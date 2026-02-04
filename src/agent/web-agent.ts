import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { OptimizedSnapshotExtractor, OptimizedSnapshot } from '../browser/optimized-snapshot.js';
import { OptimizedOpenAIClient, BatchDecision } from './optimized-openai-client.js';
import { BatchActionExecutor, BatchExecutionResult } from './batch-executor.js';
import { ActionVerifier, VerificationResult } from './action-verifier.js';
import { StateManager } from './state-manager.js';
import { RetryManager } from './retry-strategy.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { AdapterFactory, SiteAdapter } from '../browser/site-adapters/index.js';
import { ActionHistory } from './prompts/system-prompt.js';

interface AgentConfig {
    url: string;
    objective: string;
    structuredData: StructuredData;
    maxSteps?: number;
    headless?: boolean;
    recordFlow?: string;
}

interface StructuredData {
    date?: { formatted: string; day: number; month: number; year: number };
    time?: { formatted: string; hour: number; minute: number; period: string };
    credentials?: { email?: string; password?: string };
}

interface AgentResult {
    status: string;
    success: boolean;
    summary: string;
    extractedSummary: string; // Resumen de información extraída
    totalSteps: number;
    duration: number;
    finalUrl: string;
    error?: string;
    // Compatibility fields for index.ts
    steps: any[];
    data?: any;
    downloadedFiles?: string[];
    flowId?: string;
}

export class WebAgent {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    private snapshotExtractor: OptimizedSnapshotExtractor;
    private openaiClient: OptimizedOpenAIClient;
    private verifier: ActionVerifier;
    private stateManager: StateManager;
    private elementResolver: ElementResolver;
    private batchExecutor: BatchActionExecutor;
    private siteAdapter: SiteAdapter | null = null;
    private config: {
        openaiApiKey: string;
        headless?: boolean;
        recordFlow?: boolean;
        maxSteps?: number;
        openaiModel?: string;
        screenshotOnEachStep?: boolean;
    };

    constructor(config: {
        openaiApiKey: string;
        headless?: boolean;
        recordFlow?: boolean;
        maxSteps?: number;
        openaiModel?: string;
        screenshotOnEachStep?: boolean;
    }) {
        this.config = config;
        this.snapshotExtractor = new OptimizedSnapshotExtractor();
        this.openaiClient = new OptimizedOpenAIClient(config.openaiApiKey);
        this.verifier = new ActionVerifier();
        this.stateManager = new StateManager(config.maxSteps || 30);
        this.elementResolver = new ElementResolver();
        this.batchExecutor = new BatchActionExecutor(this.verifier, this.elementResolver);
    }

