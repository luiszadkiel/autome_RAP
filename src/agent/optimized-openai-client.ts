import OpenAI from 'openai';
import { OptimizedSnapshot, OptimizedElement } from '../browser/optimized-snapshot.js';
import { FormattedSnapshot, SnapshotFormatter } from '../browser/snapshot-formatter.js';
import { SYSTEM_PROMPT, buildUserPrompt, StructuredData, ActionHistory, ActionResult } from './prompts/system-prompt.js';
import { getTaskPrompt } from './prompts/task-prompts.js';

export interface ActionDecision {
    action: string;
    ref?: string;
    value?: string;
    why?: string;
}

export interface ExtractedInfoItem {
    type: string;
    content: string;
}

export interface BatchDecision {
    thinking: string;
    actions: ActionDecision[];
    extractedInfo: ExtractedInfoItem[];
    expectedResult: string;
    confidence: number;
    isComplete: boolean;
    reason?: string;
}

export class OptimizedOpenAIClient {
    private client: OpenAI;
    private conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    private formatter: SnapshotFormatter;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
        this.formatter = new SnapshotFormatter();
    }

    async planActions(
        snapshot: OptimizedSnapshot,
        objective: string,
        structuredData: StructuredData,
        history: ActionHistory[],
        lastResult?: ActionResult
    ): Promise<BatchDecision> {

        // 0. Formatear snapshot para LLM
        const formatted = this.formatter.format(snapshot);

        // 1. Construir prompts
        const systemPrompt = SYSTEM_PROMPT + '\n\n' + getTaskPrompt(objective);

        const userPrompt = buildUserPrompt({
            snapshotFormatted: formatted.formattedElements,
            snapshotRaw: snapshot,
            objective,
            structuredData,
            history,
            lastResult,
            currentUrl: snapshot.url
        });

        // 2. Llamar a OpenAI
        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4-turbo-preview', // Capaz de JSON mode complejo
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...this.conversationHistory.slice(-4), // Mantener contexto breve
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1, // Determinístico
                max_tokens: 600,  // Suficiente para múltiples acciones
                top_p: 0.95
            });

            const content = response.choices[0].message.content || '{}';

            // 3. Guardar historial
            this.conversationHistory.push(
                { role: 'user', content: userPrompt },
                { role: 'assistant', content: content }
            );

            // Mantener historial manejable
            if (this.conversationHistory.length > 10) {
                this.conversationHistory = this.conversationHistory.slice(-6);
            }

            // 4. Parsear respuesta
            return this.parseResponse(content, snapshot.elements);

        } catch (error) {
            console.error('❌ Error en OpenAI:', error);
            // Fallback en caso de error de API
            return {
                thinking: 'Error de API, esperando recuperación',
                actions: [{ action: 'wait', value: '5000', why: 'Error de API' }],
                extractedInfo: [],
                expectedResult: 'Recuperación del servicio',
                confidence: 0,
                isComplete: false
            };
        }
    }

    private parseResponse(content: string, elements: OptimizedElement[]): BatchDecision {
        try {
            const parsed = JSON.parse(content);

            // Validar estructura básica
            const decision: BatchDecision = {
                thinking: parsed.thinking || 'Sin análisis',
                actions: Array.isArray(parsed.actions) ? parsed.actions : [],
                extractedInfo: Array.isArray(parsed.extractedInfo) ? parsed.extractedInfo : [],
                expectedResult: parsed.expectedResult || 'Sin resultado esperado',
                confidence: parsed.confidence || 50,
                isComplete: !!parsed.isComplete,
                reason: parsed.reason
            };

            // Validar referencias en acciones
            decision.actions = decision.actions.map(action => {
                // Si la acción tiene referencia, verificar que exista
                if (action.ref && !elements.find(e => e.ref === action.ref)) {
                    console.warn(`⚠️ Elemento ${action.ref} no encontrado. Buscando similar...`);
                    // Podríamos implementar búsqueda difusa aquí si fuera necesario
                    // Por ahora, si no existe, mantenemos la ref pero bajamos confianza
                    // o cambiamos a wait si es crítico
                }
                return {
                    action: action.action || 'wait',
                    ref: action.ref,
                    value: action.value,
                    why: action.why || 'Acción automatizada'
                };
            });

            if (decision.actions.length === 0) {
                decision.actions.push({ action: 'wait', why: 'No se generaron acciones válidas' });
            }

            return decision;

        } catch (error) {
            console.error('❌ Error parseando JSON de OpenAI:', content);
            return {
                thinking: 'Error de parsing',
                actions: [{ action: 'wait', why: 'Error de formato JSON' }],
                extractedInfo: [],
                expectedResult: 'Reintento',
                confidence: 0,
                isComplete: false
            };
        }
    }
}
