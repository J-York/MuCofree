/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlazaPage, { resetPlazaPageCache } from "./PlazaPage";

const apiMocks = vi.hoisted(() => ({
  apiAddSongToDefaultPlaylist: vi.fn(),
  apiDeleteShare: vi.fn(),
  apiDeleteShareReaction: vi.fn(),
  apiPlazaStats: vi.fn(),
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
  apiDeleteShareReaction: apiMocks.apiDeleteShareReaction,
  apiPlazaStats: apiMocks.apiPlazaStats,
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

  apiMocks.apiSharesFeed.mockResolvedValue({
    items: [],
    nextCursor: null,
  });

  apiMocks.apiPlazaStats.mockResolvedValue({
    totalUsers: 1,
    totalShares: 3,
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
        latestSongTitle: "Song A",
        latestSingerName: "Singer A",
        recentCoverUrls: [],
      },
    ],
    total: 1,
    totalShares: 3,
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

  it("loads feed and stats first, then fetches users on demand", async () => {
    renderPage();

    await waitFor(() => {
      expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
      expect(apiMocks.apiPlazaStats).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.apiUsersList).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: "分享者" }));

    await waitFor(() => {
      expect(apiMocks.apiUsersList).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/最近：Song A · Singer A/)).toBeInTheDocument();
  });

  it("reuses cached feed and stats across remounts", async () => {
    const firstRender = renderPage();

    await waitFor(() => {
      expect(apiMocks.apiSharesFeed).toHaveBeenCalledTimes(1);
      expect(apiMocks.apiPlazaStats).toHaveBeenCalledTimes(1);
    });

    firstRender.unmount();
    renderPage();

    await screen.findByText("3 首分享");

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
});
