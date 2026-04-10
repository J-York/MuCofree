import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Player from "./Player";

const usePlayerMock = vi.hoisted(() => vi.fn());
const apiQqLyricMock = vi.hoisted(() => vi.fn());

vi.mock("../context/PlayerContext", () => ({
  usePlayer: usePlayerMock,
}));

vi.mock("../api", () => ({
  apiQqLyric: apiQqLyricMock,
}));

function createPlayerState(overrides: Record<string, unknown> = {}) {
  return {
    queue: [
      { mid: "song-1", title: "第一首", singer: "歌手甲" },
      { mid: "song-2", title: "第二首", singer: "歌手乙" },
    ],
    currentIndex: 0,
    currentSong: { mid: "song-1", title: "第一首", singer: "歌手甲" },
    playing: true,
    audioUrl: null,
    currentTime: 6,
    duration: 12,
    loadingMid: null,
    errorMsg: null,
    playMode: "sequential",
    queueSource: "playlist",
    canPrev: false,
    canNext: true,
    play: vi.fn(),
    enqueue: vi.fn(),
    appendToPlaylistQueue: vi.fn(),
    removeFromQueue: vi.fn(),
    removeFromPlaylistQueue: vi.fn(),
    playIndex: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    clearQueue: vi.fn(),
    setPlayingState: vi.fn(),
    setPlaybackProgress: vi.fn(),
    seekTo: vi.fn(),
    isCurrentSong: vi.fn((mid: string) => mid === "song-1"),
    togglePlayPause: vi.fn(),
    cyclePlayMode: vi.fn(),
    audioRef: { current: null },
    ...overrides,
  };
}

afterEach(() => {
  usePlayerMock.mockReset();
  apiQqLyricMock.mockReset();
});

describe("Player", () => {
  it("removes a single song from the queue drawer", () => {
    const removeFromQueue = vi.fn();

    usePlayerMock.mockReturnValue(createPlayerState({ removeFromQueue }));

    render(<Player />);

    fireEvent.click(screen.getByRole("button", { name: /队列 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /从队列移除《第二首》/i }));

    expect(removeFromQueue).toHaveBeenCalledWith("song-2");
  });

  it("loads lyrics into the lyrics drawer and highlights the active line", async () => {
    apiQqLyricMock.mockResolvedValue({
      lyric: "[00:05.00]第一句\n[00:10.00]第二句",
      trans: "[00:05.00]First line\n[00:10.00]Second line",
      roma: null,
      format: "lrc",
    });

    usePlayerMock.mockReturnValue(createPlayerState());

    render(<Player />);

    fireEvent.click(screen.getByRole("button", { name: /歌词/i }));

    expect(await screen.findByRole("dialog", { name: /当前歌词/i })).toBeInTheDocument();
    expect(await screen.findByText("第一句")).toBeInTheDocument();
    expect(screen.getByText("First line")).toBeInTheDocument();
    expect(apiQqLyricMock).toHaveBeenCalledWith("song-1", { trans: true }, expect.any(AbortSignal));
    expect(screen.getByText("第一句").closest(".player-lyric-line")).toHaveClass("player-lyric-line-active");
  });
});
