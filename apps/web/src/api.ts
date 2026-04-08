import type { ReactionCounts, ReactionKey } from "./share-reactions";

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
  shares?: BaseShare[];
};

export type BaseShare = {
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

export type Share = BaseShare & {
  reactionCounts: ReactionCounts;
  viewerReactionKey: ReactionKey | null;
};

export type PlaylistVisibility = "private" | "link_readonly" | "link_collab";
export type PlaylistRole = "owner" | "editor" | "viewer";
export type PlaylistMemberStatus = "active" | "pending";
export type PlaylistShareScope = "read" | "edit";

export type PlaylistSummary = {
  id: string;
  ownerUserId: number;
  name: string;
  description: string | null;
  visibility: PlaylistVisibility;
  revision: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  role: PlaylistRole;
  status: PlaylistMemberStatus;
  itemCount: number;
};

export type PlaylistItem = {
  id: number;
  playlistId: string;
  songMid: string;
  songTitle: string | null;
  songSubtitle: string | null;
  singerName: string | null;
  albumMid: string | null;
  albumName: string | null;
  coverUrl: string | null;
  position: number;
  addedByUserId: number;
  addedAt: string;
};

export type PlaylistMember = {
  userId: number;
  role: PlaylistRole;
  status: PlaylistMemberStatus;
  invitedByUserId: number | null;
  joinedAt: string;
  createdAt: string;
};

export type PlaylistShareLink = {
  id: number;
  playlistId: string;
  scope: PlaylistShareScope;
  expiresAt: string;
  maxUses: number | null;
  usedCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdByUserId: number;
  createdAt: string;
};

export type PlaylistListResponse = {
  items: PlaylistSummary[];
  total: number;
  nextOffset: number | null;
};

export type PlaylistDetailResponse = {
  playlist: PlaylistSummary;
  members: PlaylistMember[];
};

export type PlaylistItemsResponse = {
  items: PlaylistItem[];
  total: number;
  nextOffset: number | null;
  revision: number;
};

export type PlaylistShareResolveResponse = {
  link: PlaylistShareLink;
  playlist: Omit<PlaylistSummary, "role" | "status" | "itemCount">;
  membership: PlaylistMember | null;
  canRead: boolean;
  canEdit: boolean;
  requiresJoin: boolean;
};


export type HomeResponse = { users: User[] };

// ── Paginated feed types ───────────────────────────────────────────────────────

export type FeedShare = Share & {
  userName: string;
  userAvatarUrl: string | null;
};

export type FeedResponse = {
  items: FeedShare[];
  nextCursor: number | null;
};

export type UserWithPreview = {
  id: number;
  username: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  shareCount: number;
  latestSongTitle: string | null;
  latestSingerName: string | null;
  recentCoverUrls: string[];
};

export type UsersResponse = {
  users: UserWithPreview[];
  total: number;
  totalShares: number;
};

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

export async function apiSharesFeed(cursor?: number | null, limit = 20): Promise<FeedResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", String(limit));
  if (cursor) sp.set("cursor", String(cursor));
  const res = await fetch(`/api/shares/feed?${sp.toString()}`, { method: "GET", credentials: "include" });
  return readJson<FeedResponse>(res);
}

export async function apiUsersList(offset = 0, limit = 20): Promise<UsersResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", String(limit));
  sp.set("offset", String(offset));
  const res = await fetch(`/api/users?${sp.toString()}`, { method: "GET", credentials: "include" });
  return readJson<UsersResponse>(res);
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
}): Promise<{ share: BaseShare }> {
  const res = await fetch("/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include"
  });
  return readJson<{ share: BaseShare }>(res);
}

export async function apiDeleteShare(shareId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}`, { method: "DELETE", credentials: "include" });
  return readJson<{ ok: boolean }>(res);
}

export async function apiSetShareReaction(
  shareId: number,
  reactionKey: ReactionKey,
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}/reaction`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reactionKey }),
    credentials: "include",
  });
  return readJson<{ ok: boolean }>(res);
}

