/**
 * Core Types for Web Automation Agent
 */

// ============================================
// Agent Types
// ============================================

export interface AgentOptions {
    /** OpenAI API key */
    openaiApiKey: string;
    /** OpenAI model to use (default: gpt-4o) */
    openaiModel?: string;
    /** Run browser in headless mode (default: true) */
    headless?: boolean;
    /** Take screenshot on each step */
    screenshotOnEachStep?: boolean;
    /** Record the flow for replay */
    recordFlow?: boolean;
    /** Maximum steps before stopping (default: 20) */
    maxSteps?: number;
    /** Timeout in milliseconds (default: 60000) */
    timeout?: number;
    /** Data directory for storing files */
    dataDir?: string;
    /** Enable Vision API (GPT-4 Vision) */
    enableVision?: boolean;
    /** Enable fallback to text-only mode if Vision fails (default: true) */
    visionFallbackEnabled?: boolean;
}

export interface AgentInput {
    /** URL to navigate to */
    url: string;
    /** What to do (natural language) */
    instruction: string;
    /** Optional credentials for login */
    credentials?: Credentials;
    /** Optional form data to fill */
    formData?: Record<string, string>;
    /** Name for the recorded flow */
    flowName?: string;
}

export interface Credentials {
    username?: string;
    email?: string;
    password?: string;
}

export interface AgentResult {
    /** Whether the task completed successfully */
    success: boolean;
    /** Summary of what was done */
    summary: string;
    /** Each step that was executed */
    steps: StepResult[];
    /** Extracted data (if any) */
    data?: unknown;
    /** Files that were downloaded */
    downloadedFiles?: string[];
    /** Screenshots taken */
    screenshots?: string[];
    /** ID of the recorded flow */
    flowId?: string;
    /** Error message if failed */
    error?: string;
    /** Total time taken in ms */
    duration?: number;
    /** Detailed execution summary */
    executionSummary?: {
        /** Total number of actions performed */
        totalActions: number;
        /** Final URL after execution */
        finalUrl: string;
        /** List of pages visited */
        pagesVisited: string[];
        /** Detailed list of actions performed */
        actionsPerformed: {
            action: string;
            detail: string;
            reason: string;
        }[];
        /** Human-readable summary text */
        actionsSummaryText: string;
    };
}

export interface StepResult {
    stepNumber: number;
    action: PlannedAction;
    success: boolean;
    error?: string;
    timestamp: string;
    screenshotPath?: string;
}

// ============================================
// Action Types
// ============================================

export type ActionType =
    | 'click'
    | 'type'
    | 'navigate'
    | 'wait'
    | 'scroll'
    | 'select'
    | 'download'
    | 'extract'
    | 'screenshot'
    | 'goBack'
    | 'goForward'
    | 'closeTab'
    | 'login'
    | 'done';

export interface PlannedAction {
    action: ActionType;
    /** Element reference (e1, e2, etc.) for click, type, select */
    ref?: string;
    /** Value for type, navigate, select */
    value?: string;
    /** What to wait for */
    waitFor?: string;
    /** Scroll direction */
    direction?: 'up' | 'down';
    /** What to extract */
    extractTarget?: string;
    /** Reasoning for this action */
    reason: string;
}

export interface DoneResponse {
    done: true;
    summary: string;
    data?: unknown;
}

export type OpenAIResponse = PlannedAction | DoneResponse;

// ============================================
// Snapshot Types
// ============================================

export interface SnapshotElement {
    /** Short reference like e1, e2, e3 */
    ref: string;
    /** ARIA role: button, textbox, link, etc. */
    role: string;
    /** Visible text or aria-label */
    name: string;
    /** CSS selector to find this element */
    selector: string;
    /** XPath as alternative */
    xpath?: string;
    /** Important attributes */
    attributes: Record<string, string>;
    /** Position on page */
    position?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Whether element is interactive */
    isInteractive: boolean;
}

export interface PageSnapshot {
    /** Current URL */
    url: string;
    /** Page title */
    title: string;
    /** When snapshot was taken */
    timestamp: string;
    /** All elements found */
    elements: SnapshotElement[];
    /** Simplified HTML structure */
    htmlStructure?: string;
    /** Full HTML (optional) */
    fullHtml?: string;
    /** Text representation for AI */
    textRepresentation: string;
    /** Hash of the DOM state for loop detection */
    domHash?: string;
}

export interface VisionSnapshot {
    screenshot: string; // base64
    elements: SnapshotElement[];
    url: string;
    viewport: { width: number; height: number } | null;
    size?: number;
    quality?: number;
}

// ============================================
// Flow Recording Types
// ============================================

export interface RecordedFlow {
    /** Unique ID */
    id: string;
    /** Human-readable name */
    name: string;
    /** When created */
    createdAt: string;
    /** Starting URL */
    startUrl: string;
    /** Original instruction */
    instruction: string;
    /** All steps */
    steps: FlowStep[];
    /** Snapshots at key points */
    snapshots: Record<string, PageSnapshot>;
    /** Whether it completed successfully */
    success: boolean;
    /** Final summary */
    summary?: string;
}

export interface FlowStep {
    stepId: number;
    action: PlannedAction;
    timestamp: string;
    /** Element details for finding similar elements */
    element?: {
        role: string;
        name: string;
        selector: string;
        attributes: Record<string, string>;
    };
    /** URL at this step */
    url: string;
    /** Snapshot ID before this step */
    snapshotBefore?: string;
    /** Snapshot ID after this step */
    snapshotAfter?: string;
    /** Whether step succeeded */
    success: boolean;
    error?: string;
}

export interface FlowSummary {
    id: string;
    name: string;
    createdAt: string;
    startUrl: string;
    instruction: string;
    stepCount: number;
    success: boolean;
}

// ============================================
// Browser Types
// ============================================

export interface BrowserConfig {
    headless: boolean;
    timeout: number;
    viewport?: {
        width: number;
        height: number;
    };
    userAgent?: string;
}

// ============================================
// Configuration
// ============================================

export interface Config {
    openai: {
        apiKey: string;
        model: string;
    };
    browser: BrowserConfig;
    paths: {
        dataDir: string;
        downloadsDir: string;
        screenshotsDir: string;
        flowsDir: string;
        snapshotsDir: string;
    };
    agent: {
        maxSteps: number;
        screenshotOnEachStep: boolean;
        autoRecordFlows: boolean;
    };
    vision?: {
        enabled: boolean;
        fallbackEnabled: boolean;
        costTracking: boolean;
    };
}
