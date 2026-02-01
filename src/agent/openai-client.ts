/**
 * OpenAI Client - Interfaces with OpenAI API for action planning
 */

import OpenAI from 'openai';
import type {
    PlannedAction,
    DoneResponse,
    OpenAIResponse,
    Credentials,
    PageSnapshot
} from '../core/types.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

export class OpenAIClient {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = 'gpt-4o') {
        this.client = new OpenAI({ apiKey });
        this.model = model;
    }

    /**
     * Plan the next action based on current page state and instruction
     */
    async planNextAction(params: {
        instruction: string;
        currentUrl: string;
        snapshot: PageSnapshot;
        previousActions: PlannedAction[];
        credentials?: Credentials;
        formData?: Record<string, string>;
    }): Promise<OpenAIResponse> {
        const userPrompt = buildUserPrompt(params);

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1, // Low temperature for consistent behavior
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from OpenAI');
            }

            const parsed = JSON.parse(content);

            // Check if done
            if (parsed.done === true) {
                return {
                    done: true,
                    summary: parsed.summary || 'Task completed',
                    data: parsed.data,
                } as DoneResponse;
            }

            // Extract action object
            // Handle { action: { ... } } vs { action: "click", ... }
            let actionData = parsed;
            if (parsed.action && typeof parsed.action === 'object' && !Array.isArray(parsed.action)) {
                actionData = parsed.action;
            }

            return {
                action: actionData.action,
                ref: actionData.ref,
                value: actionData.value,
                waitFor: actionData.waitFor,
                direction: actionData.direction,
                extractTarget: actionData.extractTarget,
                reason: actionData.reason || parsed.reason || 'No reason provided',
            } as PlannedAction;

        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Failed to parse OpenAI response: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Extract structured data from page content
     */
    async extractData(params: {
        instruction: string;
        pageContent: string;
        extractTarget: string;
    }): Promise<unknown> {
        const prompt = `
You are extracting data from a webpage.

User wants: ${params.instruction}
Extract this: ${params.extractTarget}

Page content:
${params.pageContent.slice(0, 10000)}

Return a JSON object with the extracted data. Be concise.
`;

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        try {
            return JSON.parse(content);
        } catch {
            return { raw: content };
        }
    }
}
