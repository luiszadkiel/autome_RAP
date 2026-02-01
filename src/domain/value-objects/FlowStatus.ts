/**
 * FlowStatus - Estado de un flujo
 */

export enum FlowStatus {
    DRAFT = 'draft',
    READY = 'ready',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    PAUSED = 'paused',
}

export function isFlowStatus(status: string): status is FlowStatus {
    return Object.values(FlowStatus).includes(status as FlowStatus);
}