    async run(params: {
        url: string;
        instruction: string;
        credentials?: { email?: string; username?: string; password?: string };
        flowName?: string;
        context?: BrowserContext;
    }): Promise<AgentResult> {
        const startTime = Date.now();

        // Configurar structured data
        const now = new Date();
        const structuredData: StructuredData = {
            credentials: {
                email: params.credentials?.email || params.credentials?.username,
                password: params.credentials?.password
            },
            date: {
                formatted: now.toLocaleDateString(),
                day: now.getDate(),
                month: now.getMonth() + 1,
                year: now.getFullYear()
            },
            time: {
                formatted: now.toLocaleTimeString(),
                hour: now.getHours(),
                minute: now.getMinutes(),
                period: now.getHours() >= 12 ? 'PM' : 'AM'
            }
        };

        const config: AgentConfig = {
            url: params.url,
            objective: params.instruction,
            structuredData,
            maxSteps: this.config.maxSteps,
            headless: this.config.headless,
            recordFlow: params.flowName
        };

        try {
            // 1. Inicializar navegador
            if (params.context) {
                console.log('🚀 Iniciando agente optimizado (Contexto compartido)...');
                this.context = params.context;
                // No asignamos this.browser para evitar cerrarlo al final
            } else {
                console.log('🚀 Iniciando agente optimizado (Nuevo navegador)...');
                this.browser = await chromium.launch({ headless: config.headless ?? false });
                this.context = await this.browser.newContext();
            }

            this.page = await this.context.newPage();

            // 2. Navegar a URL inicial con fallback de estrategias
            console.log(`🌐 Navegando a ${config.url}...`);
            const waitStrategies: Array<{ strategy: 'domcontentloaded' | 'load' | 'networkidle' | 'commit'; timeout: number }> = [
                { strategy: 'domcontentloaded', timeout: 20000 },
                { strategy: 'load', timeout: 25000 },
                { strategy: 'networkidle', timeout: 30000 },
                { strategy: 'commit', timeout: 15000 }
            ];

            let navigationSuccess = false;
            for (const { strategy, timeout } of waitStrategies) {
                try {
                    await this.page.goto(config.url, {
                        waitUntil: strategy,
                        timeout: timeout
                    });
                    console.log(`✅ Navegación exitosa (${strategy})`);
                    navigationSuccess = true;
                    break;
                } catch (navError: any) {
                    console.log(`⚠️ Estrategia '${strategy}' falló: ${navError.message?.slice(0, 50)}...`);
                    // Continuar con la siguiente estrategia
                }
            }

            if (!navigationSuccess) {
                throw new Error(`No se pudo navegar a ${config.url} con ninguna estrategia`);
            }

            console.log('⏳ Esperando estabilización...');
            await this.page.waitForTimeout(2000);

            // 3. Seleccionar adaptador de sitio
            this.siteAdapter = AdapterFactory.getAdapter(config.url);
            console.log(`🔌 Usando adaptador: ${this.siteAdapter.name}`);

            // 4. Esperar a que la página tenga contenido real (Warm-up)
            console.log('⏳ Esperando a que la página renderice contenido...');
            let warmedUp = false;
            for (let i = 0; i < 15; i++) {
                try {
                    // Esperar a que la navegación se estabilice
                    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

                    const warmupSnapshot = await this.snapshotExtractor.extract(this.page);
                    if (warmupSnapshot.elements.length > 10) {
                        console.log(`✅ Página lista: ${warmupSnapshot.elements.length} elementos detectados.`);
                        warmedUp = true;
                        break;
                    }
                    if (i === 5 || i === 10) {
                        console.log('   ...scroll para despertar contenido...');
                        await this.page.evaluate(() => window.scrollBy(0, 300)).catch(() => { });
                    }
                } catch (e: any) {
                    // Si el contexto fue destruido por navegación, esperar y reintentar
                    if (e.message?.includes('context was destroyed') || e.message?.includes('navigation')) {
                        console.log('   ...página navegando, esperando estabilización...');
                        await this.page.waitForTimeout(2000);
                        continue;
                    }
                    throw e;
                }
                await this.page.waitForTimeout(1000);
            }

            if (!warmedUp) {
                console.warn('⚠️ Advertencia: Warm-up no detectó suficientes elementos, continuando de todos modos...');
            }

            // 5. Loop principal
            let lastResult: { success: boolean; error?: string; suggestion?: string } | undefined;

            while (true) {
                await this.page.waitForLoadState('domcontentloaded').catch(() => { });

                // Verificar si debemos detenernos (por límites)
                const stopCheck = this.stateManager.shouldStop();
                if (stopCheck.stop) {
                    console.log(`⏹️ Deteniendo: ${stopCheck.reason}`);
                    break;
                }

                // Detectar página de pago
                if (await this.isPaymentPage()) {
                    console.log('💳 PÁGINA DE PAGO DETECTADA - Deteniendo');
                    return this.createResult('payment_detected', startTime, config.objective);
                }

                // Tomar snapshot
                console.log(`\n📍 Paso ${this.stateManager.getState().currentStep + 1}`);
                let snapshot = await this.snapshotExtractor.extract(this.page);

                if (snapshot.elements.length === 0) {
                    console.log('   ⚠️ Snapshot vacío, esperando 2s...');
                    await this.page.waitForTimeout(2000);
                    snapshot = await this.snapshotExtractor.extract(this.page);
                }

                console.log(`   📸 ${snapshot.meta.elementCount} elementos (${snapshot.meta.extractionTimeMs}ms)`);

                // Detectar si estamos atascados
                if (this.stateManager.isStuck()) {
                    const shouldContinueRecovery = this.stateManager.recordRecoveryAttempt();
                    if (shouldContinueRecovery) {
                        console.log('⚠️ Detectado estado atascado, aplicando recuperación...');
                        await this.applyRecoveryStrategies();
                        continue;
                    }
                    // Si agotamos intentos de recuperación, continuamos al LLM para nueva estrategia
                }

                // Pedir decisión a OpenAI (Planificando Batch)
                console.log('   🤖 Pensando...');
                const decision: BatchDecision = await this.openaiClient.planActions(
                    snapshot,
                    config.objective,
                    config.structuredData,
                    this.stateManager.getActionHistory(),
                    lastResult
                );

                console.log(`   🤔 "Thinking": ${decision.thinking}`);

                // Registrar URL visitada
                this.stateManager.addVisitedUrl(this.page!.url());

                // Procesar información extraída del LLM
                if (decision.extractedInfo && decision.extractedInfo.length > 0) {
                    for (const info of decision.extractedInfo) {
                        this.stateManager.addExtractedInfo({
                            type: info.type,
                            content: info.content,
                            source: this.page!.url()
                        });
                        console.log(`   📝 Info extraída [${info.type}]: ${info.content}`);
                    }
                }

                // Verificar si terminamos según el LLM
                const doneAction = decision.actions.find(a => a.action === 'done');

                // SOLO terminar si hay una acción explícita de 'done'
                if (doneAction) {
                    const reason = doneAction.value || doneAction.why || 'Objetivo alcanzado';

                    // Verificar si realmente tuvo éxito o falló
                    const isFailure = reason.toLowerCase().includes('no encontr') ||
                        reason.toLowerCase().includes('no pude') ||
                        reason.toLowerCase().includes('imposible') ||
                        reason.toLowerCase().includes('not found') ||
                        reason.toLowerCase().includes('no_') ||
                        reason.toLowerCase().includes('sin resultado');

                    const extractedInfo = this.stateManager.getExtractedInfo();
                    const hasProductInfo = extractedInfo.some(i => ['result', 'product', 'producto'].includes(i.type));
                    const hasPrice = extractedInfo.some(i => i.type === 'price' || i.type === 'precio');
                    const looksLikePriceNotFound = /precio|price/.test(reason.toLowerCase());

                    if (isFailure && looksLikePriceNotFound && hasProductInfo && !hasPrice) {
                        console.log(`   📜 Página de producto sin precio visible - haciendo scroll y esperando antes de rendirse...`);
                        await this.page.evaluate(() => window.scrollBy(0, 600));
                        await this.page.waitForTimeout(2500);
                        continue;
                    }

                    const currentStep = this.stateManager.getState().currentStep;
                    const maxSteps = this.stateManager.getState().maxSteps;
                    const MIN_STEPS_BEFORE_GIVE_UP = 15; // Mínimo de pasos antes de permitir rendirse

                    // Si es un "fallo" pero aún tenemos muchos pasos, forzar a seguir intentando
                    if (isFailure && currentStep < MIN_STEPS_BEFORE_GIVE_UP && currentStep < maxSteps * 0.5) {
                        console.log(`⚠️ Agente quiere rendirse (${reason}) pero solo llevamos ${currentStep} pasos - forzando más intentos...`);

                        // Forzar scroll y búsqueda alternativa
                        await this.page.evaluate(() => window.scrollBy(0, 500));
                        await this.page.waitForTimeout(1000);

                        // Actualizar lastResult para que el LLM sepa que debe intentar algo diferente
                        lastResult = {
                            success: false,
                            error: `NO TE RINDAS: ${reason}. Intenta otra estrategia: busca "mexican", "tacos", "tex-mex", usa filtros, explora categorías.`,
                            suggestion: 'Prueba términos de búsqueda alternativos o navega por categorías'
                        };
                        continue;
                    }

                    console.log(`✅ Agente terminó: ${reason}`);
                    return this.createResult(isFailure ? 'failed' : 'success', startTime, config.objective);
                }

                // Si isComplete pero sin acciones, NO es éxito - forzar scroll
                if (decision.isComplete && decision.actions.length === 0) {
                    console.log('⚠️ Modelo indeciso - forzando exploración...');
                    await this.page.evaluate(() => window.scrollBy(0, 400));
                    await this.page.waitForTimeout(1500);
                    continue;
                }

                // Ejecutar Batch de acciones
                if (decision.actions.length === 0 && !decision.isComplete) {
                    console.log('   ⚠️ No hay acciones generadas, reintentando...');
                    await this.page.waitForTimeout(1000);
                    continue;
                }

                const batchResult = await this.batchExecutor.executeBatch(
                    this.page,
                    decision,
                    snapshot,
                    this.siteAdapter,
                    this.context!
                );

                // Si se abrió una nueva pestaña, actualizar la referencia
                if (batchResult.newPage) {
                    console.log(`   📑 Cambiando a nueva pestaña: ${batchResult.newPage.url()}`);
                    this.page = batchResult.newPage;
                }

                // Registrar resultados en StateManager
                for (const res of batchResult.results) {
                    this.stateManager.recordAction({
                        step: this.stateManager.getState().currentStep,
                        action: res.action.action,
                        target: res.action.ref,
                        value: res.action.value,
                        timestamp: Date.now(),
                        success: res.success,
                        reason: res.action.why,
                        snapshotHash: this.snapshotExtractor.getSnapshotHash(snapshot)
                    });
                }

                // Actualizar lastResult para el siguiente turno
                if (batchResult.stoppedEarly) {
                    const fail = batchResult.results.find(r => !r.success);
                    lastResult = {
                        success: false,
                        error: fail?.error || fail?.verification?.reason || 'Acción fallida en batch',
                        suggestion: fail?.verification?.suggestedAction
                    };
                    console.log(`   ⛔ Batch detenido: ${lastResult.error}`);
                } else {
                    lastResult = { success: true };
                    // Resetear estado de atascado cuando hay progreso real
                    this.stateManager.resetStuckState();
                }

                // Breve pausa para estabilidad
                await this.page.waitForTimeout(1000);
            }

            return this.createResult('max_steps_reached', startTime, config.objective);

        } catch (error) {
            console.error('❌ Error fatal:', error);
            return this.createResult('error', startTime, config.objective, error as Error);

        } finally {
            await this.cleanup();
        }
    }

