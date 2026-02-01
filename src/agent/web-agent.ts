/**
 * Web Agent - Main agent that orchestrates browser automation with AI
 */

import type {
    AgentOptions,
    AgentInput,
    AgentResult,
    PlannedAction,
    StepResult,
    DoneResponse,
    Config,
} from '../core/types.js';
import { loadConfig, validateConfig } from '../core/config.js';
import { BrowserClient } from '../browser/browser-client.js';
import { OpenAIClient } from './openai-client.js';
import { ActionExecutor } from './action-executor.js';
import { FlowRecorder } from '../recorder/flow-recorder.js';

export class WebAgent {
    private config: Config;
    private openai: OpenAIClient;
    private browser: BrowserClient | null = null;
    private recorder: FlowRecorder | null = null;
    private options: AgentOptions;

    constructor(options: AgentOptions) {
        this.options = options;
        this.config = loadConfig();

        // Override config with provided options
        if (options.openaiApiKey) {
            this.config.openai.apiKey = options.openaiApiKey;
        }
        if (options.openaiModel) {
            this.config.openai.model = options.openaiModel;
        }
        if (options.headless !== undefined) {
            this.config.browser.headless = options.headless;
        }
        if (options.maxSteps !== undefined) {
            this.config.agent.maxSteps = options.maxSteps;
        }
        if (options.screenshotOnEachStep !== undefined) {
            this.config.agent.screenshotOnEachStep = options.screenshotOnEachStep;
        }

        validateConfig(this.config);

        this.openai = new OpenAIClient(
            this.config.openai.apiKey,
            this.config.openai.model
        );
    }

    /**
     * Run the agent with given input
     */
    async run(input: AgentInput): Promise<AgentResult> {
        const startTime = Date.now();
        const steps: StepResult[] = [];
        const previousActions: PlannedAction[] = [];
        const downloadedFiles: string[] = [];
        const screenshots: string[] = [];
        let extractedData: unknown = undefined;

        try {
            // Initialize browser
            this.browser = new BrowserClient(
                this.config.browser,
                this.config.paths.downloadsDir
            );
            await this.browser.launch();

            // Initialize recorder if needed
            const shouldRecord = this.options.recordFlow ?? this.config.agent.autoRecordFlows;
            if (shouldRecord) {
                this.recorder = new FlowRecorder(this.config.paths.flowsDir);
                this.recorder.startRecording({
                    name: input.flowName || `flow_${Date.now()}`,
                    startUrl: input.url,
                    instruction: input.instruction,
                });
            }

            // Initialize executor
            const executor = new ActionExecutor({
                browser: this.browser,
                recorder: this.recorder,
                openai: this.openai,
                credentials: input.credentials,
                screenshotsDir: this.config.paths.screenshotsDir,
                screenshotOnEachStep: this.config.agent.screenshotOnEachStep,
            });

            // Navigate to initial URL
            console.log(`🌐 Navigating to ${input.url}...`);
            await this.browser.goto(input.url);

            // Main loop
            let stepCount = 0;
            const maxSteps = this.config.agent.maxSteps;

            while (stepCount < maxSteps) {
                stepCount++;
                console.log(`\n📍 Step ${stepCount}/${maxSteps}`);

                // Take snapshot
                const snapshot = await this.browser.takeSnapshot();
                console.log(`   URL: ${snapshot.url}`);
                console.log(`   Elements: ${snapshot.elements.length}`);

                // Record snapshot
                if (this.recorder) {
                    this.recorder.recordSnapshot(snapshot);
                }

                // Ask AI for next action
                console.log(`   🤖 Thinking...`);
                const response = await this.openai.planNextAction({
                    instruction: input.instruction,
                    currentUrl: this.browser.getUrl(),
                    snapshot,
                    previousActions,
                    credentials: input.credentials,
                    formData: input.formData,
                });

                // Check if done
                if ('done' in response && response.done) {
                    const doneResponse = response as DoneResponse;
                    console.log(`\n✅ Task complete: ${doneResponse.summary}`);

                    if (doneResponse.data) {
                        extractedData = doneResponse.data;
                    }

                    // Stop recording
                    if (this.recorder) {
                        this.recorder.stopRecording(true, doneResponse.summary);
                    }

                    return {
                        success: true,
                        summary: doneResponse.summary,
                        steps,
                        data: extractedData,
                        downloadedFiles,
                        screenshots,
                        flowId: this.recorder?.getCurrentFlowId() || undefined,
                        duration: Date.now() - startTime,
                    };
                }

                // Execute action
                const action = response as PlannedAction;
                console.log(`   ▶️ Action: ${action.action}${action.ref ? ` [${action.ref}]` : ''}${action.value ? `: "${action.value}"` : ''}`);
                console.log(`   💭 Reason: ${action.reason}`);

                const result = await executor.execute(action, snapshot);
                steps.push(result);
                previousActions.push(action);

                if (result.screenshotPath) {
                    screenshots.push(result.screenshotPath);
                }

                if (!result.success) {
                    console.log(`   ❌ Failed: ${result.error}`);
                    console.log('   🛡️ Attempting to dismiss overlays...');
                    await this.browser?.dismissOverlays().catch(() => { });
                    // Continue anyway, AI might recover
                } else {
                    console.log(`   ✓ Success`);
                }

                // Handle special actions
                if (action.action === 'extract' && action.extractTarget) {
                    const content = await this.browser.getTextContent();
                    extractedData = await this.openai.extractData({
                        instruction: input.instruction,
                        pageContent: content,
                        extractTarget: action.extractTarget,
                    });
                }

                if (action.action === 'download') {
                    if (action.value) {
                        downloadedFiles.push(action.value);
                    }
                }

                // Small delay between steps
                await new Promise(r => setTimeout(r, 500));
            }

            // Max steps reached
            console.log(`\n⚠️ Max steps (${maxSteps}) reached`);

            if (this.recorder) {
                this.recorder.stopRecording(false, 'Max steps reached');
            }

            return {
                success: false,
                summary: `Reached maximum of ${maxSteps} steps without completing the task`,
                steps,
                data: extractedData,
                downloadedFiles,
                screenshots,
                flowId: this.recorder?.getCurrentFlowId() || undefined,
                duration: Date.now() - startTime,
                error: 'Max steps reached',
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`\n❌ Error: ${errorMessage}`);

            if (this.recorder) {
                this.recorder.stopRecording(false, errorMessage);
            }

            return {
                success: false,
                summary: `Failed with error: ${errorMessage}`,
                steps,
                data: extractedData,
                downloadedFiles,
                screenshots,
                flowId: this.recorder?.getCurrentFlowId() || undefined,
                duration: Date.now() - startTime,
                error: errorMessage,
            };

        } finally {
            // Cleanup
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        }
    }

    /**
     * Stop the agent
     */
    async stop(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
