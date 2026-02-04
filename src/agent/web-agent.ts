/**
 * Web Agent - Main agent that orchestrates browser automation with AI
 */

import type {
    AgentOptions,
    AgentInput,
    AgentResult,
    PlannedAction,
    StepResult,
    DoneResponse,
    Config,
} from '../core/types.js';
import { loadConfig, validateConfig } from '../core/config.js';
import { BrowserClient } from '../browser/browser-client.js';
import { OpenAIClient } from './openai-client.js';
import { ActionExecutor } from './action-executor.js';
import { FlowRecorder } from '../recorder/flow-recorder.js';
import { VisionCache } from './vision-cache.js';
import { PerformanceMetrics } from '../core/metrics.js';
import { extractStructuredData, type StructuredInput } from './prompts.js';

export class WebAgent {
    private config: Config;
    private openai: OpenAIClient;
    private browser: BrowserClient | null = null;
    private recorder: FlowRecorder | null = null;
    private options: AgentOptions;
    private visionCache = new VisionCache();
    private metrics = new PerformanceMetrics();

    // Para detectar estados estancados
    private lastSnapshotHash: string = '';
    private stuckCounter: number = 0;
    private readonly MAX_STUCK_COUNT = 3;

    // Token storage for payment continuation
    private static tokenStore: Map<string, { url: string; timestamp: number; data: any }> = new Map();

    /**
     * Generate a unique token for payment continuation
     */
    private generatePaymentToken(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `pay_${timestamp}_${random}`;
    }

