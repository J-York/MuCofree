import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerProvider, usePlayer, type PlayerSong } from "./PlayerContext";

const apiQqSongUrlMock = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  apiQqSongUrl: apiQqSongUrlMock,
}));

const songs: PlayerSong[] = [
  { mid: "a", title: "第一首", singer: "歌手甲" },
  { mid: "b", title: "第二首", singer: "歌手乙" },
  { mid: "c", title: "第三首", singer: "歌手丙" },
];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function PlayerHarness() {
  const {
    play,
    playIndex,
    removeFromQueue,
    cyclePlayMode,
    queue,
    currentIndex,
    currentSong,
    audioUrl,
    loadingMid,
    playMode,
  } = usePlayer();

  return (
    <div>
      <button onClick={() => play(songs[0]!, songs, "search")}>开始播放队列</button>
      <button onClick={cyclePlayMode}>切换播放模式</button>
      <button onClick={() => playIndex(2)}>加载第三首</button>
      <button onClick={() => removeFromQueue("a")}>移除第一首</button>
      <button onClick={() => removeFromQueue("c")}>移除第三首</button>
      <div data-testid="queue">{queue.map((song) => song.mid).join(",") || "empty"}</div>
      <div data-testid="current-index">{String(currentIndex)}</div>
      <div data-testid="current-song">{currentSong?.mid ?? "none"}</div>
      <div data-testid="audio-url">{audioUrl ?? "none"}</div>
      <div data-testid="loading-mid">{loadingMid ?? "none"}</div>
      <div data-testid="play-mode">{playMode}</div>
    </div>
  );
}

function renderHarness() {
  render(
    <PlayerProvider>
      <PlayerHarness />
    </PlayerProvider>,
  );
}

afterEach(() => {
  apiQqSongUrlMock.mockReset();
  vi.restoreAllMocks();
});

describe("PlayerContext", () => {
  it("keeps shuffle playback order when removing the current song", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    apiQqSongUrlMock.mockImplementation(async (mid: string) => `url-${mid}`);

    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "开始播放队列" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-song")).toHaveTextContent("a");
      expect(screen.getByTestId("audio-url")).toHaveTextContent("url-a");
    });

    fireEvent.click(screen.getByRole("button", { name: "切换播放模式" }));
    fireEvent.click(screen.getByRole("button", { name: "切换播放模式" }));

    expect(screen.getByTestId("play-mode")).toHaveTextContent("shuffle");

    fireEvent.click(screen.getByRole("button", { name: "移除第一首" }));

    await waitFor(() => {
      expect(screen.getByTestId("queue")).toHaveTextContent("b,c");
      expect(screen.getByTestId("current-song")).toHaveTextContent("c");
      expect(screen.getByTestId("current-index")).toHaveTextContent("1");
      expect(screen.getByTestId("audio-url")).toHaveTextContent("url-c");
    });

    randomSpy.mockRestore();
  });

  it("ignores stale load results after the loading song is removed", async () => {
    const thirdSongDeferred = createDeferred<string | null>();

    apiQqSongUrlMock.mockImplementation((mid: string) => {
      if (mid === "a") return Promise.resolve("url-a");
      if (mid === "c") return thirdSongDeferred.promise;
      return Promise.resolve(`url-${mid}`);
    });

    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "开始播放队列" }));

    await waitFor(() => {
      expect(screen.getByTestId("queue")).toHaveTextContent("a,b,c");
      expect(screen.getByTestId("current-song")).toHaveTextContent("a");
      expect(screen.getByTestId("audio-url")).toHaveTextContent("url-a");
    });

    fireEvent.click(screen.getByRole("button", { name: "加载第三首" }));

    await waitFor(() => {
      expect(screen.getByTestId("loading-mid")).toHaveTextContent("c");
    });

    fireEvent.click(screen.getByRole("button", { name: "移除第三首" }));

    await waitFor(() => {
      expect(screen.getByTestId("queue")).toHaveTextContent("a,b");
      expect(screen.getByTestId("loading-mid")).toHaveTextContent("none");
    });

    await act(async () => {
      thirdSongDeferred.resolve("url-c");
      await thirdSongDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-song")).toHaveTextContent("a");
      expect(screen.getByTestId("current-index")).toHaveTextContent("0");
      expect(screen.getByTestId("audio-url")).toHaveTextContent("url-a");
      expect(screen.getByTestId("queue")).toHaveTextContent("a,b");
    });
  });
});
