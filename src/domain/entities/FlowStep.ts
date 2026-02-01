/**
 * FlowStep Entity - Representa un paso individual en un flujo
 */

import { StepAction } from '../value-objects/StepAction.js';

export interface FlowStepProps {
    id: string;
    index: number;
    action: StepAction;
    selector?: string;
    value?: string;
    url?: string;
    waitFor?: string;
    timeout?: number;
    snapshotId?: string;
    fallbackSelectors?: string[];
    description?: string;
}

export class FlowStep {
    private props: FlowStepProps;

    constructor(props: FlowStepProps) {
        this.props = props;
    }

    // Getters
    get id(): string { return this.props.id; }
    get index(): number { return this.props.index; }
    get action(): StepAction { return this.props.action; }
    get selector(): string | undefined { return this.props.selector; }
    get value(): string | undefined { return this.props.value; }
    get url(): string | undefined { return this.props.url; }
    get waitFor(): string | undefined { return this.props.waitFor; }
    get timeout(): number { return this.props.timeout || 10000; }
    get snapshotId(): string | undefined { return this.props.snapshotId; }
    get fallbackSelectors(): string[] { return this.props.fallbackSelectors || []; }
    get description(): string | undefined { return this.props.description; }

    /**
     * Create a new step
     */
    static create(params: Omit<FlowStepProps, 'id'> & { id?: string }): FlowStep {
        return new FlowStep({
            id: params.id || `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...params,
        });
    }

    /**
     * Check if this step uses variables ({{varName}})
     */
    hasVariables(): boolean {
        const value = this.props.value || '';
        return /\{\{[^}]+\}\}/.test(value);
    }

    /**
     * Extract variable names from step
     */
    extractVariables(): string[] {
        const value = this.props.value || '';
        const matches = value.match(/\{\{([^}]+)\}\}/g) || [];
        return matches.map(m => m.replace(/\{\{|\}\}/g, '').trim());
    }

    /**
     * Replace variables with actual values
     */
    replaceVariables(variables: Record<string, string>): FlowStep {
        let newValue = this.props.value;

        if (newValue) {
            for (const [key, val] of Object.entries(variables)) {
                newValue = newValue.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
            }
        }

        return new FlowStep({
            ...this.props,
            value: newValue,
        });
    }

    /**
     * Set snapshot ID
     */
    setSnapshotId(snapshotId: string): void {
        this.props.snapshotId = snapshotId;
    }

    /**
     * Update selector with fallbacks
     */
    updateSelectors(primary: string, fallbacks: string[]): void {
        this.props.selector = primary;
        this.props.fallbackSelectors = fallbacks;
    }

    /**
     * Convert to plain object
     */
    toJSON(): FlowStepProps {
        return { ...this.props };
    }

    /**
     * Reconstruct from plain object
     */
    static fromJSON(data: FlowStepProps): FlowStep {
        return new FlowStep(data);
    }
}
