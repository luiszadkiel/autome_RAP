/**
 * Action Executor - Executes planned actions on the browser
 */

import type { PlannedAction, StepResult, Credentials, PageSnapshot } from '../core/types.js';
import type { BrowserClient } from '../browser/browser-client.js';
import type { FlowRecorder } from '../recorder/flow-recorder.js';
import type { OpenAIClient } from './openai-client.js';

export class ActionExecutor {
    private browser: BrowserClient;
    private recorder: FlowRecorder | null;
    private openai: OpenAIClient;
    private credentials?: Credentials;
    private screenshotsDir: string;
    private stepNumber: number = 0;
    private screenshotOnEachStep: boolean;

    constructor(params: {
        browser: BrowserClient;
        recorder: FlowRecorder | null;
        openai: OpenAIClient;
        credentials?: Credentials;
        screenshotsDir: string;
        screenshotOnEachStep: boolean;
    }) {
        this.browser = params.browser;
        this.recorder = params.recorder;
        this.openai = params.openai;
        this.credentials = params.credentials;
        this.screenshotsDir = params.screenshotsDir;
        this.screenshotOnEachStep = params.screenshotOnEachStep;
    }

    /**
     * Execute a planned action
     */
    async execute(action: PlannedAction, snapshot?: PageSnapshot): Promise<StepResult> {
        this.stepNumber++;
        const timestamp = new Date().toISOString();
        let success = true;
        let error: string | undefined;
        let screenshotPath: string | undefined;

        // Find element in snapshot if available
        const element = snapshot && action.ref
            ? snapshot.elements.find(e => e.ref === action.ref)
            : undefined;

        try {
            switch (action.action) {
                case 'click':
                    if (!action.ref) throw new Error('click requires ref');
                    await this.browser.click(action.ref, element);
                    // Wait for potential navigation
                    await this.browser.wait({ timeout: 2000 }).catch(() => { });
                    break;

                case 'type':
                    if (!action.ref) throw new Error('type requires ref');
                    if (!action.value) throw new Error('type requires value');
                    // Handle credential substitution
                    let valueToType = action.value;
                    if (this.credentials) {
                        if (action.value === '[PASSWORD]' || action.value.toLowerCase().includes('password')) {
                            valueToType = this.credentials.password || action.value;
                        } else if (action.value === '[EMAIL]' || action.value === '[USERNAME]') {
                            valueToType = this.credentials.email || this.credentials.username || action.value;
                        }
                    }
                    await this.browser.type(action.ref, valueToType, element);
                    break;

                case 'navigate':
                    if (!action.value) throw new Error('navigate requires value (url)');
                    await this.browser.goto(action.value);
                    break;

                case 'wait':
                    if (action.waitFor === 'load') {
                        await this.browser.wait({ timeout: 5000 });
                    } else if (action.waitFor?.includes('|') || action.waitFor?.startsWith('text:') || action.waitFor?.startsWith('selector:')) {
                        // Support multiple options separated by pipe |, can be mixed "text:Foo|selector:.bar"
                        const options = action.waitFor.split('|');

                        let found = false;
                        const start = Date.now();
                        const payout = 15000; // 15s max total wait

                        while (Date.now() - start < payout) {
                            for (const option of options) {
                                const opt = option.trim();

                                if (opt.startsWith('text:')) {
                                    const text = opt.substring(5);
                                    const content = await this.browser.getTextContent();
                                    if (content.includes(text)) {
                                        found = true;
                                        break;
                                    }
                                } else if (opt.startsWith('selector:')) {
                                    const selector = opt.substring(9);
                                    const visible = await this.browser.isElementVisible(selector);
                                    if (visible) {
                                        found = true;
                                        break;
                                    }
                                } else {
                                    // Fallback: treat as text if no prefix, or implement simple text check
                                    const content = await this.browser.getTextContent();
                                    if (content.includes(opt)) {
                                        found = true;
                                        break;
                                    }
                                }
                            }

                            if (found) break;
                            await new Promise(r => setTimeout(r, 500));
                        }

                        if (!found) {
                            throw new Error(`Timeout waiting for any of: ${options.join(', ')}`);
                        }
                    } else if (action.waitFor) {
                        // Support simple selector
                        await this.browser.wait({ selector: action.waitFor, timeout: 10000 });
                    } else {
                        await this.browser.wait({ timeout: 2000 });
                    }
                    break;

                case 'scroll':
                    await this.browser.scroll(action.direction || 'down');
                    break;

                case 'select':
                    if (!action.ref) throw new Error('select requires ref');
                    if (!action.value) throw new Error('select requires value');
                    await this.browser.select(action.ref, action.value, element);
                    break;

                case 'screenshot':
                    const filename = `step_${this.stepNumber}_${Date.now()}.png`;
                    screenshotPath = `${this.screenshotsDir}/${filename}`;
                    await this.browser.screenshot(screenshotPath);
                    break;

                case 'extract':
                    // Extract is handled by the agent, not executor
                    break;

                case 'download':
                    // Wait for download to complete
                    const downloadPath = await this.browser.waitForDownload();
                    action.value = downloadPath;
                    break;

                case 'goBack':
                    // Navigate back in history
                    await this.browser.goBack();
                    break;

                case 'goForward':
                    // Navigate forward in history
                    await this.browser.goForward();
                    break;

                case 'closeTab':
                    // Close current tab and switch to main
                    await this.browser.closeCurrentTab();
                    break;

                case 'login':
                    // Quick login: fill form and click submit
                    const filled = await this.browser.fillLoginForm(
                        this.credentials?.email,
                        this.credentials?.username,
                        this.credentials?.password
                    );

                    // Also try to dismiss overlays for good measure
                    await this.browser.dismissOverlays().catch(() => { });

                    if (filled) {
                        await this.browser.clickLoginButton();
                        // Wait for navigation after login
                        await this.browser.wait({ timeout: 3000 }).catch(() => { });
                    }
                    break;

                default:
                    throw new Error(`Unknown action: ${action.action}`);
            }

            // Take screenshot if enabled
            if (this.screenshotOnEachStep && action.action !== 'screenshot') {
                const filename = `step_${this.stepNumber}_${Date.now()}.png`;
                screenshotPath = `${this.screenshotsDir}/${filename}`;
                await this.browser.screenshot(screenshotPath).catch(() => { });
            }

        } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
        }

        const result: StepResult = {
            stepNumber: this.stepNumber,
            action,
            success,
            error,
            timestamp,
            screenshotPath,
        };

        // Record step if recorder is active
        if (this.recorder) {
            await this.recorder.recordStep(result, this.browser.getUrl());
        }

        return result;
    }

    /**
     * Get current step number
     */
    getStepNumber(): number {
        return this.stepNumber;
    }
}
