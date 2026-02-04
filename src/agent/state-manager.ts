
export interface AgentState {
    currentStep: number;
    maxSteps: number;
    visitedUrls: Set<string>;
    executedActions: ActionRecord[];
    failedActions: ActionRecord[];
    stuckDetectionCounter: number;
    lastSnapshotHash: string;
    objectiveProgress: number; // 0-100
}

export interface ActionRecord {
    step: number;
    action: string;
    target?: string; // Maps to ref
    value?: string;
    reason?: string; // New field
    timestamp: number;
    success: boolean;
    snapshotHash: string;
}

export interface ProgressIndicators {
    loggedIn: boolean;
    onTargetPage: boolean;
    dateSelected: boolean;
    timeSelected: boolean;
    formFilled: boolean;
    nearPayment: boolean;
}

export class StateManager {
    private state: AgentState;
    private readonly STUCK_THRESHOLD = 3;
    private readonly MAX_SAME_ACTION_REPEATS = 2;

    constructor(maxSteps: number = 30) {
        this.state = {
            currentStep: 0,
            maxSteps,
            visitedUrls: new Set(),
            executedActions: [],
            failedActions: [],
            stuckDetectionCounter: 0,
            lastSnapshotHash: '',
            objectiveProgress: 0
        };
    }

    /**
     * Registra una acción ejecutada
     */
    recordAction(action: ActionRecord): void {
        this.state.currentStep++;
        this.state.executedActions.push(action);

        if (!action.success) {
            this.state.failedActions.push(action);
        }

        // Detectar si estamos atascados
        if (action.snapshotHash === this.state.lastSnapshotHash) {
            this.state.stuckDetectionCounter++;
        } else {
            this.state.stuckDetectionCounter = 0;
            this.state.lastSnapshotHash = action.snapshotHash;
        }
    }

    /**
     * Verifica si una acción ya se intentó recientemente
     */
    isActionRepeated(action: string, target?: string): boolean {
        const recentActions = this.state.executedActions.slice(-5);
        const sameActionCount = recentActions.filter(a =>
            a.action === action && a.target === target
        ).length;

        return sameActionCount >= this.MAX_SAME_ACTION_REPEATS;
    }

    /**
     * Verifica si el agente está atascado
     */
    isStuck(): boolean {
        return this.state.stuckDetectionCounter >= this.STUCK_THRESHOLD;
    }

    /**
     * Obtiene sugerencias de recuperación cuando está atascado
     */
    getRecoveryStrategies(): string[] {
        const strategies: string[] = [];

        // Analizar patrones de fallo
        const recentFailures = this.state.failedActions.slice(-3);
        const failureTypes = recentFailures.map(f => f.action);

        if (failureTypes.includes('click')) {
            strategies.push('scroll_to_reveal'); // Puede que el elemento no sea visible
            strategies.push('wait_for_element'); // Puede que no haya cargado
            strategies.push('check_modal'); // Puede haber un modal bloqueando
        }

        if (failureTypes.includes('type')) {
            strategies.push('clear_and_type'); // Limpiar campo primero
            strategies.push('click_then_type'); // Hacer click para enfocar primero
        }

        // Estrategias generales
        strategies.push('scroll_down'); // Revelar más contenido
        strategies.push('close_modal'); // Cerrar cualquier modal abierto
        strategies.push('refresh_page'); // Último recurso

        return strategies;
    }

    /**
     * Calcula el progreso hacia el objetivo
     */
    updateProgress(indicators: ProgressIndicators): void {
        let progress = 0;

        if (indicators.loggedIn) progress += 20;
        if (indicators.onTargetPage) progress += 20;
        if (indicators.dateSelected) progress += 20;
        if (indicators.timeSelected) progress += 20;
        if (indicators.formFilled) progress += 10;
        if (indicators.nearPayment) progress += 10;

        this.state.objectiveProgress = progress;
    }

    /**
     * Gets action history in the format expected by prompts
     */
    getActionHistory(): any[] {
        return this.state.executedActions.map(a => ({
            action: a.action,
            ref: a.target,
            success: a.success,
            reason: a.reason,
            timestamp: a.timestamp
        }));
    }

    /**
     * Genera contexto resumido para el prompt de OpenAI
     */
    getContextSummary(): string {
        const recent = this.state.executedActions.slice(-5);
        const recentSummary = recent.map(a =>
            `${a.action}${a.target ? `[${a.target}]` : ''}:${a.success ? '✓' : '✗'}`
        ).join(' → ');

        return `Paso ${this.state.currentStep}/${this.state.maxSteps} | ` +
            `Progreso: ${this.state.objectiveProgress}% | ` +
            `Reciente: ${recentSummary}`;
    }

    /**
     * Verifica si debemos detenernos
     */
    shouldStop(): { stop: boolean; reason: string } {
        if (this.state.currentStep >= this.state.maxSteps) {
            return { stop: true, reason: 'Límite de pasos alcanzado' };
        }

        if (this.state.failedActions.length > 10) {
            return { stop: true, reason: 'Demasiados errores consecutivos' };
        }

        if (this.state.stuckDetectionCounter > 5) {
            return { stop: true, reason: 'Agente atascado sin progreso' };
        }

        return { stop: false, reason: '' };
    }

    getState(): AgentState {
        return { ...this.state };
    }
}
