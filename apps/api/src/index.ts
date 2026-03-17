import express from "express";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { getEnv } from "./env.js";
import { openDb, type Db } from "./db.js";
import { SQLiteSessionStore } from "./session-store.js";
import {
  createQqMusicClient,
  qqCover,
  qqSearch,
  qqSongUrl
} from "./qqmusic.js";

// ── Row types ──────────────────────────────────────────────────────────────

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
};

type ShareRow = {
  id: number;
  user_id: number;
  song_mid: string;
  song_title: string | null;
  song_subtitle: string | null;
  singer_name: string | null;
  album_mid: string | null;
  album_name: string | null;
  cover_url: string | null;
  comment: string | null;
  created_at: string;
};

type PlaylistRow = {
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

// ── Session augmentation ───────────────────────────────────────────────────

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

function parseIntParam(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw httpError(400, "Invalid id");
  return n;
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at
  };
}

function mapShare(row: ShareRow) {
  return {
    id: row.id,
    userId: row.user_id,
    songMid: row.song_mid,
    songTitle: row.song_title,
    songSubtitle: row.song_subtitle,
    singerName: row.singer_name,
    albumMid: row.album_mid,
    albumName: row.album_name,
    coverUrl: row.cover_url,
    comment: row.comment,
    createdAt: row.created_at
  };
}

function mapPlaylist(row: PlaylistRow) {
  return {
    id: row.id,
    userId: row.user_id,
    songMid: row.song_mid,
    songTitle: row.song_title,
    songSubtitle: row.song_subtitle,
    singerName: row.singer_name,
    albumMid: row.album_mid,
    albumName: row.album_name,
    coverUrl: row.cover_url,
    addedAt: row.added_at
  };
}

// ── DB helpers ─────────────────────────────────────────────────────────────

function dbGetUserById(db: Db, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

function dbGetUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

function dbGetShare(db: Db, id: number): ShareRow | undefined {
  return db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow | undefined;
}

function dbAllUsers(db: Db): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserRow[];
}

function dbAllShares(db: Db): ShareRow[] {
  return db.prepare("SELECT * FROM shares ORDER BY created_at DESC").all() as ShareRow[];
}

function dbUserShares(db: Db, userId: number): ShareRow[] {
  return db.prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ShareRow[];
}

function dbUserPlaylist(db: Db, userId: number): PlaylistRow[] {
  return db.prepare("SELECT * FROM playlist WHERE user_id = ? ORDER BY added_at DESC").all(userId) as PlaylistRow[];
}

function dbGetPlaylistEntry(db: Db, userId: number, songMid: string): PlaylistRow | undefined {
  return db.prepare("SELECT * FROM playlist WHERE user_id = ? AND song_mid = ?").get(userId, songMid) as PlaylistRow | undefined;
}

// ── App factory ────────────────────────────────────────────────────────────

