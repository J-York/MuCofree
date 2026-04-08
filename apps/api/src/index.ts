import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { getEnv } from "./env.js";
import { openDb, type Db } from "./db.js";
import { SQLiteSessionStore } from "./session-store.js";
import {
  createEmptyReactionCounts,
  reactionSchema,
  type ReactionCounts,
  type ReactionKey,
} from "./share-reactions.js";
import {
  createQqMusicClient,
  qqCover,
  qqSearch,
  qqSongUrl,
  qqTop
} from "./qqmusic.js";
import { basicSecurityHeaders, createAuthRateLimiter } from "./security.js";

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

type PlaylistVisibility = "private" | "link_readonly" | "link_collab";
type PlaylistRole = "owner" | "editor" | "viewer";
type PlaylistMemberStatus = "active" | "pending";
type PlaylistShareScope = "read" | "edit";

type PlaylistRow = {
  id: string;
  owner_user_id: number;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  revision: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type PlaylistItemRow = {
  id: number;
  playlist_id: string;
  song_mid: string;
  song_title: string | null;
  song_subtitle: string | null;
  singer_name: string | null;
  album_mid: string | null;
  album_name: string | null;
  cover_url: string | null;
  position: number;
  added_by_user_id: number;
  added_at: string;
};

type PlaylistMemberRow = {
  id: number;
  playlist_id: string;
  user_id: number;
  role: PlaylistRole;
  status: PlaylistMemberStatus;
  invited_by_user_id: number | null;
  joined_at: string;
  created_at: string;
};

type PlaylistShareLinkRow = {
  id: number;
  playlist_id: string;
  token_hash: string;
  scope: PlaylistShareScope;
  expires_at: string;
  max_uses: number | null;
  used_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by_user_id: number;
  created_at: string;
};

type PlaylistAccessRow = PlaylistRow & {
  member_role: PlaylistRole;
  member_status: PlaylistMemberStatus;
};

type PlaylistWithRoleRow = PlaylistRow & {
  member_role: PlaylistRole;
  member_status: PlaylistMemberStatus;
  item_count: number;
};


// ── Session augmentation ───────────────────────────────────────────────────

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

type DailyRecommendSong = {
  mid: string;
  title: string;
  subtitle: string;
  singerName: string;
  albumMid: string;
  albumName: string;
  coverUrl: string;
};

type DailyRecommendCacheEntry = {
  songs: DailyRecommendSong[];
  seedDate: string;
  sourceTopIds: number[];
  generatedAt: string;
  expiresAt: number;
};

const dailyRecommendCache = new Map<string, DailyRecommendCacheEntry>();
const DAILY_RECOMMEND_REFRESH_COOLDOWN_MS = 10_000;
const DAILY_RECOMMEND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_RECOMMEND_CACHE_MAX_ENTRIES = 2_000;

function dailyRecommendCacheKey(userId: number, seedDate: string) {
  return `${userId}:${seedDate}`;
}

function pruneDailyRecommendCache(now: number) {
  for (const [key, entry] of dailyRecommendCache) {
    if (entry.expiresAt <= now) {
      dailyRecommendCache.delete(key);
    }
  }

  while (dailyRecommendCache.size > DAILY_RECOMMEND_CACHE_MAX_ENTRIES) {
    const oldestKey = dailyRecommendCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    dailyRecommendCache.delete(oldestKey);
  }
}

function splitSingerNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[、,，/&·]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}
const SHARE_ALREADY_EXISTS_MESSAGE = "这首歌已经分享过了";

