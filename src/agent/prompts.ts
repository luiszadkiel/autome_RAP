/**
 * Prompts for OpenAI Agent
 */

import type { Credentials, PlannedAction, PageSnapshot } from '../core/types.js';

export const SYSTEM_PROMPT = `You are a web automation agent. Respond with ONLY valid JSON.

CRITICAL RULES:
1. Use element refs (e1, e2...) from the snapshot to identify elements.
2. To click element e5, respond: {"action":"click","ref":"e5","reason":"..."}
3. To type in element e3, respond: {"action":"type","ref":"e3","value":"text","reason":"..."}
4. When task is COMPLETE, respond: {"done":true,"summary":"completed X successfully"}

IMPORTANT: Format for completion is {"done":true,"summary":"..."}  NOT {"action":"done"}

SPEED TIPS:
- Click elements by their REF (e.g. e5)
- For login: use {"action":"login"} if you see a login form - it's fastest
- Don't overthink - be decisive
- If unsure, try the most obvious element

AVAILABLE ACTIONS:
- click (ref)
- type (ref, value)
- login (use this for login forms!)
- navigate (value)
- wait (waitFor)
- scroll (direction)
- select (ref, value)
- extract (extractTarget)
- done (summary)

RESPONSE FORMAT:
{
  "action": "click",
  "ref": "e5",
  "reason": "clicking login button"
}
`;

export function buildUserPrompt(params: {
  instruction: string;
  currentUrl: string;
  snapshot: PageSnapshot;
  previousActions: PlannedAction[];
  credentials?: Credentials;
  formData?: Record<string, string>;
}): string {
  const parts: string[] = [];

  // Instruction
  parts.push(`USER INSTRUCTION: ${params.instruction}`);
  parts.push('');

  // Current page state
  parts.push(`CURRENT PAGE:`);
  parts.push(params.snapshot.textRepresentation);
  parts.push('');

  // Credentials if provided
  if (params.credentials) {
    parts.push('CREDENTIALS PROVIDED:');
    if (params.credentials.email) parts.push(`- Email: ${params.credentials.email}`);
    if (params.credentials.username) parts.push(`- Username: ${params.credentials.username}`);
    if (params.credentials.password) parts.push(`- Password: [PROVIDED - use when you see password field]`);
    parts.push('');
  }

  // Form data if provided
  if (params.formData && Object.keys(params.formData).length > 0) {
    parts.push('FORM DATA TO FILL:');
    for (const [key, value] of Object.entries(params.formData)) {
      parts.push(`- ${key}: ${value}`);
    }
    parts.push('');
  }

  // Previous actions
  if (params.previousActions.length > 0) {
    parts.push('PREVIOUS ACTIONS:');
    for (let i = 0; i < params.previousActions.length; i++) {
      const action = params.previousActions[i];
      parts.push(`${i + 1}. ${action.action}${action.ref ? ` [${action.ref}]` : ''}${action.value ? `: "${action.value}"` : ''}`);
    }
    parts.push('');
  }

  parts.push('What is your next action? Respond with JSON.');

  return parts.join('\n');
}
