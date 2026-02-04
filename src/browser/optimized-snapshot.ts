import { Page } from 'playwright';

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
    // Para matching robusto
    testId?: string;
    name?: string;
    className?: string;
    id?: string;
}

export interface OptimizedSnapshot {
    url: string;
    title: string;
    elements: OptimizedElement[];
    pageState: {
        hasModal: boolean;
        modalInfo?: { title: string; buttons: string[] };
        isLoading: boolean;
        hasErrors: boolean;
        errorMessages: string[];
        currentForm?: { action: string; method: string; };
    };
    meta: {
        timestamp: number;
        elementCount: number;
        extractionTimeMs: number;
    };
}

export class OptimizedSnapshotExtractor {
    private lastSnapshot: OptimizedSnapshot | null = null;

    /**
     * Extrae snapshot optimizado en UNA SOLA llamada a evaluate
     */
    async extract(page: Page): Promise<OptimizedSnapshot> {
        const startTime = Date.now();

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
                    if (text.length > 60) text = text.slice(0, 57) + '...';
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
                if (elements.length >= 500) break;
            }

            // === Detectar estado de la página ===
            const pageState: any = {
                hasModal: false,
                isLoading: false,
                hasErrors: false,
                errorMessages: []
            };

            // Detectar modales
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

            return {
                url: window.location.href,
                title: document.title,
                elements: elements,
                pageState: pageState,
                meta: {
                    timestamp: Date.now(),
                    elementCount: elements.length,
                    extractionTimeMs: 0
                }
            };
        });

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
