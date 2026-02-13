import { Page } from 'playwright';
import type { ExtractedContent } from './content-extractor.js';

export interface OptimizedElement {
    ref: string;
    tag: string;
    type?: string;
    text: string;
    placeholder?: string;
    value?: string;
    role?: string;
    ariaLabel?: string;
    isButton: boolean;
    isInput: boolean;
    isLink: boolean;
    isDisabled: boolean;
    isVisible: boolean;
    isExpanded?: boolean;
    isSelected?: boolean;
    isRequired?: boolean;
    isFocused?: boolean;
    isReadonly?: boolean;
    isInvalid?: boolean;
    isPressed?: boolean;
    isCurrentDate?: boolean;
    isCalendarDay?: boolean;
    isCombobox?: boolean;
    hasPopup?: string;
    controls?: string;
    label?: string;

    // Select specific
    selectedIndex?: number;
    selectedText?: string;
    totalOptions?: number;

    // Input/Combobox specific
    inputValue?: string;

    rect: { x: number; y: number; w: number; h: number };
    /** Si el elemento viene de un iframe */
    frameRef?: boolean;
    // Para matching robusto
    testId?: string;
    name?: string;
    className?: string;
    id?: string;
}

/** Contenido de texto y estructura de la página (no solo interactivos) */
export interface PageContent {
    headings: { level: number; text: string }[];
    paragraphs: string[];
    labels: string[];
    tables: { headers?: string[]; rows: string[][] }[];
    lists: { items: string[] }[];
    semantic: { region: string; text: string }[];
}

/** Detección de framework/tecnología del sitio */
export interface FrameworkInfo {
    isSpa: boolean;
    framework?: 'react' | 'vue' | 'angular' | 'jquery' | 'unknown';
    hasShadowDom: boolean;
    serverRendered?: boolean;
}

/** Estado de carga detallado (reemplaza el booleano isLoading) */
export interface LoadingState {
    isLoading: boolean;
    loadingType?: 'spinner' | 'skeleton' | 'progress-bar' | 'overlay' | 'text';
    consecutiveLoadingCount: number;
    loadingSince?: number; // timestamp cuando empezó a cargar
    likelyFalsePositive: boolean; // true si lleva mucho tiempo cargando (probablemente decorativo)
    loaderSelectors?: string[]; // selectores que detectaron el loading
}

/** Contexto semántico de la página */
export interface PageContext {
    isWizard?: boolean;
    wizardStep?: number;
    wizardTotalSteps?: number;
    hasTabs?: boolean;
    activeTab?: string;
    hasCalendar?: boolean;
    calendarOpen?: boolean;
    emptyRequiredFields?: string[]; // IDs o nombres de campos requeridos sin llenar
    hasForm?: boolean;
    formFields?: { name: string; type: string; required: boolean; filled: boolean }[];
}

/** Perfil de configuración por sitio */
export interface SiteProfile {
    domain: string | RegExp;
    extraSelectors?: string[]; // selectores adicionales para este sitio
    loadingSelectors?: string[]; // selectores específicos de loading
    falsePositiveLoaders?: string[]; // selectores que parecen loaders pero no lo son
    blockingOverlays?: string[]; // selectores de overlays que bloquean interacción
    domStableTimeout?: number; // timeout personalizado para waitForDomStable
    maxWaitForElements?: number; // tiempo máximo para esperar elementos
    dismissOverlaysBeforeExtract?: boolean; // si debe cerrar overlays automáticamente
    ignoreSearchPanelModal?: boolean; // si debe ignorar la detección de paneles de búsqueda como modales
}

export interface OptimizedSnapshot {
    url: string;
    title: string;
    elements: OptimizedElement[];
    pageContent?: PageContent;
    framework?: FrameworkInfo;
    pageState: {
        hasModal: boolean;
        modalInfo?: { title: string; buttons: string[] };
        isLoading: boolean; // DEPRECATED: usar loadingState en su lugar
        loadingState: LoadingState; // Nuevo: estado de carga detallado
        hasErrors: boolean;
        errorMessages: string[];
        currentForm?: { action: string; method: string; };
    };
    pageContext?: PageContext; // Nuevo: contexto semántico de la página
    /** Respuestas API/XHR capturadas (si está habilitada la interceptación) */
    capturedApiData?: { url: string; data: unknown }[];
    /** Contenido extraído con Readability/tablas/precios (modo extracción) */
    extractedContent?: ExtractedContent;
    meta: {
        timestamp: number;
        elementCount: number;
        extractionTimeMs: number;
        snapshotHash?: string; // hash del snapshot para detectar loops
    };
}

/** Perfiles de configuración por sitio */
const SITE_PROFILES: SiteProfile[] = [
    {
        domain: /pgaoceans4\.com/i,
        extraSelectors: [
            '[data-toggle-class]',
            '[class*="js-booking"]',
            '[class*="booking-component"]',
            '[id*="searchForm"]',
            '[id*="booking"]'
        ],
        loadingSelectors: [
            '.c-loading-f',
            '[id*="loading"]',
            '[class*="loading"]'
        ],
        falsePositiveLoaders: [
            '.c-loading-f__wave', // decorativo, no es loader real
            '[class*="wave"]' // elementos decorativos de onda
        ],
        blockingOverlays: [
            '[data-overlay]',
            '.c-overlay',
            '[class*="popup-msg"]'
        ],
        domStableTimeout: 8000, // SPAs pesadas necesitan más tiempo
        maxWaitForElements: 15000,
        dismissOverlaysBeforeExtract: true
    },
    {
        domain: /outlook\.(com|office\.com)|bookings\.office\.com/i,
        extraSelectors: [
            '[data-automation-id]',
            '.ms-Button',
            '[class*="ms-"]',
            '[role="button"][class*="Button"]',
            // Elementos dentro de #app cuando Bookings está cargado
            '#app button',
            '#app input',
            '#app select',
            '#app textarea',
            '#app [role="button"]',
            '#app [role="option"]',
            '#app [class*="service"]',
            '#app [class*="Reservar"]',
            '#app [class*="calendar"]',
            '#app [class*="day"]',
            '#app [class*="time"]',
            '#app [class*="slot"]',
            '#app [class*="field"]',
            '#app [class*="input"]',
            '#app [class*="form"]'
        ],
        loadingSelectors: [
            '#loadingScreen',
            '#loadingSpinner',
            '[data-automation-id*="loading"]',
            '.ms-Spinner',
            '[class*="Spinner"]',
            '[id*="loading"]'
        ],
        falsePositiveLoaders: [
            '#bookingsLogo', // Logo no es loader
            '#MSLogo' // Logo de Microsoft no es loader
        ],
        blockingOverlays: [
            '[role="dialog"]',
            '.ms-Modal',
            '[class*="Modal"]',
            '#loadingScreen' // Pantalla de carga bloquea interacción
        ],
        domStableTimeout: 8000, // Outlook Bookings es una SPA pesada que necesita más tiempo
        maxWaitForElements: 15000, // Más tiempo para que React cargue completamente
        dismissOverlaysBeforeExtract: true
    },
    {
        domain: /cayacoagolf|countryclub/i,
        extraSelectors: [
            '[class*="calendar"]',
            '[class*="day"]',
            '[class*="time-slot"]',
            '[class*="tee"]'
        ],
        loadingSelectors: [
            '.loading',
            '[class*="loading"]'
        ],
        falsePositiveLoaders: [],
        blockingOverlays: [
            '[class*="modal"]',
            '[class*="overlay"]'
        ],
        domStableTimeout: 5000,
        maxWaitForElements: 10000,
        dismissOverlaysBeforeExtract: true
    },
    {
        domain: /opentable/i,
        ignoreSearchPanelModal: true,
        dismissOverlaysBeforeExtract: false,
        domStableTimeout: 5000,
        extraSelectors: [
            '[data-test="search-panel"]',
            '[data-test="search-primary-content"]',
            '[data-test="search-input"]',
            '[data-testid="search-container"]'
        ]
    }
];

