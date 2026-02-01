/**
 * ExecuteFlowUseCase - Ejecuta un flujo guardado
 */

import { WebFlow } from '../../../domain/entities/WebFlow.js';
import { IWebFlowRepository, ISnapshotRepository } from '../../../domain/repositories/index.js';
import { FlowExecutionService, BrowserAdapter, ExecutionResult } from '../../../domain/services/FlowExecutionService.js';


export interface ExecuteFlowInput {
    flowId?: string;
    flowName?: string;
    variables?: Record<string, string>;
    screenshotsDir: string;
}

export interface ExecuteFlowOutput extends ExecutionResult {
    flowId: string;
    flowName: string;
}

export class ExecuteFlowUseCase {
    private executionService: FlowExecutionService;

    constructor(
        private flowRepository: IWebFlowRepository,
        private snapshotRepository: ISnapshotRepository,
    ) {
        this.executionService = new FlowExecutionService();
    }

    /**
     * Execute a flow by ID or name
     */
    async execute(
        input: ExecuteFlowInput,
        browser: BrowserAdapter
    ): Promise<ExecuteFlowOutput> {
        // Find flow
        let flow: WebFlow | null = null;

        if (input.flowId) {
            flow = await this.flowRepository.findById(input.flowId);
        } else if (input.flowName) {
            flow = await this.flowRepository.findByName(input.flowName);
        }

        if (!flow) {
            throw new Error(
                `Flow not found: ${input.flowId || input.flowName}`
            );
        }

        // Check required variables
        const missingVars = this.getMissingVariables(flow, input.variables || {});
        if (missingVars.length > 0) {
            throw new Error(
                `Missing required variables: ${missingVars.join(', ')}`
            );
        }

        // Execute
        const result = await this.executionService.execute(
            flow,
            browser,
            {
                variables: input.variables || {},
                screenshotsDir: input.screenshotsDir,
                onStepStart: (step) => {
                    console.log(`  ▶ Step ${step.index + 1}: ${step.action}${step.selector ? ` [${step.selector}]` : ''}`);
                },
                onStepComplete: (step, success) => {
                    console.log(`    ${success ? '✓' : '✗'}`);
                },
            }
        );

        // Save updated flow (with execution count)
        await this.flowRepository.save(flow);

        return {
            ...result,
            flowId: flow.id,
            flowName: flow.name,
        };
    }

    /**
     * Get missing required variables
     */
    private getMissingVariables(
        flow: WebFlow,
        provided: Record<string, string>
    ): string[] {
        return flow.variables.filter(v => !(v in provided));
    }
}
