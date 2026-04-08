import { z } from "zod";

export type QqMusicClient = {
  baseUrl: string;
};

export type QqPlaylistImportSong = {
  songMid: string;
  songTitle: string;
  songSubtitle: string | null;
  singerName: string | null;
  albumMid: string | null;
  albumName: string | null;
  coverUrl: string | null;
};

export type QqPlaylistImportPayload = {
  id: number;
  title: string | null;
  songs: QqPlaylistImportSong[];
};

const apiResponseSchema = z.object({
  code: z.number(),
  data: z.unknown().optional()
});

export function createQqMusicClient(baseUrl: string): QqMusicClient {
  return { baseUrl };
}

const UPSTREAM_TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "accept": "application/json" },
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream request failed: ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ""}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function qqSearch(
  client: QqMusicClient,
  params: { keyword: string; type?: string; num?: number; page?: number }
): Promise<unknown> {
  const sp = new URLSearchParams();
  sp.set("keyword", params.keyword);
  if (params.type) sp.set("type", params.type);
  if (params.num != null) sp.set("num", String(params.num));
  if (params.page != null) sp.set("page", String(params.page));

  return getJson(`${client.baseUrl}/api/search?${sp.toString()}`);
}

export async function qqSongDetail(
  client: QqMusicClient,
  params: { mid?: string; id?: number }
): Promise<unknown> {
  const sp = new URLSearchParams();
  if (params.mid) sp.set("mid", params.mid);
  if (params.id != null) sp.set("id", String(params.id));
  return getJson(`${client.baseUrl}/api/song/detail?${sp.toString()}`);
}

export async function qqSongUrl(
  client: QqMusicClient,
  params: { mid: string; quality?: string }
): Promise<unknown> {
  const sp = new URLSearchParams();
  sp.set("mid", params.mid);
  if (params.quality) sp.set("quality", params.quality);
  return getJson(`${client.baseUrl}/api/song/url?${sp.toString()}`);
}

export async function qqLyric(
  client: QqMusicClient,
  params: { mid?: string; id?: number; qrc?: 0 | 1; trans?: 0 | 1; roma?: 0 | 1 }
): Promise<unknown> {
  const sp = new URLSearchParams();
  if (params.mid) sp.set("mid", params.mid);
  if (params.id != null) sp.set("id", String(params.id));
  if (params.qrc != null) sp.set("qrc", String(params.qrc));
  if (params.trans != null) sp.set("trans", String(params.trans));
  if (params.roma != null) sp.set("roma", String(params.roma));
  return getJson(`${client.baseUrl}/api/lyric?${sp.toString()}`);
}

export async function qqCover(
  client: QqMusicClient,
  params: { mid?: string; album_mid?: string; size?: 150 | 300 | 500 | 800; validate?: boolean }
): Promise<unknown> {
  const sp = new URLSearchParams();
  if (params.mid) sp.set("mid", params.mid);
  if (params.album_mid) sp.set("album_mid", params.album_mid);
  if (params.size != null) sp.set("size", String(params.size));
  if (params.validate != null) sp.set("validate", params.validate ? "1" : "0");
  return getJson(`${client.baseUrl}/api/song/cover?${sp.toString()}`);
}

export async function qqAlbum(client: QqMusicClient, params: { mid: string }): Promise<unknown> {
  const sp = new URLSearchParams();
  sp.set("mid", params.mid);
  return getJson(`${client.baseUrl}/api/album?${sp.toString()}`);
}

export async function qqPlaylist(client: QqMusicClient, params: { id: number }): Promise<unknown> {
  const sp = new URLSearchParams();
  sp.set("id", String(params.id));
  return getJson(`${client.baseUrl}/api/playlist?${sp.toString()}`);
}

export async function qqSinger(client: QqMusicClient, params: { mid: string }): Promise<unknown> {
  const sp = new URLSearchParams();
  sp.set("mid", params.mid);
  return getJson(`${client.baseUrl}/api/singer?${sp.toString()}`);
}

export async function qqTop(client: QqMusicClient, params: { id?: number; num?: number } = {}): Promise<unknown> {
  const sp = new URLSearchParams();
  if (params.id != null) sp.set("id", String(params.id));
  if (params.num != null) sp.set("num", String(params.num));

  const url = sp.toString() ? `${client.baseUrl}/api/top?${sp.toString()}` : `${client.baseUrl}/api/top`;
  return getJson(url);
}