    /**
     * Store token data for later retrieval
     */
    private storeTokenData(token: string, url: string, data: any): void {
        WebAgent.tokenStore.set(token, {
            url,
            timestamp: Date.now(),
            data
        });

        // Clean old tokens (older than 1 hour)
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, value] of WebAgent.tokenStore.entries()) {
            if (value.timestamp < oneHourAgo) {
                WebAgent.tokenStore.delete(key);
            }
        }
    }

    /**
     * Get stored token data
     */
    static getTokenData(token: string): { url: string; timestamp: number; data: any } | undefined {
        return WebAgent.tokenStore.get(token);
    }

    /**
     * Detect if current page is a payment/checkout page
     */
    private detectPaymentPage(url: string, elements: { role: string; name: string; selector?: string }[]): {
        isPaymentPage: boolean;
        reservationInfo: {
            date?: string;
            time?: string;
            product?: string;
            price?: string;
        };
    } {
        const urlLower = url.toLowerCase();
        // Normalizar espacios múltiples y saltos de línea en los nombres
        const elementNames = elements.map(e => (e.name || '').toLowerCase().replace(/\s+/g, ' ').trim());
        const elementNamesJoined = elementNames.join(' ');
        
        // Extraer IDs y clases de los selectores para detección adicional
        const selectors = elements.map(e => (e.selector || '').toLowerCase()).join(' ');

        // Check URL patterns for payment/checkout pages
        const paymentUrlPatterns = [
            'make-booking',
            'checkout',
            'payment',
            'pago',
            'confirmar',
            'confirm',
            'cart',
            'carrito'
        ];

        const isPaymentUrl = paymentUrlPatterns.some(pattern => urlLower.includes(pattern));

        // Check for payment-related elements
        // Patrones genéricos que funcionan con cualquier sitio web
        const paymentElementPatterns = [
            // Botones de acción
            'procesar pago',
            'realizar pago',
            'pagar',
            'pay',
            'checkout',
            'confirmar',
            'confirm',
            'completar',
            'complete',
            'finalizar',
            'finish',
            'submit',
            'place order',
            'buy now',
            'comprar',
            'reservar',
            'book now',
            // Información de resumen
            'total',
            'subtotal',
            'summary',
            'resumen',
            'order details',
            'detalle',
            // Métodos de pago
            'payment method',
            'método de pago',
            'credit card',
            'tarjeta',
            'paypal',
            'billing'
        ];

        const hasPaymentElements = paymentElementPatterns.some(pattern =>
            elementNamesJoined.includes(pattern)
        );
        
        // Patrones de ID y clases que indican página de pago/confirmación
        // Esto detecta elementos como id="pay", class="checkout-btn", etc.
        const paymentSelectorPatterns = [
            '#pay',           // id="pay"
            '#payment',       // id="payment"
            '#checkout',      // id="checkout"
            '#confirm',       // id="confirm"
            '#submit',        // id="submit"
            '#order',         // id="order"
            '#purchase',      // id="purchase"
            '#buy',           // id="buy"
            '#reserve',       // id="reserve"
            '#book',          // id="book"
            '.pay',           // class contiene "pay"
            '.payment',       // class contiene "payment"
            '.checkout',      // class contiene "checkout"
            '.confirm',       // class contiene "confirm"
            '.purchase',      // class contiene "purchase"
            '.buy-',          // class contiene "buy-"
            '.reserve',       // class contiene "reserve"
            '.booking',       // class contiene "booking"
            'btn-pay',        // class="btn-pay"
            'btn-checkout',   // class="btn-checkout"
            'btn-confirm',    // class="btn-confirm"
            'submit-order',   // class="submit-order"
            'place-order',    // class="place-order"
        ];
        
        const hasPaymentSelectors = paymentSelectorPatterns.some(pattern =>
            selectors.includes(pattern)
        );

        // Extract reservation info from elements
        const reservationInfo: {
            date?: string;
            time?: string;
            product?: string;
            price?: string;
        } = {};

        // Look for date/time in element names (format: DD/MM/YYYY HH:MMam)
        for (const name of elementNames) {
            // Match date pattern like "03/02/2026"
            const dateMatch = name.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (dateMatch) {
                reservationInfo.date = dateMatch[1];
            }

            // Match time pattern like "6:20am" or "10:00am"
            const timeMatch = name.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
            if (timeMatch) {
                reservationInfo.time = timeMatch[1];
            }

            // Match price pattern like "$50.00" or "50.00"
            const priceMatch = name.match(/\$?\s*(\d+(?:\.\d{2})?)/);
            if (priceMatch && name.includes('$')) {
                reservationInfo.price = `$${priceMatch[1]}`;
            }
        }

        // Also try to extract from URL (e.g., /make-booking/620am/03022026)
        const urlTimeMatch = url.match(/\/(\d{1,4})(am|pm)\//i);
        if (urlTimeMatch && !reservationInfo.time) {
            const timeStr = urlTimeMatch[1];
            const period = urlTimeMatch[2];
            if (timeStr.length <= 2) {
                reservationInfo.time = `${timeStr}:00${period}`;
            } else if (timeStr.length === 3) {
                reservationInfo.time = `${timeStr[0]}:${timeStr.slice(1)}${period}`;
            } else if (timeStr.length === 4) {
                reservationInfo.time = `${timeStr.slice(0, 2)}:${timeStr.slice(2)}${period}`;
            }
        }

        const urlDateMatch = url.match(/\/(\d{8})(?:\/|$)/);
        if (urlDateMatch && !reservationInfo.date) {
            const dateStr = urlDateMatch[1];
            reservationInfo.date = `${dateStr.slice(0, 2)}/${dateStr.slice(2, 4)}/${dateStr.slice(4)}`;
        }

        // DETECCIÓN GENÉRICA DE PÁGINA DE PAGO/CONFIRMACIÓN
        // Funciona con cualquier sitio web, no específico de una página
        
        // Es página de pago si tiene URL de pago Y (elementos de pago O selectores de pago)
        const isRealPaymentPage = isPaymentUrl && (hasPaymentElements || hasPaymentSelectors);
        
        // Debug logging
        if (isPaymentUrl) {
            console.log(`   📊 Detección de página de pago:`);
            console.log(`      - URL de pago: ✅`);
            console.log(`      - Elementos: ${elements.length}`);
            console.log(`      - Texto de pago: ${hasPaymentElements ? '✅' : '❌'}`);
            console.log(`      - ID/Class de pago: ${hasPaymentSelectors ? '✅' : '❌'}`);
            console.log(`      - ¿Detener? ${isRealPaymentPage ? '✅ SÍ' : '❌ NO'}`);
        }
        
        return {
            isPaymentPage: isRealPaymentPage,
            reservationInfo
        };
    }

    constructor(options: AgentOptions) {
        this.options = options;
        this.config = loadConfig();

        // Override config with provided options
        if (options.openaiApiKey) {
            this.config.openai.apiKey = options.openaiApiKey;
        }
        if (options.openaiModel) {
            this.config.openai.model = options.openaiModel;
        }
        if (options.headless !== undefined) {
            this.config.browser.headless = options.headless;
        }
        if (options.maxSteps !== undefined) {
            this.config.agent.maxSteps = options.maxSteps;
        }
        if (options.screenshotOnEachStep !== undefined) {
            this.config.agent.screenshotOnEachStep = options.screenshotOnEachStep;
        }

        validateConfig(this.config);

        this.openai = new OpenAIClient(
            this.config.openai.apiKey,
            this.config.openai.model
        );
    }

    /**
     * Run the agent with given input
     */
    /**
     * Generate a summary of actions performed
     */
    private generateActionsSummary(actions: PlannedAction[], finalUrl: string, success: boolean, summary?: string): {
        actionsSummary: string[];
        pagesVisited: string[];
        actionsPerformed: { action: string; detail: string; reason: string }[];
    } {
        const pagesVisited = new Set<string>();
        const actionsPerformed: { action: string; detail: string; reason: string }[] = [];
        const actionsSummary: string[] = [];

        for (const action of actions) {
            // Track pages
            if (action.action === 'navigate' && action.value) {
                pagesVisited.add(action.value);
            }

            // Build action detail
            let detail = '';
            if (action.ref) detail = `element [${action.ref}]`;
            if (action.value) detail += detail ? ` with value "${action.value}"` : `"${action.value}"`;

            actionsPerformed.push({
                action: action.action,
                detail: detail || '-',
                reason: action.reason || '-'
            });
        }

        // Generate human-readable summary (in Spanish)
        actionsSummary.push(`📊 RESUMEN DE EJECUCIÓN`);
        actionsSummary.push(`═══════════════════════════════════════`);
        actionsSummary.push(`   Estado: ${success ? '✅ COMPLETADO' : '❌ INCOMPLETO'}`);
        actionsSummary.push(`   Total de acciones: ${actions.length}`);
        actionsSummary.push(`   URL final: ${finalUrl}`);

        if (summary) {
            actionsSummary.push(`   Resultado: ${summary}`);
        }

        // Count action types
        const actionCounts: Record<string, number> = {};
        for (const a of actions) {
            actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
        }

        // Action names in Spanish
        const actionNamesES: Record<string, string> = {
            'click': 'clic',
            'type': 'escribir',
            'navigate': 'navegar',
            'scroll': 'desplazar',
            'wait': 'esperar',
            'login': 'iniciar sesión',
            'select': 'seleccionar',
            'extract': 'extraer',
            'download': 'descargar'
        };

        actionsSummary.push(`   Desglose de acciones:`);
        for (const [action, count] of Object.entries(actionCounts)) {
            const actionES = actionNamesES[action] || action;
            actionsSummary.push(`      - ${actionES}: ${count}`);
        }

        return {
            actionsSummary,
            pagesVisited: Array.from(pagesVisited),
            actionsPerformed
        };
    }

    /**
     * Display structured data extracted from user instruction
     */
    private displayStructuredData(data: StructuredInput): void {
        console.log('');
        console.log('================================================================================');
        console.log('                    DATOS ESTRUCTURADOS EXTRAIDOS                              ');
        console.log('================================================================================');

        // Original message
        console.log(`  MENSAJE ORIGINAL: "${data.originalMessage}"`);
        console.log('');

        // Action type
        const actionLabels: Record<string, string> = {
            'reservation': 'RESERVACION',
            'purchase': 'COMPRA',
            'search': 'BUSQUEDA',
            'login': 'LOGIN',
            'navigation': 'NAVEGACION',
            'general': 'GENERAL'
        };
        console.log(`  TIPO DE ACCION: ${actionLabels[data.actionType] || data.actionType}`);
        console.log('');

        // Date information
        console.log('  --- FECHA ---');
        if (data.date.parsed) {
            if (data.date.isRelative && data.date.relativeTerm) {
                console.log(`     Usuario dijo: "${data.date.relativeTerm}"`);
            }
            console.log(`     Dia del mes: ${data.date.dayNumber}`);
            console.log(`     Dia semana: ${data.date.dayName}`);
            console.log(`     Mes: ${data.date.monthNumber} (${data.date.monthName})`);
            console.log(`     Año: ${data.date.year}`);
            console.log(`     DD/MM/YYYY: ${data.date.formatted?.ddmmyyyy}`);
            console.log(`     Completo: ${data.date.formatted?.display}`);
            console.log('');
            console.log(`     >>> BUSCAR EN CALENDARIO: "${data.date.dayNumber}" <<<`);
        } else {
            console.log('     No se especifico fecha');
        }
        console.log('');

        // Time information
        console.log('  --- HORA ---');
        if (data.time.hour !== null) {
            if (data.time.original) {
                console.log(`     Usuario dijo: "${data.time.original}"`);
            }
            console.log(`     Hora: ${data.time.hour}`);
            console.log(`     Minutos: ${data.time.minute}`);
            console.log(`     Periodo: ${data.time.period}`);
            console.log(`     Formato 24h: ${data.time.formatted?.h24}`);
            console.log(`     Para buscar: ${data.time.formatted?.hhmm}`);
            console.log('');
            console.log(`     >>> BUSCAR EN TIME SLOTS: "${data.time.formatted?.hhmm}" <<<`);
        } else {
            console.log('     No se especifico hora');
        }
        console.log('');

        // Item information
        console.log('  --- PRODUCTO/SERVICIO ---');
        if (data.item.name || data.item.quantity) {
            if (data.item.name) {
                console.log(`     Nombre: ${data.item.name}`);
            }
            if (data.item.quantity) {
                console.log(`     Cantidad: ${data.item.quantity}`);
            }
            if (data.item.details.length > 0) {
                console.log(`     Detalles: ${data.item.details.join(', ')}`);
            }
        } else {
            console.log('     No se especifico producto');
        }
        console.log('');

        // Credentials
        if (data.credentials.email || data.credentials.username) {
            console.log('  --- CREDENCIALES ---');
            if (data.credentials.email) {
                console.log(`     Email: ${data.credentials.email}`);
            }
            if (data.credentials.username) {
                console.log(`     Usuario: ${data.credentials.username}`);
            }
            console.log(`     Password: ${data.credentials.hasPassword ? 'SI' : 'NO'}`);
        }

        console.log('================================================================================');
        console.log('');
    }

    async run(input: AgentInput): Promise<AgentResult> {
        const startTime = Date.now();
        const steps: StepResult[] = [];
        const previousActions: PlannedAction[] = [];
        const downloadedFiles: string[] = [];
        const screenshots: string[] = [];
        let extractedData: unknown = undefined;

        // ========== EXTRACT AND DISPLAY STRUCTURED DATA ==========
        const structuredData = extractStructuredData(input.instruction, input.credentials);
        this.displayStructuredData(structuredData);

        try {
            // Initialize browser
            this.browser = new BrowserClient(
                this.config.browser,
                this.config.paths.downloadsDir
            );
            await this.browser.launch();

            // Initialize recorder if needed
            const shouldRecord = this.options.recordFlow ?? this.config.agent.autoRecordFlows;
            if (shouldRecord) {
                this.recorder = new FlowRecorder(this.config.paths.flowsDir);
                this.recorder.startRecording({
                    name: input.flowName || `flow_${Date.now()}`,
                    startUrl: input.url,
                    instruction: input.instruction,
                });
            }

            // Initialize executor
            const executor = new ActionExecutor({
                browser: this.browser,
                recorder: this.recorder,
                openai: this.openai,
                credentials: input.credentials,
                screenshotsDir: this.config.paths.screenshotsDir,
                screenshotOnEachStep: this.config.agent.screenshotOnEachStep,
            });

            // Navigate to initial URL
            console.log(`🌐 Navigating to ${input.url}...`);
            await this.browser.goto(input.url);

            // Main loop
            let stepCount = 0;
            const maxSteps = this.config.agent.maxSteps;

            while (stepCount < maxSteps) {
                stepCount++;
                console.log(`\n📍 Step ${stepCount}/${maxSteps}`);

                // Brief wait for page (minimal delay for speed)
                await new Promise(r => setTimeout(r, 200));

                // Decision Phase
                let response: any;
                const startTimeDecision = Date.now();

                // Determine mode: Vision or Text
                const useVision = this.options.enableVision ?? false;

                if (useVision) {
                    try {
                        console.log(`   👁️ capturing vision snapshot...`);
                        const visionSnap = await this.browser.takeVisionSnapshot();

                        // Check cache first
                        const cachedAction = await this.visionCache.get(visionSnap, input.instruction);

                        if (cachedAction) {
                            response = cachedAction;
                        } else {
                            console.log(`   🧠 Analyzing with Vision AI...`);
                            response = await this.openai.planNextActionWithVision({
                                instruction: input.instruction,
                                currentUrl: this.browser.getUrl(),
                                visionSnapshot: visionSnap,
                                previousActions,
                                credentials: input.credentials,
                                formData: input.formData,
                            });

                            // Cache successful non-done actions
                            if (!('done' in response)) {
                                this.visionCache.set(visionSnap, input.instruction, response as any);
                            }
                        }

                        this.metrics.recordStep({
                            type: 'vision',
                            duration: Date.now() - startTimeDecision,
                            timestamp: Date.now(),
                            imageSize: visionSnap.size
                        });

                    } catch (visionError) {
                        console.warn(`   ⚠️ Vision failed: ${visionError}. Falling back to text mode.`);
                        if (this.options.visionFallbackEnabled === false) throw visionError;

                        // FALLBACK TO TEXT MODE
                        const snapshot = await this.browser.takeSnapshot();
                        console.log(`   🤖 Thinking (Text Mode)...`);
                        response = await this.openai.planNextAction({
                            instruction: input.instruction,
                            currentUrl: this.browser.getUrl(),
                            snapshot,
                            previousActions,
                            credentials: input.credentials,
                            formData: input.formData,
                        });

                        this.metrics.recordStep({
                            type: 'text',
                            duration: Date.now() - startTimeDecision,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    // TEXT ONLY MODE (Legacy)
                    console.log(`   📸 Taking snapshot...`);
                    let snapshot = await this.browser.takeSnapshot();

                    // If very few elements, try dismissing overlays and retake
                    if (snapshot.elements.length <= 5) {
                        console.log(`   ⚠️ Only ${snapshot.elements.length} elements - trying to dismiss overlays...`);
                        await this.browser.dismissOverlays().catch(() => { });
                        await new Promise(r => setTimeout(r, 800));
                        snapshot = await this.browser.takeSnapshot();
                    }

                    console.log(`   elements: ${snapshot.elements.length}`);

                    // ========== DETECCIÓN DE PÁGINA DE PAGO/DETALLE ==========
                    const currentUrl = this.browser.getUrl();
                    const paymentDetection = this.detectPaymentPage(
                        currentUrl,
                        snapshot.elements.map(e => ({ 
                            role: e.role, 
                            name: e.name,
                            selector: e.selector || ''  // Incluir selector para detectar IDs y clases
                        }))
                    );

                    // Solo detener para RESERVACIONES/COMPRAS, no para búsquedas generales
                    const isReservationTask = structuredData.actionType === 'reservation' ||
                        structuredData.actionType === 'purchase';

                    if (paymentDetection.isPaymentPage && isReservationTask) {
                        console.log(`\n💳 ═══════════════════════════════════════════════════════════`);
                        console.log(`   🛑 PÁGINA DE DETALLE/PAGO DETECTADA - DETENIENDO (RESERVACIÓN)`);
                        console.log(`   ═══════════════════════════════════════════════════════════`);

                        // Capture cookies for session persistence
                        const cookies = await this.browser.getCookies();
                        console.log(`   🍪 Capturadas ${cookies.length} cookies para persistencia de sesión`);

                        // Generate token and store session info
                        const token = this.generatePaymentToken();
                        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

                        // Store token data locally
                        this.storeTokenData(token, currentUrl, {
                            instruction: input.instruction,
                            credentials: input.credentials ? { email: input.credentials.email } : undefined,
                            reservationInfo: paymentDetection.reservationInfo,
                            cookies // Include cookies in local store
                        });

                        // Build reservation summary
                        const reservationSummary = {
                            date: paymentDetection.reservationInfo.date || 'No detectada',
                            time: paymentDetection.reservationInfo.time || 'No detectada',
                            product: paymentDetection.reservationInfo.product,
                            price: paymentDetection.reservationInfo.price,
                            additionalInfo: [] as string[]
                        };

                        // Add visible info from elements
                        snapshot.elements.forEach(el => {
                            const name = el.name.toLowerCase();
                            if (name.includes('producto') || name.includes('green fee') || name.includes('carrito')) {
                                reservationSummary.additionalInfo?.push(el.name);
                            }
                        });

                        // ========== SAVE SESSION TO SERVER API ==========
                        let shareableLink = '';
                        try {
                            const serverPort = process.env.PORT || 3000;
                            const response = await fetch(`http://localhost:${serverPort}/api/session`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    token,
                                    url: currentUrl,
                                    cookies,
                                    reservationInfo: {
                                        date: reservationSummary.date,
                                        time: reservationSummary.time,
                                        price: reservationSummary.price
                                    }
                                })
                            });

                            if (response.ok) {
                                const result = await response.json() as { shareableLink?: string };
                                shareableLink = result.shareableLink || `http://localhost:${serverPort}/session/${token}`;
                                console.log(`\n   🔗 ═══════════════════════════════════════════════════════`);
                                console.log(`   📱 ENLACE PARA COMPARTIR POR WHATSAPP:`);
                                console.log(`   ${shareableLink}`);
                                console.log(`   ═══════════════════════════════════════════════════════`);
                            } else {
                                console.log(`   ⚠️ No se pudo guardar sesión en servidor: ${response.status}`);
                                shareableLink = `http://localhost:${serverPort}/session/${token}`;
                            }
                        } catch (e) {
                            console.log(`   ⚠️ Servidor no disponible para guardar sesión: ${e}`);
                            shareableLink = `http://localhost:3000/session/${token}`;
                        }

                        console.log(`\n   📋 RESUMEN DE RESERVA:`);
                        console.log(`      📅 Fecha: ${reservationSummary.date}`);
                        console.log(`      ⏰ Hora: ${reservationSummary.time}`);
                        if (reservationSummary.price) {
                            console.log(`      💰 Precio: ${reservationSummary.price}`);
                        }
                        console.log(`\n   🔗 URL de continuación: ${currentUrl}`);
                        console.log(`   🎫 Token: ${token}`);
                        console.log(`   ⏱️ Expira: ${expiresAt.toISOString()}`);
                        console.log(`\n   ═══════════════════════════════════════════════════════════`);

                        // Generate actions summary
                        const { actionsSummary, pagesVisited, actionsPerformed } = this.generateActionsSummary(
                            previousActions,
                            currentUrl,
                            true,
                            'Proceso detenido en página de pago - esperando confirmación del usuario'
                        );

                        console.log('\n' + actionsSummary.join('\n'));

                        // Stop recording
                        if (this.recorder) {
                            this.recorder.stopRecording(true, 'Detenido en página de pago');
                        }

                        // Build human-readable message with shareable link
                        const message = `🛑 PROCESO PAUSADO EN PÁGINA DE PAGO\n\n` +
                            `📋 Resumen de la reserva:\n` +
                            `   • Fecha: ${reservationSummary.date}\n` +
                            `   • Hora: ${reservationSummary.time}\n` +
                            `${reservationSummary.price ? `   • Precio: ${reservationSummary.price}\n` : ''}` +
                            `\n📱 ENLACE PARA COMPARTIR:\n` +
                            `   ${shareableLink}\n` +
                            `\n🔗 URL directa (requiere sesión):\n` +
                            `   ${currentUrl}\n` +
                            `\n⚠️ El enlace expira en 1 hora (${expiresAt.toLocaleTimeString('es-ES')})`;

                        return {
                            success: true,
                            summary: 'Reserva preparada - esperando confirmación de pago',
                            steps,
                            data: extractedData,
                            downloadedFiles,
                            screenshots,
                            flowId: this.recorder?.getCurrentFlowId() || undefined,
                            duration: Date.now() - startTime,
                            executionSummary: {
                                totalActions: previousActions.length,
                                finalUrl: currentUrl,
                                pagesVisited,
                                actionsPerformed,
                                actionsSummaryText: actionsSummary.join('\n')
                            },
                            paymentPending: {
                                stopped: true,
                                shareableLink, // NEW: Link to share via WhatsApp
                                continuationUrl: `${currentUrl}?token=${token}`,
                                token,
                                directUrl: currentUrl,
                                reservationSummary,
                                message,
                                expiresAt: expiresAt.toISOString(),
                                cookies
                            }
                        };
                    } else if (paymentDetection.isPaymentPage && !isReservationTask) {
                        // Para búsquedas/general, no detenerse, continuar extrayendo información
                        console.log(`   ℹ️ Página de pago detectada pero es ${structuredData.actionType.toUpperCase()} - continuando extracción`);
                    }

                    // ========== DETECCIÓN DE ESTADO ESTANCADO ==========
                    // Crear hash simple del snapshot para detectar páginas sin cambios
                    const currentHash = snapshot.elements.map(e => `${e.ref}:${e.name}`).join('|');

                    if (currentHash === this.lastSnapshotHash) {
                        this.stuckCounter++;
                        console.log(`   ⚠️ Página sin cambios detectada (${this.stuckCounter}/${this.MAX_STUCK_COUNT})`);

                        if (this.stuckCounter >= this.MAX_STUCK_COUNT) {
                            console.log(`   🔄 ESTADO ESTANCADO DETECTADO - Intentando recuperación...`);

                            // Estrategia 1: Verificar si hay un modal/popup visible
                            const hasModal = await this.browser.detectPopupOrModal();
                            if (hasModal) {
                                console.log(`   🔲 Modal detectado - esperando interacción...`);
                                await new Promise(r => setTimeout(r, 1500));
                            }

                            // Estrategia 2: Esperar más tiempo para contenido dinámico
                            console.log(`   ⏳ Esperando contenido dinámico (2s)...`);
                            await new Promise(r => setTimeout(r, 2000));

                            // Estrategia 3: Buscar en iframes si hay contenido de reservas
                            const foundInIframe = await this.browser.findAndClickInIframes('reserv');
                            if (foundInIframe) {
                                console.log(`   ✓ Encontrado contenido en iframe`);
                                await new Promise(r => setTimeout(r, 1500));
                            }

                            // Estrategia 4: Intentar scroll para revelar contenido
                            console.log(`   📜 Scrolling para revelar contenido...`);
                            await this.browser.scroll('down');
                            await new Promise(r => setTimeout(r, 1000));

                            // Estrategia 5: Buscar la URL de reservas en los enlaces de la página
                            const allLinks = await this.browser.getAllLinks();
                            const reservationLink = allLinks.find(link =>
                                link.text.toLowerCase().includes('reserv') ||
                                link.href.toLowerCase().includes('reserv') ||
                                link.href.toLowerCase().includes('booking') ||
                                link.href.toLowerCase().includes('tee')
                            );

                            if (reservationLink && reservationLink.href.startsWith('http')) {
                                console.log(`   🔗 Enlace de reservas encontrado: ${reservationLink.href}`);
                                try {
                                    await this.browser.goto(reservationLink.href);
                                    await new Promise(r => setTimeout(r, 2000));
                                    const newSnapshot = await this.browser.takeSnapshot();
                                    if (newSnapshot.elements.length !== snapshot.elements.length) {
                                        console.log(`   ✓ Navegación directa exitosa`);
                                        snapshot = newSnapshot;
                                    }
                                } catch (e) {
                                    console.log(`   ⚠️ Error navegando a enlace: ${e}`);
                                }
                            }

                            // Estrategia 6: DESHABILITADA - Navegar a URLs alternativas rompía el estado
                            // En su lugar, intentamos refrescar la página actual
                            try {
                                console.log(`   🔄 Refrescando página actual...`);
                                await this.browser.reload();
                                await new Promise(r => setTimeout(r, 2000));
                            } catch (reloadError) {
                                console.log(`   ⚠️ Error al refrescar: ${reloadError}`);
                            }

                            // Re-tomar snapshot después de intentos de recuperación
                            try {
                                if (this.browser) {
                                    snapshot = await this.browser.takeSnapshot();
                                }
                            } catch (snapshotError) {
                                console.log(`   ⚠️ Error al tomar snapshot después de recuperación: ${snapshotError}`);
                                // Si falla el snapshot, continuar con el anterior
                            }
                            this.stuckCounter = 0; // Reset counter
                        }
                    } else {
                        this.stuckCounter = 0; // Reset si la página cambió
                    }
                    this.lastSnapshotHash = currentHash;

                    // Show elements for debugging
                    // Always show when <= 15, or when between 15-50 (likely time slots after date selection)
                    const showElements = snapshot.elements.length > 0 && snapshot.elements.length <= 50;
                    if (showElements) {
                        console.log(`   📋 Elements found:`);
                        const elementsToShow = snapshot.elements.slice(0, 30); // Show max 30 for readability
                        elementsToShow.forEach(el => {
                            const shortName = el.name.substring(0, 40).replace(/\n/g, ' ');
                            console.log(`      [${el.ref}] ${el.role}: "${shortName}${el.name.length > 40 ? '...' : ''}"`);
                        });
                        if (snapshot.elements.length > 30) {
                            console.log(`      ... and ${snapshot.elements.length - 30} more elements`);
                        }
                    }

                    console.log(`   🤖 Thinking...`);

                    response = await this.openai.planNextAction({
                        instruction: input.instruction,
                        currentUrl: this.browser.getUrl(),
                        snapshot,
                        previousActions,
                        credentials: input.credentials,
                        formData: input.formData,
                    });

                    this.metrics.recordStep({
                        type: 'text',
                        duration: Date.now() - startTimeDecision,
                        timestamp: Date.now()
                    });
                }

                // Check if done
                if ('done' in response && response.done) {
                    const doneResponse = response as DoneResponse;
                    console.log(`\n✅ Task complete: ${doneResponse.summary}`);

                    if (doneResponse.data) {
                        extractedData = doneResponse.data;
                    }

                    // Generate actions summary
                    const finalUrl = this.browser?.getUrl() || input.url;
                    const { actionsSummary, pagesVisited, actionsPerformed } = this.generateActionsSummary(
                        previousActions,
                        finalUrl,
                        true,
                        doneResponse.summary
                    );

                    // Log summary
                    console.log('\n' + actionsSummary.join('\n'));

                    // Stop recording
                    if (this.recorder) {
                        this.recorder.stopRecording(true, doneResponse.summary);
                    }

                    return {
                        success: true,
                        summary: doneResponse.summary,
                        steps,
                        data: extractedData,
                        downloadedFiles,
                        screenshots,
                        flowId: this.recorder?.getCurrentFlowId() || undefined,
                        duration: Date.now() - startTime,
                        // New summary fields
                        executionSummary: {
                            totalActions: previousActions.length,
                            finalUrl,
                            pagesVisited,
                            actionsPerformed,
                            actionsSummaryText: actionsSummary.join('\n')
                        }
                    };
                }

                // Execute action
                const action = response as PlannedAction;

                // Handle undefined or invalid action - convert to scroll
                if (!action.action || (action.action as string) === 'undefined') {
                    console.log(`   ⚠️ Invalid action received (${action.action}), converting to scroll UP`);
                    action.action = 'scroll';
                    action.direction = 'up';
                    action.reason = action.reason || 'Auto-converted from invalid action - scrolling to find content';
                }

                // Count recent scrolls and check if stuck at bottom
                const recentScrollsDown = previousActions.slice(-6).filter(a =>
                    a.action === 'scroll' && (a.direction === 'down' || !a.direction)
                ).length;

                const recentScrollsUp = previousActions.slice(-6).filter(a =>
                    a.action === 'scroll' && a.direction === 'up'
                ).length;

                const totalRecentScrolls = recentScrollsDown + recentScrollsUp;

                // If too many scrolls in any direction without progress, try clicking date field
                if (action.action === 'scroll' && totalRecentScrolls >= 5) {
                    console.log(`   ⚠️ Stuck scrolling (${totalRecentScrolls} recent scrolls without progress)`);

                    // Try to find a date input field to click instead
                    const snapshot = await this.browser?.takeSnapshot();
                    if (snapshot) {
                        const dateInput = snapshot.elements.find(e => {
                            const name = (e.name || '').toLowerCase();
                            const role = (e.role || '').toLowerCase();
                            return (role === 'input' || role === 'textbox') &&
                                (name.includes('fecha') || name.includes('date') || name.includes('seleccionar'));
                        });

                        if (dateInput) {
                            console.log(`   🎯 Found date input [${dateInput.ref}] - clicking to open calendar`);
                            action.action = 'click';
                            action.ref = dateInput.ref;
                            action.direction = undefined;
                            action.reason = 'Auto-converted from scroll - clicking date field to open calendar';
                        } else {
                            // No date input found, try scroll UP if we've been scrolling down
                            if (recentScrollsDown > recentScrollsUp) {
                                console.log(`   🔄 Forcing scroll UP to find content`);
                                action.direction = 'up';
                                action.reason = 'Auto-converted to scroll UP - stuck scrolling down';
                            }
                        }
                    }
                }

                // If many consecutive scroll downs, force scroll UP
                if (action.action === 'scroll' && (action.direction === 'down' || !action.direction) &&
                    recentScrollsDown >= 4) {
                    console.log(`   ⚠️ Stuck scrolling down (${recentScrollsDown} consecutive scrolls)`);
                    console.log(`   🔄 Forcing scroll UP to find content`);
                    action.direction = 'up';
                    action.reason = 'Auto-converted to scroll UP - stuck scrolling down';
                }

                // Check for excessive login attempts before executing
                const recentLoginCount = previousActions.slice(-5).filter(a => a.action === 'login').length;
                if (action.action === 'login' && recentLoginCount >= 3) {
                    console.log(`   ⚠️ Blocking login action - too many recent attempts (${recentLoginCount})`);
                    console.log(`   🔄 Forcing scroll action instead to explore page`);
                    action.action = 'scroll';
                    action.direction = 'down';
                    action.reason = 'Auto-converted from login due to too many attempts';
                }

                // Check for repetitive clicks - MÁS AGRESIVO para evitar bucles
                if (action.action === 'click' && action.ref) {
                    // Check if this looks like a time slot click (based on value pattern)
                    const isTimeSlotClick = action.value && /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(action.value.trim());

                    // Check if this is a navigation link (Reservas, Reservar, etc.)
                    const isNavLink = action.reason?.toLowerCase().includes('reserv') ||
                        action.reason?.toLowerCase().includes('naveg') ||
                        action.reason?.toLowerCase().includes('acceder');

                    // Count total clicks on this element (not just consecutive)
                    const totalClicksOnElement = previousActions.filter(
                        a => a.action === 'click' && a.ref === action.ref
                    ).length;

                    // Only count CONSECUTIVE same clicks (not total)
                    let consecutiveClicks = 0;
                    for (let i = previousActions.length - 1; i >= 0; i--) {
                        const prevAction = previousActions[i];
                        if (prevAction.action === 'click' && prevAction.ref === action.ref) {
                            consecutiveClicks++;
                        } else if (prevAction.action !== 'scroll' && prevAction.action !== 'wait') {
                            break; // Different action, stop counting
                        }
                    }

                    // For navigation links, be VERY restrictive - only 1-2 attempts
                    // For time slots, allow 2 attempts
                    // For other elements, allow 3-4 attempts
                    let maxClicksAllowed = 4;
                    if (isNavLink) {
                        maxClicksAllowed = 2;
                    } else if (isTimeSlotClick) {
                        maxClicksAllowed = 2;
                    }

                    // Block if too many clicks (consecutive OR total)
                    const shouldBlock = consecutiveClicks >= maxClicksAllowed || totalClicksOnElement >= maxClicksAllowed;

                    if (shouldBlock) {
                        console.log(`   ⚠️ Blocking repetitive click on [${action.ref}] - ${consecutiveClicks} consecutive, ${totalClicksOnElement} total`);

                        if (isTimeSlotClick) {
                            // For time slots, the click probably worked but didn't navigate
                            // Wait for any UI updates and then continue to see what changed
                            console.log(`   🕐 Time slot already clicked - waiting for page response...`);
                            await new Promise(r => setTimeout(r, 1500));

                            // Take a fresh snapshot and let the AI decide next action
                            // Instead of forcing scroll, let the AI see what's on screen now
                            continue;
                        }

                        if (isNavLink && totalClicksOnElement >= 2) {
                            // Navigation link clicked multiple times without effect
                            // Try waiting longer for page load or dynamic content
                            console.log(`   🔄 Navigation link sin efecto - esperando contenido dinámico...`);
                            await new Promise(r => setTimeout(r, 3000));

                            // Try pressing Enter on the link
                            try {
                                await this.browser?.press('Enter');
                                await new Promise(r => setTimeout(r, 1000));
                            } catch { }

                            // If still no change, try scrolling to reveal hidden content
                            console.log(`   📜 Scrolling para revelar contenido oculto...`);
                            await this.browser?.scroll('down');
                            await new Promise(r => setTimeout(r, 500));
                            await this.browser?.scroll('up');
                            continue;
                        }

                        console.log(`   🔄 Trying to dismiss overlays and scroll...`);
                        await this.browser?.dismissOverlays().catch(() => { });
                        await new Promise(r => setTimeout(r, 1000));
                        action.action = 'scroll';
                        action.direction = 'down';
                        action.ref = undefined;
                        action.reason = 'Auto-converted from repetitive click - exploring page';
                    }
                }

                console.log(`   ▶️ Action: ${action.action}${action.ref ? ` [${action.ref}]` : ''}${action.value ? `: "${action.value}"` : ''}`);
                console.log(`   💭 Reason: ${action.reason}`);

                // Save URL before action to detect navigation
                const urlBefore = this.browser.getUrl();

                let result;
                try {
                    result = await executor.execute(action, undefined); // Snapshot not strictly needed for executor anymore due to fast-finder
                } catch (execError: any) {
                    // Check if this is a TIME_SLOT_UNAVAILABLE error
                    if (execError.message?.startsWith('TIME_SLOT_UNAVAILABLE:') && execError.timeSlotResult) {
                        const slotResult = execError.timeSlotResult;
                        const slotName = execError.message.split(':')[1];

                        console.log(`\n⏰ ═══════════════════════════════════════════════════════════`);
                        console.log(`   🚫 HORARIO NO DISPONIBLE: ${slotName}`);
                        console.log(`   ═══════════════════════════════════════════════════════════`);
                        console.log(`   📋 Razón: El horario ${slotName} ya está reservado`);

                        if (slotResult.nearbyAvailable && slotResult.nearbyAvailable.length > 0) {
                            console.log(`\n   🕐 HORARIOS DISPONIBLES MÁS CERCANOS:`);
                            slotResult.nearbyAvailable.slice(0, 10).forEach((slot: string, idx: number) => {
                                console.log(`      ${idx + 1}. ${slot}`);
                            });
                        }

                        console.log(`\n   ═══════════════════════════════════════════════════════════`);

                        // Generate actions summary
                        const finalUrl = this.browser?.getUrl() || input.url;
                        const { actionsSummary, pagesVisited, actionsPerformed } = this.generateActionsSummary(
                            previousActions,
                            finalUrl,
                            false,
                            `Horario ${slotName} no disponible`
                        );

                        console.log('\n' + actionsSummary.join('\n'));

                        // Stop recording
                        if (this.recorder) {
                            this.recorder.stopRecording(false, `Horario ${slotName} no disponible`);
                        }

                        // Build human-readable message
                        const alternativesText = slotResult.nearbyAvailable && slotResult.nearbyAvailable.length > 0
                            ? `\n\n🕐 Horarios disponibles más cercanos:\n${slotResult.nearbyAvailable.slice(0, 5).map((s: string, i: number) => `   ${i + 1}. ${s}`).join('\n')}`
                            : '\n\n⚠️ No se encontraron horarios alternativos cercanos.';

                        return {
                            success: false,
                            summary: `El horario solicitado (${slotName}) no está disponible - ya está reservado`,
                            steps,
                            data: extractedData,
                            downloadedFiles,
                            screenshots,
                            flowId: this.recorder?.getCurrentFlowId() || undefined,
                            duration: Date.now() - startTime,
                            error: `TIME_SLOT_UNAVAILABLE:${slotName}`,
                            executionSummary: {
                                totalActions: previousActions.length,
                                finalUrl,
                                pagesVisited,
                                actionsPerformed,
                                actionsSummaryText: actionsSummary.join('\n')
                            },
                            // Include slot unavailability info
                            slotUnavailable: {
                                requestedSlot: slotName,
                                reason: slotResult.reason,
                                availableAlternatives: slotResult.nearbyAvailable || [],
                                message: `🚫 HORARIO NO DISPONIBLE\n\nEl horario solicitado ${slotName} ya está reservado.${alternativesText}\n\n💡 Por favor, intenta con otro horario.`
                            }
                        };
                    }

                    // Re-throw other errors
                    throw execError;
                }

                steps.push(result);
                previousActions.push(action);

                if (result.screenshotPath) {
                    screenshots.push(result.screenshotPath);
                }

                if (!result.success) {
                    console.log(`   ❌ Failed: ${result.error}`);
                    console.log('   🛡️ Attempting to dismiss overlays...');
                    await this.browser?.dismissOverlays().catch(() => { });
                    // Continue anyway, AI might recover
                } else {
                    console.log(`   ✓ Success`);

                    // Si es un clic en enlace de navegación, esperar más tiempo
                    // para contenido dinámico (SPAs, AJAX, etc.)
                    const isNavAction = action.action === 'click' &&
                        (action.reason?.toLowerCase().includes('reserv') ||
                            action.reason?.toLowerCase().includes('naveg') ||
                            action.reason?.toLowerCase().includes('página') ||
                            action.reason?.toLowerCase().includes('acceder'));

                    if (isNavAction) {
                        console.log(`   ⏳ Esperando contenido dinámico después de navegación...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                // Detect URL change after action
                const urlAfter = this.browser.getUrl();
                if (urlAfter !== urlBefore) {
                    console.log(`   🌐 PAGE CHANGED: ${urlBefore.substring(0, 50)}... → ${urlAfter.substring(0, 50)}...`);
                    // Wait for new page to load
                    await this.browser.waitForNavigation();
                }

                // Handle special actions
                if (action.action === 'extract' && action.extractTarget) {
                    const content = await this.browser.getTextContent();
                    extractedData = await this.openai.extractData({
                        instruction: input.instruction,
                        pageContent: content,
                        extractTarget: action.extractTarget,
                    });
                }

                if (action.action === 'download') {
                    if (action.value) {
                        downloadedFiles.push(action.value);
                    }
                }

                // Small delay between steps
                await new Promise(r => setTimeout(r, 200));
            }

            // Max steps reached
            console.log(`\n⚠️ Max steps (${maxSteps}) reached`);

            // Generate actions summary
            const finalUrl = this.browser?.getUrl() || input.url;
            const { actionsSummary, pagesVisited, actionsPerformed } = this.generateActionsSummary(
                previousActions,
                finalUrl,
                false,
                `Reached maximum of ${maxSteps} steps`
            );

            // Log summary
            console.log('\n' + actionsSummary.join('\n'));

            if (this.recorder) {
                this.recorder.stopRecording(false, 'Max steps reached');
            }

            return {
                success: false,
                summary: `Reached maximum of ${maxSteps} steps without completing the task`,
                steps,
                data: extractedData,
                downloadedFiles,
                screenshots,
                flowId: this.recorder?.getCurrentFlowId() || undefined,
                duration: Date.now() - startTime,
                error: 'Max steps reached',
                executionSummary: {
                    totalActions: previousActions.length,
                    finalUrl,
                    pagesVisited,
                    actionsPerformed,
                    actionsSummaryText: actionsSummary.join('\n')
                }
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`\n❌ Error: ${errorMessage}`);

            // Generate actions summary
            const finalUrl = this.browser?.getUrl() || input.url;
            const { actionsSummary, pagesVisited, actionsPerformed } = this.generateActionsSummary(
                previousActions,
                finalUrl,
                false,
                `Error: ${errorMessage}`
            );

            // Log summary
            console.log('\n' + actionsSummary.join('\n'));

            if (this.recorder) {
                this.recorder.stopRecording(false, errorMessage);
            }

            return {
                success: false,
                summary: `Failed with error: ${errorMessage}`,
                steps,
                data: extractedData,
                downloadedFiles,
                screenshots,
                flowId: this.recorder?.getCurrentFlowId() || undefined,
                duration: Date.now() - startTime,
                error: errorMessage,
                executionSummary: {
                    totalActions: previousActions.length,
                    finalUrl,
                    pagesVisited,
                    actionsPerformed,
                    actionsSummaryText: actionsSummary.join('\n')
                }
            };

        } finally {
            this.metrics.printReport();

            // Cleanup
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        }
    }

    /**
     * Stop the agent
     */
    async stop(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
