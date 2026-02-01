/**
 * HtmlSnapshot Entity - Captura del estado HTML de un paso
 */

export interface HtmlSnapshotProps {
    id: string;
    flowId: string;
    stepIndex: number;
    url: string;
    timestamp: Date;
    html: {
        full?: string;
        target?: string;
        context?: string;
    };
    selectors: {
        primary: string;
        fallbacks: string[];
    };
    ariaSnapshot?: string;
    interactiveElements?: Array<{
        ref: string;
        role: string;
        name: string;
        selector: string;
    }>;
}

export class HtmlSnapshot {
    private props: HtmlSnapshotProps;

    constructor(props: HtmlSnapshotProps) {
        this.props = props;
    }

    // Getters
    get id(): string { return this.props.id; }
    get flowId(): string { return this.props.flowId; }
    get stepIndex(): number { return this.props.stepIndex; }
    get url(): string { return this.props.url; }
    get timestamp(): Date { return this.props.timestamp; }
    get html(): HtmlSnapshotProps['html'] { return this.props.html; }
    get selectors(): HtmlSnapshotProps['selectors'] { return this.props.selectors; }
    get ariaSnapshot(): string | undefined { return this.props.ariaSnapshot; }
    get interactiveElements() { return this.props.interactiveElements; }

    /**
     * Create a new snapshot
     */
    static create(params: {
        flowId: string;
        stepIndex: number;
        url: string;
        targetHtml?: string;
        contextHtml?: string;
        primarySelector: string;
        fallbackSelectors?: string[];
        ariaSnapshot?: string;
        interactiveElements?: HtmlSnapshotProps['interactiveElements'];
    }): HtmlSnapshot {
        return new HtmlSnapshot({
            id: `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            flowId: params.flowId,
            stepIndex: params.stepIndex,
            url: params.url,
            timestamp: new Date(),
            html: {
                target: params.targetHtml,
                context: params.contextHtml,
            },
            selectors: {
                primary: params.primarySelector,
                fallbacks: params.fallbackSelectors || [],
            },
            ariaSnapshot: params.ariaSnapshot,
            interactiveElements: params.interactiveElements,
        });
    }

    /**
     * Check if a selector matches this snapshot
     */
    matchesSelector(selector: string): boolean {
        if (this.props.selectors.primary === selector) return true;
        return this.props.selectors.fallbacks.includes(selector);
    }

    /**
     * Get all possible selectors
     */
    getAllSelectors(): string[] {
        return [this.props.selectors.primary, ...this.props.selectors.fallbacks];
    }

    /**
     * Find interactive element by ref
     */
    findElementByRef(ref: string) {
        return this.props.interactiveElements?.find(e => e.ref === ref);
    }

    /**
     * Convert to plain object
     */
    toJSON(): HtmlSnapshotProps {
        return { ...this.props };
    }

    /**
     * Reconstruct from plain object
     */
    static fromJSON(data: HtmlSnapshotProps): HtmlSnapshot {
        return new HtmlSnapshot({
            ...data,
            timestamp: new Date(data.timestamp),
        });
    }
}
