/**
 * Flow Player - Replays recorded automation flows
 */

import type { RecordedFlow, FlowStep, StepResult } from '../core/types.js';
import type { BrowserClient } from '../browser/browser-client.js';
import { FlowRecorder } from './flow-recorder.js';

export interface PlayOptions {
    /** Run in headless mode */
    headless?: boolean;
    /** Delay between steps in ms */
    slowMo?: number;
    /** Stop on first error */
    stopOnError?: boolean;
    /** Try to find similar elements if original not found */
    adaptSelectors?: boolean;
}

export interface PlayResult {
    success: boolean;
    stepsExecuted: number;
    stepsTotal: number;
    results: StepResult[];
    error?: string;
}

export class FlowPlayer {
    private flowsDir: string;
    private recorder: FlowRecorder;

    constructor(flowsDir: string) {
        this.flowsDir = flowsDir;
        this.recorder = new FlowRecorder(flowsDir);
    }

    /**
     * Load a flow by ID
     */
    loadFlow(flowId: string): RecordedFlow | null {
        return this.recorder.loadFlow(flowId);
    }

    /**
     * Play a recorded flow
     */
    async playFlow(
        browser: BrowserClient,
        flow: RecordedFlow,
        options: PlayOptions = {}
    ): Promise<PlayResult> {
        const results: StepResult[] = [];
        const slowMo = options.slowMo || 500;
        const stopOnError = options.stopOnError ?? true;

        // Navigate to start URL
        await browser.goto(flow.startUrl);
        await this.delay(slowMo);

        for (const step of flow.steps) {
            const result = await this.playStep(browser, step, options);
            results.push(result);

            if (!result.success && stopOnError) {
                return {
                    success: false,
                    stepsExecuted: results.length,
                    stepsTotal: flow.steps.length,
                    results,
                    error: result.error,
                };
            }

            await this.delay(slowMo);
        }

        return {
            success: results.every(r => r.success),
            stepsExecuted: results.length,
            stepsTotal: flow.steps.length,
            results,
        };
    }

    /**
     * Play a single step
     */
    private async playStep(
        browser: BrowserClient,
        step: FlowStep,
        options: PlayOptions
    ): Promise<StepResult> {
        const timestamp = new Date().toISOString();

        try {
            const action = step.action;

            switch (action.action) {
                case 'click':
                    if (action.ref) {
                        await browser.click(action.ref);
                    }
                    break;

                case 'type':
                    if (action.ref && action.value) {
                        await browser.type(action.ref, action.value);
                    }
                    break;

                case 'navigate':
                    if (action.value) {
                        await browser.goto(action.value);
                    }
                    break;

                case 'wait':
                    if (action.waitFor === 'load') {
                        await browser.wait({ timeout: 5000 });
                    } else if (action.waitFor?.startsWith('text:')) {
                        await browser.wait({ text: action.waitFor.substring(5) });
                    } else {
                        await browser.wait({ timeout: 2000 });
                    }
                    break;

                case 'scroll':
                    await browser.scroll(action.direction || 'down');
                    break;

                case 'select':
                    if (action.ref && action.value) {
                        await browser.select(action.ref, action.value);
                    }
                    break;

                case 'screenshot':
                    // Skip screenshots during replay
                    break;

                default:
                    // Unknown action, skip
                    break;
            }

            return {
                stepNumber: step.stepId,
                action: step.action,
                success: true,
                timestamp,
            };

        } catch (err) {
            return {
                stepNumber: step.stepId,
                action: step.action,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                timestamp,
            };
        }
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * List available flows
     */
    listFlows() {
        return this.recorder.listFlows();
    }
}