export class OptimizedSnapshotExtractor {
    private lastSnapshot: OptimizedSnapshot | null = null;
    private snapshotHistory: string[] = []; // Historial de hashes para detectar loops
    private loadingHistory: { timestamp: number; isLoading: boolean }[] = []; // Historial de loading
    private currentSiteProfile: SiteProfile | null = null;

    /**
     * Detecta el perfil del sitio basado en la URL
     */
    private detectSiteProfile(url: string): SiteProfile | null {
        for (const profile of SITE_PROFILES) {
            if (typeof profile.domain === 'string') {
                if (url.includes(profile.domain)) return profile;
            } else if (profile.domain.test(url)) {
                return profile;
            }
        }
        return null;
    }

    /**
     * Cierra overlays bloqueantes automáticamente antes de extraer snapshot
     */
    private async dismissBlockingOverlays(page: Page): Promise<void> {
        const profile = this.currentSiteProfile;
        if (!profile?.dismissOverlaysBeforeExtract) return;

        // Verificar si la página está cerrada
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        const selectors = [
            ...(profile.blockingOverlays || []),
            // Selectores genéricos comunes
            'button[aria-label*="close" i]',
            'button[aria-label*="cerrar" i]',
            '[data-dismiss="modal"]',
            '[data-toggle-class*="close"]',
            '.cookie-banner button',
            '[id*="cookie"] button:has-text("Accept"), [id*="cookie"] button:has-text("Aceptar")',
            '[class*="gdpr"] button:has-text("Accept"), [class*="gdpr"] button:has-text("Aceptar")'
        ];

        for (const selector of selectors) {
            // Verificar nuevamente antes de cada iteración
            if (page.isClosed()) {
                throw new Error('Target page, context or browser has been closed');
            }

            try {
                const element = await page.locator(selector).first();
                if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await element.click({ timeout: 1000 }).catch(() => { });
                    try {
                        await page.waitForTimeout(300); // Dar tiempo a que se cierre
                    } catch (e: any) {
                        const errorMessage = e?.message || '';
                        if (errorMessage.includes('Target page, context or browser has been closed') ||
                            errorMessage.includes('Target closed') ||
                            errorMessage.includes('Browser closed') ||
                            errorMessage.includes('context was destroyed')) {
                            throw new Error('Target page, context or browser has been closed');
                        }
                    }
                }
            } catch (e: any) {
                const errorMessage = e?.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    throw new Error('Target page, context or browser has been closed');
                }
                // Continuar con el siguiente selector para otros errores
            }
        }
    }

    /**
     * Detecta si estamos en un loop de snapshots idénticos
     */
    isInSnapshotLoop(threshold: number = 3): boolean {
        if (this.snapshotHistory.length < threshold) return false;
        const lastN = this.snapshotHistory.slice(-threshold);
        return lastN.every(hash => hash === lastN[0] && hash !== '');
    }

    /**
     * Resetea el tracking de snapshots (útil después de login o navegación exitosa)
     */
    resetTracking(): void {
        this.snapshotHistory = [];
        this.loadingHistory = [];
    }

    /**
     * Genera un hash simple del snapshot para detectar loops
     */
    private generateSnapshotHash(elements: OptimizedElement[]): string {
        // Hash simple basado en cantidad y tipos de elementos
        const summary = elements
            .slice(0, 20) // Solo primeros 20 para performance
            .map(e => `${e.tag}-${e.isButton ? 'btn' : ''}${e.isInput ? 'inp' : ''}${e.isLink ? 'lnk' : ''}`)
            .join('|');
        return `${elements.length}-${summary.length}`;
    }

    /**
     * Espera a que el DOM deje de cambiar (MutationObserver) antes de tomar snapshot
     */
    async waitForDomStable(page: Page, silenceMs: number = 400, maxWaitMs: number = 5000): Promise<void> {
        // Usar timeout del perfil si está disponible
        const effectiveMaxWait = this.currentSiteProfile?.domStableTimeout || maxWaitMs;
        await page.evaluate(
            ({ silenceMs, maxWaitMs }) =>
                new Promise<void>((resolve) => {
                    let timeout: ReturnType<typeof setTimeout>;
                    const observer = new MutationObserver(() => {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => {
                            observer.disconnect();
                            resolve();
                        }, silenceMs);
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden', 'data-toggle-class']
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        resolve();
                    }, maxWaitMs);
                }),
            { silenceMs, maxWaitMs }
        ).catch(() => { });

        // Para SPAs pesadas: esperar a que scripts externos terminen de cargar
        // Verificar si hay scripts pendientes o elementos que se activan con JavaScript
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                // Esperar a que document.readyState sea 'complete'
                if (document.readyState === 'complete') {
                    // Verificar si hay scripts pendientes o elementos con data-toggle-class que aún no están inicializados
                    const hasToggleElements = document.querySelectorAll('[data-toggle-class]').length > 0;
                    const hasBookingComponents = document.querySelectorAll('[class*="js-booking"], [class*="booking-component"]').length > 0;

                    if (hasToggleElements || hasBookingComponents) {
                        // Dar tiempo adicional para que JavaScript inicialice estos componentes
                        setTimeout(() => resolve(), 1000);
                    } else {
                        resolve();
                    }
                } else {
                    // Esperar a que el documento termine de cargar
                    const checkReady = () => {
                        if (document.readyState === 'complete') {
                            resolve();
                        } else {
                            setTimeout(checkReady, 100);
                        }
                    };
                    checkReady();
                }
            });
        }).catch(() => { });
    }

    /**
     * Extrae snapshot optimizado (con espera de DOM estable y soporte iframes)
     */
    async extract(page: Page, options?: { skipDomStable?: boolean; includeFrames?: boolean; retryOnEmpty?: boolean }): Promise<OptimizedSnapshot> {
        const startTime = Date.now();
        const url = page.url();

        // Detectar perfil del sitio
        this.currentSiteProfile = this.detectSiteProfile(url);

        // Verificar si la página está cerrada antes de cualquier operación
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        // Cerrar overlays bloqueantes antes de extraer
        if (this.currentSiteProfile?.dismissOverlaysBeforeExtract) {
            try {
                await this.dismissBlockingOverlays(page);
            } catch (e: any) {
                const errorMessage = e?.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    throw new Error('Target page, context or browser has been closed');
                }
                // Continuar si es otro tipo de error
            }
        }

        if (!options?.skipDomStable) {
            try {
                await this.waitForDomStable(page);
            } catch (e: any) {
                const errorMessage = e?.message || '';
                if (errorMessage.includes('Target page, context or browser has been closed') ||
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Browser closed') ||
                    errorMessage.includes('context was destroyed')) {
                    throw new Error('Target page, context or browser has been closed');
                }
                // Continuar si es otro tipo de error
            }
        }

        // Verificar nuevamente si la página está cerrada antes de evaluar
        if (page.isClosed()) {
            throw new Error('Target page, context or browser has been closed');
        }

        // Inyectar perfil del sitio antes de evaluar
        try {
            await page.evaluate((profile: any) => {
                (window as any).__SITE_PROFILE__ = profile || {};
            }, this.currentSiteProfile);
        } catch (e: any) {
            const errorMessage = e?.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                throw new Error('Target page, context or browser has been closed');
            }
            throw e;
        }

        let snapshot;
        try {
            snapshot = await page.evaluate(() => {
                // @ts-ignore - Shim for esbuild __name helper that might be injected (using window to avoid renaming)
                (window as any).__name = (target: any, value: any) => target;
                const pageSiteProfile = (window as any).__SITE_PROFILE__ as SiteProfile | null;

                const elements: any[] = [];
                let refCounter = 0;

                // === Función de visibilidad optimizada ===
                const isVisible = (el: HTMLElement): boolean => {
                    const style = getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;

                    // Fix: elements with position: fixed often have null offsetParent
                    if (!el.offsetParent && style.position !== 'fixed' && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;

                    if (parseFloat(style.opacity) === 0) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };

                // === Función para detectar elementos que pueden activarse (aunque estén ocultos inicialmente) ===
                const canBeActivated = (el: HTMLElement): boolean => {
                    // 1. Elementos con atributos data-* que indican comportamiento dinámico
                    if (el.hasAttribute('data-toggle-class') ||
                        el.hasAttribute('data-toggle') ||
                        el.hasAttribute('data-target') ||
                        el.hasAttribute('data-clickoutside-container') ||
                        el.hasAttribute('data-step') ||
                        el.hasAttribute('data-wizard') ||
                        el.hasAttribute('data-panel') ||
                        el.hasAttribute('data-tab')) {
                        return true;
                    }

                    // 2. Elementos con atributos data-* que contienen valores (común en formularios multi-paso)
                    const dataAttrs = Array.from(el.attributes)
                        .filter(attr => attr.name.startsWith('data-') && attr.name.length > 5)
                        .map(attr => attr.name.toLowerCase());
                    const hasDataValue = dataAttrs.some(attr =>
                        attr.includes('code') ||
                        attr.includes('id') ||
                        attr.includes('value') ||
                        attr.includes('step') ||
                        attr.includes('panel') ||
                        attr.includes('field') ||
                        attr.includes('option')
                    );
                    if (hasDataValue && (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.hasAttribute('role') || el.tagName === 'LABEL')) {
                        return true;
                    }

                    // 3. Elementos dentro de componentes interactivos comunes (formularios multi-paso, wizards, tabs, etc.)
                    const className = el.className || '';
                    const classLower = typeof className === 'string' ? className.toLowerCase() : '';

                    // Patrones comunes de componentes interactivos que pueden tener elementos ocultos inicialmente
                    const interactiveComponentPatterns = [
                        'component',      // Componente genérico
                        'step',           // Formularios multi-paso
                        'wizard',         // Wizards
                        'tab',            // Tabs
                        'panel',          // Paneles
                        'form-group',     // Grupos de formulario
                        'fieldset',       // Fieldsets
                        'accordion',      // Acordeones
                        'collapse',       // Elementos colapsables
                        'multi-step',     // Formularios multi-paso
                        'stepper',        // Steppers
                        'booking',        // Sistemas de reserva (genérico)
                        'reservation',    // Reservaciones
                        'checkout',       // Checkout
                        'wizard-step',   // Pasos de wizard
                        'form-step'       // Pasos de formulario
                    ];

                    const hasInteractiveClass = interactiveComponentPatterns.some(pattern => classLower.includes(pattern));
                    if (hasInteractiveClass) {
                        return true;
                    }

                    // 4. Elementos con clase "disabled" que están dentro de componentes interactivos
                    if (classLower.includes('disabled')) {
                        const parent = el.closest('form, [class*="component"], [class*="step"], [class*="wizard"], [class*="panel"], [class*="tab"], [class*="form"]');
                        if (parent && (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.hasAttribute('role') || el.tagName === 'LABEL')) {
                            // Si tiene ID o atributos data-*, probablemente puede activarse
                            if (el.hasAttribute('id') || el.hasAttribute('name') || dataAttrs.length > 0) {
                                return true;
                            }
                        }
                    }

                    // 5. Elementos dentro de contenedores con clases de componentes interactivos
                    const parent = el.closest('[class*="component"], [class*="step"], [class*="wizard"], [class*="panel"], [class*="tab"], [class*="form"], [class*="booking"], [class*="reservation"]');
                    if (parent) {
                        // Si el elemento es interactivo (button, input, label, etc.) dentro de un componente, puede activarse
                        if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'LABEL' ||
                            el.hasAttribute('role') || el.hasAttribute('tabindex')) {
                            return true;
                        }
                    }

                    return false;
                };

                // === Función para detectar elementos de solo accesibilidad (no clickeables) ===
                const isAccessibilityOnly = (el: HTMLElement): boolean => {
                    const className = el.className || '';
                    // Manejar SVGAnimatedString (para elementos SVG) y strings normales
                    const classLower = typeof className === 'string' ? className.toLowerCase() :
                        (className && (className as any).baseVal ? (className as any).baseVal.toLowerCase() : '');

                    // Patrones de clases de accesibilidad (cubren múltiples frameworks/CMS)
                    // Estos patrones usan .includes() para capturar variaciones como:
                    // - "elementor-screen-only", "wp-screen-reader-text", "bootstrap-sr-only", etc.
                    const srOnlyPatterns = [
                        // === Screen reader patterns ===
                        'screen-only',      // Elementor: elementor-screen-only
                        'sr-only',          // Bootstrap, Tailwind, Bulma: sr-only, is-sr-only
                        'sronly',           // Variación sin guión: MuiTypography-srOnly
                        'screenreader',     // screenreader-only, screenreader-text

                        // === Visually hidden patterns ===
                        'visually-hidden',  // Bootstrap 5, Vue A11y: visually-hidden
                        'visuallyhidden',   // HTML5 Boilerplate, React Aria
                        'visually_hidden',  // Variación con underscore

                        // === React ecosystem ===
                        'chakra-visually-hidden',  // Chakra UI
                        'css-sronly',              // Emotion/Styled components
                        'rah-',                    // React Aria Hidden: rah-hidden

                        // === Vue.js ecosystem ===
                        'v-sr-only',        // Vuetify
                        'p-sr-only',        // PrimeVue
                        'q-sr-only',        // Quasar

                        // === Angular ecosystem ===
                        'cdk-visually-hidden',  // Angular CDK
                        'mat-visually-hidden',  // Angular Material

                        // === Other frameworks ===
                        'ion-sr-only',      // Ionic
                        'is-sr-only',       // Bulma
                        'u-sr-only',        // Utility classes

                        // === Accessibility patterns ===
                        'a11y-hidden',      // a11y = accessibility
                        'a11y-invisible',
                        'accessible-hidden',
                        'hidden-accessible',
                        'accessibility-text',
                        'assistive-text',
                        'assistive-hidden',

                        // === Hide patterns ===
                        'hide-visually',
                        'hide-text',
                        'text-hide',
                        'hidden-text',

                        // === Reader patterns ===
                        'reader-text',      // WordPress: screen-reader-text
                        'reader-only',

                        // === Offscreen patterns ===
                        'offscreen',
                        'off-screen',
                        'off-canvas-sr',

                        // === Clip patterns ===
                        'clip-hide',
                        'clipped',
                        'clip-rect',

                        // === Foundation framework ===
                        'show-for-sr',

                        // === Navigation/Skip patterns ===
                        'skip-link',        // Skip navigation links
                        'skiplink',
                        'skip-to-',
                        'skipto',

                        // === MUI (Material UI) specific ===
                        '-sronly',          // MuiTypography-srOnly (suffix match)
                        'notranslate',      // Google Translate hidden elements

                        // === Hidden labels/fields ===
                        'hiddenlabel',      // hiddenLabels, hidden-label, etc.
                        'hidden-label',
                        'label-hidden',
                        'field-hidden',
                        'input-hidden'
                    ];

                    for (const pattern of srOnlyPatterns) {
                        if (classLower.includes(pattern)) return true;
                    }

                    // Verificar aria-hidden
                    if (el.getAttribute('aria-hidden') === 'true') return true;

                    // Verificar estilos CSS que hacen el elemento invisible pero accesible
                    const style = getComputedStyle(el);

                    // clip: rect(0,0,0,0) o clip-path: inset(50%) - técnicas de ocultación para SR
                    if (style.clip === 'rect(0px, 0px, 0px, 0px)' ||
                        style.clipPath === 'inset(50%)' ||
                        style.clipPath === 'inset(100%)') return true;

                    // Elementos con tamaño 1x1 o 0x0 (técnica común de ocultación)
                    const rect = el.getBoundingClientRect();
                    if (rect.width <= 1 && rect.height <= 1) return true;

                    // Posición absoluta fuera de la pantalla
                    if ((style.position === 'absolute' || style.position === 'fixed') &&
                        (parseInt(style.left) < -9000 || parseInt(style.top) < -9000)) return true;

                    return false;
                };

                // === Selectores de elementos interactivos (orden de prioridad) ===
                const selectors = [
                    // Alta prioridad - controles de formulario
                    // NOTA: Incluimos elementos con clase "disabled" porque en SPAs pueden activarse después
                    'button',
                    'input:not([type="hidden"])',
                    'select',
                    'textarea',
                    // Media prioridad - elementos clickeables y partes de menú
                    'a[href]',
                    '[role="button"]',
                    '[role="link"]',
                    '[role="tab"]',
                    '[role="menuitem"]',
                    '[role="option"]',
                    '[role="listbox"]',
                    '[role="combobox"]',
                    '[role="searchbox"]',
                    '[role="textbox"]',
                    '[role="treeitem"]',
                    '[role="gridcell"]',
                    '[role="switch"]',
                    '[role="checkbox"]',
                    '[role="radio"]',
                    '[role="slider"]',
                    'li',
                    'dt', 'dd',

                    // Elementos HTML5 Interactivos y Semánticos
                    '[contenteditable="true"]',
                    'details',
                    'summary',
                    'audio[controls]',
                    'video[controls]',
                    'iframe', 'embed',

                    // Atributos de Estado y Accesibilidad (Alta probabilidad de interactividad)
                    '[aria-expanded="true"]',      // Menús abiertos
                    '[aria-haspopup]',
                    '[aria-controls]',
                    '[draggable="true"]',

                    // Baja prioridad - Eventos y Tabindex
                    '[onclick]',
                    '[onmousedown]', '[onmouseup]',
                    '[ontouchstart]',
                    '[onkeydown]',
                    '[tabindex]:not([tabindex="-1"])',
                    'label[for]',
                    '.btn', '.button',

                    // Heurísticas de Clases (Probabilidad Media)
                    '[class*="dropdown"]',
                    '[class*="toggle"]',
                    '[class*="close"]',
                    '[class*="modal"]',
                    '[class*="nav"]',
                    '[class*="link"]',
                    '[class*="card"]',
                    '[class*="select"]',
                    '[class*="search"]',
                    '[class*="clickable"]',

                    // Data Attributes (Common Frameworks)
                    '[data-toggle]',
                    '[data-toggle-class]', // Específico para páginas como pgaoceans4
                    '[data-target]',
                    '[data-dismiss]',
                    '[data-bs-toggle]',
                    '[data-action]',
                    '[data-click]',
                    '[data-clickoutside-container]', // Modales y popups
                    '[data-test]',
                    '[data-testid]',
                    '[data-qa]',
                    '[data-automation]',
                    // Elementos dentro de contenedores de booking (común en páginas de reservas)
                    '[class*="js-booking"]',
                    '[class*="booking-component"]',
                    '[class*="c-booking"]',
                    '[id*="booking"]',
                    '[id*="searchForm"]',

                    // Heurísticas específicas anteriores
                    '[class*="option"]',
                    '[class*="item"]',
                    '[class*="result"]',
                    '[class*="menu"]',
                    '[class*="suggestion"]'
                ];

                const seenElements = new Set<Element>();
                const allInteractive: HTMLElement[] = [];

                // Recolectar elementos únicos
                for (let i = 0; i < selectors.length; i++) {
                    try {
                        const found = document.querySelectorAll(selectors[i]);
                        // Usar for loop básico en lugar de Array.from/forEach
                        for (let j = 0; j < found.length; j++) {
                            const el = found[j];
                            // Explicitly exclude non-interactive metadata tags
                            const tagName = el.tagName.toUpperCase();
                            // Explicitly exclude non-interactive metadata tags and SVGs (unless specific interactive roles)
                            if (['TITLE', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD', 'HTML', 'BODY', 'SVG', 'PATH', 'G', 'DEFS', 'SYMBOL', 'DESC', 'USE'].includes(tagName)) continue;

                            if (!seenElements.has(el) && el instanceof HTMLElement) {
                                // Filtrar elementos de accesibilidad ANTES de agregarlos
                                const elClass = el.className;
                                let elClassStr = '';
                                if (typeof elClass === 'string') {
                                    elClassStr = elClass.toLowerCase();
                                } else if (elClass && typeof (elClass as any).baseVal === 'string') {
                                    elClassStr = (elClass as any).baseVal.toLowerCase();
                                }

                                // Lista rápida de patrones a excluir
                                const skipPatterns = ['screen-only', 'sr-only', 'visually-hidden', 'screenreader',
                                    'reader-text', 'offscreen', 'clip-hide', 'a11y-hidden'];
                                let shouldSkip = false;
                                for (const pattern of skipPatterns) {
                                    if (elClassStr.includes(pattern)) {
                                        shouldSkip = true;
                                        break;
                                    }
                                }

                                // También verificar aria-hidden
                                if (el.getAttribute('aria-hidden') === 'true') shouldSkip = true;

                                if (shouldSkip) continue;

                                seenElements.add(el);
                                allInteractive.push(el);
                            }
                        }
                    } catch (e) { /* selector inválido, ignorar */ }
                }

                // Procesar elementos
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;

                for (let i = 0; i < allInteractive.length; i++) {
                    const el = allInteractive[i];

                    // Para SPAs pesadas: detectar elementos que pueden activarse aunque estén ocultos inicialmente
                    const className = el.className || '';
                    const classLower = typeof className === 'string' ? className.toLowerCase() : '';

                    // Detectar elementos que pueden activarse usando la función canBeActivated
                    const canBeActivated = (() => {
                        // Atributos data-* que indican comportamiento dinámico
                        if (el.hasAttribute('data-toggle-class') ||
                            el.hasAttribute('data-toggle') ||
                            el.hasAttribute('data-target') ||
                            el.hasAttribute('data-clickoutside-container') ||
                            el.hasAttribute('data-step') ||
                            el.hasAttribute('data-wizard') ||
                            el.hasAttribute('data-panel') ||
                            el.hasAttribute('data-tab')) {
                            return true;
                        }

                        // Clases comunes de componentes interactivos
                        const interactivePatterns = ['component', 'step', 'wizard', 'tab', 'panel', 'form-group', 'booking', 'reservation', 'checkout'];
                        if (interactivePatterns.some(pattern => classLower.includes(pattern))) {
                            return true;
                        }

                        // Elementos dentro de componentes interactivos
                        const parent = el.closest('[class*="component"], [class*="step"], [class*="wizard"], [class*="panel"], [class*="tab"], [class*="form"], [class*="booking"]');
                        if (parent && (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'LABEL' || el.hasAttribute('role'))) {
                            return true;
                        }

                        return false;
                    })();

                    // Si el elemento puede activarse pero está oculto, incluirlo de todas formas (se mostrará después)
                    if (!isVisible(el) && !canBeActivated) continue;

                    // Filtrar elementos de solo accesibilidad (screen-only, sr-only, etc.)
                    if (isAccessibilityOnly(el)) continue;

                    const rect = el.getBoundingClientRect();

                    // Solo elementos en viewport extendido (visible + 1 scroll)
                    // EXCEPCIÓN: Si el elemento puede activarse (data-toggle-class, etc.), incluirlo aunque esté fuera del viewport
                    if (!canBeActivated) {
                        if (rect.bottom < -viewportHeight || rect.top > viewportHeight * 2) continue;
                        if (rect.right < 0 || rect.left > viewportWidth) continue;
                    }

                    const ref = 'e' + (++refCounter);
                    const tag = el.tagName.toLowerCase();

                    // Extraer texto de forma inteligente
                    let text = '';
                    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                        if (el instanceof HTMLInputElement) {
                            text = el.placeholder || el.title || '';
                        } else {
                            text = el.title || '';
                        }
                    } else {
                        // Use innerText to get only visible text, avoiding hidden metadata like <title> in SVGs
                        // This prevents the agent from seeing and trying to click invisible text
                        text = (el.innerText || '').trim();

                        // Fallback to textContent if innerText is empty but it's a specific role that might need it? 
                        // No, usually hidden text shouldn't be clicked.

                        // Truncar textos largos
                        if (text.length > 100) text = text.slice(0, 97) + '...';
                    }

                    // Skip elements with no text and no specific interactive traits (unless it's an input/button with other attrs)
                    // Esto ayuda a filtrar <li> o <div> vacíos que se colaron por las heurísticas
                    if (!text && !el.getAttribute('aria-label') && !el.getAttribute('title') &&
                        !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName) &&
                        el.getAttribute('role') !== 'button') {
                        // Si el elemento no tiene texto ni atributos descriptivos, y no es un control nativo, lo saltamos
                        // A menos que tenga hijos interactivos... pero aquí estamos capturando nodos hoja o contenedores.
                        // Si es un contenedor puramente estructural sin texto propio, podría ser ruido.
                        // Permitiremos contenedores si tienen dimensiones significativas, pero la regla general es: si no tiene nombre, el LLM no puede usarlo.
                        continue;
                    }


                    // Detectar si tiene clase "disabled" pero puede activarse (común en SPAs)
                    const hasDisabledClass = el.className &&
                        typeof el.className === 'string' &&
                        el.className.toLowerCase().includes('disabled');
                    const actuallyDisabled = (el as any).disabled === true || el.getAttribute('aria-disabled') === 'true';
                    // Si tiene clase disabled pero puede activarse, no marcarlo como disabled
                    const isDisabled = actuallyDisabled && !canBeActivated;

                    const element: any = {
                        ref: ref,
                        tag: tag,
                        text: text,
                        isButton: tag === 'button' || el.getAttribute('role') === 'button' || el.classList.contains('btn'),
                        isInput: ['input', 'select', 'textarea'].includes(tag),
                        isLink: tag === 'a' || el.getAttribute('role') === 'link',
                        isDisabled: isDisabled,
                        isVisible: canBeActivated ? true : isVisible(el), // Si puede activarse, marcarlo como visible aunque esté oculto
                        rect: {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            w: Math.round(rect.width),
                            h: Math.round(rect.height)
                        }
                    };

                    // Enhanced Properties
                    const expanded = el.getAttribute('aria-expanded');
                    if (expanded === 'true') element.isExpanded = true;

                    const selected = (el as any).selected || (el as any).checked || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true';
                    if (selected) element.isSelected = true;

                    const required = (el as any).required || el.getAttribute('aria-required') === 'true';
                    if (required) element.isRequired = true;

                    if (document.activeElement === el) element.isFocused = true;

                    const readonly = (el as any).readOnly || el.getAttribute('aria-readonly') === 'true';
                    if (readonly) element.isReadonly = true;

                    const invalid = el.getAttribute('aria-invalid') === 'true' ||
                        (el.classList && (el.classList.contains('is-invalid') || el.classList.contains('error'))) ||
                        ((el as any).willValidate && !(el as any).validity.valid);
                    if (invalid) element.isInvalid = true;

                    // ID Capture
                    if (el.id) element.id = el.id;

                    // Specialized ARIA State
                    const pressed = el.getAttribute('aria-pressed');
                    if (pressed === 'true') element.isPressed = true;

                    const current = el.getAttribute('aria-current');
                    if (current) element.isCurrentDate = true;

                    const controls = el.getAttribute('aria-controls');
                    if (controls) element.controls = controls;

                    const hasPopup = el.getAttribute('aria-haspopup');
                    if (hasPopup) element.hasPopup = hasPopup;

                    // Calendar Heuristics
                    if (el.getAttribute('name') === 'day' || (el.getAttribute('role') === 'gridcell' && !isNaN(Number(text)))) {
                        element.isCalendarDay = true;
                    }

                    // Combobox & Input Logic
                    if (el.getAttribute('role') === 'combobox') {
                        element.isCombobox = true;
                        // Try to find associated input value if this is a wrapper
                        const input = el.querySelector('input');
                        if (input instanceof HTMLInputElement) {
                            element.inputValue = input.value;
                        }
                    }

                    if (el instanceof HTMLInputElement) {
                        element.inputValue = el.value;
                    }

                    // Try to find label
                    if (el.id) {
                        const label = document.querySelector(`label[for="${el.id}"]`);
                        if (label && label.textContent) {
                            element.label = label.textContent.trim().slice(0, 50);
                        }
                    }
                    // Implicit label wrapping
                    if (!element.label && el.parentElement && el.parentElement.tagName === 'LABEL') {
                        element.label = el.parentElement.innerText.replace(element.text, '').trim().slice(0, 50);
                    }

                    // Agregar atributos opcionales solo si existen
                    if (el instanceof HTMLInputElement) {
                        element.type = el.type;
                        if (el.value) element.value = el.value.slice(0, 30);
                        if (el.placeholder) element.placeholder = el.placeholder;
                        if (el.name) element.name = el.name;
                    }

                    if (el instanceof HTMLSelectElement) {
                        if (el.selectedIndex >= 0) {
                            element.value = el.options[el.selectedIndex]?.text?.slice(0, 30);
                            element.selectedText = el.options[el.selectedIndex]?.text?.slice(0, 50);
                            element.selectedIndex = el.selectedIndex;
                        }
                        element.totalOptions = el.options.length;
                    }

                    const ariaLabel = el.getAttribute('aria-label');
                    if (ariaLabel) element.ariaLabel = ariaLabel;

                    const role = el.getAttribute('role');
                    if (role) element.role = role;

                    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
                    if (testId) element.testId = testId;

                    // Classname helpful for debugging or heuristic matching
                    if (el.className && typeof el.className === 'string') {
                        element.className = el.className.slice(0, 50);
                    }

                    elements.push(element);

                    // Límite de elementos para evitar snapshots enormes
                    if (elements.length >= 800) break;
                }

                // === Detectar estado de la página ===
                const pageState: any = {
                    hasModal: false,
                    isLoading: false,
                    hasErrors: false,
                    errorMessages: []
                };

                // Detectar modales y overlays de búsqueda
                const modalSelectors = [
                    '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
                    '.modal.show', '.modal.active', '.modal.open',
                    '.popup:not(.hidden)', '.overlay.active'
                ];

                for (let i = 0; i < modalSelectors.length; i++) {
                    const modal = document.querySelector(modalSelectors[i]);
                    if (modal instanceof HTMLElement && isVisible(modal)) {
                        pageState.hasModal = true;
                        const titleEl = modal.querySelector('h1, h2, h3, .modal-title, [role="heading"]');
                        const title = titleEl?.textContent?.trim() || '';

                        const buttons: string[] = [];
                        const foundButtons = modal.querySelectorAll('button');
                        for (let k = 0; k < foundButtons.length; k++) {
                            const t = foundButtons[k].textContent?.trim();
                            if (t) buttons.push(t);
                        }

                        pageState.modalInfo = { title: title.slice(0, 50), buttons: buttons.slice(0, 5) };
                        break;
                    }
                }

                // Detectar overlays/paneles de búsqueda tipo OpenTable (si no está deshabilitado por perfil)
                if (!pageState.hasModal && !pageSiteProfile?.ignoreSearchPanelModal) {
                    // Método 1: Buscar por botón de cerrar + componentes de reserva
                    const closeButton = document.querySelector(
                        'button[aria-label="cerrar"], button[title="cerrar"], ' +
                        'button[aria-label="close"], button[title="close"], ' +
                        '[data-test="icClose"], [data-testid="icClose"]'
                    );

                    if (closeButton instanceof HTMLElement && isVisible(closeButton)) {
                        // Buscar el contenedor padre más cercano que tenga el panel de búsqueda
                        let container = closeButton.parentElement;
                        for (let depth = 0; depth < 10 && container; depth++) {
                            // Verificar si este contenedor tiene los componentes de OpenTable
                            const hasSearchInput = container.querySelector(
                                'input[data-test*="search"], input[data-test*="autocomplete"], ' +
                                'input[id*="autocomplete"], input[placeholder*="Ubicación"], ' +
                                'input[placeholder*="restaurante"], input[placeholder*="cocina"]'
                            );
                            const hasPickers = container.querySelector(
                                '[data-test="day-picker"], [data-test="time-picker"], [data-test="party-size-picker"], ' +
                                '[data-testid="day-picker-overlay"], [data-testid="time-picker-container"]'
                            );
                            // Buscar botón de búsqueda (sin usar :contains que no es CSS válido)
                            const allButtons = container.querySelectorAll('button');
                            let hasGoButton = false;
                            for (let b = 0; b < allButtons.length; b++) {
                                const btn = allButtons[b];
                                const ariaLabel = btn.getAttribute('aria-label') || '';
                                const btnText = btn.textContent?.toLowerCase() || '';
                                if (ariaLabel === '¡Vamos!' || ariaLabel === "Let's go" ||
                                    btnText.includes('vamos') || btnText.includes('search') || btnText.includes('buscar')) {
                                    hasGoButton = true;
                                    break;
                                }
                            }

                            if (hasSearchInput || hasPickers) {
                                pageState.hasModal = true;
                                const titleEl = container.querySelector('h1, h2, h3, h4');
                                const title = titleEl?.textContent?.trim() || 'Panel de Búsqueda/Reserva';

                                const actionButtons: string[] = [];
                                if (hasGoButton) actionButtons.push('¡Vamos!');
                                actionButtons.push('cerrar');

                                pageState.modalInfo = {
                                    title: title.slice(0, 50),
                                    buttons: actionButtons
                                };
                                break;
                            }
                            container = container.parentElement;
                        }
                    }

                    // Método 2: Buscar directamente por data-test del contenedor de búsqueda
                    if (!pageState.hasModal) {
                        const searchPanel = document.querySelector(
                            '[data-test="search-in-header-dtp"], [data-test="search-panel"], ' +
                            '[data-testid="search-container"], [role="search"]'
                        );
                        if (searchPanel instanceof HTMLElement && isVisible(searchPanel)) {
                            pageState.hasModal = true;
                            pageState.modalInfo = {
                                title: 'Panel de Búsqueda',
                                buttons: ['buscar', 'cerrar']
                            };
                        }
                    }

                    // Método 3: Detectar autocomplete dropdown abierto
                    if (!pageState.hasModal) {
                        const autocompleteDropdown = document.querySelector(
                            '[data-test="autocomplete-items-dropdown"], [id*="autocomplete-menu"], ' +
                            '[role="listbox"][aria-expanded="true"], [role="combobox"][aria-expanded="true"]'
                        );
                        if (autocompleteDropdown instanceof HTMLElement && isVisible(autocompleteDropdown)) {
                            pageState.hasModal = true;
                            pageState.modalInfo = {
                                title: 'Resultados de Búsqueda',
                                buttons: ['seleccionar opción']
                            };
                        }
                    }
                }

                // Detectar loading mejorado con LoadingState detallado
                // pageSiteProfile hoisted
                const baseLoadingSelectors = '.loading, .spinner, .loader, [class*="loading"], [aria-busy="true"]';
                const siteLoadingSelectors = (pageSiteProfile?.loadingSelectors || []) as string[];
                const falsePositiveLoaders = (pageSiteProfile?.falsePositiveLoaders || []) as string[];
                const allLoadingSelectors = [...baseLoadingSelectors.split(', '), ...siteLoadingSelectors].join(', ');

                const loaders = document.querySelectorAll(allLoadingSelectors);
                const detectedLoaders: string[] = [];
                let loadingType: 'spinner' | 'skeleton' | 'progress-bar' | 'overlay' | 'text' | undefined;

                for (let i = 0; i < loaders.length; i++) {
                    const loader = loaders[i];
                    if (!(loader instanceof HTMLElement)) continue;

                    // Verificar si es un falso positivo
                    const className = (loader.className || '').toLowerCase();
                    const isFalsePositive = falsePositiveLoaders.some((fp: string) => className.includes(fp.toLowerCase()));
                    if (isFalsePositive) continue;

                    if (isVisible(loader)) {
                        detectedLoaders.push(loader.tagName + (loader.className ? '.' + loader.className.split(' ')[0] : ''));

                        // Determinar tipo de loading
                        if (!loadingType) {
                            if (className.includes('skeleton')) loadingType = 'skeleton';
                            else if (className.includes('progress')) loadingType = 'progress-bar';
                            else if (className.includes('overlay')) loadingType = 'overlay';
                            else if (loader.textContent && loader.textContent.trim().length > 0) loadingType = 'text';
                            else loadingType = 'spinner';
                        }
                        pageState.isLoading = true;
                    }
                }

                // Crear LoadingState detallado
                const now = Date.now();
                const windowAny = window as any;
                const lastLoadingState = windowAny.__LAST_LOADING_STATE__ || { isLoading: false, timestamp: now };
                const consecutiveCount = pageState.isLoading && lastLoadingState.isLoading
                    ? (windowAny.__CONSECUTIVE_LOADING_COUNT__ || 0) + 1
                    : (pageState.isLoading ? 1 : 0);

                const loadingSince = pageState.isLoading && !lastLoadingState.isLoading ? now : (lastLoadingState.loadingSince || now);
                const likelyFalsePositive = consecutiveCount >= 5 || (now - loadingSince > 30000); // 5 snapshots seguidos o 30s

                pageState.loadingState = {
                    isLoading: pageState.isLoading,
                    loadingType: loadingType,
                    consecutiveLoadingCount: consecutiveCount,
                    loadingSince: pageState.isLoading ? loadingSince : undefined,
                    likelyFalsePositive: likelyFalsePositive,
                    loaderSelectors: detectedLoaders.slice(0, 5)
                };

                // Guardar estado para el próximo snapshot
                windowAny.__LAST_LOADING_STATE__ = { isLoading: pageState.isLoading, timestamp: now, loadingSince };
                windowAny.__CONSECUTIVE_LOADING_COUNT__ = consecutiveCount;

                // Detectar errores
                const errorSelectors = '.error, .alert-danger, .alert-error, [role="alert"], .invalid-feedback';
                const errors = document.querySelectorAll(errorSelectors);
                for (let i = 0; i < errors.length; i++) {
                    const error = errors[i];
                    if (error instanceof HTMLElement && isVisible(error) && error.textContent?.trim()) {
                        pageState.hasErrors = true;
                        if (error.textContent) {
                            pageState.errorMessages.push(error.textContent.trim().slice(0, 100));
                        }
                    }
                }

                // Detectar formulario activo
                const activeForm = document.querySelector('form:has(input:focus), form:has(button[type="submit"])');
                if (activeForm instanceof HTMLFormElement) {
                    pageState.currentForm = {
                        action: activeForm.action || '',
                        method: activeForm.method || 'get'
                    };
                }

                // === Detectar PageContext (wizard, tabs, calendario, campos vacíos) ===
                const pageContext: any = {};

                // Detectar wizard/steps
                const wizardIndicators = document.querySelectorAll('[class*="wizard"], [class*="step"], [class*="stepper"], [aria-label*="step" i], [aria-label*="paso" i]');
                if (wizardIndicators.length > 0) {
                    pageContext.isWizard = true;
                    // Intentar detectar paso actual y total
                    const stepText = Array.from(wizardIndicators).find(el => {
                        const text = el.textContent?.toLowerCase() || '';
                        return text.includes('step') || text.includes('paso') || /\d+\s*\/\s*\d+/.test(text);
                    })?.textContent || '';
                    const stepMatch = stepText.match(/(\d+)\s*\/\s*(\d+)/);
                    if (stepMatch) {
                        pageContext.wizardStep = parseInt(stepMatch[1], 10);
                        pageContext.wizardTotalSteps = parseInt(stepMatch[2], 10);
                    }
                }

                // Detectar tabs
                const tabs = document.querySelectorAll('[role="tablist"] [role="tab"][aria-selected="true"], .tab.active, [class*="tab"][class*="active"]');
                if (tabs.length > 0) {
                    pageContext.hasTabs = true;
                    const activeTab = tabs[0];
                    pageContext.activeTab = activeTab.textContent?.trim() || activeTab.getAttribute('aria-label') || '';
                }

                // Detectar calendario abierto
                const calendarSelectors = [
                    '[role="grid"][aria-label*="calendar" i]',
                    '[role="grid"][aria-label*="calendario" i]',
                    '.calendar:not([style*="display: none"])',
                    '[class*="datepicker"]:not([style*="display: none"])',
                    '[class*="calendar"]:not([style*="display: none"])'
                ];
                let calendarOpen = false;
                for (const selector of calendarSelectors) {
                    const calendar = document.querySelector(selector);
                    if (calendar instanceof HTMLElement && isVisible(calendar)) {
                        calendarOpen = true;
                        break;
                    }
                }
                if (calendarOpen || elements.some(e => e.isCalendarDay)) {
                    pageContext.hasCalendar = true;
                    pageContext.calendarOpen = calendarOpen;
                }

                // Detectar campos requeridos sin llenar
                // NOTA: No podemos usar :has-text() porque no es un selector CSS válido
                // En su lugar, seleccionamos todos los campos requeridos y verificamos manualmente
                const requiredInputs = document.querySelectorAll('input[required], textarea[required], select[required]');
                const emptyRequiredFields: string[] = [];
                requiredInputs.forEach((input: Element) => {
                    if (!(input instanceof HTMLElement)) return;

                    // Verificar si realmente está vacío
                    let isEmpty = false;
                    if (input instanceof HTMLInputElement) {
                        // Para inputs, verificar si no tiene value o está vacío
                        isEmpty = !input.value || input.value.trim() === '';
                    } else if (input instanceof HTMLTextAreaElement) {
                        isEmpty = !input.value || input.value.trim() === '';
                    } else if (input instanceof HTMLSelectElement) {
                        // Para selects, verificar si no tiene opción seleccionada o es la primera (default)
                        isEmpty = !input.value || input.selectedIndex === 0;
                    }

                    if (isEmpty) {
                        const name = input.getAttribute('name') || input.getAttribute('id') || '';
                        const label = input.id ? (document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() || '') : '';
                        const ariaLabel = input.getAttribute('aria-label') || '';
                        const placeholder = input.getAttribute('placeholder') || '';
                        const fieldLabel = label || ariaLabel || placeholder || name;

                        if (fieldLabel && !emptyRequiredFields.includes(fieldLabel)) {
                            emptyRequiredFields.push(fieldLabel);
                        }
                    }
                });
                if (emptyRequiredFields.length > 0) {
                    pageContext.emptyRequiredFields = emptyRequiredFields;
                }

                // Detectar formulario y sus campos
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) {
                    pageContext.hasForm = true;
                    const formFields: { name: string; type: string; required: boolean; filled: boolean }[] = [];
                    forms[0].querySelectorAll('input, select, textarea').forEach((field: Element) => {
                        if (!(field instanceof HTMLElement)) return;
                        const name = field.getAttribute('name') || field.getAttribute('id') || '';
                        const type = field.getAttribute('type') || field.tagName.toLowerCase();
                        const required = field.hasAttribute('required') || field.getAttribute('aria-required') === 'true';
                        let filled = false;
                        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
                            filled = !!(field.value && field.value.trim() !== '');
                        } else if (field instanceof HTMLSelectElement) {
                            filled = field.selectedIndex > 0 && !!field.value;
                        }
                        if (name) {
                            formFields.push({ name, type, required, filled });
                        }
                    });
                    if (formFields.length > 0) {
                        pageContext.formFields = formFields;
                    }
                }

                // Guardar PageContext en window para que esté disponible en el return
                (window as any).__PAGE_CONTEXT__ = Object.keys(pageContext).length > 0 ? pageContext : undefined;

                // === Contenido de texto (headings, párrafos, tablas, listas, semántica) ===
                const pageContent: any = {
                    headings: [] as { level: number; text: string }[],
                    paragraphs: [] as string[],
                    labels: [] as string[],
                    tables: [] as { headers?: string[]; rows: string[][] }[],
                    lists: [] as { items: string[] }[],
                    semantic: [] as { region: string; text: string }[]
                };
                const textLimit = (s: string, max: number) => (s || '').trim().slice(0, max);
                const addHeading = (el: Element) => {
                    const tag = el.tagName.toUpperCase();
                    const match = tag.match(/^H([1-6])$/);
                    if (match && el instanceof HTMLElement && isVisible(el)) {
                        const t = el.innerText?.trim();
                        if (t) pageContent.headings.push({ level: parseInt(match[1], 10), text: textLimit(t, 200) });
                    }
                };
                document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(addHeading);
                document.querySelectorAll('p').forEach(el => {
                    if (el instanceof HTMLElement && isVisible(el)) {
                        const t = el.innerText?.trim();
                        if (t) pageContent.paragraphs.push(textLimit(t, 300));
                    }
                });
                document.querySelectorAll('label').forEach(el => {
                    if (el instanceof HTMLElement && isVisible(el)) {
                        const t = el.textContent?.trim();
                        if (t) pageContent.labels.push(textLimit(t, 100));
                    }
                });
                document.querySelectorAll('table').forEach(table => {
                    if (!(table instanceof HTMLElement) || !isVisible(table)) return;
                    const rows: string[][] = [];
                    const ths = table.querySelectorAll('thead th');
                    const headers = ths.length ? Array.from(ths).map(th => textLimit(th.textContent || '', 80)) : undefined;
                    if (headers) rows.push(headers);
                    table.querySelectorAll('tbody tr, tr').forEach(tr => {
                        const cells = tr.querySelectorAll('td, th');
                        if (cells.length) rows.push(Array.from(cells).map(c => textLimit(c.textContent || '', 80)));
                    });
                    if (rows.length) pageContent.tables.push({ headers, rows });
                });
                document.querySelectorAll('ul, ol').forEach(list => {
                    if (!(list instanceof HTMLElement) || !isVisible(list)) return;
                    const items = Array.from(list.querySelectorAll(':scope > li')).map(li => textLimit(li.textContent || '', 150));
                    if (items.length) pageContent.lists.push({ items });
                });
                const semanticSelectors = ['nav', 'header', 'main', 'footer', 'aside', 'article'];
                semanticSelectors.forEach(region => {
                    document.querySelectorAll(region).forEach(el => {
                        if (el instanceof HTMLElement && isVisible(el)) {
                            const t = el.innerText?.trim();
                            if (t) pageContent.semantic.push({ region, text: textLimit(t, 250) });
                        }
                    });
                });

                // === Detección de framework/tecnología ===
                const windowForFramework = window as any;
                let framework: 'react' | 'vue' | 'angular' | 'jquery' | 'unknown' | undefined;
                let isSpa = false;
                if (windowForFramework.__REACT_DEVTOOLS_GLOBAL_HOOK__ || windowForFramework.React || windowForFramework.__REACT__) {
                    framework = 'react';
                    isSpa = true;
                } else if (windowForFramework.__VUE__ || windowForFramework.Vue) {
                    framework = 'vue';
                    isSpa = true;
                } else if (windowForFramework.ng || windowForFramework.getAllAngularRootElements) {
                    framework = 'angular';
                    isSpa = true;
                } else if (windowForFramework.jQuery || windowForFramework.$) {
                    framework = 'jquery';
                }
                let hasShadowDom = false;
                const shadowElements: any[] = [];

                // Función recursiva para extraer elementos de Shadow DOM
                const extractShadowElements = (shadowRoot: ShadowRoot, depth: number = 0, maxDepth: number = 3): void => {
                    if (depth > maxDepth) return;

                    try {
                        const shadowSelectors = 'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="link"]';
                        const shadowNodes = shadowRoot.querySelectorAll(shadowSelectors);

                        for (let i = 0; i < shadowNodes.length && shadowElements.length < 50; i++) {
                            const el = shadowNodes[i];
                            if (!(el instanceof HTMLElement)) continue;

                            const rect = el.getBoundingClientRect();
                            if (rect.width === 0 || rect.height === 0) continue;

                            const style = getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden') continue;

                            const tag = el.tagName.toLowerCase();
                            let text = '';
                            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                                text = (el as HTMLInputElement).placeholder || el.title || '';
                            } else {
                                text = (el.innerText || '').trim().slice(0, 100);
                            }

                            shadowElements.push({
                                ref: 'sd' + depth + '-' + (shadowElements.length + 1),
                                tag: tag,
                                text: text,
                                isButton: tag === 'button' || el.getAttribute('role') === 'button',
                                isInput: ['input', 'select', 'textarea'].includes(tag),
                                isLink: tag === 'a' || el.getAttribute('role') === 'link',
                                isDisabled: (el as any).disabled || el.getAttribute('aria-disabled') === 'true',
                                isVisible: true,
                                rect: {
                                    x: Math.round(rect.x),
                                    y: Math.round(rect.y),
                                    w: Math.round(rect.width),
                                    h: Math.round(rect.height)
                                },
                                ariaLabel: el.getAttribute('aria-label') || undefined,
                                role: el.getAttribute('role') || undefined,
                                testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,
                                id: el.id || undefined,
                                name: el.getAttribute('name') || undefined,
                                className: el.className || undefined
                            });
                        }

                        // Buscar shadow roots anidados
                        const nestedShadows = shadowRoot.querySelectorAll('*');
                        for (let j = 0; j < nestedShadows.length && depth < maxDepth; j++) {
                            const nested = nestedShadows[j];
                            if ((nested as any).shadowRoot) {
                                extractShadowElements((nested as any).shadowRoot, depth + 1, maxDepth);
                            }
                        }
                    } catch (e) {
                        // Shadow DOM puede ser cerrado o inaccesible
                    }
                };

                // Detectar y extraer Shadow DOM
                try {
                    const all = document.body?.querySelectorAll('*');
                    if (all) {
                        for (let i = 0; i < Math.min(all.length, 200); i++) {
                            const el = all[i] as any;
                            if (el.shadowRoot) {
                                hasShadowDom = true;
                                extractShadowElements(el.shadowRoot, 0, 3);
                                if (shadowElements.length >= 50) break; // Límite de elementos shadow
                            }
                        }
                    }

                    // Agregar elementos shadow al array principal
                    if (shadowElements.length > 0) {
                        elements.push(...shadowElements);
                    }
                } catch (_) { }

                // Generar hash del snapshot antes de retornar
                const snapshotHash = `${elements.length}-${elements.slice(0, 10).map(e => e.ref).join('')}`;
                (window as any).__SNAPSHOT_HASH__ = snapshotHash;

                return {
                    url: window.location.href,
                    title: document.title,
                    elements: elements,
                    pageContent,
                    framework: { isSpa, framework, hasShadowDom },
                    pageState: pageState,
                    pageContext: (window as any).__PAGE_CONTEXT__ || undefined,
                    meta: {
                        timestamp: Date.now(),
                        elementCount: elements.length,
                        extractionTimeMs: 0,
                        snapshotHash: snapshotHash
                    }
                };
            }, this.currentSiteProfile || {});
        } catch (e: any) {
            const errorMessage = e?.message || '';
            if (errorMessage.includes('Target page, context or browser has been closed') ||
                errorMessage.includes('Target closed') ||
                errorMessage.includes('Browser closed') ||
                errorMessage.includes('context was destroyed')) {
                throw new Error('Target page, context or browser has been closed');
            }
            throw e;
        }

        // === Elementos en iframes (Stripe, reCAPTCHA, embeds) ===
        if (options?.includeFrames !== false) {
            const frames = page.frames();
            let frameIndex = 0;
            for (const frame of frames) {
                if (frame === page.mainFrame()) continue;
                try {
                    const frameElements = await frame.evaluate(() => {
                        const out: any[] = [];
                        let refCounter = 0;
                        const isVisible = (el: HTMLElement): boolean => {
                            const style = getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden') return false;
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        };
                        const sel = 'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"], label';
                        document.querySelectorAll(sel).forEach((el: Element) => {
                            if (!(el instanceof HTMLElement) || !isVisible(el)) return;
                            const rect = el.getBoundingClientRect();
                            const ref = 'e' + (++refCounter);
                            const tag = el.tagName.toLowerCase();
                            let text = '';
                            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                                text = (el as HTMLInputElement).placeholder || el.title || '';
                            } else {
                                text = (el.innerText || '').trim().slice(0, 100);
                            }
                            out.push({
                                ref,
                                tag,
                                text,
                                isButton: tag === 'button' || el.getAttribute('role') === 'button',
                                isInput: ['input', 'select', 'textarea'].includes(tag),
                                isLink: tag === 'a',
                                isDisabled: (el as any).disabled || el.getAttribute('aria-disabled') === 'true',
                                isVisible: true,
                                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                                frameRef: true,
                                // Metadata adicional para iframes
                                ariaLabel: el.getAttribute('aria-label') || undefined,
                                role: el.getAttribute('role') || undefined,
                                testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,
                                id: el.id || undefined,
                                name: el.getAttribute('name') || undefined,
                                className: el.className || undefined,
                                type: el.getAttribute('type') || undefined,
                                placeholder: el.getAttribute('placeholder') || undefined
                            });
                        });
                        return out;
                    });
                    const prefix = 'f' + frameIndex + '-';
                    // Limitar elementos por iframe para evitar snapshots enormes
                    const maxElementsPerFrame = 30;
                    for (let i = 0; i < Math.min(frameElements.length, maxElementsPerFrame); i++) {
                        const el = frameElements[i];
                        snapshot.elements.push({
                            ...el,
                            ref: prefix + el.ref,
                            testId: el.testId || undefined,
                        });
                    }
                    frameIndex++;
                    if (frameIndex >= 5) break; // Máximo 5 iframes para evitar demoras
                } catch (_) {
                    // iframe puede ser cross-origin y no accesible
                }
            }
            snapshot.meta.elementCount = snapshot.elements.length;
        }

        // Agregar tiempo de extracción real
        snapshot.meta.extractionTimeMs = Date.now() - startTime;

        // Generar hash del snapshot para detectar loops
        snapshot.meta.snapshotHash = this.generateSnapshotHash(snapshot.elements);
        this.snapshotHistory.push(snapshot.meta.snapshotHash);
        if (this.snapshotHistory.length > 10) {
            this.snapshotHistory.shift(); // Mantener solo los últimos 10
        }

        // Adaptive retry: si hay muy pocos elementos, hacer scroll y reintentar
        if (snapshot.elements.length < 5 && options?.retryOnEmpty !== false && !options?.skipDomStable) {
            try {
                await page.evaluate(() => window.scrollBy(0, 500));
                await page.waitForTimeout(1000);
                // Reintentar una vez
                const retrySnapshot = await this.extract(page, { ...options, retryOnEmpty: false });
                if (retrySnapshot.elements.length > snapshot.elements.length) {
                    return retrySnapshot;
                }
            } catch (_) {
                // Si falla el retry, continuar con el snapshot original
            }
        }

        this.lastSnapshot = snapshot;
        return snapshot;
    }

    /**
     * Verifica si la página cambió desde el último snapshot
     */
    hasPageChanged(newSnapshot: OptimizedSnapshot): boolean {
        if (!this.lastSnapshot) return true;

        // Comparación rápida
        if (this.lastSnapshot.url !== newSnapshot.url) return true;
        if (this.lastSnapshot.pageState.hasModal !== newSnapshot.pageState.hasModal) return true;
        if (this.lastSnapshot.meta.elementCount !== newSnapshot.meta.elementCount) return true;

        // Comparación de elementos principales
        const oldRefs = this.lastSnapshot.elements.slice(0, 10).map(e => e.ref + e.text).join('');
        const newRefs = newSnapshot.elements.slice(0, 10).map(e => e.ref + e.text).join('');

        return oldRefs !== newRefs;
    }

    /**
     * Genera hash del snapshot para detección de loops
     */
    getSnapshotHash(snapshot: OptimizedSnapshot): string {
        const key = snapshot.url +
            snapshot.pageState.hasModal +
            snapshot.elements.slice(0, 15).map(e => e.ref).join('');
        return this.simpleHash(key);
    }

    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
}
