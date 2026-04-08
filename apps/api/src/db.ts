import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

type UserIdRow = {
  id: number;
};

type LegacyPlaylistRow = {
  id: number;
  user_id: number;
  song_mid: string;
  song_title: string | null;
  song_subtitle: string | null;
  singer_name: string | null;
  album_mid: string | null;
  album_name: string | null;
  cover_url: string | null;
  added_at: string;
};

type PlaylistIdRow = {
  id: string;
};

const DEFAULT_PLAYLIST_NAME = "我的收藏";
const DEFAULT_PLAYLIST_DESCRIPTION = "系统默认歌单";

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

function ensurePlaylistCoreTables(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link_readonly', 'link_collab')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_owner_user_id_updated_at
      ON playlists(owner_user_id, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_owner_default
      ON playlists(owner_user_id)
      WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      song_mid TEXT NOT NULL,
      song_title TEXT,
      song_subtitle TEXT,
      singer_name TEXT,
      album_mid TEXT,
      album_name TEXT,
      cover_url TEXT,
      position INTEGER NOT NULL,
      added_by_user_id INTEGER NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(playlist_id, song_mid),
      UNIQUE(playlist_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_id_position
      ON playlist_items(playlist_id, position ASC);

    CREATE TABLE IF NOT EXISTS playlist_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending')),
      invited_by_user_id INTEGER,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(playlist_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_members_user_id_status
      ON playlist_members(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_playlist_members_playlist_id_status_role
      ON playlist_members(playlist_id, status, role);

    CREATE TABLE IF NOT EXISTS playlist_share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL CHECK (scope IN ('read', 'edit')),
      expires_at TEXT NOT NULL,
      max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      last_used_at TEXT,
      revoked_at TEXT,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_share_links_playlist_id
      ON playlist_share_links(playlist_id);

    CREATE INDEX IF NOT EXISTS idx_playlist_share_links_expires_at
      ON playlist_share_links(expires_at);
  `);
}

function ensureDefaultPlaylistForUser(db: Db, userId: number): string {
  const existing = db.prepare(
    "SELECT id FROM playlists WHERE owner_user_id = ? AND is_default = 1 LIMIT 1"
  ).get(userId) as PlaylistIdRow | undefined;

  if (existing) {
    db.prepare(
      `INSERT OR IGNORE INTO playlist_members (playlist_id, user_id, role, status, invited_by_user_id)
       VALUES (?, ?, 'owner', 'active', NULL)`
    ).run(existing.id, userId);

    return existing.id;
  }

  const playlistId = randomUUID();

  db.prepare(
    `INSERT INTO playlists (id, owner_user_id, name, description, visibility, revision, is_default)
     VALUES (?, ?, ?, ?, 'private', 1, 1)`
  ).run(playlistId, userId, DEFAULT_PLAYLIST_NAME, DEFAULT_PLAYLIST_DESCRIPTION);

  db.prepare(
    `INSERT INTO playlist_members (playlist_id, user_id, role, status, invited_by_user_id)
     VALUES (?, ?, 'owner', 'active', NULL)`
  ).run(playlistId, userId);

  return playlistId;
}

function ensurePlaylistV2Migration(db: Db) {
  ensurePlaylistCoreTables(db);

  const hasLegacyPlaylistTable = Boolean(
    db.prepare("SELECT 1 AS has_table FROM sqlite_master WHERE type = 'table' AND name = 'playlist' LIMIT 1").get()
  );

  const migratePlaylists = db.transaction(() => {
    const users = db.prepare("SELECT id FROM users ORDER BY id ASC").all() as UserIdRow[];
    const defaultPlaylistByUserId = new Map<number, string>();

    const getDefaultPlaylistId = (userId: number) => {
      const existingId = defaultPlaylistByUserId.get(userId);
      if (existingId) return existingId;
      const playlistId = ensureDefaultPlaylistForUser(db, userId);
      defaultPlaylistByUserId.set(userId, playlistId);
      return playlistId;
    };

    for (const user of users) {
      getDefaultPlaylistId(user.id);
    }

    if (!hasLegacyPlaylistTable) {
      return;
    }

    const legacyRows = db.prepare(
      `SELECT id, user_id, song_mid, song_title, song_subtitle, singer_name, album_mid, album_name, cover_url, added_at
       FROM playlist
       ORDER BY user_id ASC, added_at ASC, id ASC`
    ).all() as LegacyPlaylistRow[];

    const getNextPosition = db.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?"
    );
    const insertItem = db.prepare(
      `INSERT OR IGNORE INTO playlist_items (
         playlist_id,
         song_mid,
         song_title,
         song_subtitle,
         singer_name,
         album_mid,
         album_name,
         cover_url,
         position,
         added_by_user_id,
         added_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nextPositionByPlaylist = new Map<string, number>();

    for (const row of legacyRows) {
      const playlistId = getDefaultPlaylistId(row.user_id);

      let position = nextPositionByPlaylist.get(playlistId);
      if (position === undefined) {
        const nextRow = getNextPosition.get(playlistId) as { next_position: number };
        position = nextRow.next_position;
      }

      const result = insertItem.run(
        playlistId,
        row.song_mid,
        row.song_title,
        row.song_subtitle,
        row.singer_name,
        row.album_mid,
        row.album_name,
        row.cover_url,
        position,
        row.user_id,
        row.added_at
      );

      if (result.changes > 0) {
        position += 1;
      }

      nextPositionByPlaylist.set(playlistId, position);
    }

    db.exec("DROP TABLE playlist");
  });

  migratePlaylists();
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
      reaction_key TEXT NOT NULL CHECK (
        reaction_key IN ('slacking', 'boost', 'healing', 'after_work', 'loop')
      ),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(share_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_share_reactions_share_id_reaction_key
      ON share_reactions(share_id, reaction_key);
  `);

  ensureUsersAuthColumns(db);
  ensureUniqueSharesPerSong(db);
  ensurePlaylistV2Migration(db);

  return db;
}
