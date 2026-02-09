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

export interface OptimizedSnapshot {
    url: string;
    title: string;
    elements: OptimizedElement[];
    pageContent?: PageContent;
    framework?: FrameworkInfo;
    pageState: {
        hasModal: boolean;
        modalInfo?: { title: string; buttons: string[] };
        isLoading: boolean;
        hasErrors: boolean;
        errorMessages: string[];
        currentForm?: { action: string; method: string; };
    };
    /** Respuestas API/XHR capturadas (si está habilitada la interceptación) */
    capturedApiData?: { url: string; data: unknown }[];
    /** Contenido extraído con Readability/tablas/precios (modo extracción) */
    extractedContent?: ExtractedContent;
    meta: {
        timestamp: number;
        elementCount: number;
        extractionTimeMs: number;
    };
}

export class OptimizedSnapshotExtractor {
    private lastSnapshot: OptimizedSnapshot | null = null;

    /**
     * Espera a que el DOM deje de cambiar (MutationObserver) antes de tomar snapshot
     */
    async waitForDomStable(page: Page, silenceMs: number = 400, maxWaitMs: number = 5000): Promise<void> {
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
                        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden']
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        resolve();
                    }, maxWaitMs);
                }),
            { silenceMs, maxWaitMs }
        ).catch(() => {});
    }

    /**
     * Extrae snapshot optimizado (con espera de DOM estable y soporte iframes)
     */
    async extract(page: Page, options?: { skipDomStable?: boolean; includeFrames?: boolean }): Promise<OptimizedSnapshot> {
        const startTime = Date.now();
        if (!options?.skipDomStable) {
            await this.waitForDomStable(page);
        }

        const snapshot = await page.evaluate(() => {
            // @ts-ignore - Shim for esbuild __name helper that might be injected (using window to avoid renaming)
            (window as any).__name = (target: any, value: any) => target;
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
                'button:not([disabled])',
                'input:not([type="hidden"]):not([disabled])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                // Media prioridad - elementos clickeables y partes de menú
                'a[href]',
                '[role="button"]:not([disabled])',
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
                '[data-target]',
                '[data-dismiss]',
                '[data-bs-toggle]',
                '[data-action]',
                '[data-click]',
                '[data-test]',
                '[data-testid]',
                '[data-qa]',
                '[data-automation]',

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
                if (!isVisible(el)) continue;
                
                // Filtrar elementos de solo accesibilidad (screen-only, sr-only, etc.)
                if (isAccessibilityOnly(el)) continue;

                const rect = el.getBoundingClientRect();

                // Solo elementos en viewport extendido (visible + 1 scroll)
                if (rect.bottom < -viewportHeight || rect.top > viewportHeight * 2) continue;
                if (rect.right < 0 || rect.left > viewportWidth) continue;

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


                const element: any = {
                    ref: ref,
                    tag: tag,
                    text: text,
                    isButton: tag === 'button' || el.getAttribute('role') === 'button' || el.classList.contains('btn'),
                    isInput: ['input', 'select', 'textarea'].includes(tag),
                    isLink: tag === 'a' || el.getAttribute('role') === 'link',
                    isDisabled: (el as any).disabled || el.getAttribute('aria-disabled') === 'true',
                    isVisible: true,
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

            // Detectar overlays/paneles de búsqueda tipo OpenTable
            if (!pageState.hasModal) {
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

            // Detectar loading
            const loadingSelectors = '.loading, .spinner, .loader, [class*="loading"], [aria-busy="true"]';
            const loaders = document.querySelectorAll(loadingSelectors);
            for (let i = 0; i < loaders.length; i++) {
                const loader = loaders[i];
                if (loader instanceof HTMLElement && isVisible(loader)) {
                    pageState.isLoading = true;
                    break;
                }
            }

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
            const win = window as any;
            let framework: 'react' | 'vue' | 'angular' | 'jquery' | 'unknown' | undefined;
            let isSpa = false;
            if (win.__REACT_DEVTOOLS_GLOBAL_HOOK__ || win.React || win.__REACT__) {
                framework = 'react';
                isSpa = true;
            } else if (win.__VUE__ || win.Vue) {
                framework = 'vue';
                isSpa = true;
            } else if (win.ng || win.getAllAngularRootElements) {
                framework = 'angular';
                isSpa = true;
            } else if (win.jQuery || win.$) {
                framework = 'jquery';
            }
            let hasShadowDom = false;
            try {
                const all = document.body?.querySelectorAll('*');
                if (all) {
                    for (let i = 0; i < Math.min(all.length, 200); i++) {
                        if ((all[i] as any).shadowRoot) {
                            hasShadowDom = true;
                            break;
                        }
                    }
                }
            } catch (_) {}

            return {
                url: window.location.href,
                title: document.title,
                elements: elements,
                pageContent,
                framework: { isSpa, framework, hasShadowDom },
                pageState: pageState,
                meta: {
                    timestamp: Date.now(),
                    elementCount: elements.length,
                    extractionTimeMs: 0
                }
            };
        });

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
                                frameRef: true
                            });
                        });
                        return out;
                    });
                    const prefix = 'f' + frameIndex + '-';
                    for (const el of frameElements) {
                        snapshot.elements.push({
                            ...el,
                            ref: prefix + el.ref,
                            testId: (el.testId || '') ? el.testId : undefined,
                        });
                    }
                    frameIndex++;
                } catch (_) {
                    // iframe puede ser cross-origin y no accesible
                }
            }
            snapshot.meta.elementCount = snapshot.elements.length;
        }

        // Agregar tiempo de extracción real
        snapshot.meta.extractionTimeMs = Date.now() - startTime;

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
