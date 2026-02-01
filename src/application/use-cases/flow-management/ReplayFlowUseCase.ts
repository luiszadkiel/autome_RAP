/**
 * ReplayFlowUseCase - Reproduce un flujo con validación de snapshots
 */

import { WebFlow } from '../../../domain/entities/WebFlow.js';
import { HtmlSnapshot } from '../../../domain/entities/HtmlSnapshot.js';
import { IWebFlowRepository, ISnapshotRepository } from '../../../domain/repositories/index.js';
import { BrowserAdapter } from '../../../domain/services/FlowExecutionService.js';

export interface ReplayOptions {
    flowId?: string;
    flowName?: string;
    variables?: Record<string, string>;
    slowMo?: number;
    validateSnapshots?: boolean;
    stopOnMismatch?: boolean;
    screenshotsDir: string;
}

export interface SnapshotMismatch {
    stepIndex: number;
    expected: string;
    actual: string;
    suggestion: string;
}

export interface ReplayResult {
    success: boolean;
    flowId: string;
    flowName: string;
    stepsExecuted: number;
    stepsTotal: number;
    duration: number;
    mismatches: SnapshotMismatch[];
    error?: string;
}

export class ReplayFlowUseCase {
    constructor(
        private flowRepository: IWebFlowRepository,
        private snapshotRepository: ISnapshotRepository,
    ) { }

    /**
     * Replay a flow with optional snapshot validation
     */
    async replay(
        options: ReplayOptions,
        browser: BrowserAdapter
    ): Promise<ReplayResult> {
        const startTime = Date.now();
        const mismatches: SnapshotMismatch[] = [];
        let stepsExecuted = 0;

        // Find flow
        let flow: WebFlow | null = null;
        if (options.flowId) {
            flow = await this.flowRepository.findById(options.flowId);
        } else if (options.flowName) {
            flow = await this.flowRepository.findByName(options.flowName);
        }

        if (!flow) {
            throw new Error(`Flow not found: ${options.flowId || options.flowName}`);
        }

        // Load all snapshots for this flow
        const snapshots = await this.snapshotRepository.findByFlowId(flow.id);
        const snapshotMap = new Map(snapshots.map(s => [s.stepIndex, s]));

        try {
            // Navigate to start URL
            await browser.goto(flow.startUrl);
            await this.delay(options.slowMo || 500);

            // Execute each step
            for (const step of flow.steps) {
                console.log(`  ▶ Replaying step ${step.index + 1}: ${step.action}`);

                // Validate snapshot if enabled
                if (options.validateSnapshots && step.snapshotId) {
                    const snapshot = snapshotMap.get(step.index);
                    if (snapshot) {
                        const mismatch = await this.validateSnapshot(snapshot, browser);
                        if (mismatch) {
                            mismatches.push(mismatch);
                            console.log(`    ⚠ Snapshot mismatch: ${mismatch.suggestion}`);

                            if (options.stopOnMismatch) {
                                return {
                                    success: false,
                                    flowId: flow.id,
                                    flowName: flow.name,
                                    stepsExecuted,
                                    stepsTotal: flow.stepCount,
                                    duration: Date.now() - startTime,
                                    mismatches,
                                    error: `Snapshot mismatch at step ${step.index}`,
                                };
                            }
                        }
                    }
                }

                // Replace variables
                const resolvedStep = step.replaceVariables(options.variables || {});

                // Execute step
                await this.executeStep(resolvedStep, browser);
                stepsExecuted++;
                console.log(`    ✓`);

                // Delay between steps
                await this.delay(options.slowMo || 500);
            }

            // Record execution
            flow.recordExecution(true);
            await this.flowRepository.save(flow);

            return {
                success: true,
                flowId: flow.id,
                flowName: flow.name,
                stepsExecuted,
                stepsTotal: flow.stepCount,
                duration: Date.now() - startTime,
                mismatches,
            };

        } catch (error) {
            flow.recordExecution(false);
            await this.flowRepository.save(flow);

            return {
                success: false,
                flowId: flow.id,
                flowName: flow.name,
                stepsExecuted,
                stepsTotal: flow.stepCount,
                duration: Date.now() - startTime,
                mismatches,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Validate current page against snapshot
     */
    private async validateSnapshot(
        snapshot: HtmlSnapshot,
        browser: BrowserAdapter
    ): Promise<SnapshotMismatch | null> {
        // Check if we're on the right URL
        const currentUrl = browser.getUrl();
        if (currentUrl !== snapshot.url) {
            return {
                stepIndex: snapshot.stepIndex,
                expected: `URL: ${snapshot.url}`,
                actual: `URL: ${currentUrl}`,
                suggestion: 'Page URL has changed. Flow may need updating.',
            };
        }

        // Try to find element with selector
        const selectors = snapshot.getAllSelectors();
        const found = await browser.findElement(selectors);

        if (!found) {
            return {
                stepIndex: snapshot.stepIndex,
                expected: `Selector: ${snapshot.selectors.primary}`,
                actual: 'Element not found',
                suggestion: 'Element selector may have changed. Consider updating the flow.',
            };
        }

        return null;
    }

    /**
     * Execute a single step
     */
    private async executeStep(step: any, browser: BrowserAdapter): Promise<void> {
        switch (step.action) {
            case 'navigate':
                await browser.goto(step.url);
                break;
            case 'click':
                await browser.click(step.selector);
                break;
            case 'type':
                await browser.type(step.selector, step.value || '');
                break;
            case 'select':
                await browser.select(step.selector, step.value || '');
                break;
            case 'wait':
                if (step.waitFor?.startsWith('text:')) {
                    await browser.wait({ text: step.waitFor.substring(5) });
                } else if (step.waitFor) {
                    await browser.wait({ selector: step.waitFor });
                } else {
                    await browser.wait({ timeout: 2000 });
                }
                break;
            case 'scroll':
                await browser.scroll(step.value || 'down');
                break;
            default:
                break;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
