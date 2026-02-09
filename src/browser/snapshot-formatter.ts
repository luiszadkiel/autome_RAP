
import { OptimizedSnapshot, OptimizedElement, PageContent, FrameworkInfo } from './optimized-snapshot.js';
import type { ExtractedContent } from './content-extractor.js';

export interface FormattedSnapshot {
    formattedElements: string;  // Optimized text for LLM
    modal: { title: string; buttons: string[] } | null;
    errors: string[];
    isLoading: boolean;
    forms: OptimizedElement[];
    rawElements: OptimizedElement[];  // Keep raw for executor
}

interface GroupedElements {
    modal: OptimizedElement[];
    pickers: OptimizedElement[];       // Selectores de fecha/hora/personas
    autocomplete: OptimizedElement[];  // Opciones de autocompletado/dropdown
    forms: OptimizedElement[];
    navigation: OptimizedElement[];
    actions: OptimizedElement[];
    other: OptimizedElement[];
}

export class SnapshotFormatter {

    /**
     * Converts raw snapshot to LLM-optimized format (incl. contenido de texto y framework)
     */
    format(snapshot: OptimizedSnapshot): FormattedSnapshot {
        const grouped = this.groupElements(snapshot.elements);
        let formattedElements = this.formatPageContentAndFramework(snapshot) + '\n' + this.formatForLLM(grouped);

        return {
            formattedElements,
            modal: snapshot.pageState.modalInfo || null, // Map from internal structure
            errors: snapshot.pageState.errorMessages,
            isLoading: snapshot.pageState.isLoading,
            forms: grouped.forms,
            rawElements: snapshot.elements
        };
    }

