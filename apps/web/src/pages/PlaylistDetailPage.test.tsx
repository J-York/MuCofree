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
  apiCreateShare: vi.fn(),
  apiImportQqPlaylist: vi.fn(),
  apiUpdatePlaylistMember: vi.fn(),
  apiRemovePlaylistMember: vi.fn(),
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
  apiCreateShare: apiMocks.apiCreateShare,
  apiImportQqPlaylist: apiMocks.apiImportQqPlaylist,
  apiUpdatePlaylistMember: apiMocks.apiUpdatePlaylistMember,
  apiRemovePlaylistMember: apiMocks.apiRemovePlaylistMember,
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
  });
  apiMocks.apiCreateShare.mockResolvedValue({
    share: { id: 10, userId: 7, songMid: "song-2", comment: "今晚单曲循环" },
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

  it("hides song share actions for viewers", async () => {
    apiMocks.apiGetPlaylistDetail.mockResolvedValue({
      playlist: { ...basePlaylist, role: "viewer" },
      members: [],
    });

    renderPage();

    expect(await screen.findByText("Song One")).toBeInTheDocument();
    expect(screen.queryByText("在下方歌曲右侧点击“分享”，即可发布到个人主页和广场。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已分享" })).not.toBeInTheDocument();
  });
});
