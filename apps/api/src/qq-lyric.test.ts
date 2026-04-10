import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";
import { createCsrfAgent } from "./test-helpers.js";

const tempDirs: string[] = [];

describe("qq lyric api", () => {
  let db: Db;
  let qqServer: http.Server;
  let qqBaseUrl: string;
  let client: ReturnType<typeof createCsrfAgent>;
  let lyricResponder: (url: URL) => { status: number; body: unknown };

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-qq-lyric-"));
    tempDirs.push(tempDir);

    lyricResponder = () => ({
      status: 404,
      body: { code: 1, message: "not found" },
    });

    qqServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/lyric") {
        const response = lyricResponder(url);
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(response.body));
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: 1, message: "not found" }));
    });

    await new Promise<void>((resolve) => {
      qqServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = qqServer.address() as AddressInfo;
    qqBaseUrl = `http://127.0.0.1:${address.port}`;
    db = openDb(path.join(tempDir, "test.sqlite"));

    const app = createApp(
      db,
      qqBaseUrl,
      "http://127.0.0.1:3000",
      "test-session-secret",
      false,
      false,
    );

    client = createCsrfAgent(app);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve, reject) => {
      qqServer.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function register(username: string) {
    const response = await client.agent.post("/api/auth/register").send({
      username,
      password: "password123",
      name: username,
    });

    expect(response.status).toBe(201);
    client.setCsrfToken(response.body.csrfToken as string | null);
  }

  it("requires authentication", async () => {
    const response = await client.agent.get("/api/qq/lyric").query({ mid: "song-mid-1" });
    expect(response.status).toBe(401);
  });

  it("normalizes lyric payloads and forwards lyric options", async () => {
    await register("lyric_user");

    let seenQuery = "";
    lyricResponder = (url) => {
      seenQuery = url.searchParams.toString();
      return {
        status: 200,
        body: {
          code: 0,
          data: {
            data: {
              lyric: '<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1200]第一句(0,400)词"/></LyricInfo></QrcInfos>',
              trans: "[00:00.00]First line",
              roma: " ",
            },
          },
        },
      };
    };

    const response = await client.agent.get("/api/qq/lyric").query({
      mid: "song-mid-1",
      qrc: 1,
      trans: 1,
      roma: 1,
    });

    expect(response.status).toBe(200);
    expect(seenQuery).toContain("mid=song-mid-1");
    expect(seenQuery).toContain("qrc=1");
    expect(seenQuery).toContain("trans=1");
    expect(seenQuery).toContain("roma=1");
    expect(response.body).toEqual({
      lyric: '<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1200]第一句(0,400)词"/></LyricInfo></QrcInfos>',
      trans: "[00:00.00]First line",
      roma: null,
      format: "qrc",
    });
  });
});
