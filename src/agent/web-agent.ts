import { chromium, Browser, Page } from 'playwright';
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
            console.log('🚀 Iniciando agente optimizado (Phase 2)...');
            this.browser = await chromium.launch({ headless: config.headless ?? false });
            this.page = await this.browser.newPage();

            // 2. Navegar a URL inicial
            console.log(`🌐 Navegando a ${config.url}...`);
            await this.page.goto(config.url, { waitUntil: 'load' });
            try { await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { }); } catch { }

            // 3. Seleccionar adaptador de sitio
            this.siteAdapter = AdapterFactory.getAdapter(config.url);
            console.log(`🔌 Usando adaptador: ${this.siteAdapter.name}`);

            // 4. Loop principal
            let lastResult: { success: boolean; error?: string; suggestion?: string } | undefined;

            while (true) {
                // Verificar si debemos detenernos (por límites)
                const stopCheck = this.stateManager.shouldStop();
                if (stopCheck.stop) {
                    console.log(`⏹️ Deteniendo: ${stopCheck.reason}`);
                    break;
                }

                // Detectar página de pago
                if (await this.isPaymentPage()) {
                    console.log('💳 PÁGINA DE PAGO DETECTADA - Deteniendo');
                    return this.createResult('payment_detected', startTime);
                }

                // Tomar snapshot
                console.log(`\n📍 Paso ${this.stateManager.getState().currentStep + 1}`);
                const snapshot = await this.snapshotExtractor.extract(this.page);
                console.log(`   📸 ${snapshot.meta.elementCount} elementos (${snapshot.meta.extractionTimeMs}ms)`);

                // Detectar si estamos atascados
                if (this.stateManager.isStuck()) {
                    console.log('⚠️ Detectado estado atascado, aplicando recuperación...');
                    await this.applyRecoveryStrategies();
                    continue;
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

                // Verificar si terminamos según el LLM
                // Si la acción es 'done' o explícitamente isComplete
                const doneAction = decision.actions.find(a => a.action === 'done');
                if (doneAction || (decision.isComplete && decision.actions.length === 0)) {
                    console.log('✅ Objetivo completado según el agente!');
                    return this.createResult('success', startTime);
                }

                // Ejecutar Batch de acciones
                const batchResult = await this.batchExecutor.executeBatch(
                    this.page,
                    decision,
                    snapshot,
                    this.siteAdapter
                );

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
                }

                // Breve pausa para estabilidad
                await this.page.waitForTimeout(500);
            }

            return this.createResult('max_steps_reached', startTime);

        } catch (error) {
            console.error('❌ Error fatal:', error);
            return this.createResult('error', startTime, error as Error);

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
        error?: Error
    ): AgentResult {
        const duration = Date.now() - startTime;
        const steps = this.stateManager.getState().currentStep;
        return {
            status,
            success: status === 'success' || status === 'payment_detected',
            summary: `Status: ${status} - ${error?.message || 'Completed'}`,
            totalSteps: steps,
            duration: duration,
            finalUrl: this.page?.url() || '',
            error: error?.message,
            // Compatibility fields
            steps: this.stateManager.getState().executedActions,
            data: {},
            downloadedFiles: [],
            flowId: this.config.recordFlow ? `flow-${Date.now()}` : undefined
        };
    }

    private async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        }
    }
}
