import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

const tempDirs: string[] = [];

function createTempDbPath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-db-smoke-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "smoke.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("openDb", () => {
  it("creates core tables", () => {
    const dbPath = createTempDbPath();
    const db = openDb(dbPath);

    const tables = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'users',
             'shares',
             'share_reactions',
             'playlists',
             'playlist_items',
             'playlist_members',
             'playlist_share_links'
           )
         ORDER BY name ASC`
      )
      .all() as Array<{ name: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual([
      "playlist_items",
      "playlist_members",
      "playlist_share_links",
      "playlists",
      "share_reactions",
      "shares",
      "users",
    ]);
  });

  it("migrates legacy playlist rows into default playlists", () => {
    const dbPath = createTempDbPath();
    const legacyDb = new Database(dbPath);

    legacyDb.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE playlist (
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
        UNIQUE(user_id, song_mid)
      );

      INSERT INTO users (id, username, password_hash, name)
      VALUES (1, 'legacy_user', 'hash', 'Legacy User');

      INSERT INTO playlist (user_id, song_mid, song_title, singer_name, added_at)
      VALUES (1, 'legacy-song-mid', 'Legacy Song', 'Legacy Singer', '2026-01-01T00:00:00.000Z');
    `);

    legacyDb.close();

    const db = openDb(dbPath);

    const legacyTableStillExists = db
      .prepare("SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'playlist' LIMIT 1")
      .get() as { n: number } | undefined;

    const playlist = db.prepare(
      "SELECT * FROM playlists WHERE owner_user_id = 1 AND is_default = 1"
    ).get() as { id: string; name: string; description: string | null } | undefined;

    const playlistItem = db.prepare(
      "SELECT * FROM playlist_items WHERE playlist_id = ?"
    ).get(playlist?.id) as { song_mid: string; singer_name: string | null; added_at: string } | undefined;

    const ownerMember = db.prepare(
      "SELECT role, status FROM playlist_members WHERE playlist_id = ? AND user_id = 1"
    ).get(playlist?.id) as { role: string; status: string } | undefined;

    db.close();

    expect(legacyTableStillExists).toBeUndefined();
    expect(playlist).toBeTruthy();
    expect(playlist?.name).toBe("我的收藏");
    expect(playlistItem).toMatchObject({
      song_mid: "legacy-song-mid",
      singer_name: "Legacy Singer",
      added_at: "2026-01-01T00:00:00.000Z",
    });
    expect(ownerMember).toEqual({ role: "owner", status: "active" });
  });

  it("rejects invalid reaction keys at the database layer", () => {
    const dbPath = createTempDbPath();
    const db = openDb(dbPath);

    const userInsert = db.prepare(
      "INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)"
    );
    const userResult = userInsert.run("smoke_user", "hashed_pw", "Smoke User");
    const userId = Number(userResult.lastInsertRowid);

    const shareInsert = db.prepare("INSERT INTO shares (user_id, song_mid) VALUES (?, ?)");
    const shareResult = shareInsert.run(userId, "song_mid_smoke");
    const shareId = Number(shareResult.lastInsertRowid);

    const reactionInsert = db.prepare(
      "INSERT INTO share_reactions (share_id, user_id, reaction_key) VALUES (?, ?, ?)"
    );

    expect(() => {
      reactionInsert.run(shareId, userId, "not_whitelisted");
    }).toThrow();

    db.close();
  });
});