export async function apiDeleteShareReaction(shareId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}/reaction`, {
    method: "DELETE",
    credentials: "include",
  });
  return readJson<{ ok: boolean }>(res);
}

// ── Playlists ────────────────────────────────────────────────────────────────

type PlaylistSongInput = {
  songMid: string;
  songTitle?: string | null;
  songSubtitle?: string | null;
  singerName?: string | null;
  albumMid?: string | null;
  albumName?: string | null;
  coverUrl?: string | null;
};

export async function apiListPlaylists(offset = 0, limit = 20): Promise<PlaylistListResponse> {
  const sp = new URLSearchParams();
  sp.set("offset", String(offset));
  sp.set("limit", String(limit));
  const res = await fetch(`/api/playlists?${sp.toString()}`, { method: "GET", credentials: "include" });
  return readJson<PlaylistListResponse>(res);
}

export async function apiCreatePlaylist(input: {
  name: string;
  description?: string | null;
  visibility?: PlaylistVisibility;
}): Promise<{ playlist: PlaylistSummary }> {
  const res = await fetch("/api/playlists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return readJson<{ playlist: PlaylistSummary }>(res);
}

export async function apiGetPlaylistDetail(playlistId: string): Promise<PlaylistDetailResponse> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
    method: "GET",
    credentials: "include",
  });
  return readJson<PlaylistDetailResponse>(res);
}

export async function apiUpdatePlaylist(
  playlistId: string,
  input: {
    expectedRevision: number;
    name?: string;
    description?: string | null;
    visibility?: PlaylistVisibility;
  },
): Promise<{ playlist: PlaylistSummary }> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return readJson<{ playlist: PlaylistSummary }>(res);
}

export async function apiArchivePlaylist(playlistId: string, expectedRevision: number): Promise<{ ok: boolean }> {
  const sp = new URLSearchParams();
  sp.set("expectedRevision", String(expectedRevision));
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}?${sp.toString()}`, {
    method: "DELETE",
    credentials: "include",
  });
  return readJson<{ ok: boolean }>(res);
}

export async function apiGetPlaylistItems(
  playlistId: string,
  offset = 0,
  limit = 200,
): Promise<PlaylistItemsResponse> {
  const sp = new URLSearchParams();
  sp.set("offset", String(offset));
  sp.set("limit", String(limit));
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items?${sp.toString()}`, {
    method: "GET",
    credentials: "include",
  });
  return readJson<PlaylistItemsResponse>(res);
}

export async function apiAddPlaylistItem(
  playlistId: string,
  input: PlaylistSongInput & { expectedRevision: number },
): Promise<{ item: PlaylistItem; revision: number }> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return readJson<{ item: PlaylistItem; revision: number }>(res);
}

export async function apiRemovePlaylistItem(
  playlistId: string,
  songMid: string,
  expectedRevision: number,
): Promise<{ ok: boolean; revision: number }> {
  const sp = new URLSearchParams();
  sp.set("expectedRevision", String(expectedRevision));
  const res = await fetch(
    `/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(songMid)}?${sp.toString()}`,
    { method: "DELETE", credentials: "include" },
  );
  return readJson<{ ok: boolean; revision: number }>(res);
}

export async function apiReorderPlaylistItems(
  playlistId: string,
  songMids: string[],
  expectedRevision: number,
): Promise<{ items: PlaylistItem[]; revision: number }> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items/reorder`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ songMids, expectedRevision }),
    credentials: "include",
  });
  return readJson<{ items: PlaylistItem[]; revision: number }>(res);
}

export async function apiCreatePlaylistShareLink(
  playlistId: string,
  input: { scope?: PlaylistShareScope; expiresInHours?: number; maxUses?: number | null },
): Promise<{ link: PlaylistShareLink; token: string; sharePath: string }> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return readJson<{ link: PlaylistShareLink; token: string; sharePath: string }>(res);
}