function isUniqueConstraintError(err: unknown, constraint: string) {
  if (!(err instanceof Error)) return false;

  const sqliteCode = (err as Error & { code?: unknown }).code;
  return (
    sqliteCode === "SQLITE_CONSTRAINT_UNIQUE" ||
    err.message.includes(`UNIQUE constraint failed: ${constraint}`)
  );
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

function mapShareWithReactions(
  row: ShareRow,
  reactionCounts: ReactionCounts,
  viewerReactionKey: ReactionKey | null,
) {
  return {
    ...mapShare(row),
    reactionCounts,
    viewerReactionKey,
  };
}

const DEFAULT_PLAYLIST_NAME = "我的收藏";
const DEFAULT_PLAYLIST_DESCRIPTION = "系统默认歌单";

const PLAYLIST_ROLE_LEVEL: Record<PlaylistRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function parsePlaylistIdParam(value: string): string {
  const playlistId = value.trim();
  if (!playlistId || playlistId.length > 128) {
    throw httpError(400, "Invalid playlist id");
  }
  return playlistId;
}

function isPlaylistRoleAllowed(actual: PlaylistRole, needed: PlaylistRole) {
  return PLAYLIST_ROLE_LEVEL[actual] >= PLAYLIST_ROLE_LEVEL[needed];
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createShareToken(): string {
  return randomBytes(32).toString("base64url");
}

function mapPlaylist(row: PlaylistRow) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    revision: row.revision,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapPlaylistItem(row: PlaylistItemRow) {
  return {
    id: row.id,
    playlistId: row.playlist_id,
    songMid: row.song_mid,
    songTitle: row.song_title,
    songSubtitle: row.song_subtitle,
    singerName: row.singer_name,
    albumMid: row.album_mid,
    albumName: row.album_name,
    coverUrl: row.cover_url,
    position: row.position,
    addedByUserId: row.added_by_user_id,
    addedAt: row.added_at,
  };
}

function mapPlaylistMember(row: PlaylistMemberRow) {
  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
  };
}

function mapPlaylistShareLink(row: PlaylistShareLinkRow) {
  return {
    id: row.id,
    playlistId: row.playlist_id,
    scope: row.scope,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
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

function dbGetUserShareBySongMid(db: Db, userId: number, songMid: string): ShareRow | undefined {
  return db.prepare("SELECT * FROM shares WHERE user_id = ? AND song_mid = ?").get(userId, songMid) as ShareRow | undefined;
}

function dbAllUsers(db: Db): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserRow[];
}

function dbAllShares(db: Db): ShareRow[] {
  return db.prepare("SELECT * FROM shares ORDER BY created_at DESC").all() as ShareRow[];
}

type FeedShareRow = ShareRow & {
  user_name: string;
  user_avatar_url: string | null;
};

function dbSharesFeed(db: Db, limit: number, cursor: number | null): FeedShareRow[] {
  const sql = cursor
    ? `SELECT s.*, u.name AS user_name, u.avatar_url AS user_avatar_url
       FROM shares s JOIN users u ON s.user_id = u.id
       WHERE s.id < ?
       ORDER BY s.id DESC LIMIT ?`
    : `SELECT s.*, u.name AS user_name, u.avatar_url AS user_avatar_url
       FROM shares s JOIN users u ON s.user_id = u.id
       ORDER BY s.id DESC LIMIT ?`;
  return cursor
    ? (db.prepare(sql).all(cursor, limit) as FeedShareRow[])
    : (db.prepare(sql).all(limit) as FeedShareRow[]);
}

type UserWithPreviewRow = UserRow & {
  share_count: number;
  latest_song_title: string | null;
  latest_singer_name: string | null;
  cover_urls: string | null;
};

function dbUsersWithPreview(db: Db, limit: number, offset: number): UserWithPreviewRow[] {
  return db.prepare(`
    SELECT
      u.*,
      COUNT(s.id) AS share_count,
      MAX(s.song_title) AS latest_song_title,
      (SELECT singer_name FROM shares WHERE user_id = u.id ORDER BY id DESC LIMIT 1) AS latest_singer_name,
      (
        SELECT GROUP_CONCAT(cover_url, '||')
        FROM (SELECT cover_url FROM shares WHERE user_id = u.id ORDER BY id DESC LIMIT 3)
      ) AS cover_urls
    FROM users u
    LEFT JOIN shares s ON s.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as UserWithPreviewRow[];
}

function dbUsersCount(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

function dbSharesCount(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM shares").get() as { n: number };
  return row.n;
}

function dbUserShares(db: Db, userId: number): ShareRow[] {
  return db.prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ShareRow[];
}

function dbGetDefaultPlaylist(db: Db, userId: number): PlaylistRow | undefined {
  return db.prepare(
    "SELECT * FROM playlists WHERE owner_user_id = ? AND is_default = 1 AND archived_at IS NULL LIMIT 1"
  ).get(userId) as PlaylistRow | undefined;
}

function dbGetPlaylistById(db: Db, playlistId: string): PlaylistRow | undefined {
  return db.prepare("SELECT * FROM playlists WHERE id = ? AND archived_at IS NULL").get(playlistId) as PlaylistRow | undefined;
}

function dbEnsureDefaultPlaylist(db: Db, userId: number): PlaylistRow {
  const existing = dbGetDefaultPlaylist(db, userId);
  if (existing) {
    db.prepare(
      `INSERT OR IGNORE INTO playlist_members (playlist_id, user_id, role, status, invited_by_user_id)
       VALUES (?, ?, 'owner', 'active', NULL)`
    ).run(existing.id, userId);
    return existing;
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

  const created = dbGetPlaylistById(db, playlistId);
  if (!created) throw httpError(500, "Failed to create default playlist");
  return created;
}

function dbGetPlaylistAccess(db: Db, userId: number, playlistId: string): PlaylistAccessRow | undefined {
  return db.prepare(
    `SELECT p.*, m.role AS member_role, m.status AS member_status
     FROM playlists p
     JOIN playlist_members m
       ON m.playlist_id = p.id
      AND m.user_id = ?
      AND m.status = 'active'
     WHERE p.id = ?
       AND p.archived_at IS NULL`
  ).get(userId, playlistId) as PlaylistAccessRow | undefined;
}

function authorizePlaylistAccess(
  db: Db,
  userId: number,
  playlistId: string,
  neededRole: PlaylistRole,
): PlaylistAccessRow {
  const access = dbGetPlaylistAccess(db, userId, playlistId);
  if (!access) throw httpError(404, "Playlist not found");
  if (!isPlaylistRoleAllowed(access.member_role, neededRole)) {
    throw httpError(403, "Forbidden");
  }
  return access;
}

function bumpPlaylistRevision(db: Db, playlistId: string, expectedRevision: number): number {
  const result = db.prepare(
    `UPDATE playlists
     SET revision = revision + 1,
         updated_at = datetime('now')
     WHERE id = ?
       AND revision = ?
       AND archived_at IS NULL`
  ).run(playlistId, expectedRevision);

  if (result.changes === 0) {
    throw httpError(409, "Playlist revision conflict");
  }

  const row = db.prepare("SELECT revision FROM playlists WHERE id = ?").get(playlistId) as { revision: number } | undefined;
  if (!row) throw httpError(404, "Playlist not found");
  return row.revision;
}

function assertShareLinkUsable(link: PlaylistShareLinkRow, nowMs: number) {
  if (link.revoked_at) throw httpError(410, "Share link revoked");

  const expiresAtMs = Date.parse(link.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw httpError(410, "Share link expired");
  }

  if (typeof link.max_uses === "number" && link.used_count >= link.max_uses) {
    throw httpError(410, "Share link exhausted");
  }
}

function dbListAccessiblePlaylists(
  db: Db,
  userId: number,
  limit: number,
  offset: number,
): PlaylistWithRoleRow[] {
  return db.prepare(
    `SELECT
       p.*,
       m.role AS member_role,
       m.status AS member_status,
       COUNT(pi.id) AS item_count
     FROM playlists p
     JOIN playlist_members m
       ON m.playlist_id = p.id
      AND m.user_id = ?
      AND m.status = 'active'
     LEFT JOIN playlist_items pi
       ON pi.playlist_id = p.id
     WHERE p.archived_at IS NULL
     GROUP BY
       p.id, p.owner_user_id, p.name, p.description, p.visibility, p.revision, p.is_default, p.created_at, p.updated_at, p.archived_at,
       m.role, m.status
     ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
     LIMIT ? OFFSET ?`
  ).all(userId, limit, offset) as PlaylistWithRoleRow[];
}

function dbCountAccessiblePlaylists(db: Db, userId: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS n
     FROM playlists p
     JOIN playlist_members m
       ON m.playlist_id = p.id
      AND m.user_id = ?
      AND m.status = 'active'
     WHERE p.archived_at IS NULL`
  ).get(userId) as { n: number };

  return row.n;
}

function dbPlaylistItems(db: Db, playlistId: string, limit: number, offset: number): PlaylistItemRow[] {
  return db.prepare(
    `SELECT *
     FROM playlist_items
     WHERE playlist_id = ?
     ORDER BY position ASC
     LIMIT ? OFFSET ?`
  ).all(playlistId, limit, offset) as PlaylistItemRow[];
}

function dbPlaylistItemsCount(db: Db, playlistId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?").get(playlistId) as { n: number };
  return row.n;
}

function dbPlaylistMembers(db: Db, playlistId: string): PlaylistMemberRow[] {
  return db.prepare(
    `SELECT *
     FROM playlist_members
     WHERE playlist_id = ?
     ORDER BY
       CASE role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END DESC,
       user_id ASC`
  ).all(playlistId) as PlaylistMemberRow[];
}

function dbGetPlaylistShareLinkByToken(db: Db, token: string): PlaylistShareLinkRow | undefined {
  const tokenHash = hashShareToken(token);
  return db.prepare("SELECT * FROM playlist_share_links WHERE token_hash = ?").get(tokenHash) as PlaylistShareLinkRow | undefined;
}

type ShareReactionCountRow = {
  share_id: number;
  reaction_key: ReactionKey;
  reaction_count: number;
};

type ViewerShareReactionRow = {
  share_id: number;
  reaction_key: ReactionKey;
};

function sqlPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function dbShareReactionState(db: Db, shareIds: number[], viewerUserId?: number) {
  const reactionCountsByShareId = new Map<number, ReactionCounts>();
  const viewerReactionKeyByShareId = new Map<number, ReactionKey | null>();

  for (const shareId of shareIds) {
    reactionCountsByShareId.set(shareId, createEmptyReactionCounts());
    viewerReactionKeyByShareId.set(shareId, null);
  }

  if (shareIds.length === 0) {
    return { reactionCountsByShareId, viewerReactionKeyByShareId };
  }

  const placeholders = sqlPlaceholders(shareIds.length);
  const reactionCountRows = db.prepare(
    `SELECT share_id, reaction_key, COUNT(*) AS reaction_count
     FROM share_reactions
     WHERE share_id IN (${placeholders})
     GROUP BY share_id, reaction_key`,
  ).all(...shareIds) as ShareReactionCountRow[];

  for (const row of reactionCountRows) {
    const reactionCounts = reactionCountsByShareId.get(row.share_id);
    if (!reactionCounts) continue;
    reactionCounts[row.reaction_key] = row.reaction_count;
  }

  if (viewerUserId !== undefined) {
    const viewerReactionRows = db.prepare(
      `SELECT share_id, reaction_key
       FROM share_reactions
       WHERE user_id = ? AND share_id IN (${placeholders})`,
    ).all(viewerUserId, ...shareIds) as ViewerShareReactionRow[];

    for (const row of viewerReactionRows) {
      viewerReactionKeyByShareId.set(row.share_id, row.reaction_key);
    }
  }

  return { reactionCountsByShareId, viewerReactionKeyByShareId };
}

// ── App factory ────────────────────────────────────────────────────────────

export function createApp(db: Db, qqBaseUrl: string, corsOrigin: string, sessionSecret: string, secureCookie: boolean, trustProxy: boolean) {
  const qq = createQqMusicClient(qqBaseUrl);
  const authRateLimiter = createAuthRateLimiter();

  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);

  app.use(basicSecurityHeaders);
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

  app.post("/api/auth/register", authRateLimiter, async (req, res, next) => {
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
      if (!user) throw httpError(500, "Failed to create user");
      dbEnsureDefaultPlaylist(db, user.id);
      req.session.userId = user.id;

      res.status(201).json({ user: mapUser(user) });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/auth/login", authRateLimiter, async (req, res, next) => {
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
          keyword: z.string().min(1).max(100),
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

  app.get("/api/qq/song/url", requireAuth, async (req, res, next) => {
    try {
      const query = z
        .object({
          mid: z.string().min(1).max(50),
          quality: z.enum(["128", "320", "flac"]).optional()
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
          album_mid: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
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
          coverUrl: z.string().max(500).optional().nullable(),
          comment: z.string().trim().max(200).optional().nullable()
        })
        .parse(req.body);

      const userId = req.session.userId!;
      const existingShare = dbGetUserShareBySongMid(db, userId, body.songMid);
      if (existingShare) throw httpError(409, SHARE_ALREADY_EXISTS_MESSAGE);

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
      if (isUniqueConstraintError(e, "shares.user_id, shares.song_mid")) {
        next(httpError(409, SHARE_ALREADY_EXISTS_MESSAGE));
        return;
      }
      next(e);
    }
  });

  app.get("/api/users/:userId/shares", (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.userId);
      const user = dbGetUserById(db, userId);
      if (!user) throw httpError(404, "User not found");
      const rows = dbUserShares(db, userId);
      const shareIds = rows.map((row) => row.id);
      const { reactionCountsByShareId, viewerReactionKeyByShareId } = dbShareReactionState(
        db,
        shareIds,
        req.session.userId,
      );

      res.json({
        shares: rows.map((row) =>
          mapShareWithReactions(
            row,
            reactionCountsByShareId.get(row.id) ?? createEmptyReactionCounts(),
            viewerReactionKeyByShareId.get(row.id) ?? null,
          ),
        ),
      });
    } catch (e) {
      next(e);
    }
  });

  app.put("/api/shares/:shareId/reaction", requireAuth, (req, res, next) => {
    try {
      const shareId = parseIntParam(req.params.shareId);
      const body = z.object({ reactionKey: reactionSchema }).parse(req.body);
      const share = dbGetShare(db, shareId);
      if (!share) throw httpError(404, "Share not found");
      if (share.user_id === req.session.userId) throw httpError(403, "Forbidden");

      db.prepare(
        `INSERT INTO share_reactions (share_id, user_id, reaction_key)
         VALUES (?, ?, ?)
         ON CONFLICT(share_id, user_id) DO UPDATE SET
           reaction_key = excluded.reaction_key,
           updated_at = datetime('now')`,
      ).run(shareId, req.session.userId, body.reactionKey);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/shares/:shareId/reaction", requireAuth, (req, res, next) => {
    try {
      const shareId = parseIntParam(req.params.shareId);
      const share = dbGetShare(db, shareId);
      if (!share) throw httpError(404, "Share not found");
      if (share.user_id === req.session.userId) throw httpError(403, "Forbidden");

      db.prepare("DELETE FROM share_reactions WHERE share_id = ? AND user_id = ?").run(
        shareId,
        req.session.userId,
      );

      res.json({ ok: true });
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

  // ── Shares feed (paginated) ───────────────────────────────────────────────

  app.get("/api/shares/feed", (req, res, next) => {
    try {
      const query = z
        .object({
          limit: z.coerce.number().int().positive().max(50).default(20),
          cursor: z.coerce.number().int().positive().optional()
        })
        .parse(req.query);

      const rows = dbSharesFeed(db, query.limit, query.cursor ?? null);
      const shareIds = rows.map((row) => row.id);
      const { reactionCountsByShareId, viewerReactionKeyByShareId } = dbShareReactionState(
        db,
        shareIds,
        req.session.userId,
      );
      const items = rows.map((row) => ({
        ...mapShareWithReactions(
          row,
          reactionCountsByShareId.get(row.id) ?? createEmptyReactionCounts(),
          viewerReactionKeyByShareId.get(row.id) ?? null,
        ),
        userName: row.user_name,
        userAvatarUrl: row.user_avatar_url
      }));

      const nextCursor = rows.length === query.limit ? rows[rows.length - 1]!.id : null;

      res.json({ items, nextCursor });
    } catch (e) {
      next(e);
    }
  });

  // ── Users list (paginated) ────────────────────────────────────────────────

  app.get("/api/users", (req, res, next) => {
    try {
      const query = z
        .object({
          limit: z.coerce.number().int().positive().max(50).default(20),
          offset: z.coerce.number().int().min(0).default(0)
        })
        .parse(req.query);

      const rows = dbUsersWithPreview(db, query.limit, query.offset);
      const total = dbUsersCount(db);
      const totalShares = dbSharesCount(db);

      const users = rows.map((row) => ({
        ...mapUser(row),
        shareCount: row.share_count,
        latestSongTitle: row.latest_song_title,
        latestSingerName: row.latest_singer_name,
        recentCoverUrls: row.cover_urls
          ? row.cover_urls.split("||").filter(Boolean)
          : []
      }));

      res.json({ users, total, totalShares });
    } catch (e) {
      next(e);
    }
  });

  // ── Playlists ──────────────────────────────────────────────────────────────

  app.get("/api/playlists", requireAuth, (req, res, next) => {
    try {
      const query = z
        .object({
          limit: z.coerce.number().int().positive().max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);

      const userId = req.session.userId!;
      dbEnsureDefaultPlaylist(db, userId);

      const rows = dbListAccessiblePlaylists(db, userId, query.limit, query.offset);
      const total = dbCountAccessiblePlaylists(db, userId);
      const nextOffset = query.offset + rows.length < total ? query.offset + rows.length : null;

      res.json({
        items: rows.map((row) => ({
          ...mapPlaylist(row),
          role: row.member_role,
          status: row.member_status,
          itemCount: row.item_count,
        })),
        total,
        nextOffset,
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/playlists", requireAuth, (req, res, next) => {
    try {
      const body = z
        .object({
          name: z.string().trim().min(1).max(100),
          description: z.string().trim().max(500).optional().nullable(),
          visibility: z.enum(["private", "link_readonly", "link_collab"]).optional(),
        })
        .parse(req.body);

      const userId = req.session.userId!;
      const createPlaylist = db.transaction(() => {
        const playlistId = randomUUID();
        db.prepare(
          `INSERT INTO playlists (id, owner_user_id, name, description, visibility, revision, is_default)
           VALUES (?, ?, ?, ?, ?, 1, 0)`
        ).run(
          playlistId,
          userId,
          body.name,
          body.description ?? null,
          body.visibility ?? "private",
        );

        db.prepare(
          `INSERT INTO playlist_members (playlist_id, user_id, role, status, invited_by_user_id)
           VALUES (?, ?, 'owner', 'active', NULL)`
        ).run(playlistId, userId);

        const created = dbGetPlaylistById(db, playlistId);
        if (!created) throw httpError(500, "Failed to create playlist");
        return created;
      });

      const playlist = createPlaylist();
      res.status(201).json({
        playlist: {
          ...mapPlaylist(playlist),
          role: "owner" as PlaylistRole,
          status: "active" as PlaylistMemberStatus,
          itemCount: 0,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/playlists/:playlistId", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const access = authorizePlaylistAccess(db, userId, playlistId, "viewer");
      const members = dbPlaylistMembers(db, playlistId);
      const itemCount = dbPlaylistItemsCount(db, playlistId);

      res.json({
        playlist: {
          ...mapPlaylist(access),
          role: access.member_role,
          status: access.member_status,
          itemCount,
        },
        members: members.map(mapPlaylistMember),
      });
    } catch (e) {
      next(e);
    }
  });

  app.patch("/api/playlists/:playlistId", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const body = z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          description: z.string().trim().max(500).optional().nullable(),
          visibility: z.enum(["private", "link_readonly", "link_collab"]).optional(),
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.body);

      const access = authorizePlaylistAccess(db, userId, playlistId, "owner");

      const updatePlaylist = db.transaction(() => {
        db.prepare(
          `UPDATE playlists
           SET name = ?,
               description = ?,
               visibility = ?
           WHERE id = ?
             AND archived_at IS NULL`
        ).run(
          body.name ?? access.name,
          body.description === undefined ? access.description : body.description,
          body.visibility ?? access.visibility,
          playlistId,
        );

        const revision = bumpPlaylistRevision(db, playlistId, body.expectedRevision);
        const updated = dbGetPlaylistById(db, playlistId);
        if (!updated) throw httpError(404, "Playlist not found");
        return { updated, revision };
      });

      const { updated, revision } = updatePlaylist();
      res.json({
        playlist: {
          ...mapPlaylist(updated),
          role: access.member_role,
          status: access.member_status,
          revision,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/playlists/:playlistId", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const query = z
        .object({
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.query);

      const access = authorizePlaylistAccess(db, userId, playlistId, "owner");
      if (access.is_default === 1) {
        throw httpError(400, "Default playlist cannot be archived");
      }

      const archivePlaylist = db.transaction(() => {
        const result = db.prepare(
          `UPDATE playlists
           SET archived_at = datetime('now'),
               updated_at = datetime('now'),
               revision = revision + 1
           WHERE id = ?
             AND revision = ?
             AND archived_at IS NULL`
        ).run(playlistId, query.expectedRevision);

        if (result.changes === 0) {
          throw httpError(409, "Playlist revision conflict");
        }

        db.prepare(
          `UPDATE playlist_share_links
           SET revoked_at = COALESCE(revoked_at, datetime('now'))
           WHERE playlist_id = ?`
        ).run(playlistId);
      });

      archivePlaylist();
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/playlists/:playlistId/items", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const query = z
        .object({
          limit: z.coerce.number().int().positive().max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);

      const access = authorizePlaylistAccess(db, userId, playlistId, "viewer");
      const rows = dbPlaylistItems(db, playlistId, query.limit, query.offset);
      const total = dbPlaylistItemsCount(db, playlistId);
      const nextOffset = query.offset + rows.length < total ? query.offset + rows.length : null;

      res.json({
        items: rows.map(mapPlaylistItem),
        total,
        nextOffset,
        revision: access.revision,
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/playlists/:playlistId/items", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const body = z
        .object({
          songMid: z.string().trim().min(1).max(100),
          songTitle: z.string().trim().max(200).optional().nullable(),
          songSubtitle: z.string().trim().max(200).optional().nullable(),
          singerName: z.string().trim().max(200).optional().nullable(),
          albumMid: z.string().trim().max(50).optional().nullable(),
          albumName: z.string().trim().max(200).optional().nullable(),
          coverUrl: z.string().max(500).optional().nullable(),
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.body);

      authorizePlaylistAccess(db, userId, playlistId, "editor");

      const addItem = db.transaction(() => {
        const nextPositionRow = db.prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM playlist_items WHERE playlist_id = ?"
        ).get(playlistId) as { next_position: number };

        const insertResult = db.prepare(
          `INSERT INTO playlist_items (
             playlist_id,
             song_mid,
             song_title,
             song_subtitle,
             singer_name,
             album_mid,
             album_name,
             cover_url,
             position,
             added_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          playlistId,
          body.songMid,
          body.songTitle ?? null,
          body.songSubtitle ?? null,
          body.singerName ?? null,
          body.albumMid ?? null,
          body.albumName ?? null,
          body.coverUrl ?? null,
          nextPositionRow.next_position,
          userId,
        );

        const revision = bumpPlaylistRevision(db, playlistId, body.expectedRevision);
        const created = db.prepare("SELECT * FROM playlist_items WHERE id = ?").get(Number(insertResult.lastInsertRowid)) as PlaylistItemRow | undefined;
        if (!created) throw httpError(500, "Failed to create playlist item");
        return { created, revision };
      });

      const { created, revision } = addItem();
      res.status(201).json({ item: mapPlaylistItem(created), revision });
    } catch (e) {
      if (isUniqueConstraintError(e, "playlist_items.playlist_id, playlist_items.song_mid")) {
        next(httpError(409, "Song already exists in playlist"));
        return;
      }
      next(e);
    }
  });

  app.delete("/api/playlists/:playlistId/items/:songMid", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const songMid = z.string().trim().min(1).max(100).parse(req.params.songMid);
      const query = z
        .object({
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.query);

      authorizePlaylistAccess(db, userId, playlistId, "editor");

      const removeItem = db.transaction(() => {
        const existing = db.prepare(
          "SELECT id, position FROM playlist_items WHERE playlist_id = ? AND song_mid = ?"
        ).get(playlistId, songMid) as { id: number; position: number } | undefined;

        if (!existing) throw httpError(404, "Playlist item not found");

        db.prepare("DELETE FROM playlist_items WHERE id = ?").run(existing.id);
        db.prepare(
          `UPDATE playlist_items
           SET position = position - 1
           WHERE playlist_id = ?
             AND position > ?`
        ).run(playlistId, existing.position);

        const revision = bumpPlaylistRevision(db, playlistId, query.expectedRevision);
        return revision;
      });

      const revision = removeItem();
      res.json({ ok: true, revision });
    } catch (e) {
      next(e);
    }
  });

  app.patch("/api/playlists/:playlistId/items/reorder", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const body = z
        .object({
          songMids: z.array(z.string().trim().min(1).max(100)).min(1),
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.body);

      authorizePlaylistAccess(db, userId, playlistId, "editor");

      const reorderItems = db.transaction(() => {
        const currentRows = db.prepare(
          "SELECT song_mid, position FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC"
        ).all(playlistId) as Array<{ song_mid: string; position: number }>;

        if (currentRows.length !== body.songMids.length) {
          throw httpError(400, "Reorder payload does not match playlist items");
        }

        const existingSet = new Set(currentRows.map((row) => row.song_mid));
        const requestedSet = new Set(body.songMids);
        if (requestedSet.size !== body.songMids.length) {
          throw httpError(400, "Reorder payload contains duplicate songs");
        }

        for (const songMid of requestedSet) {
          if (!existingSet.has(songMid)) {
            throw httpError(400, "Reorder payload contains unknown song");
          }
        }

        db.prepare(
          "UPDATE playlist_items SET position = position + 1000000 WHERE playlist_id = ?"
        ).run(playlistId);

        const updatePosition = db.prepare(
          "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND song_mid = ?"
        );
        body.songMids.forEach((songMid, index) => {
          updatePosition.run(index, playlistId, songMid);
        });

        const revision = bumpPlaylistRevision(db, playlistId, body.expectedRevision);
        return revision;
      });

      const revision = reorderItems();
      const items = dbPlaylistItems(db, playlistId, 5000, 0);
      res.json({ items: items.map(mapPlaylistItem), revision });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/playlists/:playlistId/share-links", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const body = z
        .object({
          scope: z.enum(["read", "edit"]).default("read"),
          expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72),
          maxUses: z.coerce.number().int().min(1).max(100000).optional().nullable(),
        })
        .parse(req.body);

      authorizePlaylistAccess(db, userId, playlistId, "owner");

      const createLink = db.transaction(() => {
        const token = createShareToken();
        const tokenHash = hashShareToken(token);
        const expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000).toISOString();

        const result = db.prepare(
          `INSERT INTO playlist_share_links (playlist_id, token_hash, scope, expires_at, max_uses, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          playlistId,
          tokenHash,
          body.scope,
          expiresAt,
          body.maxUses ?? null,
          userId,
        );

        const link = db.prepare("SELECT * FROM playlist_share_links WHERE id = ?").get(Number(result.lastInsertRowid)) as PlaylistShareLinkRow | undefined;
        if (!link) throw httpError(500, "Failed to create share link");
        return { link, token };
      });

      const { link, token } = createLink();
      res.status(201).json({
        link: mapPlaylistShareLink(link),
        token,
        sharePath: `/playlist/share/${encodeURIComponent(token)}`,
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/playlists/share/:token", requireAuth, (req, res, next) => {
    try {
      const token = z.string().trim().min(16).max(200).parse(req.params.token);
      const link = dbGetPlaylistShareLinkByToken(db, token);
      if (!link) throw httpError(404, "Share link not found");
      assertShareLinkUsable(link, Date.now());

      const playlist = dbGetPlaylistById(db, link.playlist_id);
      if (!playlist) throw httpError(404, "Playlist not found");

      const userId = req.session.userId!;
      const membership = db.prepare(
        "SELECT * FROM playlist_members WHERE playlist_id = ? AND user_id = ?"
      ).get(link.playlist_id, userId) as PlaylistMemberRow | undefined;

      const canRead = Boolean(
        membership &&
        membership.status === "active" &&
        isPlaylistRoleAllowed(membership.role, "viewer")
      );
      const canEdit = Boolean(
        membership &&
        membership.status === "active" &&
        isPlaylistRoleAllowed(membership.role, "editor")
      );

      res.json({
        link: mapPlaylistShareLink(link),
        playlist: mapPlaylist(playlist),
        membership: membership ? mapPlaylistMember(membership) : null,
        canRead,
        canEdit,
        requiresJoin: !canRead,
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/playlists/share/:token/join", requireAuth, (req, res, next) => {
    try {
      const token = z.string().trim().min(16).max(200).parse(req.params.token);
      const userId = req.session.userId!;

      const joinByLink = db.transaction(() => {
        const link = dbGetPlaylistShareLinkByToken(db, token);
        if (!link) throw httpError(404, "Share link not found");
        assertShareLinkUsable(link, Date.now());

        const playlist = dbGetPlaylistById(db, link.playlist_id);
        if (!playlist) throw httpError(404, "Playlist not found");

        const existing = db.prepare(
          "SELECT * FROM playlist_members WHERE playlist_id = ? AND user_id = ?"
        ).get(link.playlist_id, userId) as PlaylistMemberRow | undefined;

        let nextRole: PlaylistRole = "viewer";
        let nextStatus: PlaylistMemberStatus = "active";

        if (existing?.role === "owner") {
          nextRole = "owner";
          nextStatus = "active";
        } else if (link.scope === "edit") {
          nextRole = "editor";
          nextStatus = existing?.role === "editor" && existing.status === "active"
            ? "active"
            : "pending";
        } else if (existing?.role === "editor") {
          nextRole = "editor";
          nextStatus = "active";
        }

        if (existing) {
          db.prepare(
            `UPDATE playlist_members
             SET role = ?,
                 status = ?,
                 invited_by_user_id = COALESCE(invited_by_user_id, ?),
                 joined_at = CASE WHEN ? = 'active' THEN datetime('now') ELSE joined_at END
             WHERE id = ?`
          ).run(nextRole, nextStatus, link.created_by_user_id, nextStatus, existing.id);
        } else {
          db.prepare(
            `INSERT INTO playlist_members (playlist_id, user_id, role, status, invited_by_user_id)
             VALUES (?, ?, ?, ?, ?)`
          ).run(link.playlist_id, userId, nextRole, nextStatus, link.created_by_user_id);
        }

        db.prepare(
          `UPDATE playlist_share_links
           SET used_count = used_count + 1,
               last_used_at = datetime('now')
           WHERE id = ?`
        ).run(link.id);

        db.prepare(
          `UPDATE playlists
           SET revision = revision + 1,
               updated_at = datetime('now')
           WHERE id = ?
             AND archived_at IS NULL`
        ).run(link.playlist_id);

        const membership = db.prepare(
          "SELECT * FROM playlist_members WHERE playlist_id = ? AND user_id = ?"
        ).get(link.playlist_id, userId) as PlaylistMemberRow | undefined;
        if (!membership) throw httpError(500, "Failed to join playlist");

        const updatedPlaylist = dbGetPlaylistById(db, link.playlist_id);
        if (!updatedPlaylist) throw httpError(404, "Playlist not found");

        const refreshedLink = db.prepare("SELECT * FROM playlist_share_links WHERE id = ?").get(link.id) as PlaylistShareLinkRow | undefined;
        if (!refreshedLink) throw httpError(404, "Share link not found");

        return { membership, updatedPlaylist, refreshedLink };
      });

      const { membership, updatedPlaylist, refreshedLink } = joinByLink();
      res.json({
        playlist: mapPlaylist(updatedPlaylist),
        membership: mapPlaylistMember(membership),
        link: mapPlaylistShareLink(refreshedLink),
      });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/playlists/share-links/:linkId", requireAuth, (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const linkId = parseIntParam(req.params.linkId);
      const link = db.prepare("SELECT * FROM playlist_share_links WHERE id = ?").get(linkId) as PlaylistShareLinkRow | undefined;
      if (!link) throw httpError(404, "Share link not found");

      authorizePlaylistAccess(db, userId, link.playlist_id, "owner");

      db.prepare(
        `UPDATE playlist_share_links
         SET revoked_at = COALESCE(revoked_at, datetime('now'))
         WHERE id = ?`
      ).run(linkId);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.patch("/api/playlists/:playlistId/members/:userId", requireAuth, (req, res, next) => {
    try {
      const ownerUserId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const targetUserId = parseIntParam(req.params.userId);
      const body = z
        .object({
          role: z.enum(["editor", "viewer"]),
          status: z.enum(["active", "pending"]).default("active"),
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.body);

      const access = authorizePlaylistAccess(db, ownerUserId, playlistId, "owner");
      if (targetUserId === access.owner_user_id) {
        throw httpError(400, "Owner role cannot be changed");
      }

      const updateMember = db.transaction(() => {
        const existing = db.prepare(
          "SELECT * FROM playlist_members WHERE playlist_id = ? AND user_id = ?"
        ).get(playlistId, targetUserId) as PlaylistMemberRow | undefined;
        if (!existing) throw httpError(404, "Member not found");
        if (existing.role === "owner") throw httpError(400, "Owner role cannot be changed");

        db.prepare(
          `UPDATE playlist_members
           SET role = ?,
               status = ?
           WHERE id = ?`
        ).run(body.role, body.status, existing.id);

        const revision = bumpPlaylistRevision(db, playlistId, body.expectedRevision);
        const updated = db.prepare("SELECT * FROM playlist_members WHERE id = ?").get(existing.id) as PlaylistMemberRow | undefined;
        if (!updated) throw httpError(404, "Member not found");
        return { updated, revision };
      });

      const { updated, revision } = updateMember();
      res.json({ member: mapPlaylistMember(updated), revision });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/api/playlists/:playlistId/members/:userId", requireAuth, (req, res, next) => {
    try {
      const ownerUserId = req.session.userId!;
      const playlistId = parsePlaylistIdParam(req.params.playlistId);
      const targetUserId = parseIntParam(req.params.userId);
      const query = z
        .object({
          expectedRevision: z.coerce.number().int().min(1),
        })
        .parse(req.query);

      const access = authorizePlaylistAccess(db, ownerUserId, playlistId, "owner");
      if (targetUserId === access.owner_user_id) {
        throw httpError(400, "Owner cannot be removed");
      }

      const removeMember = db.transaction(() => {
        const existing = db.prepare(
          "SELECT * FROM playlist_members WHERE playlist_id = ? AND user_id = ?"
        ).get(playlistId, targetUserId) as PlaylistMemberRow | undefined;
        if (!existing) throw httpError(404, "Member not found");
        if (existing.role === "owner") throw httpError(400, "Owner cannot be removed");

        db.prepare("DELETE FROM playlist_members WHERE id = ?").run(existing.id);
        const revision = bumpPlaylistRevision(db, playlistId, query.expectedRevision);
        return revision;
      });

      const revision = removeMember();
      res.json({ ok: true, revision });
    } catch (e) {
      next(e);
    }
  });

  // ── Daily recommend ───────────────────────────────────────────────────────

  app.get("/api/recommend/daily", requireAuth, async (req, res, next) => {
    try {
      const userId = req.session.userId!;
      const now = Date.now();
      pruneDailyRecommendCache(now);
      const today = new Date(now).toISOString().slice(0, 10);
      const cacheKey = dailyRecommendCacheKey(userId, today);
      const forceRefresh = req.query.refresh === "1";
      const cached = dailyRecommendCache.get(cacheKey);
      const hasFreshCache = Boolean(cached && cached.expiresAt > now);

      if (hasFreshCache && !forceRefresh) {
        res.json(cached);
        return;
      }

      if (forceRefresh && cached) {
        const ageMs = now - Date.parse(cached.generatedAt);
        if (Number.isFinite(ageMs) && ageMs < DAILY_RECOMMEND_REFRESH_COOLDOWN_MS) {
          throw httpError(429, "刷新过于频繁，请稍后再试");
        }
      }

      function makeSeed(uid: number, date: string): number {
        let h = 0;
        const str = `${uid}:${date}`;
        for (let i = 0; i < str.length; i++) {
          h = Math.imul(31, h) + str.charCodeAt(i) | 0;
        }
        return Math.abs(h);
      }

      function seededRand(seed: number, index: number): number {
        let s = seed ^ (index * 2654435761);
        s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
        s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
        s = (s ^ (s >>> 16)) >>> 0;
        return s / 0x100000000;
      }

      function seededShuffle<T>(arr: T[], seed: number): T[] {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(seededRand(seed, i) * (i + 1));
          [a[i], a[j]] = [a[j]!, a[i]!];
        }
        return a;
      }

      type NormalizedSong = DailyRecommendSong;

      function normalizeFromSongInfo(item: any): NormalizedSong | null {
        const mid = typeof item?.mid === "string" ? item.mid.trim() : "";
        const title = typeof item?.title === "string" ? item.title.trim() : typeof item?.name === "string" ? item.name.trim() : "";
        if (!mid || !title) return null;
        const singers: any[] = Array.isArray(item?.singer) ? item.singer : [];
        const singerName = singers.map((s: any) => s?.name || "").filter(Boolean).join(", ");
        const albumMid = typeof item?.album?.mid === "string" ? item.album.mid : "";
        const albumName = typeof item?.album?.name === "string"
          ? item.album.name
          : typeof item?.album?.title === "string"
            ? item.album.title
            : "";
        const coverUrl = albumMid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
          : "";
        return {
          mid,
          title,
          subtitle: typeof item?.subtitle === "string" ? item.subtitle : "",
          singerName,
          albumMid,
          albumName,
          coverUrl
        };
      }

      function normalizeFromTopSong(item: any): NormalizedSong | null {
        const mid = typeof item?.mid === "string"
          ? item.mid.trim()
          : typeof item?.songMid === "string"
            ? item.songMid.trim()
            : typeof item?.songInfo?.mid === "string"
              ? item.songInfo.mid.trim()
              : "";
        const title = typeof item?.title === "string"
          ? item.title.trim()
          : typeof item?.name === "string"
            ? item.name.trim()
            : typeof item?.songName === "string"
              ? item.songName.trim()
              : "";
        if (!mid || !title) return null;
        const singers = Array.isArray(item?.singer)
          ? item.singer
          : Array.isArray(item?.singerName)
            ? item.singerName
            : Array.isArray(item?.songInfo?.singer)
              ? item.songInfo.singer
              : [];
        const singerName = singers
          .map((s: any) => typeof s === "string" ? s : s?.name || "")
          .filter(Boolean)
          .join(", ");
        const albumMid = typeof item?.albumMid === "string"
          ? item.albumMid
          : typeof item?.album?.mid === "string"
            ? item.album.mid
            : typeof item?.songInfo?.album?.mid === "string"
              ? item.songInfo.album.mid
              : "";
        const albumName = typeof item?.albumName === "string"
          ? item.albumName
          : typeof item?.album?.name === "string"
            ? item.album.name
            : typeof item?.songInfo?.album?.name === "string"
              ? item.songInfo.album.name
              : "";
        const coverUrl = albumMid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}_1.jpg`
          : "";
        return {
          mid,
          title,
          subtitle: typeof item?.subtitle === "string"
            ? item.subtitle
            : typeof item?.songInfo?.subtitle === "string"
              ? item.songInfo.subtitle
              : "",
          singerName,
          albumMid,
          albumName,
          coverUrl
        };
      }

      const seedSalt = forceRefresh ? Math.floor(now / DAILY_RECOMMEND_REFRESH_COOLDOWN_MS) : 0;
      const seed = makeSeed(userId, `${today}:${seedSalt}`);
      const recommendCount = 20;
      const topsToUse = 3;
      const songsPerTop = 20;
      const maxExtraTops = 1;

      const catalogPayload = await qqTop(qq) as any;
      const groups: any[] = Array.isArray(catalogPayload?.data?.group) ? catalogPayload.data.group : [];
      const allTopIds: number[] = [];
      for (const group of groups) {
        const toplist: any[] = Array.isArray(group?.toplist) ? group.toplist : [];
        for (const top of toplist) {
          if (typeof top?.topId === "number") allTopIds.push(top.topId);
        }
      }

      if (allTopIds.length === 0) {
        const payload: DailyRecommendCacheEntry = {
          songs: [],
          seedDate: today,
          sourceTopIds: [],
          generatedAt: new Date(now).toISOString(),
          expiresAt: now + DAILY_RECOMMEND_CACHE_TTL_MS
        };
        dailyRecommendCache.set(cacheKey, payload);
        pruneDailyRecommendCache(now);
        res.json(payload);
        return;
      }

      const userPlaylistItems = db.prepare(
        `SELECT pi.song_mid, pi.singer_name
         FROM playlist_items pi
         JOIN playlists p
           ON p.id = pi.playlist_id
         WHERE p.owner_user_id = ?
           AND p.archived_at IS NULL`
      ).all(userId) as Array<{ song_mid: string; singer_name: string | null }>;
      const userShares = dbUserShares(db, userId);
      const ownedMids = new Set<string>([
        ...userPlaylistItems.map((song) => song.song_mid),
        ...userShares.map((song) => song.song_mid),
      ]);

      const singerCounts = new Map<string, number>();
      const countSinger = (name: string | null, weight: number) => {
        for (const singer of splitSingerNames(name)) {
          singerCounts.set(singer, (singerCounts.get(singer) ?? 0) + weight);
        }
      };
      userPlaylistItems.forEach((song) => countSinger(song.singer_name, 1));
      userShares.forEach((song) => countSinger(song.singer_name, 2));

      const shuffledTopIds = seededShuffle([...new Set(allTopIds)], seed);
      const selectedTopIds = shuffledTopIds.slice(0, topsToUse);
      const sourceTopIds = [...selectedTopIds];
      const candidateSongs: NormalizedSong[] = [];
      const fetchedTopIds = new Set<number>();

      async function appendTopCandidates(topIds: number[]) {
        const pendingIds = topIds.filter((id) => !fetchedTopIds.has(id));
        if (!pendingIds.length) return;
        const topResults = await Promise.allSettled(
          pendingIds.map((id) => qqTop(qq, { id, num: songsPerTop }))
        );
        topResults.forEach((result, index) => {
          const topId = pendingIds[index]!;
          fetchedTopIds.add(topId);
          if (result.status !== "fulfilled") return;
          const payload = result.value as any;
          const songInfoList: any[] = Array.isArray(payload?.data?.songInfoList) ? payload.data.songInfoList : [];
          const fallbackSongList: any[] = Array.isArray(payload?.data?.songList)
            ? payload.data.songList
            : Array.isArray(payload?.data?.song)
              ? payload.data.song
              : [];
          const normalizedSongs = songInfoList.length
            ? songInfoList.map((item) => normalizeFromSongInfo(item))
            : fallbackSongList.map((item) => normalizeFromTopSong(item));
          for (const song of normalizedSongs) {
            if (song) candidateSongs.push(song);
          }
        });
      }

      await appendTopCandidates(selectedTopIds);

      if (candidateSongs.length < recommendCount) {
        const extraTopIds = shuffledTopIds
          .slice(topsToUse, topsToUse + maxExtraTops)
          .filter((id) => !sourceTopIds.includes(id));
        if (extraTopIds.length) {
          sourceTopIds.push(...extraTopIds);
          await appendTopCandidates(extraTopIds);
        }
      }

      const seenMids = new Set<string>();
      const filtered = candidateSongs.filter((song) => {
        if (!song.mid || ownedMids.has(song.mid) || seenMids.has(song.mid)) return false;
        seenMids.add(song.mid);
        return true;
      });

      type ScoredSong = NormalizedSong & { score: number };
      const scored: ScoredSong[] = filtered.map((song, index) => {
        let score = seededRand(seed, index + 1000);
        let singerScore = 0;
        for (const singer of splitSingerNames(song.singerName)) {
          singerScore += singerCounts.get(singer) ?? 0;
        }
        score += singerScore * 0.3;
        return { ...song, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, recommendCount);
      const finalList = seededShuffle(top, seed + 7);
      const payload: DailyRecommendCacheEntry = {
        songs: finalList.map((song) => ({
          mid: song.mid,
          title: song.title,
          subtitle: song.subtitle,
          singerName: song.singerName,
          albumMid: song.albumMid,
          albumName: song.albumName,
          coverUrl: song.coverUrl
        })),
        seedDate: today,
        sourceTopIds,
        generatedAt: new Date(now).toISOString(),
        expiresAt: now + DAILY_RECOMMEND_CACHE_TTL_MS
      };

      dailyRecommendCache.set(cacheKey, payload);
      pruneDailyRecommendCache(now);
      res.json(payload);
    } catch (err) {
      next(err);
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

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  const env = getEnv();
  const db = openDb(env.DATABASE_PATH);
  const app = createApp(
    db,
    env.QQMUSIC_BASE_URL,
    env.CORS_ORIGIN,
    env.SESSION_SECRET,
    env.SECURE_COOKIE,
    env.TRUST_PROXY,
  );

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://127.0.0.1:${env.PORT}`);
  });
}
