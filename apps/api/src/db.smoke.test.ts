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
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'shares', 'playlist') ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual(["playlist", "shares", "users"]);
  });
});
