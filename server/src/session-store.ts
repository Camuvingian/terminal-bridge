import fs from 'fs';
import path from 'path';
import type { AiServerMessage, SessionSnapshotMessage } from '../../shared/ai-protocol.js';

export interface BufferedMessage {
    seq: number;
    message: AiServerMessage;
}

interface SessionFile {
    messages: BufferedMessage[];
    snapshot: SessionSnapshotMessage | null;
    createdAt: number;
    lastUpdatedAt: number;
}

const MAX_SESSIONS = 10;
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Flat-file persistence for AI session messages.
 *
 * Each session is stored as a single JSON file. This keeps the
 * implementation simple (no database dependency) while allowing
 * sessions to survive server restarts.
 */
export class SessionStore {
    private readonly dir: string;

    constructor(dataDir?: string) {
        this.dir = dataDir ?? path.resolve(process.cwd(), 'data', 'sessions');
        fs.mkdirSync(this.dir, { recursive: true });
    }

    append(sessionId: string, seq: number, message: AiServerMessage): void {
        const data = this.readFile(sessionId);
        data.messages.push({ seq, message });
        data.lastUpdatedAt = Date.now();
        this.writeFile(sessionId, data);
    }

    loadFrom(sessionId: string, afterSeq: number): BufferedMessage[] {
        const data = this.readFile(sessionId);
        return data.messages.filter((m) => m.seq > afterSeq);
    }

    loadSnapshot(sessionId: string): SessionSnapshotMessage | null {
        const data = this.readFile(sessionId);
        return data.snapshot;
    }

    saveSnapshot(sessionId: string, snapshot: SessionSnapshotMessage): void {
        const data = this.readFile(sessionId);
        data.snapshot = snapshot;
        data.lastUpdatedAt = Date.now();
        this.writeFile(sessionId, data);
    }

    exists(sessionId: string): boolean {
        return fs.existsSync(this.filePath(sessionId));
    }

    getSessionMeta(sessionId: string): { createdAt: number; lastUpdatedAt: number } | null {
        if (!this.exists(sessionId)) {
            return null;
        }
        const data = this.readFile(sessionId);
        return { createdAt: data.createdAt, lastUpdatedAt: data.lastUpdatedAt };
    }

    cleanup(): void {
        let files: string[];
        try {
            files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
        } catch {
            return;
        }

        // Read metadata for all files
        const entries: { name: string; lastUpdatedAt: number }[] = [];
        const now = Date.now();

        for (const name of files) {
            const filePath = path.join(this.dir, name);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw) as SessionFile;

                // Delete files older than MAX_AGE_MS
                if (now - data.lastUpdatedAt > MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    continue;
                }

                entries.push({ name, lastUpdatedAt: data.lastUpdatedAt });
            } catch {
                // Corrupt file — remove it
                try {
                    fs.unlinkSync(filePath);
                } catch { /* ignore */ }
            }
        }

        // Keep only the newest MAX_SESSIONS
        if (entries.length > MAX_SESSIONS) {
            entries.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
            for (const entry of entries.slice(MAX_SESSIONS)) {
                try {
                    fs.unlinkSync(path.join(this.dir, entry.name));
                } catch { /* ignore */ }
            }
        }
    }

    // ── Internal ─────────────────────────────────────────────────────

    private filePath(sessionId: string): string {
        // Sanitize sessionId to prevent path traversal
        const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.dir, `${safe}.json`);
    }

    private readFile(sessionId: string): SessionFile {
        const filePath = this.filePath(sessionId);
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as SessionFile;
        } catch {
            const now = Date.now();
            return { messages: [], snapshot: null, createdAt: now, lastUpdatedAt: now };
        }
    }

    private writeFile(sessionId: string, data: SessionFile): void {
        const filePath = this.filePath(sessionId);
        fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    }
}
