/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage, { resetHomeDailyCache } from "./HomePage";

const apiMocks = vi.hoisted(() => ({
  apiAddSongToDefaultPlaylist: vi.fn(),
  apiQqSearch: vi.fn(),
  apiRecommendDaily: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  currentUser: {
    id: 1,
    username: "user-1",
    name: "User One",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
}));

vi.mock("../api", () => ({
  apiAddSongToDefaultPlaylist: apiMocks.apiAddSongToDefaultPlaylist,
  apiQqSearch: apiMocks.apiQqSearch,
  apiRecommendDaily: apiMocks.apiRecommendDaily,
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
    refreshMids: vi.fn(),
  }),
}));

vi.mock("../components/SongCard", () => ({
  default: ({ item }: { item: { title?: string; songTitle?: string; mid?: string; songMid?: string } }) => (
    <div data-testid="song-card">{item.title ?? item.songTitle ?? item.mid ?? item.songMid}</div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/?tab=daily"]}>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeDailyCache();

  authState.currentUser = {
    id: 1,
    username: "user-1",
    name: "User One",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
});

describe("HomePage", () => {
  it("does not reuse daily recommendation cache across users", async () => {
    apiMocks.apiRecommendDaily
      .mockResolvedValueOnce({
        songs: [],
        seedDate: "2026-04-01",
        sourceTopIds: [],
      })
      .mockResolvedValueOnce({
        songs: [],
        seedDate: "2026-04-02",
        sourceTopIds: [],
      });

    const firstRender = renderPage();

    expect(await screen.findByText(/2026-04-01/)).toBeInTheDocument();

    firstRender.unmount();

    authState.currentUser = {
      id: 2,
      username: "user-2",
      name: "User Two",
      avatarUrl: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    renderPage();

    expect(await screen.findByText(/2026-04-02/)).toBeInTheDocument();
    expect(apiMocks.apiRecommendDaily).toHaveBeenCalledTimes(2);
  });
});
