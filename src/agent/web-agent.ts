import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { OptimizedSnapshotExtractor, OptimizedSnapshot } from '../browser/optimized-snapshot.js';
import { OptimizedOpenAIClient, BatchDecision } from './optimized-openai-client.js';
import { tryObviousLocalDecision } from './local-decision.js';
import { BatchActionExecutor, BatchExecutionResult } from './batch-executor.js';
import { ActionVerifier, VerificationResult } from './action-verifier.js';
import { StateManager } from './state-manager.js';
import { RetryManager } from './retry-strategy.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { AdapterFactory, SiteAdapter } from '../browser/site-adapters/index.js';
import { waitForPageReady } from '../browser/page-waits.js';
import { extractContent } from '../browser/content-extractor.js';
import { ActionHistory } from './prompts/system-prompt.js';
import { getSessionFilePath, hasStoredSession, ensureSessionsDir } from './session-persistence.js';
import { LoginVerifier } from './login-verifier.js';

interface AgentConfig {
    url: string;
    objective: string;
    structuredData: StructuredData;
    maxSteps?: number;
    maxLoginSteps?: number;
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
    private loginVerifier: LoginVerifier;
    /** Respuestas API/XHR capturadas para contexto del LLM (precios, disponibilidad, etc.) */
    private capturedApiData: { url: string; data: unknown }[] = [];
    /** Ruta donde guardar storageState al finalizar (persistencia de sesión por dominio) */
    private sessionPathForSave: string | null = null;
    private static readonly MAX_CAPTURED_API = 25;
    private config: {
        openaiApiKey: string;
        headless?: boolean;
        recordFlow?: boolean;
        maxSteps?: number;
        openaiModel?: string;
        openaiMaxTokens?: number;
        useMiniForSimpleSteps?: boolean;
        screenshotOnEachStep?: boolean;
        /** Directorio para sesiones guardadas (cookies/storage). Por defecto data/sessions */
        sessionsDir?: string;
        /** Optimizar para ejecución paralela (reduce snapshots, memoria) */
        optimizeForParallel?: boolean;
    };

    constructor(config: {
        openaiApiKey: string;
        headless?: boolean;
        recordFlow?: boolean;
        maxSteps?: number;
        openaiModel?: string;
        openaiMaxTokens?: number;
        useMiniForSimpleSteps?: boolean;
        screenshotOnEachStep?: boolean;
        sessionsDir?: string;
        optimizeForParallel?: boolean;
    }) {
        this.config = config;
        this.snapshotExtractor = new OptimizedSnapshotExtractor();
        this.openaiClient = new OptimizedOpenAIClient(config.openaiApiKey, {
            model: config.openaiModel ?? 'gpt-4o',
            maxTokens: config.openaiMaxTokens ?? 1200,
            useMiniForSimpleSteps: config.useMiniForSimpleSteps ?? true
        });
        this.verifier = new ActionVerifier();
        this.stateManager = new StateManager(config.maxSteps || 30);
        this.elementResolver = new ElementResolver();
        this.batchExecutor = new BatchActionExecutor(this.verifier, this.elementResolver);
        this.loginVerifier = new LoginVerifier();
    }

