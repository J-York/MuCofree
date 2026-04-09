/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlazaPage, { resetPlazaPageCache } from "./PlazaPage";

const apiMocks = vi.hoisted(() => ({
  apiAddSongToDefaultPlaylist: vi.fn(),
  apiDeleteShare: vi.fn(),
  apiDeletePlaylistShare: vi.fn(),
  apiDeleteShareReaction: vi.fn(),
  apiPlazaStats: vi.fn(),
  apiPlaylistSharesFeed: vi.fn(),
  apiSetShareReaction: vi.fn(),
  apiSharesFeed: vi.fn(),
  apiUsersList: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  currentUser: null as
    | {
        id: number;
        username: string;
        name: string;
        avatarUrl: null;
        createdAt: string;
      }
    | null,
}));

vi.mock("../api", () => ({
  apiAddSongToDefaultPlaylist: apiMocks.apiAddSongToDefaultPlaylist,
  apiDeleteShare: apiMocks.apiDeleteShare,
  apiDeletePlaylistShare: apiMocks.apiDeletePlaylistShare,
  apiDeleteShareReaction: apiMocks.apiDeleteShareReaction,
  apiPlazaStats: apiMocks.apiPlazaStats,
  apiPlaylistSharesFeed: apiMocks.apiPlaylistSharesFeed,
  apiSetShareReaction: apiMocks.apiSetShareReaction,
  apiSharesFeed: apiMocks.apiSharesFeed,
  apiUsersList: apiMocks.apiUsersList,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: authState.currentUser,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../hooks", () => ({
  useDefaultPlaylistMids: () => ({
    playlistMids: new Set<string>(),
    defaultPlaylist: null,
    addMid: vi.fn(),
    loading: false,
    refreshMids: vi.fn(),
  }),
}));

vi.mock("../context/PlayerContext", () => ({
  usePlayer: () => ({
    currentSong: null,
    playing: false,
    play: vi.fn(),
    appendToPlaylistQueue: vi.fn(),
    togglePlayPause: vi.fn(),
    loadingMid: null,
  }),
}));

vi.mock("../components/Avatar", () => ({
  default: ({ name }: { name: string }) => <div data-testid="avatar">{name}</div>,
}));

