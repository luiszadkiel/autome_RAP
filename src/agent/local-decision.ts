/**
 * Decisiones locales sin LLM: cuando hay un solo botón obvio (Aceptar, Siguiente, etc.)
 * se ejecuta el click directamente para ganar velocidad en pasos simples.
 */

import type { OptimizedSnapshot, OptimizedElement } from '../browser/optimized-snapshot.js';
import type { BatchDecision, ActionDecision } from './optimized-openai-client.js';

/** Textos de botones que se consideran "obvios" para proceder sin consultar al LLM */
const OBVIOUS_BUTTON_LABELS = new Set([
    'aceptar', 'accept', 'ok', 'sí', 'si', 'yes', 'siguiente', 'continue', 'continuar', 'next',
    'submit', 'enviar', 'confirmar', 'confirm', 'cerrar', 'close', 'listo', 'done', 'vamos',
    "let's go", 'got it', 'entendido', 'perfecto', 'continuar', 'finalizar', 'finish',
    'omitir', 'skip', 'salir', 'exit', 'guardar', 'save', 'aplicar', 'apply', 'listo',
    'de acuerdo', 'agreed', 'entendido', 'comenzar', 'start', 'empezar', 'ir', 'go'
]);

function normalizeLabel(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 50);
}

function isObviousLabel(text: string, ariaLabel?: string): boolean {
    const t = normalizeLabel(text || '');
    const a = normalizeLabel(ariaLabel || '');
    if (OBVIOUS_BUTTON_LABELS.has(t) || OBVIOUS_BUTTON_LABELS.has(a)) return true;
    for (const label of OBVIOUS_BUTTON_LABELS) {
        if (t.includes(label) || a.includes(label)) return true;
    }
    return false;
}

/**
 * Si en la página hay exactamente un solo elemento clickeable con texto "obvio",
 * devuelve una decisión local (click en ese elemento). Si no, devuelve null y se usará el LLM.
 */
export function tryObviousLocalDecision(snapshot: OptimizedSnapshot): BatchDecision | null {
    const clickables = snapshot.elements.filter(
        (el: OptimizedElement) =>
            (el.isButton || el.role === 'button' || el.isLink) &&
            !el.isDisabled &&
            el.isVisible
    );

    if (clickables.length !== 1) return null;

    const single = clickables[0];
    const label = single.text || single.ariaLabel || '';
    if (!isObviousLabel(label, single.ariaLabel)) return null;

    const decision: ActionDecision = {
        action: 'click',
        ref: single.ref,
        why: `Decisión local: único botón obvio "${(single.text || single.ariaLabel || '').trim().slice(0, 30)}"`
    };

    return {
        thinking: 'Un solo botón obvio detectado — ejecutando click sin LLM.',
        actions: [decision],
        extractedInfo: [],
        expectedResult: 'Avance al siguiente paso',
        confidence: 95,
        isComplete: false
    };
}