export function assertApiOk(payload: unknown): { code: number; data?: unknown } {
  const parsed = apiResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Upstream response shape invalid");
  }
  return parsed.data;
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function pickPositiveInteger(value: unknown): number | undefined {
  const parsed = pickInteger(value);
  return typeof parsed === "number" && parsed > 0 ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function coverProxyUrl(albumMid: string | null): string | null {
  return albumMid ? `/api/qq/cover-proxy?album_mid=${encodeURIComponent(albumMid)}` : null;
}

function pickSongMid(item: Record<string, unknown>): string | undefined {
  return pickString(item.mid) || pickString(item.songmid) || pickString(item.song_mid);
}

function pickSongTitle(item: Record<string, unknown>): string | undefined {
  return (
    pickString(item.title) ||
    pickString(item.name) ||
    pickString(item.songname) ||
    pickString(item.song_title)
  );
}

function pickSongSubtitle(item: Record<string, unknown>): string | null {
  return (
    pickString(item.subtitle) ||
    pickString(item.subtitle_name) ||
    pickString(item.subTitle) ||
    pickString(item.song_subtitle) ||
    null
  );
}

function pickSingerName(item: Record<string, unknown>): string | null {
  const direct = pickString(item.singerName) || pickString(item.singer_name);
  if (direct) return direct;

  const singers = Array.isArray(item.singer)
    ? item.singer
    : Array.isArray(item.singers)
      ? item.singers
      : [];
  const names = singers
    .map((entry) => {
      const singer = asRecord(entry);
      return pickString(singer.name) || pickString(singer.title);
    })
    .filter((name): name is string => Boolean(name));

  return names.length ? names.join(", ") : null;
}

function pickAlbumInfo(item: Record<string, unknown>) {
  const album = asRecord(item.album);
  const albumMid = (
    pickString(album.mid) ||
    pickString(item.album_mid) ||
    pickString(item.albummid) ||
    null
  );
  const albumName = (
    pickString(album.name) ||
    pickString(album.title) ||
    pickString(item.album_name) ||
    pickString(item.albumname) ||
    null
  );
  return { albumMid, albumName };
}

export function parseQqPlaylistSource(source: string): number | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return pickPositiveInteger(trimmed) ?? null;
  }

  const commonMatch = trimmed.match(/(?:playlist\/|[?&]id=)(\d{5,})/i);
  if (commonMatch) {
    return pickPositiveInteger(commonMatch[1]) ?? null;
  }

  try {
    const parsed = new URL(trimmed);

    for (const key of ["id", "disstid", "dirid"]) {
      const value = parsed.searchParams.get(key);
      const id = pickPositiveInteger(value);
      if (id) return id;
    }

    const pathnameMatch = parsed.pathname.match(/\/playlist\/(\d{5,})(?:\/)?$/i);
    if (pathnameMatch) {
      return pickPositiveInteger(pathnameMatch[1]) ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeQqPlaylistPayload(payload: unknown): QqPlaylistImportPayload {
  const root = asRecord(payload);
  const rootCode = pickInteger(root.code);
  if (rootCode !== undefined && rootCode !== 0) {
    throw new Error("QQ playlist unavailable");
  }

  const data = asRecord(root.data);
  const dataCode = pickInteger(data.code);
  if (dataCode !== undefined && dataCode !== 0) {
    throw new Error("QQ playlist unavailable");
  }

  const dirinfo = asRecord(data.dirinfo);
  const playlistId = pickPositiveInteger(dirinfo.id);
  if (!playlistId) {
    throw new Error("QQ playlist payload invalid");
  }

  const rawSongs = Array.isArray(data.songlist)
    ? data.songlist
    : Array.isArray(data.list)
      ? data.list
      : [];

  const seenSongMids = new Set<string>();
  const songs: QqPlaylistImportSong[] = [];

  for (const rawItem of rawSongs) {
    const item = asRecord(rawItem);
    const songMid = pickSongMid(item);
    const songTitle = pickSongTitle(item);
    if (!songMid || !songTitle || seenSongMids.has(songMid)) {
      continue;
    }

    seenSongMids.add(songMid);

    const { albumMid, albumName } = pickAlbumInfo(item);
    songs.push({
      songMid,
      songTitle,
      songSubtitle: pickSongSubtitle(item),
      singerName: pickSingerName(item),
      albumMid,
      albumName,
      coverUrl: coverProxyUrl(albumMid),
    });
  }

  return {
    id: playlistId,
    title: pickString(dirinfo.title) || pickString(data.title) || null,
    songs,
  };
}
