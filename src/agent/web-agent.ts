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
    /** Métricas de cobertura del objetivo */
    objectiveCoverage?: {
        coverage: number;
        componentsFound: string[];
        componentsMissing: string[];
        evidence: string[];
        confidence: number;
    };
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

    /**
     * Limpia capturedApiData para evitar memory leaks
     * Se llama automáticamente cuando se alcanza el límite
     */
    private cleanupCapturedApiData(): void {
        if (this.capturedApiData.length > WebAgent.MAX_CAPTURED_API) {
            // Mantener solo los más recientes
            this.capturedApiData = this.capturedApiData.slice(-WebAgent.MAX_CAPTURED_API);
        }
    }
    /** Ruta donde guardar storageState al finalizar (persistencia de sesión por dominio) */
    private sessionPathForSave: string | null = null;
    private static readonly MAX_CAPTURED_API = 25;
    /** AbortController para cancelación limpia del agente */
    private abortController: AbortController | null = null;
    /** Último timestamp de progreso real (acción exitosa o cambio de paso) */
    private lastProgressTimestamp: number = Date.now();
    /** Último paso registrado para detectar progreso */
    private lastStepCount: number = 0;
    /** Health check del browser - último timestamp de verificación */
    private lastBrowserHealthCheck: number = Date.now();
    /** Intervalo de health check del browser */
    private browserHealthCheckInterval: NodeJS.Timeout | null = null;
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

    /**
     * Verifica si el agente está haciendo progreso real (heartbeat)
     * Retorna true si hubo progreso en los últimos X segundos
     */
    hasRecentProgress(maxIdleSeconds: number = 30): boolean {
        const idleTime = Date.now() - this.lastProgressTimestamp;
        return idleTime < maxIdleSeconds * 1000;
    }

    /**
     * Obtiene el último timestamp de progreso
     */
    getLastProgressTimestamp(): number {
        return this.lastProgressTimestamp;
    }

    /**
     * Cancela la ejecución del agente de forma limpia
     */
    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * Verifica si el agente fue cancelado
     */
    isCancelled(): boolean {
        return this.abortController?.signal.aborted ?? false;
    }

    /**
     * Verifica la salud del browser/contexto
     */
    private async checkBrowserHealth(): Promise<boolean> {
        try {
            if (!this.page || !this.context) return false;

            // Verificar que la página no esté cerrada
            if (this.page.isClosed()) {
                console.warn('⚠️ Browser health check: página cerrada');
                return false;
            }

            // Verificar que el contexto no esté cerrado
            const pages = this.context.pages();
            if (pages.length === 0 && this.page.isClosed()) {
                console.warn('⚠️ Browser health check: contexto sin páginas');
                return false;
            }

            // Intentar una operación simple para verificar que el browser responde
            try {
                await this.page.evaluate(() => document.readyState);
            } catch (e: any) {
                if (e.message?.includes('Target closed') ||
                    e.message?.includes('Browser closed') ||
                    e.message?.includes('context was destroyed')) {
                    console.warn('⚠️ Browser health check: browser no responde');
                    return false;
                }
            }

            return true;
        } catch (error) {
            console.warn('⚠️ Browser health check falló:', (error as Error).message);
            return false;
        }
    }

    /**
     * Inicia health checks periódicos del browser
     */
    private startBrowserHealthChecks(): void {
        if (this.browserHealthCheckInterval) return; // Ya está corriendo

        const HEALTH_CHECK_INTERVAL = 30_000; // Cada 30 segundos

        this.browserHealthCheckInterval = setInterval(async () => {
            const isHealthy = await this.checkBrowserHealth();
            if (!isHealthy) {
                console.error('❌ Browser health check falló. El browser puede estar crasheado.');
                // No cancelamos automáticamente, pero logueamos el problema
            }
            this.lastBrowserHealthCheck = Date.now();
        }, HEALTH_CHECK_INTERVAL);
    }

    /**
     * Detiene los health checks del browser
     */
    private stopBrowserHealthChecks(): void {
        if (this.browserHealthCheckInterval) {
            clearInterval(this.browserHealthCheckInterval);
            this.browserHealthCheckInterval = null;
        }
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
        this.abortController = new AbortController();
        this.lastProgressTimestamp = Date.now();
        this.lastStepCount = 0;

        // Iniciar health checks del browser
        this.startBrowserHealthChecks();

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
                        // Limitar tamaño de datos capturados para evitar memory leaks
                        const dataSize = JSON.stringify(data).length;
                        const MAX_DATA_SIZE = 50_000; // 50KB por respuesta

                        if (dataSize <= MAX_DATA_SIZE) {
                            this.capturedApiData.push({ url, data });
                            this.cleanupCapturedApiData();
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
            const warmupMaxAttempts = 25; // Aumentado para SPAs muy pesadas
            const hostnameLower = hostname.toLowerCase();
            const isKnownSlowSPA = /pgaoceans4|outlook|bookings|microsoft/i.test(hostnameLower);

            for (let i = 0; i < warmupMaxAttempts; i++) {
                try {
                    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

                    // Para SPAs pesadas: esperar a que JavaScript termine de inicializar
                    if (isKnownSlowSPA && i >= 3) {
                        // Esperar a que scripts externos terminen de cargar
                        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

                        // Esperar a que elementos con data-toggle-class se inicialicen
                        await this.page.evaluate(() => {
                            return new Promise<void>((resolve) => {
                                const checkInitialized = () => {
                                    const toggleElements = document.querySelectorAll('[data-toggle-class]');
                                    if (toggleElements.length === 0 || document.readyState === 'complete') {
                                        resolve();
                                    } else {
                                        setTimeout(checkInitialized, 200);
                                    }
                                };
                                checkInitialized();
                            });
                        }).catch(() => { });
                    }

                    // Intentar aceptar cookies/banners automáticamente en sitios conocidos
                    if (i === 2 && isKnownSlowSPA) {
                        try {
                            const cookieSelectors = [
                                'button:has-text("Accept")',
                                'button:has-text("Aceptar")',
                                'button:has-text("I agree")',
                                'button:has-text("Acepto")',
                                '[id*="cookie"] button',
                                '[class*="cookie"] button',
                                '[data-testid*="cookie"] button'
                            ];
                            for (const selector of cookieSelectors) {
                                const btn = await this.page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false);
                                if (btn) {
                                    await this.page.locator(selector).first().click({ timeout: 2000 }).catch(() => { });
                                    console.log('   🍪 Banner de cookies aceptado automáticamente');
                                    await waitForPageReady(this.page, { timeout: 3000 });
                                    break;
                                }
                            }
                        } catch (_) { /* Ignorar errores de cookie banner */ }
                    }

                    const warmupSnapshot = await this.snapshotExtractor.extract(this.page);
                    if (warmupSnapshot.elements.length > 10) {
                        console.log(`✅ Página lista: ${warmupSnapshot.elements.length} elementos detectados.`);
                        warmedUp = true;
                        break;
                    }
                    if (i === 5 || i === 10 || i === 15 || i === 20) {
                        console.log('   ...scroll para despertar contenido...');
                        await this.page.evaluate(() => window.scrollBy(0, 300)).catch(() => { });
                    }
                    // SPAs lentas (pgaoceans4, Outlook Bookings): esperar más entre intentos
                    // Aumentar progresivamente el timeout para SPAs muy pesadas
                    const waitMs = isKnownSlowSPA
                        ? (i < 8 ? 3000 : (i < 15 ? 5000 : (i < 20 ? 7000 : 10000)))
                        : (i < 8 ? 2000 : (i < 15 ? 3500 : 5000));
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
                console.warn('⚠️ Advertencia: Warm-up no detectó suficientes elementos, intentando reload...');
                // Intentar 1 reload antes de rendirse
                try {
                    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
                    await waitForPageReady(this.page, { timeout: 5000 });
                    const retrySnapshot = await this.snapshotExtractor.extract(this.page);
                    if (retrySnapshot.elements.length < 5) {
                        console.log('❌ Página no responde después de reload. Abortando.');
                        return this.createResult('page_unresponsive', startTime, config.objective,
                            new Error('La página no cargó contenido interactivo después del warm-up + reload'));
                    }
                    console.log(`✅ Después de reload: ${retrySnapshot.elements.length} elementos detectados.`);
                } catch (reloadError) {
                    console.log('❌ Error en reload, abortando:', (reloadError as Error).message);
                    return this.createResult('page_unresponsive', startTime, config.objective,
                        reloadError as Error);
                }
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
                        // Resetear tracking de snapshots después de login exitoso
                        this.snapshotExtractor.resetTracking();
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

                // Early exit: Si ya extrajimos la información solicitada y es solo extracción
                if (this.isExtractionObjective(config.objective) && loginCompleted) {
                    const extractedInfo = this.stateManager.getExtractedInfo();
                    const hasRelevantInfo = extractedInfo.length > 0;
                    // Si tenemos información relevante y ya pasamos el login, considerar éxito temprano
                    if (hasRelevantInfo && this.stateManager.getState().currentStep >= 2) {
                        const objectiveLower = config.objective.toLowerCase();
                        const hasAvailability = extractedInfo.some(i =>
                            i.type === 'availability' ||
                            /horario|disponible|availability/i.test(i.content)
                        );
                        const hasPrice = extractedInfo.some(i =>
                            i.type === 'price' ||
                            /precio|price|RD\$|\$|€|£/i.test(i.content)
                        );

                        // Si el objetivo es buscar horarios/precios y ya los tenemos, terminar
                        if ((/horario|golf|disponible|mañana/i.test(objectiveLower) && hasAvailability) ||
                            (/precio|price/i.test(objectiveLower) && hasPrice)) {
                            console.log('✅ Información solicitada ya extraída. Terminando temprano.');
                            return this.createResult('success', startTime, config.objective);
                        }
                    }
                }

                // Tomar snapshot (con manejo de contexto cerrado)
                console.log(`\n📍 Paso ${this.stateManager.getState().currentStep + 1}`);
                let snapshot: OptimizedSnapshot;
                try {
                    snapshot = await this.snapshotExtractor.extract(this.page);
                } catch (snapshotError: any) {
                    const errorMessage = snapshotError.message || '';
                    if (errorMessage.includes('Target page, context or browser has been closed') ||
                        errorMessage.includes('Target closed') ||
                        errorMessage.includes('Browser closed') ||
                        errorMessage.includes('context was destroyed')) {
                        console.log('⚠️ Contexto cerrado durante snapshot. Terminando agente.');
                        return this.createResult('context_closed', startTime, config.objective, snapshotError as Error);
                    }
                    throw snapshotError;
                }

                if (snapshot.elements.length === 0) {
                    console.log('   ⚠️ Snapshot vacío, esperando que la página cargue...');
                    try {
                        await waitForPageReady(this.page!, { timeout: 5000 });
                        snapshot = await this.snapshotExtractor.extract(this.page);
                    } catch (waitError: any) {
                        const errorMessage = waitError.message || '';
                        if (errorMessage.includes('Target page, context or browser has been closed') ||
                            errorMessage.includes('Target closed') ||
                            errorMessage.includes('Browser closed') ||
                            errorMessage.includes('context was destroyed')) {
                            console.log('⚠️ Contexto cerrado durante wait. Terminando agente.');
                            return this.createResult('context_closed', startTime, config.objective, waitError as Error);
                        }
                        throw waitError;
                    }
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

                // Detectar ciclo wait/scroll (agente atascado sin progreso)
                const actionHistory = this.stateManager.getActionHistory();
                if (actionHistory.length >= 4) {
                    const lastActions = actionHistory.slice(-4);
                    const allWaitsOrScrolls = lastActions.every(a =>
                        a.action === 'wait' ||
                        a.action === 'scroll' ||
                        (a.action === 'click' && a.reason?.toLowerCase().includes('scroll'))
                    );
                    if (allWaitsOrScrolls && loginCompleted) {
                        console.log('⚠️ Agente atascado en ciclo wait/scroll. Terminando para evitar timeout.');
                        return this.createResult('stuck_in_wait_cycle', startTime, config.objective);
                    }
                }

                // Detectar si estamos atascados (tres métodos: por snapshot hash, por falta de progreso, y por loop de snapshots)
                const stuckByHash = this.stateManager.isStuck();
                const stuckByProgress = this.stateManager.isStuckByLackOfProgress();
                const stuckBySnapshotLoop = this.snapshotExtractor.isInSnapshotLoop(3);

                if (stuckByHash || stuckByProgress || stuckBySnapshotLoop) {
                    const reasons = [];
                    if (stuckByHash) reasons.push('snapshot hash no cambia');
                    if (stuckByProgress) reasons.push('sin acciones exitosas recientes');
                    if (stuckBySnapshotLoop) reasons.push('loop de snapshots idénticos');
                    const stuckReason = reasons.join(', ');
                    console.log(`⚠️ Detectado estado atascado (${stuckReason}), aplicando recuperación...`);

                    const shouldContinueRecovery = this.stateManager.recordRecoveryAttempt();
                    if (shouldContinueRecovery) {
                        await this.applyRecoveryStrategies();
                        continue;
                    }
                    // Si agotamos intentos de recuperación, continuamos al LLM para nueva estrategia
                }

                // Ignorar loading si es probablemente un falso positivo (loader decorativo)
                if (snapshot.pageState.loadingState?.likelyFalsePositive && snapshot.pageState.loadingState.isLoading) {
                    console.log(`   ⚠️ Loading detectado pero probablemente decorativo (${snapshot.pageState.loadingState.consecutiveLoadingCount} snapshots seguidos). Ignorando.`);
                    // No hacer wait innecesario
                }

                // Detectar clicks repetidos al mismo elemento (limitar a 2 intentos)
                const lastActions = this.stateManager.getState().executedActions.slice(-3);
                const repeatedClick = lastActions.filter(a =>
                    a.action === 'click' &&
                    a.target === lastActions[0]?.target &&
                    !a.success &&
                    lastActions[0]?.target !== undefined
                );
                const blockedRefs = new Set<string>();
                if (repeatedClick.length >= 2 && lastActions[0]?.target) {
                    blockedRefs.add(lastActions[0].target);
                    console.log(`   ⚠️ Bloqueando click repetido en [${lastActions[0].target}] - ya falló 2 veces`);
                }

                // Decisión local: si hay un solo botón obvio (Aceptar, Siguiente...), ejecutar sin LLM
                let decision: BatchDecision | null = tryObviousLocalDecision(snapshot);
                if (decision) {
                    console.log('   ⚡ Decisión local (sin LLM):', decision.actions[0]?.why ?? 'click obvio');
                } else {
                    console.log('   🤖 Pensando...');
                    // Pasar blockedRefs al prompt para que el LLM no los use
                    decision = await this.openaiClient.planActions(
                        snapshot,
                        config.objective,
                        config.structuredData,
                        this.stateManager.getActionHistory(),
                        lastResult,
                        blockedRefs
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

                // Early exit: Si hay errores repetidos (ej: "No hay fechas disponibles" varias veces)
                if (loginCompleted) {
                    const extractedInfo = this.stateManager.getExtractedInfo();
                    const errorInfoCount = extractedInfo.filter(i =>
                        i.type === 'error' ||
                        /no hay|no disponible|not available|sin.*disponible/i.test(i.content)
                    ).length;
                    if (errorInfoCount >= 2) {
                        console.log('⚠️ Información de error repetida detectada. Terminando temprano para evitar timeout.');
                        return this.createResult('error_repeated', startTime, config.objective);
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

                let batchResult: BatchExecutionResult;
                try {
                    batchResult = await this.batchExecutor.executeBatch(
                        this.page,
                        decision,
                        snapshot,
                        this.siteAdapter,
                        this.context!,
                        structuredData.credentials
                    );
                } catch (batchError: any) {
                    // Detectar si el contexto fue cerrado (timeout de otro agente o cierre en cascada)
                    const errorMessage = batchError.message || '';
                    if (errorMessage.includes('Target page, context or browser has been closed') ||
                        errorMessage.includes('Target closed') ||
                        errorMessage.includes('Browser closed') ||
                        errorMessage.includes('context was destroyed')) {
                        console.log('⚠️ Contexto cerrado durante ejecución. Terminando agente.');
                        return this.createResult('context_closed', startTime, config.objective, batchError as Error);
                    }
                    // Re-lanzar otros errores
                    throw batchError;
                }

                // Si se abrió una nueva pestaña, actualizar la referencia
                if (batchResult.newPage) {
                    console.log(`   📑 Cambiando a nueva pestaña: ${batchResult.newPage.url()}`);
                    this.page = batchResult.newPage;
                }

                // Registrar resultados en StateManager
                const currentStepBefore = this.stateManager.getState().currentStep;
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

                // Actualizar heartbeat si hubo progreso real (acción exitosa o cambio de paso)
                const currentStepAfter = this.stateManager.getState().currentStep;
                const hasSuccessfulAction = batchResult.results.some(r => r.success);
                const stepChanged = currentStepAfter > currentStepBefore;

                if (hasSuccessfulAction || stepChanged) {
                    this.lastProgressTimestamp = Date.now();
                    this.lastStepCount = currentStepAfter;
                }

                // Verificar cancelación después de cada batch
                if (this.isCancelled()) {
                    console.log('⚠️ Agente cancelado. Terminando ejecución.');
                    return this.createResult('cancelled', startTime, config.objective);
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
        if (detector.urlPatterns.some((p: RegExp) => p.test(url))) return true;
        for (const selector of detector.indicators) {
            try {
                const found = await this.page!.locator(selector).count();
                if (found > 0) return true;
            } catch { }
        }
        return false;
    }

    private async applyRecoveryStrategies(): Promise<void> {
        // Verificar si la página está cerrada antes de aplicar estrategias
        if (!this.page || this.page.isClosed()) {
            return;
        }

        const strategies = this.stateManager.getRecoveryStrategies();
        for (const strategy of strategies.slice(0, 3)) {
            // Verificar nuevamente antes de cada estrategia
            if (!this.page || this.page.isClosed()) {
                return;
            }

            try {
                console.log(`   🔧 Aplicando: ${strategy}`);
                switch (strategy) {
                    case 'scroll_down':
                        await this.page.evaluate(() => window.scrollBy(0, 300)).catch(() => { });
                        break;
                    case 'close_modal':
                        await this.page.keyboard.press('Escape').catch(() => { });
                        break;
                    case 'click_outside':
                        // Intentar click en esquina superior izquierda para cerrar modales
                        await this.page.mouse.click(10, 10).catch(() => { });
                        // Y también en el centro-arriba por si acaso
                        await this.page.mouse.click(window.innerWidth / 2, 50).catch(() => { });
                        break;
                    case 'refresh_page':
                        await this.page.reload().catch(() => { });
                        break;
                }

                // Espera segura que no lanza error si la página está cerrada
                try {
                    await this.page.waitForTimeout(500);
                } catch (e: any) {
                    const errorMessage = e?.message || '';
                    if (errorMessage.includes('Target page, context or browser has been closed') ||
                        errorMessage.includes('Target closed') ||
                        errorMessage.includes('Browser closed') ||
                        errorMessage.includes('context was destroyed')) {
                        return;
                    }
                    throw e;
                }
            } catch (e: any) {
                const errorMessage = e?.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    return;
                }
                // Continuar con la siguiente estrategia si hay otro tipo de error
            }
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

        // Calcular cobertura del objetivo
        const objectiveCoverage = this.stateManager.calculateObjectiveCoverage(objective);

        // Generar resumen de información extraída
        const extractedSummary = this.stateManager.generateFinalSummary(objective, status);
        console.log(extractedSummary);

        // Log de cobertura
        if (objectiveCoverage.coverage > 0) {
            console.log(`\n📊 Cobertura del objetivo: ${objectiveCoverage.coverage}% (confianza: ${objectiveCoverage.confidence}%)`);
            if (objectiveCoverage.componentsFound.length > 0) {
                console.log(`   ✓ Componentes encontrados: ${objectiveCoverage.componentsFound.join(', ')}`);
            }
            if (objectiveCoverage.componentsMissing.length > 0) {
                console.log(`   ✗ Componentes faltantes: ${objectiveCoverage.componentsMissing.join(', ')}`);
            }
        }

        return {
            status,
            success: status === 'success' || status === 'payment_detected',
            summary: `Status: ${status} - ${error?.message || 'Completed'}`,
            extractedSummary,
            totalSteps: steps,
            duration: duration,
            finalUrl: this.page?.url() || '',
            error: error?.message,
            objectiveCoverage: {
                coverage: objectiveCoverage.coverage,
                componentsFound: objectiveCoverage.componentsFound,
                componentsMissing: objectiveCoverage.componentsMissing,
                evidence: objectiveCoverage.evidence,
                confidence: objectiveCoverage.confidence
            },
            // Compatibility fields
            steps: this.stateManager.getState().executedActions,
            data: this.stateManager.getExtractedInfo(),
            downloadedFiles: [],
            flowId: this.config.recordFlow ? `flow-${Date.now()}` : undefined
        };
    }

    private async cleanup(): Promise<void> {
        // Guardar sesión solo si el contexto aún está abierto y es nuestro propio browser
        if (this.browser && this.context && this.sessionPathForSave && !this.config.optimizeForParallel) {
            try {
                // Verificar que el contexto no esté cerrado antes de intentar guardar
                const pages = this.context.pages();
                if (pages.length > 0) {
                    ensureSessionsDir(this.config.sessionsDir);
                    await this.context.storageState({ path: this.sessionPathForSave });
                    console.log('🔐 Sesión guardada para próxima ejecución');
                }
            } catch (e: any) {
                const errorMsg = (e as Error).message || '';
                // Ignorar errores de contexto cerrado (normal en modo paralelo)
                if (!errorMsg.includes('Target closed') &&
                    !errorMsg.includes('Browser closed') &&
                    !errorMsg.includes('context was destroyed') &&
                    !errorMsg.includes('Target page, context or browser has been closed')) {
                    console.warn('⚠️ No se pudo guardar sesión:', errorMsg);
                }
            }
            this.sessionPathForSave = null;
        }

        // Cerrar página siempre para liberar memoria (especialmente importante en modo paralelo)
        // Pero solo si el contexto aún está abierto (en modo paralelo, el contexto se cierra externamente)
        if (this.page && !this.config.optimizeForParallel) {
            try {
                await this.page.close();
            } catch (e: any) {
                // Ignorar errores de página ya cerrada
                const errorMsg = e.message || '';
                if (!errorMsg.includes('Target closed') &&
                    !errorMsg.includes('Browser closed') &&
                    !errorMsg.includes('Target page, context or browser has been closed')) {
                    console.warn('⚠️ Error al cerrar página:', errorMsg);
                }
            }
            this.page = null;
        } else if (this.page) {
            // En modo paralelo, solo limpiar referencia
            this.page = null;
        }

        // Solo cerrar browser si es nuestro propio browser (no compartido)
        if (this.browser && !this.config.optimizeForParallel) {
            try {
                await this.browser.close();
            } catch (e: any) {
                const errorMsg = e.message || '';
                if (!errorMsg.includes('Target closed') &&
                    !errorMsg.includes('Browser closed')) {
                    console.warn('⚠️ Error al cerrar browser:', errorMsg);
                }
            }
            this.browser = null;
        }

        // Limpiar referencias para ayudar al GC
        if (this.config.optimizeForParallel) {
            this.capturedApiData = [];
            // No cerrar contexto en modo paralelo - se cierra externamente por runSingleAgent
            this.context = null;
        }

        // Limpiar siempre capturedApiData para evitar memory leaks
        this.capturedApiData = [];
        this.abortController = null;

        // Detener health checks
        this.stopBrowserHealthChecks();
    }
}
