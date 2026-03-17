// ── JSON helper ──────────────────────────────────────────────────────────────

export type ApiError = {
  error: { message: string; issues?: Array<{ path: string; message: string }> };
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      if (res.ok) throw new Error("Invalid JSON response");
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }
  if (!res.ok) {
    const apiErr = data as Partial<ApiError> | null;
    const issues = apiErr?.error?.issues
      ?.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      .filter(Boolean);
    const msg =
      (issues && issues.length ? issues[0] : undefined) ||
      apiErr?.error?.message ||
      `${res.status} ${res.statusText}` ||
      "Request failed";
    throw new Error(msg);
  }
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type User = {
  id: number;
  username: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  shares?: Share[];
};

export type Share = {
  id: number;
  userId: number;
  songMid: string;
  songTitle: string | null;
  songSubtitle: string | null;
  singerName: string | null;
  albumMid: string | null;
  albumName: string | null;
  coverUrl: string | null;
  comment: string | null;
  createdAt: string;
};

export type PlaylistSong = {
  id: number;
  userId: number;
  songMid: string;
  songTitle: string | null;
  songSubtitle: string | null;
  singerName: string | null;
  albumMid: string | null;
  albumName: string | null;
  coverUrl: string | null;
  addedAt: string;
};

export type HomeResponse = { users: User[] };

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function apiRegister(input: {
  username: string;
  password: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<{ user: User }> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  return readJson<{ user: User }>(res);
}

export async function apiLogin(input: {
  username: string;
  password: string;
}): Promise<{ user: User }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  return readJson<{ user: User }>(res);
}

export async function apiLogout(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include"
  });
  return readJson<{ ok: boolean }>(res);
}

export async function apiMe(): Promise<{ user: User | null }> {
  const res = await fetch("/api/auth/me", {
    method: "GET",
    credentials: "include"
  });
  return readJson<{ user: User | null }>(res);
}

// ── Users / Home ──────────────────────────────────────────────────────────────

export async function apiHome(): Promise<HomeResponse> {
  const res = await fetch("/api/home", { method: "GET", credentials: "include" });
  return readJson<HomeResponse>(res);
}

export async function apiGetUser(userId: number): Promise<{ user: User }> {
  const res = await fetch(`/api/users/${userId}`, { method: "GET", credentials: "include" });
  return readJson<{ user: User }>(res);
}

export async function apiUserShares(userId: number): Promise<{ shares: Share[] }> {
  const res = await fetch(`/api/users/${userId}/shares`, { method: "GET", credentials: "include" });
  return readJson<{ shares: Share[] }>(res);
}

// ── Shares ────────────────────────────────────────────────────────────────────

export async function apiCreateShare(input: {
  songMid: string;
  songTitle?: string | null;
  songSubtitle?: string | null;
  singerName?: string | null;
  albumMid?: string | null;
  albumName?: string | null;
  coverUrl?: string | null;
  comment?: string | null;
}): Promise<{ share: Share }> {
  const res = await fetch("/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  return readJson<{ share: Share }>(res);
}

export async function apiDeleteShare(shareId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}`, { method: "DELETE", credentials: "include" });
  return readJson<{ ok: boolean }>(res);
}

// ── Playlist ──────────────────────────────────────────────────────────────────

export async function apiGetPlaylist(): Promise<{ songs: PlaylistSong[] }> {
  const res = await fetch("/api/playlist", { method: "GET", credentials: "include" });
  return readJson<{ songs: PlaylistSong[] }>(res);
}

export async function apiAddToPlaylist(input: {
  songMid: string;
  songTitle?: string | null;
  songSubtitle?: string | null;
  singerName?: string | null;
  albumMid?: string | null;
  albumName?: string | null;
  coverUrl?: string | null;
}): Promise<{ song: PlaylistSong }> {
  const res = await fetch("/api/playlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  return readJson<{ song: PlaylistSong }>(res);
}

export async function apiRemoveFromPlaylist(songMid: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/playlist/${encodeURIComponent(songMid)}`, {
    method: "DELETE",
    credentials: "include"
  });
  return readJson<{ ok: boolean }>(res);
}

// ── QQ Music helpers ──────────────────────────────────────────────────────────

export type QqSong = {
  mid: string;
  title: string;
  subtitle?: string;
  singer?: string;
  albumMid?: string;
  albumName?: string;
  coverUrl?: string;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function pickMid(item: any): string | undefined {
  return pickString(item?.mid) || pickString(item?.songmid) || pickString(item?.song_mid);
}

function pickTitle(item: any): string | undefined {
  return (
    pickString(item?.title) ||
    pickString(item?.name) ||
    pickString(item?.songname) ||
    pickString(item?.song_title)
  );
}

function pickSubtitle(item: any): string | undefined {
  return (
    pickString(item?.subtitle) ||
    pickString(item?.subtitle_name) ||
    pickString(item?.subTitle) ||
    pickString(item?.song_subtitle)
  );
}

function pickSinger(item: any): string | undefined {
  const singerName = pickString(item?.singerName) || pickString(item?.singer_name);
  if (singerName) return singerName;
  const singers = item?.singer || item?.singers;
  if (Array.isArray(singers) && singers.length) {
    const names = singers
      .map((s: any) => pickString(s?.name) || pickString(s?.title))
      .filter(Boolean);
    if (names.length) return names.join(", ");
  }
  return undefined;
}

function pickAlbum(item: any): { albumMid?: string; albumName?: string } {
  const album = item?.album;
  const albumMid = pickString(album?.mid) || pickString(item?.album_mid) || pickString(item?.albummid);
  const albumName =
    pickString(album?.name) || pickString(item?.album_name) || pickString(item?.albumname);
  return { albumMid, albumName };
}

function extractSongList(payload: any): any[] {
  const data = payload?.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.song?.list)) return data.song.list;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  return [];
}

export async function apiQqSearch(keyword: string, signal?: AbortSignal): Promise<QqSong[]> {
  const sp = new URLSearchParams();
  sp.set("keyword", keyword);
  sp.set("type", "song");
  sp.set("num", "20");

  const res = await fetch(`/api/qq/search?${sp.toString()}`, { credentials: "include", signal });
  const payload = await readJson<any>(res);

  const list = extractSongList(payload);

  return list
    .map((item: any) => {
      const mid = pickMid(item);
      const title = pickTitle(item);
      if (!mid || !title) return null;
      const subtitle = pickSubtitle(item);
      const singer = pickSinger(item);
      const { albumMid, albumName } = pickAlbum(item);
      const coverUrl = albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : undefined;
      return { mid, title, subtitle, singer, albumMid, albumName, coverUrl } as QqSong;
    })
    .filter((s: QqSong | null): s is QqSong => s !== null);
}

export async function apiQqSongUrl(mid: string, quality = "320"): Promise<string | null> {
  const sp = new URLSearchParams();
  sp.set("mid", mid);
  sp.set("quality", quality);
  const res = await fetch(`/api/qq/song/url?${sp.toString()}`, { credentials: "include" });
  const payload = await readJson<any>(res);
  const url = payload?.data?.[mid];
  return typeof url === "string" && url ? url : null;
}
