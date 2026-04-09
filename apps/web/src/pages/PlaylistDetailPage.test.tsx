/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaylistDetailPage from "./PlaylistDetailPage";

const apiMocks = vi.hoisted(() => ({
  apiGetPlaylistDetail: vi.fn(),
  apiGetPlaylistItems: vi.fn(),
  apiUpdatePlaylist: vi.fn(),
  apiArchivePlaylist: vi.fn(),
  apiRemovePlaylistItem: vi.fn(),
  apiReorderPlaylistItems: vi.fn(),
  apiCreatePlaylistShareLink: vi.fn(),
  apiCreatePlaylistShare: vi.fn(),
  apiCreateShare: vi.fn(),
  apiImportQqPlaylist: vi.fn(),
  apiUpdatePlaylistMember: vi.fn(),
  apiRemovePlaylistMember: vi.fn(),
  apiUserPlaylistShares: vi.fn(),
  apiUserShares: vi.fn(),
}));

const resetPlazaPageCacheMock = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  apiGetPlaylistDetail: apiMocks.apiGetPlaylistDetail,
  apiGetPlaylistItems: apiMocks.apiGetPlaylistItems,
  apiUpdatePlaylist: apiMocks.apiUpdatePlaylist,
  apiArchivePlaylist: apiMocks.apiArchivePlaylist,
  apiRemovePlaylistItem: apiMocks.apiRemovePlaylistItem,
  apiReorderPlaylistItems: apiMocks.apiReorderPlaylistItems,
  apiCreatePlaylistShareLink: apiMocks.apiCreatePlaylistShareLink,
  apiCreatePlaylistShare: apiMocks.apiCreatePlaylistShare,
  apiCreateShare: apiMocks.apiCreateShare,
  apiImportQqPlaylist: apiMocks.apiImportQqPlaylist,
  apiUpdatePlaylistMember: apiMocks.apiUpdatePlaylistMember,
  apiRemovePlaylistMember: apiMocks.apiRemovePlaylistMember,
  apiUserPlaylistShares: apiMocks.apiUserPlaylistShares,
  apiUserShares: apiMocks.apiUserShares,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 7, username: "owner", name: "Owner", avatarUrl: null, createdAt: "2026-01-01T00:00:00.000Z" },
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
    removeFromPlaylistQueue: vi.fn(),
    loadingMid: null,
    isCurrentSong: () => false,
    currentSong: null,
    playing: false,
  }),
}));

vi.mock("./PlazaPage", () => ({
  resetPlazaPageCache: resetPlazaPageCacheMock,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: {},
  PointerSensor: function PointerSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  arrayMove: (items: unknown[]) => items,
}));

