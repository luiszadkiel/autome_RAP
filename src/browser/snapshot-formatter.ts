
import { OptimizedSnapshot, OptimizedElement } from './optimized-snapshot.js';

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
    forms: OptimizedElement[];
    navigation: OptimizedElement[];
    actions: OptimizedElement[];
    other: OptimizedElement[];
}

export class SnapshotFormatter {

    /**
     * Converts raw snapshot to LLM-optimized format
     */
    format(snapshot: OptimizedSnapshot): FormattedSnapshot {
        const grouped = this.groupElements(snapshot.elements);
        const formattedElements = this.formatForLLM(grouped);

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
     * Groups elements by context (forms, nav, actions)
     */
    private groupElements(elements: OptimizedElement[]): GroupedElements {
        const groups: GroupedElements = {
            modal: [],
            forms: [],
            navigation: [],
            actions: [],
            other: []
        };

        // Simple heuristic for modal elements based on position or parents could go here
        // For now we rely on the implementation in OptimizedSnapshotExtractor to flag generic text, 
        // but here we classify by type.

        for (const el of elements) {
            if (el.isInput || el.tag === 'select' || el.tag === 'textarea') {
                groups.forms.push(el);
            } else if (el.isLink || el.tag === 'nav' || el.role === 'navigation') {
                groups.navigation.push(el);
            } else if (el.isButton || el.role === 'button' || el.tag === 'button') {
                groups.actions.push(el);
            } else {
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
            output += this.formatElementList(groups.navigation.slice(0, 15)); // Limit nav items
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
     * Formats an individual element
     * Format: [ref] type "text" | relevant attributes
     */
    private formatElement(el: OptimizedElement): string {
        let line = `[${el.ref}] ${el.tag}`;

        // Add type if input
        if (el.type && el.type !== 'text') {
            line += `(${el.type})`;
        }

        // Add text or placeholder
        if (el.text && el.text.length > 0) {
            line += ` "${this.truncate(el.text, 50)}"`;
        } else if (el.placeholder) {
            line += ` ph="${this.truncate(el.placeholder, 30)}"`;
        } else if (el.ariaLabel) {
            line += ` aria="${this.truncate(el.ariaLabel, 30)}"`;
        }

        // Add current value if exists
        if (el.value && el.value.length > 0) {
            line += ` [val="${this.truncate(el.value, 20)}"]`;
        }

        // Add important states
        if (el.isDisabled) line += ' ⛔DISABLED';
        // if (el.isRequired) line += ' *REQ'; // Not present in OptimizedElement interface yet
        // if (el.isSelected) line += ' ✓SEL'; // Not present in OptimizedElement interface yet

        return line;
    }

    private truncate(text: string, max: number): string {
        if (text.length <= max) return text;
        return text.slice(0, max - 3) + '...';
    }
}
