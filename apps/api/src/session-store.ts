import session from "express-session";
import type Database from "better-sqlite3";

type SessionRow = {
  sid: string;
  sess: string;
  expired: number;
};

/**
 * Simple SQLite session store for express-session using better-sqlite3.
 * Sessions are persisted in a 'sessions' table and survive server restarts.
 */
export class SQLiteSessionStore extends session.Store {
  private db: Database.Database;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(db: Database.Database) {
    super();
    this.db = db;
    this.initTable();
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  private initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
    `);
  }

  private cleanup() {
    const now = Date.now();
    this.db.prepare("DELETE FROM sessions WHERE expired < ?").run(now);
  }

  get(
    sid: string,
    callback: (err?: unknown, session?: session.SessionData | null) => void
  ): void {
    try {
      const now = Date.now();
      const row = this.db
        .prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > ?")
        .get(sid, now) as SessionRow | undefined;

      if (!row) {
        callback(null, null);
        return;
      }

      const sess = JSON.parse(row.sess) as session.SessionData;
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(
    sid: string,
    sess: session.SessionData,
    callback: (err?: unknown) => void
  ): void {
    try {
      const maxAge = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000; // default 7 days
      const expired = Date.now() + maxAge;
      const sessJson = JSON.stringify(sess);

      this.db
        .prepare(
          "INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)"
        )
        .run(sid, sessJson, expired);

      callback();
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid: string, callback: (err?: unknown) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  touch(
    sid: string,
    sess: session.SessionData,
    callback: (err?: unknown) => void
  ): void {
    try {
      const maxAge = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expired = Date.now() + maxAge;
      this.db
        .prepare("UPDATE sessions SET expired = ? WHERE sid = ?")
        .run(expired, sid);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
