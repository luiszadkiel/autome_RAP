
export interface ExtractedInfo {
    type: string;       // Ej: "restaurant", "price", "availability", "error"
    content: string;    // El contenido extraído
    source?: string;    // URL o elemento donde se encontró
    timestamp: number;
}

export interface AgentState {
    currentStep: number;
    maxSteps: number;
    visitedUrls: Set<string>;
    executedActions: ActionRecord[];
    failedActions: ActionRecord[];
    stuckDetectionCounter: number;
    recoveryAttempts: number; // Contador de intentos de recuperación consecutivos
    lastSnapshotHash: string;
    objectiveProgress: number; // 0-100
    extractedInfo: ExtractedInfo[]; // Información extraída durante la navegación
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
            recoveryAttempts: 0,
            lastSnapshotHash: '',
            objectiveProgress: 0,
            extractedInfo: []
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
     * Detecta bucle detalle → back → lista → click producto (sin extraer precios).
     * Si en los últimos 10 pasos hay 3+ "back" y 3+ "click", consideramos que está repitiendo el ciclo.
     */
    isInDetailBackClickLoop(): boolean {
        if (this.state.currentStep < 12) return false;
        const recent = this.state.executedActions.slice(-10);
        const backs = recent.filter(a => a.action === 'back').length;
        const clicks = recent.filter(a => a.action === 'click').length;
        return backs >= 3 && clicks >= 3;
    }

    /**
     * Registra un intento de recuperación
     * Retorna true si se debe continuar con recuperación, false si ya se agotaron intentos
     */
    recordRecoveryAttempt(): boolean {
        this.state.recoveryAttempts++;
        const MAX_RECOVERY_ATTEMPTS = 3;
        
        if (this.state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
            console.log(`   ⚠️ Máximo de ${MAX_RECOVERY_ATTEMPTS} intentos de recuperación alcanzado, forzando nueva estrategia...`);
            this.resetStuckState();
            return false; // No más recuperación, forzar al LLM
        }
        return true; // Continuar con recuperación
    }

    /**
     * Resetea el estado de atascado después de recuperación exitosa o forzada
     */
    resetStuckState(): void {
        this.state.stuckDetectionCounter = 0;
        this.state.recoveryAttempts = 0;
        this.state.lastSnapshotHash = ''; // Forzar que el próximo snapshot sea "nuevo"
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

    /**
     * Registra una URL visitada
     */
    addVisitedUrl(url: string): void {
        this.state.visitedUrls.add(url);
    }

    /**
     * Agrega información extraída durante la navegación
     */
    addExtractedInfo(info: Omit<ExtractedInfo, 'timestamp'>): void {
        this.state.extractedInfo.push({
            ...info,
            timestamp: Date.now()
        });
    }

    /**
     * Obtiene toda la información extraída
     */
    getExtractedInfo(): ExtractedInfo[] {
        return [...this.state.extractedInfo];
    }

    /**
     * Genera un resumen final de toda la información extraída
     */
    generateFinalSummary(objective: string, finalStatus: string): string {
        const info = this.state.extractedInfo;
        const actions = this.state.executedActions;
        const visitedUrls = Array.from(this.state.visitedUrls);

        let summary = `\n📋 RESUMEN DE INFORMACIÓN EXTRAÍDA\n`;
        summary += `${'='.repeat(50)}\n`;
        summary += `🎯 Objetivo: ${objective}\n`;
        summary += `📊 Estado final: ${finalStatus}\n`;
        summary += `📍 Pasos ejecutados: ${this.state.currentStep}\n\n`;

        // URLs visitadas
        if (visitedUrls.length > 0) {
            summary += `🔗 URLs visitadas:\n`;
            visitedUrls.forEach(url => summary += `   • ${url}\n`);
            summary += '\n';
        }

        // Información extraída agrupada por tipo
        if (info.length > 0) {
            summary += `📦 Información encontrada:\n`;
            const byType = info.reduce((acc, item) => {
                if (!acc[item.type]) acc[item.type] = [];
                acc[item.type].push(item);
                return acc;
            }, {} as Record<string, ExtractedInfo[]>);

            for (const [type, items] of Object.entries(byType)) {
                summary += `\n   [${type.toUpperCase()}]\n`;
                items.forEach(item => {
                    summary += `   • ${item.content}\n`;
                    if (item.source) summary += `     Fuente: ${item.source}\n`;
                });
            }
        } else {
            summary += `⚠️ No se extrajo información específica durante la navegación.\n`;
        }

        // Acciones exitosas relevantes
        const successfulActions = actions.filter(a => a.success && a.reason);
        if (successfulActions.length > 0) {
            summary += `\n✅ Acciones completadas:\n`;
            successfulActions.slice(-10).forEach(a => {
                summary += `   • ${a.action}${a.target ? `[${a.target}]` : ''}: ${a.reason}\n`;
            });
        }

        // Errores encontrados
        const failedActions = this.state.failedActions;
        if (failedActions.length > 0) {
            summary += `\n❌ Problemas encontrados:\n`;
            const uniqueErrors = [...new Set(failedActions.map(a => a.reason || a.action))];
            uniqueErrors.slice(0, 5).forEach(err => {
                summary += `   • ${err}\n`;
            });
        }

        summary += `\n${'='.repeat(50)}\n`;

        return summary;
    }
}