    /**
     * Formato de contenido de página y detección de framework para el LLM
     */
    private formatPageContentAndFramework(snapshot: OptimizedSnapshot): string {
        let out = '';
        if (snapshot.framework) {
            const f: FrameworkInfo = snapshot.framework;
            out += '### 🔧 SITIO: ' + (f.framework || 'unknown') + (f.isSpa ? ' (SPA)' : '') + (f.hasShadowDom ? ' + Shadow DOM' : '') + '\n';
        }
        const pc = snapshot.pageContent;
        if (!pc) return out;
        if (pc.headings?.length) {
            out += '### 📑 HEADINGS\n';
            out += pc.headings.map(h => '  '.repeat(h.level) + h.text).join('\n') + '\n';
        }
        if (pc.paragraphs?.length) {
            out += '### 📄 PÁRRAFOS (resumen)\n';
            out += pc.paragraphs.slice(0, 15).map(p => this.truncate(p, 120)).join('\n') + '\n';
        }
        if (pc.labels?.length) {
            out += '### 🏷️ LABELS\n';
            out += pc.labels.slice(0, 20).join(' | ') + '\n';
        }
        if (pc.tables?.length) {
            out += '### 📊 TABLAS\n';
            pc.tables.slice(0, 3).forEach((t, i) => {
                if (t.headers?.length) out += '  Headers: ' + t.headers.join(' | ') + '\n';
                t.rows.slice(0, 5).forEach(row => {
                    out += '  ' + row.join(' | ') + '\n';
                });
            });
        }
        if (pc.lists?.length) {
            out += '### 📋 LISTAS\n';
            pc.lists.slice(0, 5).forEach(l => {
                out += '  - ' + l.items.slice(0, 8).join(', ') + '\n';
            });
        }
        if (pc.semantic?.length) {
            out += '### 🧭 REGIONES (nav, header, main, footer)\n';
            pc.semantic.slice(0, 8).forEach(s => {
                out += `  [${s.region}] ${this.truncate(s.text, 100)}\n`;
            });
        }
        if (snapshot.capturedApiData?.length) {
            out += '### 🌐 API/XHR CAPTURADAS (datos estructurados)\n';
            snapshot.capturedApiData.slice(-8).forEach(({ url, data }) => {
                const shortUrl = url.length > 60 ? url.slice(0, 57) + '...' : url;
                const preview = typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data).slice(0, 200);
                out += `  ${shortUrl}\n  → ${this.truncate(preview, 150)}\n`;
            });
        }
        const ec = snapshot.extractedContent;
        if (ec) {
            out += '### 📖 MODO EXTRACCIÓN (Readability + datos)\n';
            if (ec.readability) {
                out += `  Título: ${this.truncate(ec.readability.title, 80)}\n`;
                if (ec.readability.excerpt) out += `  Resumen: ${this.truncate(ec.readability.excerpt, 150)}\n`;
                out += `  Texto (inicio): ${this.truncate(ec.readability.textContent, 500)}\n`;
            }
            if (ec.prices?.length) out += '  Precios detectados: ' + ec.prices.slice(0, 15).join(', ') + '\n';
            if (ec.dates?.length) out += '  Fechas detectadas: ' + ec.dates.slice(0, 10).join(', ') + '\n';
            if (ec.phones?.length) out += '  Teléfonos: ' + ec.phones.slice(0, 5).join(', ') + '\n';
            if (ec.tables?.length) {
                out += '  Tablas extraídas: ' + ec.tables.length + '\n';
                ec.tables.slice(0, 2).forEach((t, i) => {
                    if (t.headers?.length) out += '    Headers: ' + t.headers.join(' | ') + '\n';
                    t.rows.slice(0, 3).forEach(row => { out += '    ' + row.join(' | ') + '\n'; });
                });
            }
            if (ec.structuredData?.jsonLd?.length) out += '  JSON-LD: ' + ec.structuredData.jsonLd.length + ' bloque(s)\n';
            if (Object.keys(ec.structuredData?.og ?? {}).length) {
                out += '  Open Graph: ' + JSON.stringify(ec.structuredData.og).slice(0, 120) + '\n';
            }
        }
        return out;
    }

    /**
     * Groups elements by context (forms, nav, actions)
     */
    private groupElements(elements: OptimizedElement[]): GroupedElements {
        const groups: GroupedElements = {
            modal: [],
            pickers: [],
            forms: [],
            autocomplete: [],
            navigation: [],
            actions: [],
            other: []
        };

        for (const el of elements) {
            const testIdLower = el.testId?.toLowerCase() || '';
            const idLower = el.id?.toLowerCase() || '';
            const classLower = el.className?.toLowerCase() || '';
            const ariaLower = el.ariaLabel?.toLowerCase() || '';

            // 1. Selectores de fecha/hora/personas (pickers) - MUY IMPORTANTE para reservas
            if (testIdLower.includes('picker') || testIdLower.includes('day-picker') ||
                testIdLower.includes('time-picker') || testIdLower.includes('party-size') ||
                idLower.includes('picker') || idLower.includes('calendar') ||
                ariaLower.includes('selector de fecha') || ariaLower.includes('selector de hora') ||
                ariaLower.includes('selector de tamaño') || ariaLower.includes('date picker') ||
                classLower.includes('rdp-') || el.isCalendarDay) {
                groups.pickers.push(el);
            }
            // 2. Opciones de autocomplete/dropdown (alta prioridad para búsquedas)
            else if (el.role === 'option' || el.role === 'listitem' || 
                testIdLower.includes('autocomplete') || testIdLower.includes('suggestion') ||
                testIdLower.includes('restaurant-autocomplete') || testIdLower.includes('freetext-autocomplete') ||
                idLower.includes('autocomplete') || idLower.includes('suggestion') ||
                classLower.includes('autocomplete') || classLower.includes('suggestion') ||
                classLower.includes('dropdown-item') || classLower.includes('result')) {
                groups.autocomplete.push(el);
            }
            // 3. Campos de formulario
            else if (el.isInput || el.tag === 'select' || el.tag === 'textarea' || el.isCombobox) {
                groups.forms.push(el);
            }
            // 4. Navegación
            else if (el.isLink || el.tag === 'nav' || el.role === 'navigation') {
                groups.navigation.push(el);
            }
            // 5. Botones de acción
            else if (el.isButton || el.role === 'button' || el.tag === 'button') {
                groups.actions.push(el);
            }
            // 6. Otros
            else {
                groups.other.push(el);
            }
        }

        return groups;
    }

    /**
     * Formats elements compactly and clearly for the LLM
     */
    private formatForLLM(groups: GroupedElements): string {
        let output = '';

        // Modal first (highest priority)
        if (groups.modal.length > 0) {
            output += '### 🔴 MODAL (interact first)\n';
            output += this.formatElementList(groups.modal);
            output += '\n';
        }

        // Pickers (date/time/party size) - critical for reservations
        if (groups.pickers.length > 0) {
            output += '### 📅 DATE/TIME/PARTY PICKERS (for reservations)\n';
            output += this.formatElementList(groups.pickers.slice(0, 20));
            output += '\n';
        }

        // Autocomplete/Dropdown options (high priority when searching)
        if (groups.autocomplete.length > 0) {
            output += '### 🔍 SEARCH RESULTS / AUTOCOMPLETE OPTIONS (click to select)\n';
            output += this.formatElementList(groups.autocomplete.slice(0, 15));
            output += '\n';
        }

        // Forms
        if (groups.forms.length > 0) {
            output += '### 📝 FORM FIELDS\n';
            output += this.formatElementList(groups.forms);
            output += '\n';
        }

        // Action Buttons
        if (groups.actions.length > 0) {
            output += '### 🔘 BUTTONS\n';
            output += this.formatElementList(groups.actions);
            output += '\n';
        }

        // Navigation
        if (groups.navigation.length > 0) {
            output += '### 🔗 NAVIGATION\n';
            output += this.formatElementList(groups.navigation.slice(0, 15));
            output += '\n';
        }

        // Others (limited)
        if (groups.other.length > 0) {
            output += '### 📦 OTHER\n';
            output += this.formatElementList(groups.other.slice(0, 10));
        }

        return output;
    }

    /**
     * Formats list of elements compactly
     */
    private formatElementList(elements: OptimizedElement[]): string {
        return elements.map(el => this.formatElement(el)).join('\n');
    }

    /**
     * Formats an individual element with rich context for LLM
     * Format: [ref] type "text" | attributes | action hint
     */
    private formatElement(el: OptimizedElement): string {
        let line = `[${el.ref}] ${el.tag}`;

        // Add type if input
        if (el.type && el.type !== 'text') {
            line += `(${el.type})`;
        }

        // Add role if semantic
        if (el.role && ['option', 'combobox', 'listbox', 'menu', 'menuitem', 'listitem', 'button', 'tab', 'grid'].includes(el.role)) {
            line += `[role=${el.role}]`;
        }

        // Add text/placeholder/aria-label (primary identifier)
        if (el.text && el.text.length > 0) {
            line += ` "${this.truncate(el.text, 50)}"`;
        } else if (el.placeholder) {
            line += ` ph="${this.truncate(el.placeholder, 40)}"`;
        } else if (el.ariaLabel) {
            line += ` aria="${this.truncate(el.ariaLabel, 40)}"`;
        }

        // Add id if descriptive (helps identify the element)
        if (el.id && !el.id.match(/^[a-f0-9-]{20,}$/i)) { // Skip random UUIDs
            line += ` #${this.truncate(el.id, 30)}`;
        }

        // Add current value if exists (important for inputs)
        if (el.value && el.value.length > 0) {
            line += ` ➡️val="${this.truncate(el.value, 25)}"`;
        }

        // Add inputValue for comboboxes
        if (el.inputValue && el.inputValue.length > 0) {
            line += ` ➡️input="${this.truncate(el.inputValue, 25)}"`;
        }

        // Specialized displays with context
        if (el.isCombobox) {
            line += ` 🔽COMBOBOX`;
            if (el.hasPopup) line += `→${el.hasPopup}`;
        }
        if (el.isCalendarDay) {
            line += ` 📅`;
            if (el.isCurrentDate) line += 'TODAY';
            if (el.isSelected) line += '✓';
        }
        if (el.tag === 'select' && el.selectedText) {
            line += ` 📋SEL="${this.truncate(el.selectedText, 25)}"`;
            if (el.totalOptions) line += `(${el.totalOptions} opts)`;
        }

        // Important states
        if (el.isDisabled) line += ' ⛔DISABLED';
        if (el.isExpanded) line += ' 📂OPEN';
        if (el.isSelected && !el.isCalendarDay) line += ' ✅SEL';
        if (el.isRequired) line += ' *';
        if (el.isFocused) line += ' 🎯';
        if (el.isReadonly) line += ' 🔒';
        if (el.isInvalid) line += ' ⚠️ERR';
        if (el.isPressed) line += ' ⬇️PRESSED';

        // Controls relationship (important for understanding what element affects what)
        if (el.controls) {
            line += ` →controls:${this.truncate(el.controls, 20)}`;
        }

        // Label (form context)
        if (el.label) {
            line += ` lbl="${this.truncate(el.label, 25)}"`;
        }

        // TestId (very useful for identifying elements)
        if (el.testId) {
            line += ` [${this.truncate(el.testId, 35)}]`;
        }

        // Add action hint based on element type
        line += this.getActionHint(el);

        return line;
    }

    /**
     * Provides action hints for the LLM based on element type
     */
    private getActionHint(el: OptimizedElement): string {
        if (el.isDisabled) return '';
        
        if (el.tag === 'input') {
            if (el.type === 'checkbox' || el.type === 'radio') return ' →click';
            return ' →type';
        }
        if (el.tag === 'select') return ' →select';
        if (el.tag === 'textarea') return ' →type';
        if (el.isButton || el.tag === 'button' || el.role === 'button') return ' →click';
        if (el.isLink || el.tag === 'a') return ' →click';
        if (el.role === 'option' || el.role === 'listitem' || el.role === 'menuitem') return ' →click';
        if (el.isCombobox) return ' →click/type';
        if (el.isCalendarDay) return ' →click';
        if (el.role === 'tab') return ' →click';
        
        return '';
    }

    private truncate(text: string, max: number): string {
        if (text.length <= max) return text;
        return text.slice(0, max - 3) + '...';
    }
}