function createApp(db: Db, qqBaseUrl: string, corsOrigin: string, sessionSecret: string, secureCookie: boolean) {
  const qq = createQqMusicClient(qqBaseUrl);

  const app = express();
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(
    session({
      store: new SQLiteSessionStore(db),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    })
  );

  // ── Auth middleware ──────────────────────────────────────────────────────

  function requireAuth(
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) {
    if (!req.session.userId) {
      next(httpError(401, "Not authenticated"));
      return;
    }
    next();
  }

  // ── Health ───────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ── Auth routes ──────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const body = z
        .object({
          username: z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, "用户名只能包含字母、数字、下划线或汉字"),
          password: z.string().min(6).max(100),
          name: z.string().trim().min(1).max(50),
          avatarUrl: z.string().url().max(500).optional().nullable()
        })
        .parse(req.body);

      const existing = dbGetUserByUsername(db, body.username);
      if (existing) throw httpError(409, "用户名已被占用");

      const passwordHash = await bcrypt.hash(body.password, 10);
      const avatarSeed = body.username + Math.random().toString(16).slice(2);
      const avatarUrl = body.avatarUrl ?? `https://api.dicebear.com/9.x/thumbs/svg?seed=${avatarSeed}`;

      const info = db
        .prepare("INSERT INTO users (username, password_hash, name, avatar_url) VALUES (?, ?, ?, ?)")
        .run(body.username, passwordHash, body.name, avatarUrl);

      const user = dbGetUserById(db, Number(info.lastInsertRowid));
      req.session.userId = user!.id;

      res.status(201).json({ user: mapUser(user!) });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const body = z
        .object({
          username: z.string().trim().min(1),
          password: z.string().min(1)
        })
        .parse(req.body);

      const user = dbGetUserByUsername(db, body.username);
      if (!user) throw httpError(401, "用户名或密码错误");

      const ok = await bcrypt.compare(body.password, user.password_hash);
      if (!ok) throw httpError(401, "用户名或密码错误");

      req.session.userId = user.id;
      res.json({ user: mapUser(user) });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/auth/logout", (req, res, next) => {
    req.session.destroy((err) => {
      if (err) { next(err); return; }
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
      res.json({ user: null });
      return;
    }
    const user = dbGetUserById(db, req.session.userId);
    res.json({ user: user ? mapUser(user) : null });
  });

  // ── Users ────────────────────────────────────────────────────────────────

  app.get("/api/users/:userId", (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const user = dbGetUserById(db, userId);
      if (!user) throw httpError(404, "User not found");
      res.json({ user: mapUser(user) });
    } catch (e) {
      next(e);
    }
  });

  // ── QQ Music proxy ───────────────────────────────────────────────────────

  app.get("/api/qq/search", async (req, res, next) => {
    try {
      const query = z
        .object({
          keyword: z.string().min(1),
          type: z.string().optional(),
          num: z.coerce.number().int().positive().max(50).optional(),
          page: z.coerce.number().int().positive().max(50).optional()
        })
        .parse(req.query);

      const payload = await qqSearch(qq, {
        keyword: query.keyword,
        type: query.type,
        num: query.num,
        page: query.page
      });

      res.json(payload);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/qq/song/url", async (req, res, next) => {
    try {
      const query = z
        .object({
          mid: z.string().min(1),
          quality: z.string().optional()
        })
        .parse(req.query);

      const payload = await qqSongUrl(qq, {
        mid: query.mid,
        quality: query.quality
      });

      res.json(payload);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/qq/song/cover", async (req, res, next) => {
    try {
      const query = z
        .object({
          mid: z.string().optional(),
          album_mid: z.string().optional(),
          size: z.coerce.number().int().optional()
        })
        .parse(req.query);

      const payload = await qqCover(qq, {
        mid: query.mid,
        album_mid: query.album_mid,
        size: query.size as 150 | 300 | 500 | 800 | undefined
      });

      res.json(payload);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/qq/cover-proxy", async (req, res, next) => {
    try {
      const query = z
        .object({
          album_mid: z.string().min(1).max(100)
        })
        .parse(req.query);

      const size = 300;
      const imgUrl = `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${query.album_mid}.jpg`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        const imgRes = await fetch(imgUrl, {
          headers: { "Referer": "https://y.qq.com/" },
          signal: controller.signal
        });

        clearTimeout(timer);

        if (!imgRes.ok) {
          res.status(404).send("Cover not found");
          return;
        }

        const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");

        const buf = await imgRes.arrayBuffer();
        res.send(Buffer.from(buf));
      } catch (fetchErr) {
        clearTimeout(timer);
        throw fetchErr;
      }
    } catch (e) {
      next(e);
    }
  });

  // ── Shares ───────────────────────────────────────────────────────────────

  app.post("/api/shares", requireAuth, (req, res, next) => {
    try {
      const body = z
        .object({
          songMid: z.string().min(1),
          songTitle: z.string().trim().min(1).max(200).optional().nullable(),
          songSubtitle: z.string().trim().max(200).optional().nullable(),
          singerName: z.string().trim().max(200).optional().nullable(),
          albumMid: z.string().trim().max(50).optional().nullable(),
          albumName: z.string().trim().max(200).optional().nullable(),
          coverUrl: z.string().url().max(500).optional().nullable(),
          comment: z.string().trim().max(200).optional().nullable()
        })
        .parse(req.body);

      const userId = req.session.userId!;

      const info = db.prepare(
        `INSERT INTO shares (user_id, song_mid, song_title, song_subtitle, singer_name, album_mid, album_name, cover_url, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        body.songMid,
        body.songTitle ?? null,
        body.songSubtitle ?? null,
        body.singerName ?? null,
        body.albumMid ?? null,
        body.albumName ?? null,
        body.coverUrl ?? null,
        body.comment ?? null
      );

      const row = dbGetShare(db, Number(info.lastInsertRowid));
      res.status(201).json({ share: mapShare(row!) });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/users/:userId/shares", (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const user = dbGetUserById(db, userId);
      if (!user) throw httpError(404, "User not found");
      res.json({ shares: dbUserShares(db, userId).map(mapShare) });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/shares/:shareId", requireAuth, (req, res, next) => {
    try {
      const shareId = parseIntParam(req.params.shareId);
      const share = dbGetShare(db, shareId);
      if (!share) throw httpError(404, "Share not found");
      if (share.user_id !== req.session.userId) throw httpError(403, "Forbidden");

      db.prepare("DELETE FROM shares WHERE id = ?").run(shareId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ── Home feed ────────────────────────────────────────────────────────────

  app.get("/api/home", (_req, res) => {
    const users = dbAllUsers(db);
    const shares = dbAllShares(db);

    const sharesByUser = new Map<number, ReturnType<typeof mapShare>[]>();
    for (const s of shares) {
      const arr = sharesByUser.get(s.user_id) ?? [];
      arr.push(mapShare(s));
      sharesByUser.set(s.user_id, arr);
    }

    res.json({
      users: users.map((u) => ({
        ...mapUser(u),
        shares: sharesByUser.get(u.id) ?? []
      }))
    });
  });

  // ── Playlist ─────────────────────────────────────────────────────────────

  app.get("/api/playlist", requireAuth, (req, res) => {
    const userId = req.session.userId!;
    const rows = dbUserPlaylist(db, userId);
    res.json({ songs: rows.map(mapPlaylist) });
  });

  app.post("/api/playlist", requireAuth, (req, res, next) => {
    try {
      const body = z
        .object({
          songMid: z.string().min(1),
          songTitle: z.string().trim().max(200).optional().nullable(),
          songSubtitle: z.string().trim().max(200).optional().nullable(),
          singerName: z.string().trim().max(200).optional().nullable(),
          albumMid: z.string().trim().max(50).optional().nullable(),
          albumName: z.string().trim().max(200).optional().nullable(),
          coverUrl: z.string().url().max(500).optional().nullable()
        })
        .parse(req.body);

      const userId = req.session.userId!;

      // upsert: if song already in playlist, just return it
      const existing = dbGetPlaylistEntry(db, userId, body.songMid);
      if (existing) {
        res.json({ song: mapPlaylist(existing) });
        return;
      }

      const info = db.prepare(
        `INSERT INTO playlist (user_id, song_mid, song_title, song_subtitle, singer_name, album_mid, album_name, cover_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        body.songMid,
        body.songTitle ?? null,
        body.songSubtitle ?? null,
        body.singerName ?? null,
        body.albumMid ?? null,
        body.albumName ?? null,
        body.coverUrl ?? null
      );

      const row = db.prepare("SELECT * FROM playlist WHERE id = ?").get(Number(info.lastInsertRowid)) as PlaylistRow;
      res.status(201).json({ song: mapPlaylist(row) });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/playlist/:songMid", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const { songMid } = req.params;
      const info = db.prepare("DELETE FROM playlist WHERE user_id = ? AND song_mid = ?").run(userId, songMid);
      if (info.changes === 0) throw httpError(404, "Song not in playlist");
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: {
          message: "Invalid request",
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
        }
      });
      return;
    }

    const e = err as Error & { status?: number };
    const status = typeof e.status === "number" ? e.status : 500;
    const message = status >= 500 ? "Internal Server Error" : e.message;
    res.status(status).json({ error: { message } });
  });

  return app;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

const env = getEnv();
const db = openDb(env.DATABASE_PATH);
const app = createApp(db, env.QQMUSIC_BASE_URL, env.CORS_ORIGIN, env.SESSION_SECRET, env.SECURE_COOKIE);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://127.0.0.1:${env.PORT}`);
});
