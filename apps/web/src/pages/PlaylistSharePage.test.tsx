/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaylistSharePage from "./PlaylistSharePage";

const apiMocks = vi.hoisted(() => ({
  apiResolvePlaylistShareToken: vi.fn(),
  apiJoinPlaylistShareToken: vi.fn(),
  apiGetPlaylistItems: vi.fn(),
}));

vi.mock("../api", () => ({
  apiResolvePlaylistShareToken: apiMocks.apiResolvePlaylistShareToken,
  apiJoinPlaylistShareToken: apiMocks.apiJoinPlaylistShareToken,
  apiGetPlaylistItems: apiMocks.apiGetPlaylistItems,
}));

const usePlayerMock = vi.hoisted(() =>
  vi.fn(() => ({
    play: vi.fn(),
    isCurrentSong: () => false,
    currentSong: null,
    playing: false,
    loadingMid: null,
  })),
);

vi.mock("../context/PlayerContext", () => ({
  usePlayer: usePlayerMock,
}));

vi.mock("../components/SongCard", () => ({
  default: ({ item }: { item: { songMid?: string; mid?: string } }) => (
    <div data-testid="song-card">{item.songMid ?? item.mid}</div>
  ),
}));

function renderPage(token = "share-token") {
  render(
    <MemoryRouter initialEntries={[`/playlist/share/${token}`]}>
      <Routes>
        <Route path="/playlist/share/:token" element={<PlaylistSharePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const basePlaylist = {
  id: "playlist-1",
  ownerUserId: 1,
  name: "Shared Playlist",
  description: null,
  visibility: "link_readonly",
  revision: 1,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

const baseLink = {
  id: 1,
  playlistId: "playlist-1",
  scope: "read",
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxUses: null,
  usedCount: 0,
  lastUsedAt: null,
  revokedAt: null,
  createdByUserId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlaylistSharePage", () => {
  it("joins share link then loads songs", async () => {
    apiMocks.apiResolvePlaylistShareToken
      .mockResolvedValueOnce({
        link: baseLink,
        playlist: basePlaylist,
        membership: null,
        canRead: false,
        canEdit: false,
        requiresJoin: true,
      })
      .mockResolvedValueOnce({
        link: baseLink,
        playlist: basePlaylist,
        membership: {
          userId: 2,
          role: "viewer",
          status: "active",
          invitedByUserId: 1,
          joinedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        canRead: true,
        canEdit: false,
        requiresJoin: false,
      });

    apiMocks.apiJoinPlaylistShareToken.mockResolvedValue({
      playlist: basePlaylist,
      membership: {
        userId: 2,
        role: "viewer",
        status: "active",
        invitedByUserId: 1,
        joinedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      link: baseLink,
    });

    apiMocks.apiGetPlaylistItems.mockResolvedValue({
      items: [
        {
          id: 1,
          playlistId: "playlist-1",
          songMid: "song-mid-1",
          songTitle: "Song 1",
          songSubtitle: null,
          singerName: "Singer",
          albumMid: null,
          albumName: null,
          coverUrl: null,
          position: 0,
          addedByUserId: 1,
          addedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      nextOffset: null,
      revision: 2,
    });

    renderPage();

    const joinButton = await screen.findByRole("button", { name: "加入歌单" });
    await userEvent.click(joinButton);

    await waitFor(() => {
      expect(apiMocks.apiJoinPlaylistShareToken).toHaveBeenCalledWith("share-token");
    });

    expect(await screen.findByTestId("song-card")).toHaveTextContent("song-mid-1");
  });

  it("shows pending approval state", async () => {
    apiMocks.apiResolvePlaylistShareToken.mockResolvedValue({
      link: { ...baseLink, scope: "edit" },
      playlist: basePlaylist,
      membership: {
        userId: 2,
        role: "editor",
        status: "pending",
        invitedByUserId: 1,
        joinedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      canRead: false,
      canEdit: false,
      requiresJoin: false,
    });

    renderPage("pending-token");

    expect(await screen.findByText(/等待歌单 owner 审批后可查看内容/i)).toBeInTheDocument();
  });

  it("renders API error messages", async () => {
    apiMocks.apiResolvePlaylistShareToken.mockRejectedValue(new Error("Share link expired"));

    renderPage("expired-token");

    expect(await screen.findByText("Share link expired")).toBeInTheDocument();
  });
});
