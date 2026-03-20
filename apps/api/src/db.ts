import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export type Db = Database.Database;

type TableInfoRow = {
  name: string;
};

type ExistingUserRow = {
  id: number;
  username: string | null;
  password_hash: string | null;
  created_at: string;
};

function ensureUniqueSharesPerSong(db: Db) {
  const migrateShares = db.transaction(() => {
    // Keep the newest share when historical duplicates exist.
    db.exec(`
      DELETE FROM shares
      WHERE id IN (
        SELECT older.id
        FROM shares older
        JOIN shares newer
          ON older.user_id = newer.user_id
         AND older.song_mid = newer.song_mid
         AND older.id < newer.id
      )
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_user_id_song_mid ON shares(user_id, song_mid)");
  });

  migrateShares();
}

function ensureUsersAuthColumns(db: Db) {
  const columns = db.prepare("PRAGMA table_info(users)").all() as TableInfoRow[];
  const columnNames = new Set(columns.map((column) => column.name));

  const missingUsername = !columnNames.has("username");
  const missingPasswordHash = !columnNames.has("password_hash");

  if (missingUsername) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  }

  if (missingPasswordHash) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }

  if (!missingUsername && !missingPasswordHash) {
    return;
  }

  const users = db
    .prepare("SELECT id, username, password_hash, created_at FROM users ORDER BY id ASC")
    .all() as ExistingUserRow[];

  const updateUsername = db.prepare("UPDATE users SET username = ? WHERE id = ?");
  const updatePasswordHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");

  const migrateUsers = db.transaction((rows: ExistingUserRow[]) => {
    const seenUsernames = new Set<string>();

    for (const row of rows) {
      let username = typeof row.username === "string" ? row.username.trim() : "";

      if (!username || seenUsernames.has(username)) {
        let suffix = 0;
        let candidate = `legacy_user_${row.id}`;

        while (seenUsernames.has(candidate)) {
          suffix += 1;
          candidate = `legacy_user_${row.id}_${suffix}`;
        }

        username = candidate;
        updateUsername.run(username, row.id);
      }

      seenUsernames.add(username);

      if (typeof row.password_hash !== "string" || !row.password_hash.trim()) {
        const placeholderHash = bcrypt.hashSync(`legacy-user-${row.id}-${row.created_at}`, 10);
        updatePasswordHash.run(placeholderHash, row.id);
      }
    }
  });

  migrateUsers(users);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
}

export function openDb(databasePath: string): Db {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      song_mid TEXT NOT NULL,
      song_title TEXT,
      song_subtitle TEXT,
      singer_name TEXT,
      album_mid TEXT,
      album_name TEXT,
      cover_url TEXT,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shares_user_id_created_at ON shares(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS share_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      share_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(share_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_share_reactions_share_id_reaction_key
      ON share_reactions(share_id, reaction_key);

    CREATE TABLE IF NOT EXISTS playlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      song_mid TEXT NOT NULL,
      song_title TEXT,
      song_subtitle TEXT,
      singer_name TEXT,
      album_mid TEXT,
      album_name TEXT,
      cover_url TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, song_mid)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_user_id ON playlist(user_id, added_at DESC);
  `);

  ensureUsersAuthColumns(db);
  ensureUniqueSharesPerSong(db);

  return db;
}