vi.mock("../components/SortableSongItem", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/playlists/playlist-1"]}>
      <Routes>
        <Route path="/playlists/:playlistId" element={<PlaylistDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const basePlaylist = {
  id: "playlist-1",
  ownerUserId: 7,
  name: "我的收藏",
  description: "收藏夹",
  visibility: "private",
  revision: 3,
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  role: "owner",
  status: "active",
  itemCount: 2,
};

const baseItems = [
  {
    id: 1,
    playlistId: "playlist-1",
    songMid: "song-1",
    songTitle: "Song One",
    songSubtitle: null,
    singerName: "Singer One",
    albumMid: null,
    albumName: null,
    coverUrl: null,
    position: 0,
    addedByUserId: 7,
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    playlistId: "playlist-1",
    songMid: "song-2",
    songTitle: "Song Two",
    songSubtitle: null,
    singerName: "Singer Two",
    albumMid: null,
    albumName: null,
    coverUrl: null,
    position: 1,
    addedByUserId: 7,
    addedAt: "2026-01-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();

  apiMocks.apiGetPlaylistDetail.mockResolvedValue({
    playlist: basePlaylist,
    members: [],
  });
  apiMocks.apiGetPlaylistItems.mockResolvedValue({
    items: baseItems,
    total: baseItems.length,
    nextOffset: null,
    revision: 3,
  });
  apiMocks.apiUserShares.mockResolvedValue({
    shares: [{ id: 9, songMid: "song-1" }],
    total: 1,
    nextCursor: null,
  });
  apiMocks.apiUserPlaylistShares.mockResolvedValue({
    shares: [],
    total: 0,
    nextCursor: null,
  });
  apiMocks.apiCreateShare.mockResolvedValue({
    share: { id: 10, userId: 7, songMid: "song-2", comment: "今晚单曲循环" },
  });
  apiMocks.apiCreatePlaylistShare.mockResolvedValue({
    share: {
      id: 11,
      userId: 7,
      playlistId: "playlist-1",
      shareLinkId: 2,
      sharePath: "/playlist/share/playlist-share-token",
      playlistName: "我的收藏",
      playlistDescription: "收藏夹",
      coverUrl: null,
      itemCount: 2,
      comment: "今日打工歌单",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });
});

describe("PlaylistDetailPage", () => {
  it("shares a playlist song with inline composer and updates shared state", async () => {
    renderPage();

    expect(await screen.findByText("Song One")).toBeInTheDocument();
    expect(await screen.findByText("Song Two")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "已分享" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "分享" }));

    const textarea = await screen.findByPlaceholderText("写一句此刻想分享它的理由（可选）");
    await userEvent.type(textarea, "今晚单曲循环");
    await userEvent.click(screen.getByRole("button", { name: "发布到主页 / 广场" }));

    await waitFor(() => {
      expect(apiMocks.apiCreateShare).toHaveBeenCalledWith({
        playlistId: "playlist-1",
        songMid: "song-2",
        comment: "今晚单曲循环",
      });
    });

    expect(resetPlazaPageCacheMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已将《Song Two》发布到主页和广场")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "已分享" })).toHaveLength(2);
  });

  it("shares the whole playlist with the playlist composer", async () => {
    renderPage();

    expect(await screen.findByText("我的收藏")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "分享到广场" }));

    const textarea = await screen.findByPlaceholderText("写一句关于这张歌单的介绍（可选）");
    await userEvent.type(textarea, "今日打工歌单");
    await userEvent.click(screen.getByRole("button", { name: "发布歌单到主页 / 广场" }));

    await waitFor(() => {
      expect(apiMocks.apiCreatePlaylistShare).toHaveBeenCalledWith("playlist-1", {
        comment: "今日打工歌单",
      });
    });

    expect(resetPlazaPageCacheMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已将歌单《我的收藏》发布到主页和广场")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已分享歌单" })).toBeDisabled();
  });

  it("loads shared state across paginated share responses", async () => {
    apiMocks.apiUserShares
      .mockResolvedValueOnce({
        shares: Array.from({ length: 50 }, (_, index) => ({
          id: index + 100,
          songMid: index === 0 ? "song-1" : `other-song-${index}`,
        })),
        total: 51,
        nextCursor: 150,
      })
      .mockResolvedValueOnce({
        shares: [{ id: 99, songMid: "song-2" }],
        total: 51,
        nextCursor: null,
      });
    apiMocks.apiUserPlaylistShares
      .mockResolvedValueOnce({
        shares: Array.from({ length: 50 }, (_, index) => ({
          id: index + 300,
          playlistId: `other-playlist-${index}`,
        })),
        total: 51,
        nextCursor: 350,
      })
      .mockResolvedValueOnce({
        shares: [{ id: 299, playlistId: "playlist-1" }],
        total: 51,
        nextCursor: null,
      });

    renderPage();

    expect(await screen.findByText("Song One")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "已分享" })).toHaveLength(2);
      expect(screen.getByRole("button", { name: "已分享歌单" })).toBeDisabled();
    });
    expect(apiMocks.apiUserShares).toHaveBeenNthCalledWith(1, 7, null, 50);
    expect(apiMocks.apiUserShares).toHaveBeenNthCalledWith(2, 7, 150, 50);
    expect(apiMocks.apiUserPlaylistShares).toHaveBeenNthCalledWith(1, 7, null, 50);
    expect(apiMocks.apiUserPlaylistShares).toHaveBeenNthCalledWith(2, 7, 350, 50);
  });

  it("hides song share actions for viewers", async () => {
    apiMocks.apiGetPlaylistDetail.mockResolvedValue({
      playlist: { ...basePlaylist, role: "viewer" },
      members: [],
    });

    renderPage();

    expect(await screen.findByText("Song One")).toBeInTheDocument();
    expect(screen.queryByText(/在下方歌曲右侧点击“分享”可发布单曲/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已分享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享到广场" })).not.toBeInTheDocument();
  });
});
