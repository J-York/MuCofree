import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiAddSongToDefaultPlaylist,
  apiListPlaylists,
  apiResolvePlaylistShareToken,
  type PlaylistSummary,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildPlaylist(overrides: Partial<PlaylistSummary> = {}): PlaylistSummary {
  return {
    id: "playlist-default",
    ownerUserId: 1,
    name: "我的收藏",
    description: null,
    visibility: "private",
    revision: 3,
    isDefault: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    role: "owner",
    status: "active",
    itemCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("playlist api client", () => {
  it("serializes playlist list pagination parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [buildPlaylist()],
          total: 1,
          nextOffset: null,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await apiListPlaylists(5, 10);

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/playlists?offset=5&limit=10");
  });

  it("retries default playlist add once on revision conflict", async () => {
    const defaultPlaylist = buildPlaylist({ id: "playlist-default", revision: 3 });
    const refreshedPlaylist = buildPlaylist({ id: "playlist-default", revision: 4 });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [defaultPlaylist],
          total: 1,
          nextOffset: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(409, { error: { message: "Playlist revision conflict" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          playlist: refreshedPlaylist,
          members: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          item: {
            id: 9,
            playlistId: "playlist-default",
            songMid: "song-mid-1",
            songTitle: "Song 1",
            songSubtitle: null,
            singerName: "Singer",
            albumMid: null,
            albumName: null,
            coverUrl: null,
            position: 0,
            addedByUserId: 1,
            addedAt: "2026-01-02T00:00:00.000Z",
          },
          revision: 5,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await apiAddSongToDefaultPlaylist({
      songMid: "song-mid-1",
      songTitle: "Song 1",
      singerName: "Singer",
    });

    expect(result).toMatchObject({
      playlistId: "playlist-default",
      revision: 5,
      item: {
        songMid: "song-mid-1",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstAddBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}"));
    const secondAddBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body ?? "{}"));

    expect(firstAddBody.expectedRevision).toBe(3);
    expect(secondAddBody.expectedRevision).toBe(4);
  });

  it("resolves playlist share token endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          link: {
            id: 1,
            playlistId: "playlist-default",
            scope: "read",
            expiresAt: "2099-01-01T00:00:00.000Z",
            maxUses: null,
            usedCount: 0,
            lastUsedAt: null,
            revokedAt: null,
            createdByUserId: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          playlist: {
            id: "playlist-default",
            ownerUserId: 1,
            name: "Shared",
            description: null,
            visibility: "link_readonly",
            revision: 1,
            isDefault: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          },
          membership: null,
          canRead: false,
          canEdit: false,
          requiresJoin: true,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const data = await apiResolvePlaylistShareToken("abc-token");

    expect(data.requiresJoin).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/playlists/share/abc-token");
  });
});
