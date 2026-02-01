/**
 * Flow Execution Service - Domain service for executing flows
 */

import { WebFlow } from '../entities/WebFlow.js';
import { FlowStep } from '../entities/FlowStep.js';
import { HtmlSnapshot } from '../entities/HtmlSnapshot.js';
import { FlowStatus } from '../value-objects/FlowStatus.js';
import { StepAction } from '../value-objects/StepAction.js';
import {
    domainEvents,
    FlowExecutedEvent,
    StepCompletedEvent,
    FlowFailedEvent
} from '../events/index.js';

export interface BrowserAdapter {
    goto(url: string): Promise<void>;
    click(selector: string): Promise<void>;
    type(selector: string, value: string): Promise<void>;
    select(selector: string, value: string): Promise<void>;
    wait(options: { text?: string; selector?: string; timeout?: number }): Promise<void>;
    scroll(direction: 'up' | 'down'): Promise<void>;
    screenshot(path: string): Promise<string>;
    getUrl(): string;
    getHtml(selector?: string): Promise<string>;
    findElement(selectors: string[]): Promise<string | null>;
}

export interface ExecutionContext {
    variables: Record<string, string>;
    screenshotsDir: string;
    onStepStart?: (step: FlowStep) => void;
    onStepComplete?: (step: FlowStep, success: boolean) => void;
}

export interface ExecutionResult {
    success: boolean;
    stepsExecuted: number;
    stepsTotal: number;
    failedStepIndex?: number;
    error?: string;
    duration: number;
    screenshots: string[];
}

export class FlowExecutionService {
    /**
     * Execute a flow with the given browser adapter
     */
    async execute(
        flow: WebFlow,
        browser: BrowserAdapter,
        context: ExecutionContext
    ): Promise<ExecutionResult> {
        const startTime = Date.now();
        const screenshots: string[] = [];
        let stepsExecuted = 0;

        try {
            // Navigate to start URL
            await browser.goto(flow.startUrl);

            // Execute each step
            for (const step of flow.steps) {
                const stepStartTime = Date.now();

                context.onStepStart?.(step);

                try {
                    // Replace variables in step
                    const resolvedStep = step.replaceVariables(context.variables);

                    // Execute step
                    await this.executeStep(resolvedStep, browser, context);

                    stepsExecuted++;

                    // Emit step completed event
                    domainEvents.emit(new StepCompletedEvent({
                        flowId: flow.id,
                        stepIndex: step.index,
                        action: step.action,
                        success: true,
                        duration: Date.now() - stepStartTime,
                    }));

                    context.onStepComplete?.(step, true);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    // Emit failure events
                    domainEvents.emit(new StepCompletedEvent({
                        flowId: flow.id,
                        stepIndex: step.index,
                        action: step.action,
                        success: false,
                        duration: Date.now() - stepStartTime,
                    }));

                    domainEvents.emit(new FlowFailedEvent({
                        flowId: flow.id,
                        flowName: flow.name,
                        failedStepIndex: step.index,
                        error: errorMessage,
                        recoverable: false,
                    }));

                    context.onStepComplete?.(step, false);

                    // Record execution
                    flow.recordExecution(false);

                    return {
                        success: false,
                        stepsExecuted,
                        stepsTotal: flow.stepCount,
                        failedStepIndex: step.index,
                        error: errorMessage,
                        duration: Date.now() - startTime,
                        screenshots,
                    };
                }
            }

            // Success!
            const duration = Date.now() - startTime;

            domainEvents.emit(new FlowExecutedEvent({
                flowId: flow.id,
                flowName: flow.name,
                success: true,
                stepCount: flow.stepCount,
                duration,
            }));

            flow.recordExecution(true);

            return {
                success: true,
                stepsExecuted,
                stepsTotal: flow.stepCount,
                duration,
                screenshots,
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            domainEvents.emit(new FlowExecutedEvent({
                flowId: flow.id,
                flowName: flow.name,
                success: false,
                stepCount: flow.stepCount,
                duration: Date.now() - startTime,
                error: errorMessage,
            }));

            flow.recordExecution(false);

            return {
                success: false,
                stepsExecuted,
                stepsTotal: flow.stepCount,
                error: errorMessage,
                duration: Date.now() - startTime,
                screenshots,
            };
        }
    }

    /**
     * Execute a single step
     */
    private async executeStep(
        step: FlowStep,
        browser: BrowserAdapter,
        context: ExecutionContext
    ): Promise<void> {
        switch (step.action) {
            case StepAction.NAVIGATE:
                if (!step.url) throw new Error('Navigate requires URL');
                await browser.goto(step.url);
                break;

            case StepAction.CLICK:
                const clickSelector = await this.resolveSelector(step, browser);
                await browser.click(clickSelector);
                break;

            case StepAction.TYPE:
                const typeSelector = await this.resolveSelector(step, browser);
                await browser.type(typeSelector, step.value || '');
                break;

            case StepAction.SELECT:
                const selectSelector = await this.resolveSelector(step, browser);
                await browser.select(selectSelector, step.value || '');
                break;

            case StepAction.WAIT:
                if (step.waitFor?.startsWith('text:')) {
                    await browser.wait({ text: step.waitFor.substring(5), timeout: step.timeout });
                } else if (step.waitFor) {
                    await browser.wait({ selector: step.waitFor, timeout: step.timeout });
                } else {
                    await browser.wait({ timeout: step.timeout || 2000 });
                }
                break;

            case StepAction.SCROLL:
                await browser.scroll((step.value as 'up' | 'down') || 'down');
                break;

            case StepAction.SCREENSHOT:
                const filename = `step_${step.index}_${Date.now()}.png`;
                const path = `${context.screenshotsDir}/${filename}`;
                await browser.screenshot(path);
                break;

            default:
                throw new Error(`Unknown action: ${step.action}`);
        }
    }

    /**
     * Resolve selector with fallbacks
     */
    private async resolveSelector(step: FlowStep, browser: BrowserAdapter): Promise<string> {
        if (!step.selector) {
            throw new Error(`Step ${step.index} requires a selector`);
        }

        // Try primary selector first
        const allSelectors = [step.selector, ...step.fallbackSelectors];
        const found = await browser.findElement(allSelectors);

        if (!found) {
            throw new Error(
                `Element not found. Tried selectors: ${allSelectors.join(', ')}`
            );
        }

        return found;
    }
}
