import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Player from "./Player";

const usePlayerMock = vi.hoisted(() => vi.fn());

vi.mock("../context/PlayerContext", () => ({
  usePlayer: usePlayerMock,
}));

describe("Player", () => {
  it("removes a single song from the queue drawer", () => {
    const removeFromQueue = vi.fn();

    usePlayerMock.mockReturnValue({
      queue: [
        { mid: "song-1", title: "第一首", singer: "歌手甲" },
        { mid: "song-2", title: "第二首", singer: "歌手乙" },
      ],
      currentIndex: 0,
      currentSong: { mid: "song-1", title: "第一首", singer: "歌手甲" },
      playing: true,
      audioUrl: null,
      loadingMid: null,
      errorMsg: null,
      playMode: "sequential",
      queueSource: "playlist",
      canPrev: false,
      canNext: true,
      play: vi.fn(),
      enqueue: vi.fn(),
      appendToPlaylistQueue: vi.fn(),
      removeFromQueue,
      removeFromPlaylistQueue: vi.fn(),
      playIndex: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      clearQueue: vi.fn(),
      setPlayingState: vi.fn(),
      isCurrentSong: vi.fn((mid: string) => mid === "song-1"),
      togglePlayPause: vi.fn(),
      cyclePlayMode: vi.fn(),
      audioRef: { current: null },
    });

    render(<Player />);

    fireEvent.click(screen.getByRole("button", { name: /队列 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /从队列移除《第二首》/i }));

    expect(removeFromQueue).toHaveBeenCalledWith("song-2");
  });
});
