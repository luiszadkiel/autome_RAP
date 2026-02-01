/**
 * SQLite Snapshot Repository - Persists HTML snapshots
 */

import Database from 'better-sqlite3';
import { HtmlSnapshot, HtmlSnapshotProps } from '../../../domain/entities/HtmlSnapshot.js';
import { ISnapshotRepository } from '../../../domain/repositories/index.js';


export class SqliteSnapshotRepository implements ISnapshotRepository {
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
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        url TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        html_target TEXT,
        html_context TEXT,
        html_full TEXT,
        selector_primary TEXT NOT NULL,
        selector_fallbacks TEXT NOT NULL,
        aria_snapshot TEXT,
        interactive_elements TEXT,
        FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_flow_id ON snapshots(flow_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_flow_step ON snapshots(flow_id, step_index);
    `);
    }

    async save(snapshot: HtmlSnapshot): Promise<void> {
        const data = snapshot.toJSON();

        this.db.prepare(`
      INSERT OR REPLACE INTO snapshots (
        id, flow_id, step_index, url, timestamp,
        html_target, html_context, html_full,
        selector_primary, selector_fallbacks,
        aria_snapshot, interactive_elements
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            data.id,
            data.flowId,
            data.stepIndex,
            data.url,
            data.timestamp.toISOString(),
            data.html.target || null,
            data.html.context || null,
            data.html.full || null,
            data.selectors.primary,
            JSON.stringify(data.selectors.fallbacks),
            data.ariaSnapshot || null,
            JSON.stringify(data.interactiveElements || []),
        );
    }

    async findById(id: string): Promise<HtmlSnapshot | null> {
        const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as any;
        if (!row) return null;
        return this.rowToSnapshot(row);
    }

    async findByFlowId(flowId: string): Promise<HtmlSnapshot[]> {
        const rows = this.db.prepare(
            'SELECT * FROM snapshots WHERE flow_id = ? ORDER BY step_index'
        ).all(flowId) as any[];
        return rows.map(row => this.rowToSnapshot(row));
    }

    async findByFlowAndStep(flowId: string, stepIndex: number): Promise<HtmlSnapshot | null> {
        const row = this.db.prepare(
            'SELECT * FROM snapshots WHERE flow_id = ? AND step_index = ?'
        ).get(flowId, stepIndex) as any;
        if (!row) return null;
        return this.rowToSnapshot(row);
    }

    async deleteByFlowId(flowId: string): Promise<void> {
        this.db.prepare('DELETE FROM snapshots WHERE flow_id = ?').run(flowId);
    }

    private rowToSnapshot(row: any): HtmlSnapshot {
        return HtmlSnapshot.fromJSON({
            id: row.id,
            flowId: row.flow_id,
            stepIndex: row.step_index,
            url: row.url,
            timestamp: new Date(row.timestamp),
            html: {
                target: row.html_target || undefined,
                context: row.html_context || undefined,
                full: row.html_full || undefined,
            },
            selectors: {
                primary: row.selector_primary,
                fallbacks: JSON.parse(row.selector_fallbacks),
            },
            ariaSnapshot: row.aria_snapshot || undefined,
            interactiveElements: JSON.parse(row.interactive_elements || '[]'),
        });
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}
