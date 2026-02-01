/**
 * Repository Interfaces - Contracts for persistence
 */

import { WebFlow } from '../entities/WebFlow.js';
import { HtmlSnapshot } from '../entities/HtmlSnapshot.js';

/**
 * WebFlow Repository Interface
 */
export interface IWebFlowRepository {
    /**
     * Save a flow
     */
    save(flow: WebFlow): Promise<void>;

    /**
     * Find flow by ID
     */
    findById(id: string): Promise<WebFlow | null>;

    /**
     * Find flow by name
     */
    findByName(name: string): Promise<WebFlow | null>;

    /**
     * Get all flows
     */
    findAll(): Promise<WebFlow[]>;

    /**
     * Delete a flow
     */
    delete(id: string): Promise<boolean>;

    /**
     * Check if flow exists
     */
    exists(id: string): Promise<boolean>;
}

/**
 * Snapshot Repository Interface
 */
export interface ISnapshotRepository {
    /**
     * Save a snapshot
     */
    save(snapshot: HtmlSnapshot): Promise<void>;

    /**
     * Find snapshot by ID
     */
    findById(id: string): Promise<HtmlSnapshot | null>;

    /**
     * Find all snapshots for a flow
     */
    findByFlowId(flowId: string): Promise<HtmlSnapshot[]>;

    /**
     * Find snapshot for a specific step
     */
    findByFlowAndStep(flowId: string, stepIndex: number): Promise<HtmlSnapshot | null>;

    /**
     * Delete all snapshots for a flow
     */
    deleteByFlowId(flowId: string): Promise<void>;
}
