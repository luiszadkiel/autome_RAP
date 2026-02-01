/**
 * Value Objects - Enums and types for domain
 */

// Step Action types
export enum StepAction {
    NAVIGATE = 'navigate',
    CLICK = 'click',
    TYPE = 'type',
    SELECT = 'select',
    WAIT = 'wait',
    SCROLL = 'scroll',
    SCREENSHOT = 'screenshot',
    EXTRACT = 'extract',
    DOWNLOAD = 'download',
}

export function isValidStepAction(action: string): action is StepAction {
    return Object.values(StepAction).includes(action as StepAction);
}
