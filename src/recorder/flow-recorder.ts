/**
 * Flow Recorder - Records automation flows for replay
 */

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type {
    RecordedFlow,
    FlowStep,
    FlowSummary,
    PlannedAction,
    StepResult,
    PageSnapshot
} from '../core/types.js';

export class FlowRecorder {
    private flowsDir: string;
    private currentFlow: RecordedFlow | null = null;
    private snapshots: Map<string, PageSnapshot> = new Map();

    constructor(flowsDir: string) {
        this.flowsDir = flowsDir;
    }

    /**
     * Start recording a new flow
     */
    startRecording(params: {
        name: string;
        startUrl: string;
        instruction: string;
    }): string {
        const id = `flow_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        this.currentFlow = {
            id,
            name: params.name,
            createdAt: new Date().toISOString(),
            startUrl: params.startUrl,
            instruction: params.instruction,
            steps: [],
            snapshots: {},
            success: false,
        };

        return id;
    }

    /**
     * Record a step
     */
    async recordStep(stepResult: StepResult, currentUrl: string): Promise<void> {
        if (!this.currentFlow) return;

        const flowStep: FlowStep = {
            stepId: stepResult.stepNumber,
            action: stepResult.action,
            timestamp: stepResult.timestamp,
            url: currentUrl,
            success: stepResult.success,
            error: stepResult.error,
        };

        this.currentFlow.steps.push(flowStep);
    }

    /**
     * Record a snapshot
     */
    recordSnapshot(snapshot: PageSnapshot): string {
        const snapshotId = `snapshot_${Date.now()}`;
        this.snapshots.set(snapshotId, snapshot);

        if (this.currentFlow) {
            this.currentFlow.snapshots[snapshotId] = snapshot;
        }

        return snapshotId;
    }

    /**
     * Stop recording and save the flow
     */
    stopRecording(success: boolean, summary?: string): RecordedFlow | null {
        if (!this.currentFlow) return null;

        this.currentFlow.success = success;
        this.currentFlow.summary = summary;

        // Save to disk
        this.saveFlow(this.currentFlow);

        const flow = this.currentFlow;
        this.currentFlow = null;
        this.snapshots.clear();

        return flow;
    }

    /**
     * Save flow to disk
     */
    private saveFlow(flow: RecordedFlow): void {
        const filename = `${flow.id}.json`;
        const filepath = join(this.flowsDir, filename);
        writeFileSync(filepath, JSON.stringify(flow, null, 2));
    }

    /**
     * Load a flow from disk
     */
    loadFlow(flowId: string): RecordedFlow | null {
        const filepath = join(this.flowsDir, `${flowId}.json`);

        if (!existsSync(filepath)) {
            return null;
        }

        const content = readFileSync(filepath, 'utf-8');
        return JSON.parse(content) as RecordedFlow;
    }

    /**
     * List all saved flows
     */
    listFlows(): FlowSummary[] {
        if (!existsSync(this.flowsDir)) {
            return [];
        }

        const files = readdirSync(this.flowsDir).filter(f => f.endsWith('.json'));
        const summaries: FlowSummary[] = [];

        for (const file of files) {
            try {
                const filepath = join(this.flowsDir, file);
                const content = readFileSync(filepath, 'utf-8');
                const flow = JSON.parse(content) as RecordedFlow;

                summaries.push({
                    id: flow.id,
                    name: flow.name,
                    createdAt: flow.createdAt,
                    startUrl: flow.startUrl,
                    instruction: flow.instruction,
                    stepCount: flow.steps.length,
                    success: flow.success,
                });
            } catch {
                // Skip invalid files
            }
        }

        // Sort by creation date, newest first
        return summaries.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }

    /**
     * Delete a flow
     */
    deleteFlow(flowId: string): boolean {
        const filepath = join(this.flowsDir, `${flowId}.json`);

        if (!existsSync(filepath)) {
            return false;
        }

        const { unlinkSync } = require('fs');
        unlinkSync(filepath);
        return true;
    }

    /**
     * Check if currently recording
     */
    isRecording(): boolean {
        return this.currentFlow !== null;
    }

    /**
     * Get current flow ID
     */
    getCurrentFlowId(): string | null {
        return this.currentFlow?.id || null;
    }
}
