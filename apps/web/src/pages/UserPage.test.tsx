/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserPage from "./UserPage";

const apiMocks = vi.hoisted(() => ({
  apiAddSongToDefaultPlaylist: vi.fn(),
  apiDeleteShare: vi.fn(),
  apiDeletePlaylistShare: vi.fn(),
  apiDeleteShareReaction: vi.fn(),
  apiGetUser: vi.fn(),
  apiSetShareReaction: vi.fn(),
  apiUserPlaylistShares: vi.fn(),
  apiUserShares: vi.fn(),
}));

const plazaPageMocks = vi.hoisted(() => ({
  resetPlazaPageCache: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  currentUser: {
    id: 7,
    username: "owner",
    name: "Owner",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
}));

vi.mock("../api", () => ({
  apiAddSongToDefaultPlaylist: apiMocks.apiAddSongToDefaultPlaylist,
  apiDeleteShare: apiMocks.apiDeleteShare,
  apiDeletePlaylistShare: apiMocks.apiDeletePlaylistShare,
  apiDeleteShareReaction: apiMocks.apiDeleteShareReaction,
  apiGetUser: apiMocks.apiGetUser,
  apiSetShareReaction: apiMocks.apiSetShareReaction,
  apiUserPlaylistShares: apiMocks.apiUserPlaylistShares,
  apiUserShares: apiMocks.apiUserShares,
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

vi.mock("../context/PlayerContext", () => ({
  usePlayer: () => ({
    play: vi.fn(),
    appendToPlaylistQueue: vi.fn(),
    loadingMid: null,
    isCurrentSong: () => false,
    currentSong: null,
    playing: false,
  }),
}));

vi.mock("../hooks", () => ({
  useDefaultPlaylistMids: () => ({
    playlistMids: new Set<string>(),
    defaultPlaylist: null,
    addMid: vi.fn(),
  }),
}));

vi.mock("./PlazaPage", () => ({
  resetPlazaPageCache: plazaPageMocks.resetPlazaPageCache,
}));

vi.mock("../components/SongCard", () => ({
  default: ({
    item,
    action,
    secondAction,
  }: {
    item: { songTitle?: string; songMid: string };
    action?: { label: string; onClick: () => void };
    secondAction?: { label: string; onClick: () => void };
  }) => (
    <div>
      <div>{item.songTitle ?? item.songMid}</div>
      {action ? <button onClick={action.onClick}>{action.label}</button> : null}
      {secondAction ? <button onClick={secondAction.onClick}>{secondAction.label}</button> : null}
    </div>
  ),
}));

vi.mock("../components/Avatar", () => ({
  default: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../components/ShareReactionBar", () => ({
  default: () => <div data-testid="reactions" />,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/user/7"]}>
      <Routes>
        <Route path="/user/:userId" element={<UserPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));

  apiMocks.apiGetUser.mockResolvedValue({
    user: {
      id: 7,
      username: "owner",
      name: "Owner",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });

  apiMocks.apiUserShares.mockResolvedValue({
    shares: [
      {
        id: 42,
        userId: 7,
        songMid: "song-1",
        songTitle: "Song To Delete",
        songSubtitle: null,
        singerName: "Singer",
        albumMid: null,
        albumName: null,
        coverUrl: null,
        comment: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        reactionCounts: { slacking: 0, boost: 0, healing: 0, after_work: 0, loop: 0 },
        viewerReactionKey: null,
      },
    ],
    total: 1,
    nextCursor: null,
  });
  apiMocks.apiUserPlaylistShares.mockResolvedValue({
    shares: [],
    total: 0,
    nextCursor: null,
  });

  apiMocks.apiDeleteShare.mockResolvedValue({ ok: true });
  apiMocks.apiDeletePlaylistShare.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UserPage", () => {
  it("invalidates plaza cache after deleting a share", async () => {
    renderPage();

    expect(await screen.findByText("Song To Delete")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(apiMocks.apiDeleteShare).toHaveBeenCalledWith(42);
      expect(plazaPageMocks.resetPlazaPageCache).toHaveBeenCalledTimes(1);
    });
  });

  it("invalidates plaza cache after deleting a playlist share", async () => {
    apiMocks.apiUserPlaylistShares.mockResolvedValue({
      shares: [
        {
          id: 51,
          userId: 7,
          playlistId: "playlist-1",
          shareLinkId: 3,
          sharePath: "/playlist/share/playlist-1-token",
          playlistName: "Work Mix",
          playlistDescription: "专注模式",
          coverUrl: null,
          itemCount: 6,
          comment: "今天的工作歌单",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      nextCursor: null,
    });

    renderPage();

    expect(await screen.findByText("Work Mix")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "撤回" }));

    await waitFor(() => {
      expect(apiMocks.apiDeletePlaylistShare).toHaveBeenCalledWith(51);
      expect(plazaPageMocks.resetPlazaPageCache).toHaveBeenCalledTimes(1);
    });
  });

  it("shows total counts from paginated responses", async () => {
    apiMocks.apiUserShares.mockResolvedValue({
      shares: [
        {
          id: 42,
          userId: 7,
          songMid: "song-1",
          songTitle: "Song To Delete",
          songSubtitle: null,
          singerName: "Singer",
          albumMid: null,
          albumName: null,
          coverUrl: null,
          comment: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          reactionCounts: { slacking: 0, boost: 0, healing: 0, after_work: 0, loop: 0 },
          viewerReactionKey: null,
        },
      ],
      total: 3,
      nextCursor: 41,
    });
    apiMocks.apiUserPlaylistShares.mockResolvedValue({
      shares: [],
      total: 2,
      nextCursor: 11,
    });

    renderPage();

    expect(await screen.findByText("共分享了 3 首歌曲，2 个歌单")).toBeInTheDocument();
    expect(screen.getByText("3 首")).toBeInTheDocument();
    expect(screen.getByText("2 个")).toBeInTheDocument();
  });
});