vi.mock("../components/ShareReactionBar", () => ({
  default: ({ viewerReactionKey }: { viewerReactionKey: string | null }) => (
    <div data-testid="reactions">{viewerReactionKey ?? "none"}</div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PlazaPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPlazaPageCache();
  authState.currentUser = null;
  vi.stubGlobal("confirm", vi.fn(() => true));

  apiMocks.apiSharesFeed.mockResolvedValue({
    items: [],
    nextCursor: null,
  });

  apiMocks.apiPlaylistSharesFeed.mockResolvedValue({
    items: [],
    nextCursor: null,
  });

  apiMocks.apiPlazaStats.mockResolvedValue({
    totalUsers: 1,
    totalShares: 3,
    songShares: 2,
    playlistShares: 1,
  });

  apiMocks.apiUsersList.mockResolvedValue({
    users: [
      {
        id: 1,
        username: "alice",
        name: "Alice",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        shareCount: 3,
        songShareCount: 2,
        playlistShareCount: 1,
        latestSongTitle: "Song A",
        latestSingerName: "Singer A",
        latestPlaylistName: "Playlist A",
        latestShareKind: "song",
        latestShareTitle: "Song A",
        latestShareSubtitle: "Singer A",
        recentCoverUrls: [],
      },
    ],
    total: 1,
    totalShares: 3,
    songShares: 2,
    playlistShares: 1,
  });
});

describe("PlazaPage", () => {
  function buildFeedItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1,
      userId: 11,
      userName: "Alice",
      userAvatarUrl: null,
      songMid: "song-1",
      songTitle: "Song One",
      songSubtitle: null,
      singerName: "Singer One",
      albumMid: null,
      albumName: null,
      coverUrl: null,
      comment: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      reactionCounts: { slacking: 0, boost: 0, healing: 0, after_work: 0, loop: 0 },
      viewerReactionKey: null,
      ...overrides,
    };
  }

  function buildPlaylistFeedItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 1,
      userId: 11,
      userName: "Alice",
      userAvatarUrl: null,
      playlistId: "playlist-1",
      shareLinkId: 2,
      sharePath: "/playlist/share/playlist-1-token",
      playlistName: "Office Mix",
      playlistDescription: "适合工作时循环",
      coverUrl: null,
      itemCount: 8,
      comment: "今天的专注歌单",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("loads feed and stats first, then fetches users on demand", async () => {
    renderPage();

    await waitFor(() => {
      expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
      expect(apiMocks.apiPlazaStats).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.apiUsersList).not.toHaveBeenCalled();
    expect(apiMocks.apiPlaylistSharesFeed).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: "分享者" }));

    await waitFor(() => {
      expect(apiMocks.apiUsersList).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/最近歌曲：Song A · Singer A/)).toBeInTheDocument();
  });

  it("shows the latest playlist share in user previews when it is newer than songs", async () => {
    apiMocks.apiUsersList.mockResolvedValue({
      users: [
        {
          id: 1,
          username: "alice",
          name: "Alice",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          shareCount: 2,
          songShareCount: 1,
          playlistShareCount: 1,
          latestSongTitle: "Old Song",
          latestSingerName: "Singer A",
          latestPlaylistName: "Newest Playlist",
          latestShareKind: "playlist",
          latestShareTitle: "Newest Playlist",
          latestShareSubtitle: null,
          recentCoverUrls: [],
        },
      ],
      total: 1,
      totalShares: 2,
      songShares: 1,
      playlistShares: 1,
    });

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "分享者" }));

    expect(await screen.findByText("最近歌单：Newest Playlist")).toBeInTheDocument();
  });

  it("reuses cached feed and stats across remounts", async () => {
    const firstRender = renderPage();

    await waitFor(() => {
      expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
      expect(apiMocks.apiPlazaStats).toHaveBeenCalledTimes(1);
    });

    firstRender.unmount();
    renderPage();

    await screen.findByText("3 条分享");

    expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
    expect(apiMocks.apiPlazaStats).toHaveBeenCalledTimes(1);
    expect(apiMocks.apiUsersList).not.toHaveBeenCalled();
  });

  it("does not reuse feed cache across viewers", async () => {
    authState.currentUser = {
      id: 1,
      username: "user-1",
      name: "User One",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    apiMocks.apiSharesFeed
      .mockResolvedValueOnce({
        items: [buildFeedItem({ songTitle: "Song For User 1", viewerReactionKey: "boost" })],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [buildFeedItem({ id: 2, songMid: "song-2", songTitle: "Song For User 2", viewerReactionKey: null })],
        nextCursor: null,
      });

    const firstRender = renderPage();

    expect(await screen.findByText("Song For User 1")).toBeInTheDocument();
    expect(screen.getByTestId("reactions")).toHaveTextContent("boost");

    firstRender.unmount();

    authState.currentUser = {
      id: 2,
      username: "user-2",
      name: "User Two",
      avatarUrl: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    renderPage();

    expect(await screen.findByText("Song For User 2")).toBeInTheDocument();
    expect(screen.getByTestId("reactions")).toHaveTextContent("none");
    expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(2);
  });

  it("loads playlist shares on demand and lets owners revoke them", async () => {
    authState.currentUser = {
      id: 11,
      username: "alice",
      name: "Alice",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    apiMocks.apiPlaylistSharesFeed.mockResolvedValue({
      items: [buildPlaylistFeedItem()],
      nextCursor: null,
    });
    apiMocks.apiDeletePlaylistShare.mockResolvedValue({ ok: true });

    renderPage();

    await waitFor(() => {
      expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.apiPlaylistSharesFeed).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "歌单动态" }));

    await waitFor(() => {
      expect(apiMocks.apiPlaylistSharesFeed).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Office Mix")).toBeInTheDocument();
    expect(screen.getByText("今天的专注歌单")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "撤回" }));

    await waitFor(() => {
      expect(apiMocks.apiDeletePlaylistShare).toHaveBeenCalledWith(1);
    });

    expect(screen.queryByText("Office Mix")).not.toBeInTheDocument();
  });
});
