import { z } from "zod";

export type QqMusicClient = {
  baseUrl: string;
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