export async function apiResolvePlaylistShareToken(token: string): Promise<PlaylistShareResolveResponse> {
  const res = await fetch(`/api/playlists/share/${encodeURIComponent(token)}`, {
    method: "GET",
    credentials: "include",
  });
  return readJson<PlaylistShareResolveResponse>(res);
}

export async function apiJoinPlaylistShareToken(token: string): Promise<{
  playlist: Omit<PlaylistSummary, "role" | "status" | "itemCount">;
  membership: PlaylistMember;
  link: PlaylistShareLink;
}> {
  const res = await fetch(`/api/playlists/share/${encodeURIComponent(token)}/join`, {
    method: "POST",
    credentials: "include",
  });
  return readJson<{
    playlist: Omit<PlaylistSummary, "role" | "status" | "itemCount">;
    membership: PlaylistMember;
    link: PlaylistShareLink;
  }>(res);
}

export async function apiRevokePlaylistShareLink(linkId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/playlists/share-links/${linkId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return readJson<{ ok: boolean }>(res);
}

export async function apiUpdatePlaylistMember(
  playlistId: string,
  userId: number,
  input: { role: "editor" | "viewer"; status?: PlaylistMemberStatus; expectedRevision: number },
): Promise<{ member: PlaylistMember; revision: number }> {
  const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/members/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  return readJson<{ member: PlaylistMember; revision: number }>(res);
}

export async function apiRemovePlaylistMember(
  playlistId: string,
  userId: number,
  expectedRevision: number,
): Promise<{ ok: boolean; revision: number }> {
  const sp = new URLSearchParams();
  sp.set("expectedRevision", String(expectedRevision));
  const res = await fetch(
    `/api/playlists/${encodeURIComponent(playlistId)}/members/${userId}?${sp.toString()}`,
    { method: "DELETE", credentials: "include" },
  );
  return readJson<{ ok: boolean; revision: number }>(res);
}

export async function apiGetDefaultPlaylist(): Promise<PlaylistSummary | null> {
  const data = await apiListPlaylists(0, 100);
  return data.items.find((playlist) => playlist.isDefault) ?? null;
}

export async function apiAddSongToDefaultPlaylist(
  input: PlaylistSongInput,
): Promise<{ playlistId: string; item: PlaylistItem; revision: number }> {
  const defaultPlaylist = await apiGetDefaultPlaylist();
  if (!defaultPlaylist) {
    throw new Error("Default playlist not found");
  }

  try {
    const firstAttempt = await apiAddPlaylistItem(defaultPlaylist.id, {
      ...input,
      expectedRevision: defaultPlaylist.revision,
    });

    return { playlistId: defaultPlaylist.id, ...firstAttempt };
  } catch (error) {
    if ((error as Error).message !== "Playlist revision conflict") {
      throw error;
    }

    const latest = await apiGetPlaylistDetail(defaultPlaylist.id);
    const retry = await apiAddPlaylistItem(defaultPlaylist.id, {
      ...input,
      expectedRevision: latest.playlist.revision,
    });

    return { playlistId: defaultPlaylist.id, ...retry };
  }
}

// ── Daily Recommendation ──────────────────────────────────────────────────────

export type DailySong = {
  mid: string;
  title: string;
  subtitle: string;
  singerName: string;
  albumMid: string;
  albumName: string;
  coverUrl: string;
};

export type DailyRecommendResponse = {
  songs: DailySong[];
  seedDate: string;
  sourceTopIds: number[];
};

export async function apiRecommendDaily(refresh = false): Promise<DailyRecommendResponse> {
  const url = refresh ? "/api/recommend/daily?refresh=1" : "/api/recommend/daily";
  const res = await fetch(url, { method: "GET", credentials: "include" });
  return readJson<DailyRecommendResponse>(res);
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
        ? `/api/qq/cover-proxy?album_mid=${encodeURIComponent(albumMid)}`
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
