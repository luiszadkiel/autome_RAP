/**
 * SQLite Flow Repository - Persists flows to SQLite database
 */

import Database from 'better-sqlite3';
import { WebFlow, WebFlowData } from '../../../domain/entities/WebFlow.js';

import { FlowStep } from '../../../domain/entities/FlowStep.js';
import { IWebFlowRepository } from '../../../domain/repositories/index.js';
import { FlowStatus } from '../../../domain/value-objects/FlowStatus.js';
import { StepAction } from '../../../domain/value-objects/StepAction.js';


export class SqliteWebFlowRepository implements IWebFlowRepository {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.initialize();
    }

    /**
     * Initialize database schema
     */
    private initialize(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        start_url TEXT NOT NULL,
        status TEXT NOT NULL,
        variables TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_executed_at TEXT,
        execution_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS flow_steps (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        action TEXT NOT NULL,
        selector TEXT,
        value TEXT,
        url TEXT,
        wait_for TEXT,
        timeout INTEGER,
        snapshot_id TEXT,
        fallback_selectors TEXT,
        description TEXT,
        FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_id ON flow_steps(flow_id);
      CREATE INDEX IF NOT EXISTS idx_flows_name ON flows(name);
    `);
    }

    async save(flow: WebFlow): Promise<void> {
        const data = flow.toJSON();

        // Upsert flow
        this.db.prepare(`
      INSERT OR REPLACE INTO flows (
        id, name, description, start_url, status, variables,
        created_at, updated_at, last_executed_at, execution_count, success_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            data.id,
            data.name,
            data.description || null,
            data.startUrl,
            data.status,
            JSON.stringify(data.variables),
            data.createdAt.toISOString(),
            data.updatedAt.toISOString(),
            data.lastExecutedAt?.toISOString() || null,
            data.executionCount,
            data.successCount,
        );

        // Delete existing steps and insert new ones
        this.db.prepare('DELETE FROM flow_steps WHERE flow_id = ?').run(data.id);

        const insertStep = this.db.prepare(`
      INSERT INTO flow_steps (
        id, flow_id, step_index, action, selector, value, url,
        wait_for, timeout, snapshot_id, fallback_selectors, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        for (const stepData of data.steps) {
            insertStep.run(
                stepData.id,
                data.id,
                stepData.index,
                stepData.action,
                stepData.selector || null,
                stepData.value || null,
                stepData.url || null,
                stepData.waitFor || null,
                stepData.timeout || null,
                stepData.snapshotId || null,
                JSON.stringify(stepData.fallbackSelectors || []),
                stepData.description || null,
            );
        }
    }


    async findById(id: string): Promise<WebFlow | null> {
        const row = this.db.prepare('SELECT * FROM flows WHERE id = ?').get(id) as any;
        if (!row) return null;
        return this.rowToFlow(row);
    }

    async findByName(name: string): Promise<WebFlow | null> {
        const row = this.db.prepare('SELECT * FROM flows WHERE name = ?').get(name) as any;
        if (!row) return null;
        return this.rowToFlow(row);
    }

    async findAll(): Promise<WebFlow[]> {
        const rows = this.db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all() as any[];
        return Promise.all(rows.map(row => this.rowToFlow(row)));
    }

    async delete(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM flows WHERE id = ?').run(id);
        return result.changes > 0;
    }

    async exists(id: string): Promise<boolean> {
        const row = this.db.prepare('SELECT 1 FROM flows WHERE id = ?').get(id);
        return !!row;
    }

    private async rowToFlow(row: any): Promise<WebFlow> {
        // Get steps
        const stepRows = this.db.prepare(
            'SELECT * FROM flow_steps WHERE flow_id = ? ORDER BY step_index'
        ).all(row.id) as any[];

        const steps = stepRows.map(sr => FlowStep.fromJSON({
            id: sr.id,
            index: sr.step_index,
            action: sr.action as StepAction,
            selector: sr.selector || undefined,
            value: sr.value || undefined,
            url: sr.url || undefined,
            waitFor: sr.wait_for || undefined,
            timeout: sr.timeout || undefined,
            snapshotId: sr.snapshot_id || undefined,
            fallbackSelectors: JSON.parse(sr.fallback_selectors || '[]'),
            description: sr.description || undefined,
        }));

        return WebFlow.fromJSON({
            id: row.id,
            name: row.name,
            description: row.description || undefined,
            startUrl: row.start_url,
            status: row.status as FlowStatus,
            variables: JSON.parse(row.variables),
            steps: steps.map(s => s.toJSON()),
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            lastExecutedAt: row.last_executed_at ? new Date(row.last_executed_at) : undefined,
            executionCount: row.execution_count,
            successCount: row.success_count,
        });
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}