    private async isPaymentPage(): Promise<boolean> {
        const detector = this.siteAdapter?.getPaymentDetector();
        if (!detector) return false;
        const url = this.page!.url();
        if (detector.urlPatterns.some(p => p.test(url))) return true;
        for (const selector of detector.indicators) {
            try {
                const found = await this.page!.locator(selector).count();
                if (found > 0) return true;
            } catch { }
        }
        return false;
    }

    private async applyRecoveryStrategies(): Promise<void> {
        const strategies = this.stateManager.getRecoveryStrategies();
        for (const strategy of strategies.slice(0, 2)) {
            console.log(`   🔧 Aplicando: ${strategy}`);
            switch (strategy) {
                case 'scroll_down': await this.page!.evaluate(() => window.scrollBy(0, 300)); break;
                case 'close_modal': await this.page!.keyboard.press('Escape'); break;
                case 'refresh_page': await this.page!.reload(); break;
            }
            await this.page!.waitForTimeout(500);
        }
    }

    private createResult(
        status: string,
        startTime: number,
        objective: string,
        error?: Error
    ): AgentResult {
        const duration = Date.now() - startTime;
        const steps = this.stateManager.getState().currentStep;

        // Generar resumen de información extraída
        const extractedSummary = this.stateManager.generateFinalSummary(objective, status);
        console.log(extractedSummary);

        return {
            status,
            success: status === 'success' || status === 'payment_detected',
            summary: `Status: ${status} - ${error?.message || 'Completed'}`,
            extractedSummary,
            totalSteps: steps,
            duration: duration,
            finalUrl: this.page?.url() || '',
            error: error?.message,
            // Compatibility fields
            steps: this.stateManager.getState().executedActions,
            data: this.stateManager.getExtractedInfo(),
            downloadedFiles: [],
            flowId: this.config.recordFlow ? `flow-${Date.now()}` : undefined
        };
    }

    private async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        } else if (this.page) {
            // Si no somos dueños del browser, al menos cerramos la página
            await this.page.close().catch(() => { });
        }
    }
}
