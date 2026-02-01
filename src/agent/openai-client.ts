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
import { normalizeOpenAIResponse } from './response-normalizer.js';

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

        return this.executeCompletion(
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ]
        );
    }

    /**
     * Plan the next action using GPT-4 Vision
     */
    async planNextActionWithVision(params: {
        instruction: string;
        currentUrl: string;
        visionSnapshot: unknown; // Ideally VisionSnapshot but preventing circular dep if type not imported
        previousActions: PlannedAction[];
        credentials?: Credentials;
        formData?: Record<string, string>;
    }): Promise<OpenAIResponse> {
        // We cast to any to access the specific vision properties
        const snapshot = params.visionSnapshot as any;

        // Use optimized prompt for vision
        const visionSystemPrompt = `You are a web automation agent. Analyze the screenshot and user instruction.
Responde ONLY with valid JSON.

CRITICAL RULES:
1. Look at the screenshot - NO fake elements.
2. The red numbered badges overlay typical elements. Use their numbers for "ref".
3. To click element 5, respond: {"action":"click","ref":"5","reason":"..."}
4. For login: if you see login form + credentials provided -> {"action":"login"}
5. Be concise.

AVAILABLE ACTIONS:
- click (ref), type (ref, value), navigate (value), wait (waitFor), scroll (direction), select (ref, value), login, done
`;

        const userContent: any[] = [
            {
                type: "text",
                text: `Instruction: ${params.instruction}
Current URL: ${params.currentUrl}
Previous Actions: ${JSON.stringify(params.previousActions.map(a => `${a.action}(${a.ref || ''})`))}

Determine the next step. Respond with JSON.`
            },
            {
                type: "image_url",
                image_url: {
                    url: `data:image/jpeg;base64,${snapshot.screenshot}`,
                    detail: "high"
                }
            }
        ];

        return this.executeCompletion(
            [
                { role: 'system', content: visionSystemPrompt },
                { role: 'user', content: userContent },
            ]
        );
    }

    /**
     * Execute OpenAI completion
     */
    private async executeCompletion(messages: any[]): Promise<OpenAIResponse> {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                max_tokens: 1000,
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from OpenAI');
            }

            const parsed = JSON.parse(content);
            const normalized = normalizeOpenAIResponse(parsed);

            // Ref normalization for vision/consistency (if it's a PlannedAction)
            if ('action' in normalized) {
                let ref = normalized.ref;
                if (ref && /^\d+$/.test(ref)) {
                    normalized.ref = `e${ref}`;
                }
            }

            return normalized;

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
