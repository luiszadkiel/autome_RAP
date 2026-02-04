
export const TASK_PROMPTS = {

    booking: `## CONTEXTO: RESERVACIÓN
  Estás haciendo una reservación. Pasos típicos:
  1. Login (si hay credenciales)
  2. Seleccionar FECHA en calendario
  3. Seleccionar HORA/horario disponible
  4. Confirmar datos
  5. DETENERSE en página de pago
  
  ### Tips para calendarios:
  - Busca elementos con el número del día
  - Los días "disabled" o "unavailable" no son clickeables
  - Si el mes no es correcto, usa botones ← →
  
  ### Tips para horarios:
  - Busca slots con la hora deseada
  - Formato puede ser "6:20 AM" o "06:20" o "6:20am"
  - Si no hay hora exacta, busca la más cercana
  `,

    ecommerce: `## CONTEXTO: COMPRA
  Estás comprando un producto. Pasos típicos:
  1. Buscar producto
  2. Seleccionar variantes (talla, color, etc)
  3. Agregar al carrito
  4. Ir a checkout
  5. DETENERSE en página de pago
  `,

    formFilling: `## CONTEXTO: FORMULARIO
  Estás llenando un formulario. Tips:
  - Llena campos EN ORDEN (arriba → abajo)
  - Respeta campos requeridos (*REQ)
  - Si hay validación, espera a que se complete
  - Dropdowns: primero click, luego selecciona opción
  `,

    search: `## CONTEXTO: BÚSQUEDA
  Estás buscando información. Tips:
  - Usa el campo de búsqueda principal
  - Aplica filtros si es necesario
  - Extrae datos cuando los encuentres
  `
};

export function getTaskPrompt(objective: string): string {
    const objectiveLower = objective.toLowerCase();

    if (/reserv|book|appointment|cita|horario/i.test(objectiveLower)) {
        return TASK_PROMPTS.booking;
    }

    if (/compr|buy|cart|carrito|producto/i.test(objectiveLower)) {
        return TASK_PROMPTS.ecommerce;
    }

    if (/formulario|form|registro|signup/i.test(objectiveLower)) {
        return TASK_PROMPTS.formFilling;
    }

    if (/busca|search|encuentra|find/i.test(objectiveLower)) {
        return TASK_PROMPTS.search;
    }

    return ''; // Sin contexto específico
}
