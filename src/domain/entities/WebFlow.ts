/**
 * WebFlow Entity - Representa un flujo de automatización web
 */

import { FlowStep, FlowStepProps } from './FlowStep.js';
import { FlowStatus } from '../value-objects/FlowStatus.js';

export interface WebFlowData {
    id: string;
    name: string;
    description?: string;
    steps: FlowStepProps[];
    variables: string[];
    status: FlowStatus;
    startUrl: string;
    createdAt: Date;
    updatedAt: Date;
    lastExecutedAt?: Date;
    executionCount: number;
    successCount: number;
}

export class WebFlow {
    private _id: string;
    private _name: string;
    private _description?: string;
    private _steps: FlowStep[];
    private _variables: string[];
    private _status: FlowStatus;
    private _startUrl: string;
    private _createdAt: Date;
    private _updatedAt: Date;
    private _lastExecutedAt?: Date;
    private _executionCount: number;
    private _successCount: number;

    constructor(data: WebFlowData) {
        this._id = data.id;
        this._name = data.name;
        this._description = data.description;
        this._steps = data.steps.map(s => FlowStep.fromJSON(s));
        this._variables = data.variables;
        this._status = data.status;
        this._startUrl = data.startUrl;
        this._createdAt = data.createdAt;
        this._updatedAt = data.updatedAt;
        this._lastExecutedAt = data.lastExecutedAt;
        this._executionCount = data.executionCount;
        this._successCount = data.successCount;
    }

    // Getters
    get id(): string { return this._id; }
    get name(): string { return this._name; }
    get description(): string | undefined { return this._description; }
    get steps(): FlowStep[] { return this._steps; }
    get variables(): string[] { return this._variables; }
    get status(): FlowStatus { return this._status; }
    get startUrl(): string { return this._startUrl; }
    get createdAt(): Date { return this._createdAt; }
    get updatedAt(): Date { return this._updatedAt; }
    get lastExecutedAt(): Date | undefined { return this._lastExecutedAt; }
    get executionCount(): number { return this._executionCount; }
    get successCount(): number { return this._successCount; }
    get stepCount(): number { return this._steps.length; }

    /**
     * Create a new WebFlow
     */
    static create(params: {
        id: string;
        name: string;
        startUrl: string;
        description?: string;
        variables?: string[];
    }): WebFlow {
        return new WebFlow({
            id: params.id,
            name: params.name,
            description: params.description,
            startUrl: params.startUrl,
            steps: [],
            variables: params.variables || [],
            status: FlowStatus.DRAFT,
            createdAt: new Date(),
            updatedAt: new Date(),
            executionCount: 0,
            successCount: 0,
        });
    }

    /**
     * Add a step to the flow
     */
    addStep(step: FlowStep): void {
        this._steps.push(step);
        this._updatedAt = new Date();

        // Extract variables from step
        const variables = step.extractVariables();
        for (const v of variables) {
            if (!this._variables.includes(v)) {
                this._variables.push(v);
            }
        }
    }

    /**
     * Mark flow as ready
     */
    markAsReady(): void {
        if (this._steps.length === 0) {
            throw new Error('Cannot mark empty flow as ready');
        }
        this._status = FlowStatus.READY;
        this._updatedAt = new Date();
    }

    /**
     * Record execution result
     */
    recordExecution(success: boolean): void {
        this._executionCount++;
        if (success) {
            this._successCount++;
        }
        this._lastExecutedAt = new Date();
        this._updatedAt = new Date();
    }

    /**
     * Get success rate
     */
    getSuccessRate(): number {
        if (this._executionCount === 0) return 0;
        return this._successCount / this._executionCount;
    }

    /**
     * Convert to plain object for serialization
     */
    toJSON(): WebFlowData {
        return {
            id: this._id,
            name: this._name,
            description: this._description,
            steps: this._steps.map(s => s.toJSON()),
            variables: this._variables,
            status: this._status,
            startUrl: this._startUrl,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt,
            lastExecutedAt: this._lastExecutedAt,
            executionCount: this._executionCount,
            successCount: this._successCount,
        };
    }

    /**
     * Reconstruct from plain object
     */
    static fromJSON(data: WebFlowData): WebFlow {
        return new WebFlow({
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
            lastExecutedAt: data.lastExecutedAt ? new Date(data.lastExecutedAt) : undefined,
        });
    }
}
