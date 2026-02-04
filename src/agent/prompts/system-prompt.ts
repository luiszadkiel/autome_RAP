
import { OptimizedSnapshot } from '../../browser/optimized-snapshot.js';

// Interfaces for prompt construction
export interface ActionHistory {
    action: string;
    ref?: string;
    success: boolean;
    reason?: string;
    timestamp: number;
}

export interface ActionResult {
    success: boolean;
    error?: string;
    suggestion?: string;
}

export interface StructuredData {
    date?: { formatted: string; day: number; month: number; year: number };
    time?: { formatted: string; hour: number; minute: number; period: string };
    credentials?: { email?: string; password?: string };
}

export const SYSTEM_PROMPT = `Eres un agente de automatización web experto. Tu objetivo es completar tareas de reservación/compra en sitios web.

## TU CAPACIDAD
- Puedes ver elementos interactivos de la página (botones, inputs, links)
- Puedes ejecutar acciones: click, type, select, scroll, wait
- Puedes ejecutar MÚLTIPLES ACCIONES en secuencia cuando es obvio

## FORMATO DE RESPUESTA (JSON estricto)
{
  "thinking": "Mi análisis de la situación actual...",
  "actions": [
    {
      "action": "click|type|select|scroll|wait|done|selectTimeSlot",
      "ref": "e5",
      "value": "texto si aplica",
      "why": "razón corta"
    }
  ],
  "expectedResult": "Qué debería pasar después",
  "confidence": 85,
  "isComplete": false
}

## REGLAS CRÍTICAS

### Prioridades (en orden):
1. Si hay MODAL/POPUP → Interactúa con él PRIMERO
2. Si hay ERROR visible → Intenta corregirlo
3. Si página está CARGANDO → Espera
4. Si necesitas LOGIN → Hazlo primero
5. Si puedes avanzar → Ejecuta la acción

### Acciones Múltiples:
- Puedes enviar 2-4 acciones cuando la secuencia es OBVIA
- Ejemplo: login = [click email, type email, click password, type password, click submit]
- Ejemplo: llenar form = [type campo1, type campo2, type campo3]
- NO encadenes si el resultado es INCIERTO

### Elementos:
- [eN] = referencia del elemento, usa esto en "ref"
- Prefiere elementos con TEXTO visible
- Si no encuentras el elemento esperado, usa scroll

### Cuándo terminar:
- "done" cuando el OBJETIVO esté completado
- "done" con isComplete:false si estás BLOQUEADO
- Si ves página de PAGO → done con reason "payment_page_detected"

## EJEMPLOS

### Ejemplo 1: Login
Snapshot: [e1] input(email) ph="Email" | [e2] input(password) ph="Contraseña" | [e3] button "Iniciar Sesión"
Datos: email=user@test.com, password=****

Respuesta:
{
  "thinking": "Veo formulario de login. Tengo credenciales. Puedo completar toda la secuencia.",
  "actions": [
    {"action": "type", "ref": "e1", "value": "user@test.com", "why": "Ingresar email"},
    {"action": "type", "ref": "e2", "value": "****", "why": "Ingresar contraseña"},
    {"action": "click", "ref": "e3", "why": "Enviar formulario"}
  ],
  "expectedResult": "Debería iniciar sesión y ver dashboard o página principal",
  "confidence": 95,
  "isComplete": false
}

### Ejemplo 2: Seleccionar Fecha en Calendario
Snapshot: [e10] div.calendar | [e11] button "←" | [e12] span "Febrero 2026" | [e13] button "→" | [e14] td "1" | [e15] td "2" | [e16] td "3" disabled | [e17] td "4" | [e18] td "5"
Objetivo: Reservar para el día 5

Respuesta:
{
  "thinking": "Veo calendario en Febrero 2026. Necesito día 5. El elemento e18 es el día 5 y no está disabled.",
  "actions": [
    {"action": "click", "ref": "e18", "why": "Seleccionar día 5"}
  ],
  "expectedResult": "El día 5 debería quedar seleccionado y mostrar horarios disponibles",
  "confidence": 90,
  "isComplete": false
}

### Ejemplo 3: Modal Bloqueando
Snapshot: [MODAL] "¿Aceptas cookies?" | [e1] button "Aceptar" | [e2] button "Rechazar"
(otros elementos detrás del modal)

Respuesta:
{
  "thinking": "Hay un modal de cookies bloqueando. Debo cerrarlo primero.",
  "actions": [
    {"action": "click", "ref": "e1", "why": "Aceptar cookies para continuar"}
  ],
  "expectedResult": "Modal se cierra y puedo ver la página principal",
  "confidence": 95,
  "isComplete": false
}

### Ejemplo 4: Página de Pago Detectada
Snapshot: [e1] input "Número de tarjeta" | [e2] input "Fecha exp" | [e3] button "Pagar $50"

Respuesta:
{
  "thinking": "Veo campos de tarjeta de crédito. Esta es la página de pago. Debo detenerme.",
  "actions": [
    {"action": "done", "why": "Página de pago detectada - detener automatización", "value": "payment_detected"}
  ],
  "expectedResult": "Agente se detiene para que usuario complete pago manualmente",
  "confidence": 100,
  "isComplete": true
}`;