    async run(params: {
        url: string;
        instruction: string;
        credentials?: { email?: string; username?: string; password?: string };
        /** URL donde loguearse (si es distinta de url). Si se indica, se navega primero aquí. */
        loginUrl?: string;
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
            maxLoginSteps: 5,
            headless: this.config.headless,
            recordFlow: params.flowName
        };

        this.verifier.setConfigLoginUrl(params.loginUrl ?? undefined);

        try {
            // 1. Inicializar navegador (con persistencia de sesión por dominio si aplica)
            const initialUrl = params.loginUrl || config.url;
            const hostname = new URL(initialUrl).hostname;

            if (params.context) {
                console.log('🚀 Iniciando agente optimizado (Contexto compartido)...');
                this.context = params.context;
            } else {
                console.log('🚀 Iniciando agente optimizado (Nuevo navegador)...');
                this.browser = await chromium.launch({ headless: config.headless ?? false });
                const sessionPath = getSessionFilePath(hostname, this.config.sessionsDir);
                if (hasStoredSession(hostname, this.config.sessionsDir)) {
                    this.context = await this.browser.newContext({ storageState: sessionPath });
                    console.log('🔐 Sesión restaurada para', hostname);
                } else {
                    this.context = await this.browser.newContext();
                }
                this.sessionPathForSave = sessionPath;
            }

            this.page = await this.context.newPage();

            // Interceptar respuestas API para obtener datos estructurados (precios, disponibilidad, etc.)
            this.page.on('response', async (response) => {
                const url = response.url();
                if (!url.includes('/api/') && !url.includes('graphql') && !url.includes('rest/')) return;
                if (response.status() !== 200) return;
                try {
                    const data = await response.json().catch(() => null);
                    if (data) {
                        this.capturedApiData.push({ url, data });
                        if (this.capturedApiData.length > WebAgent.MAX_CAPTURED_API) {
                            this.capturedApiData.shift();
                        }
                    }
                } catch (_) { }
            });

            // 2. Navegar a URL inicial (loginUrl si existe, si no url) con fallback de estrategias
            if (params.loginUrl) {
                console.log(`🌐 Navegando a página de login: ${params.loginUrl}...`);
            } else {
                console.log(`🌐 Navegando a ${config.url}...`);
            }
            const waitStrategies: Array<{ strategy: 'domcontentloaded' | 'load' | 'networkidle' | 'commit'; timeout: number }> = [
                { strategy: 'domcontentloaded', timeout: 20000 },
                { strategy: 'load', timeout: 25000 },
                { strategy: 'networkidle', timeout: 30000 },
                { strategy: 'commit', timeout: 15000 }
            ];

            let navigationSuccess = false;
            for (const { strategy, timeout } of waitStrategies) {
                try {
                    await this.page.goto(initialUrl, {
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
                throw new Error(`No se pudo navegar a ${initialUrl} con ninguna estrategia`);
            }

            console.log('⏳ Esperando que la página esté lista...');
            await waitForPageReady(this.page!, { timeout: 10000 });

            // 3. Seleccionar adaptador de sitio
            this.siteAdapter = AdapterFactory.getAdapter(config.url);
            console.log(`🔌 Usando adaptador: ${this.siteAdapter.name}`);

            // 4. Esperar a que la página tenga contenido real (Warm-up); más paciencia para SPAs lentas
            console.log('⏳ Esperando a que la página renderice contenido...');
            let warmedUp = false;
            const warmupMaxAttempts = 20;
            for (let i = 0; i < warmupMaxAttempts; i++) {
                try {
                    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

                    const warmupSnapshot = await this.snapshotExtractor.extract(this.page);
                    if (warmupSnapshot.elements.length > 10) {
                        console.log(`✅ Página lista: ${warmupSnapshot.elements.length} elementos detectados.`);
                        warmedUp = true;
                        break;
                    }
                    if (i === 5 || i === 10 || i === 15) {
                        console.log('   ...scroll para despertar contenido...');
                        await this.page.evaluate(() => window.scrollBy(0, 300)).catch(() => { });
                    }
                    // SPAs lentas (pgaoceans4, Outlook Bookings): esperar más entre intentos
                    // Aumentar progresivamente el timeout para SPAs muy pesadas
                    const waitMs = i < 8 ? 2000 : (i < 15 ? 3500 : 5000);
                    await waitForPageReady(this.page, { timeout: waitMs });
                } catch (e: any) {
                    if (e.message?.includes('context was destroyed') || e.message?.includes('navigation')) {
                        console.log('   ...página navegando, esperando estabilización...');
                        await waitForPageReady(this.page, { timeout: 5000 });
                        continue;
                    }
                    throw e;
                }
            }

            if (!warmedUp) {
                console.warn('⚠️ Advertencia: Warm-up no detectó suficientes elementos, continuando de todos modos...');
            }

            // 5. Loop principal (con presupuesto de login separado)
            let lastResult: { success: boolean; error?: string; suggestion?: string } | undefined;
            let loginBudget = config.maxLoginSteps ?? 5;
            let loginCompleted = !params.loginUrl;

            while (true) {
                await this.page.waitForLoadState('domcontentloaded').catch(() => { });

                const currentUrl = this.page!.url();

                // --- Control de pasos separado: login vs tarea ---
                if (params.loginUrl && !loginCompleted) {
                    const stillOnLogin = this.isLoginRelatedPage(currentUrl);
                    if (!stillOnLogin || loginBudget <= 1) {
                        const loginCheck = await this.loginVerifier.verify(this.page!, params.loginUrl);
                        console.log(`🔐 Login verification: ${loginCheck.isLoggedIn ? '✅' : '❌'} (${loginCheck.confidence}%)`);
                        loginCheck.evidence.forEach(e => console.log(`   ${e}`));
                        if (!loginCheck.isLoggedIn) {
                            return this.createResult('login_failed', startTime, config.objective,
                                new Error(loginCheck.failureReason || 'Login verification failed'));
                        }
                        loginCompleted = true;
                        this.stateManager.resetStepCount();
                        console.log(`✅ Login completado. Reseteando contador para tarea.`);
                    } else {
                        loginBudget--;
                        if (loginBudget <= 0) {
                            console.log('❌ Login agotó su presupuesto de pasos');
                            return this.createResult('login_failed', startTime, config.objective);
                        }
                    }
                }

                if (loginCompleted) {
                    const stopCheck = this.stateManager.shouldStop();
                    if (stopCheck.stop) {
                        console.log(`⏹️ Deteniendo: ${stopCheck.reason}`);
                        break;
                    }
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
                    console.log('   ⚠️ Snapshot vacío, esperando que la página cargue...');
                    await waitForPageReady(this.page!, { timeout: 5000 });
                    snapshot = await this.snapshotExtractor.extract(this.page);
                }

                console.log(`   📸 ${snapshot.meta.elementCount} elementos (${snapshot.meta.extractionTimeMs}ms)`);

                snapshot.capturedApiData = this.capturedApiData.length ? [...this.capturedApiData] : undefined;

                if (this.isExtractionObjective(config.objective)) {
                    try {
                        snapshot.extractedContent = await extractContent(this.page!);
                    } catch (e) {
                        console.log('   ⚠️ extractContent falló:', (e as Error).message);
                    }
                }

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

                // Decisión local: si hay un solo botón obvio (Aceptar, Siguiente...), ejecutar sin LLM
                let decision: BatchDecision | null = tryObviousLocalDecision(snapshot);
                if (decision) {
                    console.log('   ⚡ Decisión local (sin LLM):', decision.actions[0]?.why ?? 'click obvio');
                } else {
                    console.log('   🤖 Pensando...');
                    decision = await this.openaiClient.planActions(
                        snapshot,
                        config.objective,
                        config.structuredData,
                        this.stateManager.getActionHistory(),
                        lastResult
                    );
                    console.log(`   🤔 "Thinking": ${decision.thinking}`);
                }

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
                    this.context!,
                    structuredData.credentials
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

                // Detectar bucle detalle → back → click producto sin extraer precios
                if (this.stateManager.isInDetailBackClickLoop()) {
                    const hasPrice = this.stateManager.getExtractedInfo().some(i => i.type === 'price' || i.type === 'precio');
                    console.log(`🔄 Bucle detectado (varios back + click sin precio). Deteniendo para evitar repetición infinita.`);
                    const status = hasPrice ? 'success' : 'price_not_visible_in_detail_pages';
                    return this.createResult(status, startTime, config.objective);
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
            // Limpieza adicional para modo paralelo
            if (this.config.optimizeForParallel) {
                // Forzar garbage collection si está disponible
                if (global.gc) {
                    global.gc();
                }
            }
        }
    }

    /** Detecta si la URL es de login (para presupuesto de pasos y verificación). */
    private isLoginRelatedPage(url: string): boolean {
        const u = url.toLowerCase();
        return /\/login|\/signin|\/auth|\/iniciar-sesion|front-end\/login|consumer\/login/.test(u);
    }

    /** Detecta si la instrucción es de extracción (precios, listados, información) para activar extractContent */
    private isExtractionObjective(instruction: string): boolean {
        const lower = instruction.toLowerCase();
        const extractionKeywords = [
            'extraer', 'extrae', 'extraiga', 'obtener', 'obtén', 'listar', 'lista', 'listado',
            'precios', 'precio', 'price', 'prices', 'cuánto cuesta', 'cuanto cuesta',
            'disponibilidad', 'disponible', 'availability', 'inventario',
            'información', 'informacion', 'info', 'datos', 'contenido',
            'buscar precios', 'sacar precios', 'qué hay', 'que hay', 'resumen'
        ];
        return extractionKeywords.some(kw => lower.includes(kw));
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
        if (this.browser && this.context && this.sessionPathForSave) {
            try {
                ensureSessionsDir(this.config.sessionsDir);
                await this.context.storageState({ path: this.sessionPathForSave });
                console.log('🔐 Sesión guardada para próxima ejecución');
            } catch (e) {
                console.warn('⚠️ No se pudo guardar sesión:', (e as Error).message);
            }
            this.sessionPathForSave = null;
        }
        
        // Cerrar página siempre para liberar memoria (especialmente importante en modo paralelo)
        if (this.page) {
            await this.page.close().catch(() => { });
            this.page = null;
        }
        
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        
        // Limpiar referencias para ayudar al GC
        if (this.config.optimizeForParallel) {
            this.capturedApiData = [];
            this.context = null;
        }
    }
}
