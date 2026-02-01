/**
 * RecordFlowUseCase - Graba un flujo interactivamente
 */

import { WebFlow } from '../../../domain/entities/WebFlow.js';
import { FlowStep } from '../../../domain/entities/FlowStep.js';
import { HtmlSnapshot } from '../../../domain/entities/HtmlSnapshot.js';
import { StepAction } from '../../../domain/value-objects/StepAction.js';
import { IWebFlowRepository, ISnapshotRepository } from '../../../domain/repositories/index.js';

export interface RecordStepInput {
    action: StepAction;
    selector?: string;
    value?: string;
    url?: string;
    waitFor?: string;
    description?: string;
}

export interface PageState {
    url: string;
    targetHtml?: string;
    contextHtml?: string;
    interactiveElements?: Array<{
        ref: string;
        role: string;
        name: string;
        selector: string;
    }>;
}

export class RecordFlowUseCase {
    private currentFlow: WebFlow | null = null;
    private stepIndex: number = 0;

    constructor(
        private flowRepository: IWebFlowRepository,
        private snapshotRepository: ISnapshotRepository,
    ) { }

    /**
     * Start recording a new flow
     */
    startRecording(params: {
        name: string;
        startUrl: string;
        description?: string;
    }): WebFlow {
        const id = `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this.currentFlow = WebFlow.create({
            id,
            name: params.name,
            startUrl: params.startUrl,
            description: params.description,
        });

        this.stepIndex = 0;
        return this.currentFlow;
    }

    /**
     * Record a step with page state
     */
    async recordStep(input: RecordStepInput, pageState: PageState): Promise<FlowStep> {
        if (!this.currentFlow) {
            throw new Error('No recording in progress. Call startRecording first.');
        }

        // Create step
        const step = FlowStep.create({
            index: this.stepIndex,
            action: input.action,
            selector: input.selector,
            value: input.value,
            url: input.url,
            waitFor: input.waitFor,
            description: input.description,
        });

        // Create snapshot
        const snapshot = HtmlSnapshot.create({
            flowId: this.currentFlow.id,
            stepIndex: this.stepIndex,
            url: pageState.url,
            targetHtml: pageState.targetHtml,
            contextHtml: pageState.contextHtml,
            primarySelector: input.selector || '',
            interactiveElements: pageState.interactiveElements,
        });

        // Link step to snapshot
        step.setSnapshotId(snapshot.id);

        // Save snapshot
        await this.snapshotRepository.save(snapshot);

        // Add step to flow
        this.currentFlow.addStep(step);
        this.stepIndex++;

        return step;
    }

    /**
     * Stop recording and save the flow
     */
    async stopRecording(): Promise<WebFlow> {
        if (!this.currentFlow) {
            throw new Error('No recording in progress');
        }

        // Mark flow as ready if it has steps
        if (this.currentFlow.stepCount > 0) {
            this.currentFlow.markAsReady();
        }

        // Save flow
        await this.flowRepository.save(this.currentFlow);

        const flow = this.currentFlow;
        this.currentFlow = null;
        this.stepIndex = 0;

        return flow;
    }

    /**
     * Cancel recording without saving
     */
    cancelRecording(): void {
        this.currentFlow = null;
        this.stepIndex = 0;
    }

    /**
     * Check if currently recording
     */
    isRecording(): boolean {
        return this.currentFlow !== null;
    }

    /**
     * Get current flow being recorded
     */
    getCurrentFlow(): WebFlow | null {
        return this.currentFlow;
    }
}
