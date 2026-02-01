import type { OpenAIResponse, DoneResponse, PlannedAction } from '../core/types.js';

export function normalizeOpenAIResponse(parsed: any): OpenAIResponse {
    // Handle done response in multiple formats
    // format 1: { "done": true }
    // format 2: { "action": "done" }
    // format 3: { "action": { "action": "done" } }

    let isDone = parsed.done === true;

    if (!isDone && typeof parsed.action === 'string' && parsed.action === 'done') {
        isDone = true;
    }

    // Check nested action object
    if (!isDone && parsed.action && typeof parsed.action === 'object' && parsed.action.action === 'done') {
        isDone = true;
    }

    if (isDone) {
        return {
            done: true,
            summary: parsed.summary || parsed.reason || 'Task completed',
            data: parsed.data,
        } as DoneResponse;
    }

    // Handle action response
    let actionData = parsed;
    if (parsed.action && typeof parsed.action === 'object' && !Array.isArray(parsed.action)) {
        actionData = parsed.action;
    }

    return {
        action: actionData.action,
        ref: actionData.ref,
        value: actionData.value,
        waitFor: actionData.waitFor,
        direction: actionData.direction,
        extractTarget: actionData.extractTarget,
        reason: actionData.reason || parsed.reason || 'No reason provided',
    } as PlannedAction;
}
