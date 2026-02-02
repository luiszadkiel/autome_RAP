/**
 * SQLite Session Repository - Persists payment sessions to SQLite database
 */

import Database from 'better-sqlite3';

export interface StoredSession {
    url: string;
    cookies: any[];
    reservationInfo?: {
        date?: string;
        time?: string;
        price?: string;
    };
    credentials?: {
        username: string;
        password: string;
    };
    createdAt: number;
    expiresAt: number;
}

export class SqliteSessionRepository {
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
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                cookies TEXT NOT NULL,
                reservation_info TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                credentials TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        `);

        // Migration: Attempt to add credentials column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE sessions ADD COLUMN credentials TEXT');
        } catch (e) {
            // Column likely already exists, ignore error
        }
    }

    /**
     * Save or update a session
     */
    async save(token: string, session: StoredSession): Promise<void> {
        this.db.prepare(`
            INSERT OR REPLACE INTO sessions (
                token, url, cookies, reservation_info, credentials, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            token,
            session.url,
            JSON.stringify(session.cookies),
            session.reservationInfo ? JSON.stringify(session.reservationInfo) : null,
            session.credentials ? JSON.stringify(session.credentials) : null,
            session.createdAt,
            session.expiresAt
        );
    }

    /**
     * Find session by token
     */
    async findByToken(token: string): Promise<StoredSession | null> {
        const row = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;

        if (!row) {
            return null;
        }

        return {
            url: row.url,
            cookies: JSON.parse(row.cookies),
            reservationInfo: row.reservation_info ? JSON.parse(row.reservation_info) : undefined,
            credentials: row.credentials ? JSON.parse(row.credentials) : undefined,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        };
    }

    /**
     * Delete a specific session
     */
    async delete(token: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        return result.changes > 0;
    }

    /**
     * Delete all expired sessions
     */
    async deleteExpired(): Promise<number> {
        const now = Date.now();
        const result = this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
        return result.changes;
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}
