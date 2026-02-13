/**
 * Decisiones locales sin LLM: cuando hay un solo botón obvio (Aceptar, Siguiente, etc.)
 * se ejecuta el click directamente para ganar velocidad en pasos simples.
 */

import type { OptimizedSnapshot, OptimizedElement } from '../browser/optimized-snapshot.js';
import type { BatchDecision, ActionDecision } from './optimized-openai-client.js';

/** Textos de botones SEGUROS que se consideran "obvios" para proceder sin consultar al LLM */
const SAFE_OBVIOUS_BUTTON_LABELS = new Set([
    'aceptar', 'accept', 'ok', 'sí', 'si', 'yes', 'siguiente', 'continue', 'continuar', 'next',
    'submit', 'enviar', 'confirmar', 'confirm', 'listo', 'done', 'vamos',
    "let's go", 'got it', 'entendido', 'perfecto', 'continuar', 'finalizar', 'finish',
    'omitir', 'skip', 'de acuerdo', 'agreed', 'comenzar', 'start', 'empezar', 'ir', 'go'
]);

/** Textos de botones PELIGROSOS que NO deben clickearse automáticamente (modales, cerrar, etc.) */
const DANGEROUS_BUTTON_LABELS = new Set([
    'cerrar', 'close', 'salir', 'exit', 'cancelar', 'cancel', 'eliminar', 'delete', 
    'borrar', 'remove', 'guardar', 'save', 'aplicar', 'apply'
]);

function normalizeLabel(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 50);
}

function isSafeObviousLabel(text: string, ariaLabel?: string): boolean {
    const t = normalizeLabel(text || '');
    const a = normalizeLabel(ariaLabel || '');
    
    // Primero verificar si es peligroso
    for (const dangerous of DANGEROUS_BUTTON_LABELS) {
        if (t === dangerous || a === dangerous || t.includes(dangerous) || a.includes(dangerous)) {
            return false; // No clickear automáticamente botones peligrosos
        }
    }
    
    // Luego verificar si es seguro
    if (SAFE_OBVIOUS_BUTTON_LABELS.has(t) || SAFE_OBVIOUS_BUTTON_LABELS.has(a)) return true;
    for (const label of SAFE_OBVIOUS_BUTTON_LABELS) {
        if (t.includes(label) || a.includes(label)) return true;
    }
    return false;
}

/**
 * Si en la página hay exactamente un solo elemento clickeable con texto "obvio" y SEGURO,
 * devuelve una decisión local (click en ese elemento). Si no, devuelve null y se usará el LLM.
 * 
 * REGLAS DE SEGURIDAD:
 * - NO clickear automáticamente botones peligrosos (cerrar, eliminar, guardar, etc.)
 * - NO clickear si hay modal visible (podría cerrar algo importante)
 * - Solo clickear si es claramente seguro y obvio
 */
export function tryObviousLocalDecision(snapshot: OptimizedSnapshot): BatchDecision | null {
    // NO hacer decisión local si hay modal visible (podría cerrar algo importante)
    if (snapshot.pageState?.hasModal) {
        return null;
    }
    
    const clickables = snapshot.elements.filter(
        (el: OptimizedElement) =>
            (el.isButton || el.role === 'button' || el.isLink) &&
            !el.isDisabled &&
            el.isVisible
    );

    // Solo proceder si hay exactamente UN botón clickeable
    if (clickables.length !== 1) return null;

    const single = clickables[0];
    const label = single.text || single.ariaLabel || '';
    
    // Verificar que sea seguro y obvio
    if (!isSafeObviousLabel(label, single.ariaLabel)) return null;
    
    // Verificar que no sea un botón de cierre de modal/overlay
    const labelLower = label.toLowerCase();
    if (labelLower.includes('cerrar') || labelLower.includes('close') || 
        labelLower.includes('cancelar') || labelLower.includes('cancel')) {
        return null; // No clickear botones de cerrar automáticamente
    }

    const decision: ActionDecision = {
        action: 'click',
        ref: single.ref,
        why: `Decisión local segura: único botón obvio "${(single.text || single.ariaLabel || '').trim().slice(0, 30)}"`
    };

    return {
        thinking: 'Un solo botón obvio y seguro detectado — ejecutando click sin LLM.',
        actions: [decision],
        extractedInfo: [],
        expectedResult: 'Avance al siguiente paso',
        confidence: 95,
        isComplete: false
    };
}