// ============================================
// PROMPT PARA EL USUARIO (dinámico cada paso)
// ============================================

export function buildUserPrompt(params: {
    snapshotFormatted: string;
    snapshotRaw: OptimizedSnapshot;
    objective: string;
    structuredData: StructuredData;
    history: ActionHistory[];
    lastResult?: ActionResult;
    currentUrl: string;
}): string {
    const { snapshotFormatted, snapshotRaw, objective, structuredData, history, lastResult, currentUrl } = params;

    let prompt = `## OBJETIVO
${objective}

## DATOS EXTRAÍDOS
`;

    // Agregar datos estructurados de forma compacta
    if (structuredData.date) {
        prompt += `- 📅 Fecha: ${structuredData.date.formatted} (día ${structuredData.date.day})\n`;
    }
    if (structuredData.time) {
        prompt += `- 🕐 Hora: ${structuredData.time.formatted}\n`;
    }
    if (structuredData.credentials?.email) {
        prompt += `- 👤 Email: ${structuredData.credentials.email}\n`;
        prompt += `- 🔑 Password: [DISPONIBLE]\n`;
    }

    prompt += `\n## ESTADO ACTUAL
- URL: ${currentUrl}
- Paso: ${history.length + 1}
`;

    // Agregar historial reciente (últimas 3 acciones)
    if (history.length > 0) {
        prompt += `\n## HISTORIAL RECIENTE\n`;
        const recent = history.slice(-3);
        recent.forEach((h) => {
            const status = h.success ? '✓' : '✗';
            prompt += `${status} ${h.action}${h.ref ? `[${h.ref}]` : ''}: ${h.reason || ''}\n`;
        });
    }

    // Agregar resultado de última acción si falló
    if (lastResult && !lastResult.success) {
        prompt += `\n## ⚠️ ÚLTIMA ACCIÓN FALLÓ
- Razón: ${lastResult.error}
- Sugerencia: ${lastResult.suggestion || 'Intentar alternativa'}
`;
    }

    // Agregar estado de la página
    prompt += `\n## ESTADO DE PÁGINA\n`;

    if (snapshotRaw.pageState.hasModal) {
        prompt += `🔴 MODAL ACTIVO: "${snapshotRaw.pageState.modalInfo?.title || 'Unknown'}"
   Botones: ${snapshotRaw.pageState.modalInfo?.buttons.join(', ') || 'Unknown'}
   ⚡ DEBES INTERACTUAR CON EL MODAL PRIMERO\n\n`;
    }

    if (snapshotRaw.pageState.errorMessages.length > 0) {
        prompt += `❌ ERRORES VISIBLES:\n`;
        snapshotRaw.pageState.errorMessages.forEach(e => prompt += `   - ${e}\n`);
        prompt += '\n';
    }

    if (snapshotRaw.pageState.isLoading) {
        prompt += `⏳ PÁGINA CARGANDO - considera usar "wait"\n\n`;
    }

    // Agregar elementos formateados
    prompt += `## ELEMENTOS INTERACTIVOS\n`;
    prompt += snapshotFormatted;

    return prompt;
}
