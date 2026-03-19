import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { apiQqSongUrl } from "../api";

export type PlayerSong = {
  mid: string;
  title: string;
  singer?: string;
  coverUrl?: string;
};

export type PlayMode = "sequential" | "repeat-one" | "shuffle";

type PlayerState = {
  queue: PlayerSong[];
  currentIndex: number;
  currentSong: PlayerSong | null;
  playing: boolean;
  audioUrl: string | null;
  loadingMid: string | null;
  errorMsg: string | null;
  playMode: PlayMode;
  canPrev: boolean;
  canNext: boolean;
  play: (song: PlayerSong, extraQueue?: PlayerSong[]) => void;
  enqueue: (song: PlayerSong) => void;
  playIndex: (index: number) => void;
  next: () => void;
  prev: () => void;
  clearQueue: () => void;
  setPlayingState: (value: boolean) => void;
  isCurrentSong: (mid: string) => boolean;
  togglePlayPause: () => void;
  cyclePlayMode: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

function getPlayableIndex(targetIndex: number, queueLength: number): number {
  if (queueLength <= 0) return -1;
  if (targetIndex < 0 || targetIndex >= queueLength) return 0;
  return targetIndex;
}

const PlayerContext = createContext<PlayerState | null>(null);

function shuffleIndices(length: number, startIndex: number): number[] {
  const indices = Array.from({ length }, (_, index) => index).filter((index) => index !== startIndex);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[swapIndex]] = [indices[swapIndex]!, indices[i]!];
  }
  return [startIndex, ...indices];
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PlayerSong[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingMid, setLoadingMid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>("sequential");
  const playModeRef = useRef<PlayMode>("sequential");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shuffleOrderRef = useRef<number[]>([]);
  const shufflePositionRef = useRef(-1);
  const shuffleHistoryRef = useRef<number[]>([]);
  const currentSong = currentIndex >= 0 ? queue[currentIndex] ?? null : null;

  const resetShuffleState = useCallback((targetIndex: number, nextQueueLength: number) => {
    if (nextQueueLength <= 0 || targetIndex < 0 || targetIndex >= nextQueueLength) {
      shuffleOrderRef.current = [];
      shufflePositionRef.current = -1;
      shuffleHistoryRef.current = [];
      return;
    }
    shuffleOrderRef.current = shuffleIndices(nextQueueLength, targetIndex);
    shufflePositionRef.current = 0;
    shuffleHistoryRef.current = [targetIndex];
  }, []);

  const ensureShuffleState = useCallback((targetIndex: number, nextQueueLength: number) => {
    if (nextQueueLength <= 0 || targetIndex < 0 || targetIndex >= nextQueueLength) {
      resetShuffleState(-1, 0);
      return;
    }
    const order = shuffleOrderRef.current;
    const position = order.indexOf(targetIndex);
    if (order.length !== nextQueueLength || position === -1) {
      resetShuffleState(targetIndex, nextQueueLength);
      return;
    }
    shufflePositionRef.current = position;
    const history = shuffleHistoryRef.current.filter((index) => index >= 0 && index < nextQueueLength);
    if (history[history.length - 1] !== targetIndex) {
      history.push(targetIndex);
    }
    shuffleHistoryRef.current = history;
  }, [resetShuffleState]);

  function cyclePlayMode() {
    setPlayMode((m) => {
      const nextMode: PlayMode = m === "sequential" ? "repeat-one" : m === "repeat-one" ? "shuffle" : "sequential";
      playModeRef.current = nextMode;
      if (nextMode === "shuffle") {
        ensureShuffleState(getPlayableIndex(currentIndex, queue.length), queue.length);
      } else {
        resetShuffleState(-1, 0);
      }
      return nextMode;
    });
  }

  const fetchAndPlay = useCallback(async (song: PlayerSong, idx: number, newQueue?: PlayerSong[]) => {
    setLoadingMid(song.mid);
    setPlaying(false);
    setErrorMsg(null);
    try {
      const url = await apiQqSongUrl(song.mid);
      if (!url) {
        setErrorMsg(`无法获取《${song.title}》的播放链接`);
        return;
      }
      setAudioUrl(url);
      if (newQueue) setQueue(newQueue);
      setCurrentIndex(idx);
      setPlaying(true);
    } catch {
      setErrorMsg(`加载《${song.title}》失败`);
    } finally {
      setLoadingMid(null);
    }
  }, []);

  function play(song: PlayerSong, extraQueue?: PlayerSong[]) {
    const newQueue = extraQueue ?? [song];
    const idx = newQueue.findIndex((s) => s.mid === song.mid);
    const safeIndex = idx === -1 ? 0 : idx;
    if (playModeRef.current === "shuffle") {
      resetShuffleState(safeIndex, newQueue.length);
    } else if (extraQueue) {
      resetShuffleState(-1, 0);
    }
    void fetchAndPlay(song, safeIndex, newQueue);
  }

  function enqueue(song: PlayerSong) {
    setQueue((q) => {
      if (q.find((s) => s.mid === song.mid)) return q;
      const nextQueue = [...q, song];
      if (playModeRef.current === "shuffle") {
        const playableIndex = getPlayableIndex(currentIndex, q.length);
        if (playableIndex >= 0) {
          ensureShuffleState(playableIndex, q.length);
          shuffleOrderRef.current.push(nextQueue.length - 1);
        }
      }
      return nextQueue;
    });
  }

  const playIndex = useCallback((index: number) => {
    setQueue((q) => {
      const song = q[index];
      if (!song) return q;
      if (playModeRef.current === "shuffle") {
        ensureShuffleState(index, q.length);
      }
      void fetchAndPlay(song, index);
      return q;
    });
  }, [ensureShuffleState, fetchAndPlay]);

  const next = useCallback(() => {
    setCurrentIndex((idx) => {
      setQueue((q) => {
        if (q.length === 0) return q;
        if (playModeRef.current === "shuffle") {
          ensureShuffleState(getPlayableIndex(idx, q.length), q.length);
          if (q.length === 1) {
            void fetchAndPlay(q[0]!, 0);
            return q;
          }
          let nextPosition = shufflePositionRef.current + 1;
          if (nextPosition >= shuffleOrderRef.current.length) {
            const currentPlayableIndex = getPlayableIndex(idx, q.length);
            shuffleOrderRef.current = shuffleIndices(q.length, currentPlayableIndex >= 0 ? currentPlayableIndex : 0);
            shufflePositionRef.current = 0;
            shuffleHistoryRef.current = currentPlayableIndex >= 0 ? [currentPlayableIndex] : [];
            nextPosition = 1;
          }
          const nextIndex = shuffleOrderRef.current[nextPosition] ?? shuffleOrderRef.current[0] ?? 0;
          shufflePositionRef.current = nextPosition;
          if (shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1] !== nextIndex) {
            shuffleHistoryRef.current.push(nextIndex);
          }
          void fetchAndPlay(q[nextIndex]!, nextIndex);
        } else {
          const nextIdx = idx + 1 >= q.length ? 0 : idx + 1;
          void fetchAndPlay(q[nextIdx]!, nextIdx);
        }
        return q;
      });
      return idx;
    });
  }, [ensureShuffleState, fetchAndPlay]);

  const prev = useCallback(() => {
    setCurrentIndex((idx) => {
      setQueue((q) => {
        if (q.length === 0) return q;
        if (playModeRef.current === "shuffle") {
          ensureShuffleState(getPlayableIndex(idx, q.length), q.length);
          if (shuffleHistoryRef.current.length <= 1) return q;
          shuffleHistoryRef.current.pop();
          const prevIndex = shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1];
          if (typeof prevIndex !== "number") return q;
          const position = shuffleOrderRef.current.indexOf(prevIndex);
          shufflePositionRef.current = position >= 0 ? position : 0;
          void fetchAndPlay(q[prevIndex]!, prevIndex);
          return q;
        }
        const prevIdx = idx - 1;
        if (prevIdx >= 0) void fetchAndPlay(q[prevIdx]!, prevIdx);
        return q;
      });
      return idx;
    });
  }, [ensureShuffleState, fetchAndPlay]);

  function clearQueue() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    resetShuffleState(-1, 0);
    setQueue([]);
    setCurrentIndex(-1);
    setAudioUrl(null);
    setPlaying(false);
  }

  function isCurrentSong(mid: string) {
    return currentSong?.mid === mid;
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => {
        setPlaying(true);
      }).catch(() => {
        setPlaying(false);
      });
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  const canPrev = playMode === "shuffle"
    ? shuffleHistoryRef.current.length > 1
    : currentIndex > 0;
  const canNext = playMode === "shuffle"
    ? queue.length > 1
    : queue.length > 0 && currentIndex < queue.length - 1;

  return (
    <PlayerContext.Provider
      value={{
        queue,
        currentIndex,
        currentSong,
        playing,
        audioUrl,
        loadingMid,
        errorMsg,
        playMode,
        canPrev,
        canNext,
        play,
        enqueue,
        playIndex,
        next,
        prev,
        clearQueue,
        setPlayingState: setPlaying,
        isCurrentSong,
        togglePlayPause,
        cyclePlayMode,
        audioRef
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}