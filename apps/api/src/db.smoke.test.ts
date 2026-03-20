import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("openDb", () => {
  it("creates core tables", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-db-smoke-"));
    tempDirs.push(tempDir);

    const dbPath = path.join(tempDir, "smoke.sqlite");
    const db = openDb(dbPath);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'shares', 'share_reactions', 'playlist') ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual(["playlist", "share_reactions", "shares", "users"]);
  });

  it("rejects invalid reaction keys at the database layer", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-db-smoke-"));
    tempDirs.push(tempDir);

    const dbPath = path.join(tempDir, "smoke.sqlite");
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
