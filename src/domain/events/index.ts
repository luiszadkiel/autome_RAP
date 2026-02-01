/**
 * Domain Events - Events emitted during flow execution
 */

export interface DomainEvent {
    type: string;
    timestamp: Date;
    payload: unknown;
}

export class FlowExecutedEvent implements DomainEvent {
    readonly type = 'FlowExecuted';
    readonly timestamp: Date;
    readonly payload: {
        flowId: string;
        flowName: string;
        success: boolean;
        stepCount: number;
        duration: number;
        error?: string;
    };

    constructor(params: FlowExecutedEvent['payload']) {
        this.timestamp = new Date();
        this.payload = params;
    }
}

export class StepCompletedEvent implements DomainEvent {
    readonly type = 'StepCompleted';
    readonly timestamp: Date;
    readonly payload: {
        flowId: string;
        stepIndex: number;
        action: string;
        success: boolean;
        duration: number;
        snapshotId?: string;
    };

    constructor(params: StepCompletedEvent['payload']) {
        this.timestamp = new Date();
        this.payload = params;
    }
}

export class FlowFailedEvent implements DomainEvent {
    readonly type = 'FlowFailed';
    readonly timestamp: Date;
    readonly payload: {
        flowId: string;
        flowName: string;
        failedStepIndex: number;
        error: string;
        recoverable: boolean;
    };

    constructor(params: FlowFailedEvent['payload']) {
        this.timestamp = new Date();
        this.payload = params;
    }
}

/**
 * Event Emitter for domain events
 */
export type EventHandler = (event: DomainEvent) => void;

export class EventEmitter {
    private handlers: Map<string, EventHandler[]> = new Map();

    on(eventType: string, handler: EventHandler): void {
        const existing = this.handlers.get(eventType) || [];
        existing.push(handler);
        this.handlers.set(eventType, existing);
    }

    off(eventType: string, handler: EventHandler): void {
        const existing = this.handlers.get(eventType) || [];
        const filtered = existing.filter(h => h !== handler);
        this.handlers.set(eventType, filtered);
    }

    emit(event: DomainEvent): void {
        const handlers = this.handlers.get(event.type) || [];
        for (const handler of handlers) {
            try {
                handler(event);
            } catch (error) {
                console.error(`Error in event handler for ${event.type}:`, error);
            }
        }
    }
}

// Global event emitter
export const domainEvents = new EventEmitter();
