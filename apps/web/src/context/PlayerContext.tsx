import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { apiQqSongUrl } from "../api";

export type PlayerSong = {
  mid: string;
  title: string;
  singer?: string;
  coverUrl?: string;
};

export type PlayMode = "sequential" | "repeat-one" | "shuffle";
export type QueueSource = "playlist" | "search" | "daily" | "share" | "single" | null;

type PlayerState = {
  queue: PlayerSong[];
  currentIndex: number;
  currentSong: PlayerSong | null;
  playing: boolean;
  audioUrl: string | null;
  loadingMid: string | null;
  errorMsg: string | null;
  playMode: PlayMode;
  queueSource: QueueSource;
  canPrev: boolean;
  canNext: boolean;
  play: (song: PlayerSong, extraQueue?: PlayerSong[], source?: QueueSource, sourceKey?: string | null) => void;
  enqueue: (song: PlayerSong) => void;
  appendToPlaylistQueue: (song: PlayerSong, playlistId?: string | null) => void;
  removeFromPlaylistQueue: (songMid: string, playlistId?: string | null) => void;
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
  const [queueSource, setQueueSource] = useState<QueueSource>(null);
  const playModeRef = useRef<PlayMode>("sequential");
  const queueSourceRef = useRef<QueueSource>(null);
  const queueSourceKeyRef = useRef<string | null>(null);
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

  const cyclePlayMode = useCallback(() => {
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
  }, [currentIndex, ensureShuffleState, queue.length, resetShuffleState]);

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

  const play = useCallback((song: PlayerSong, extraQueue?: PlayerSong[], source?: QueueSource, sourceKey?: string | null) => {
    const newQueue = extraQueue ?? [song];
    const idx = newQueue.findIndex((s) => s.mid === song.mid);
    const safeIndex = idx === -1 ? 0 : idx;
    const nextSource = source ?? (extraQueue ? "single" : null);
    const nextSourceKey = nextSource === "playlist" ? sourceKey ?? null : null;
    queueSourceRef.current = nextSource;
    queueSourceKeyRef.current = nextSourceKey;
    setQueueSource(nextSource);
    if (playModeRef.current === "shuffle") {
      resetShuffleState(safeIndex, newQueue.length);
    } else if (extraQueue) {
      resetShuffleState(-1, 0);
    }
    void fetchAndPlay(song, safeIndex, newQueue);
  }, [fetchAndPlay, resetShuffleState]);

  const enqueue = useCallback((song: PlayerSong) => {
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
  }, [currentIndex, ensureShuffleState]);

  const appendToPlaylistQueue = useCallback((song: PlayerSong, playlistId?: string | null) => {
    if (queueSourceRef.current !== "playlist") return;
    if (!playlistId || !queueSourceKeyRef.current || playlistId !== queueSourceKeyRef.current) return;
    setQueue((q) => {
      if (q.find((item) => item.mid === song.mid)) return q;
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
  }, [currentIndex, ensureShuffleState]);

  const removeFromPlaylistQueue = useCallback((songMid: string, playlistId?: string | null) => {
    if (queueSourceRef.current !== "playlist") return;
    if (!playlistId || !queueSourceKeyRef.current || playlistId !== queueSourceKeyRef.current) return;
    setQueue((q) => {
      const removeIndex = q.findIndex((item) => item.mid === songMid);
      if (removeIndex === -1) return q;

      const nextQueue = q.filter((item) => item.mid !== songMid);
      const removedCurrent = removeIndex === currentIndex;
      const nextIndex =
        nextQueue.length === 0
          ? -1
          : removedCurrent
            ? Math.min(removeIndex, nextQueue.length - 1)
            : currentIndex > removeIndex
              ? currentIndex - 1
              : currentIndex;

      if (playModeRef.current === "shuffle") {
        const remapIndex = (index: number) => {
          if (index === removeIndex) return -1;
          return index > removeIndex ? index - 1 : index;
        };

        shuffleOrderRef.current = shuffleOrderRef.current
          .map(remapIndex)
          .filter((index) => index >= 0);

        shuffleHistoryRef.current = shuffleHistoryRef.current
          .map(remapIndex)
          .filter((index) => index >= 0);

        if (nextIndex >= 0) {
          const position = shuffleOrderRef.current.indexOf(nextIndex);
          shufflePositionRef.current = position >= 0 ? position : 0;
          if (shuffleHistoryRef.current[shuffleHistoryRef.current.length - 1] !== nextIndex) {
            shuffleHistoryRef.current.push(nextIndex);
          }
        } else {
          resetShuffleState(-1, 0);
        }
      }

      setCurrentIndex(nextIndex);

      if (nextQueue.length === 0) {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        queueSourceRef.current = null;
        queueSourceKeyRef.current = null;
        setQueueSource(null);
        setAudioUrl(null);
        setPlaying(false);
      } else if (removedCurrent) {
        void fetchAndPlay(nextQueue[nextIndex]!, nextIndex);
      }

      return nextQueue;
    });
  }, [currentIndex, ensureShuffleState, fetchAndPlay, resetShuffleState]);

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
          const nextIdx = idx + 1;
          if (nextIdx >= q.length) {
            setPlaying(false);
            return q;
          }
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

  const clearQueue = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    resetShuffleState(-1, 0);
    queueSourceRef.current = null;
    queueSourceKeyRef.current = null;
    setQueueSource(null);
    setQueue([]);
    setCurrentIndex(-1);
    setAudioUrl(null);
    setPlaying(false);
  }, [resetShuffleState]);

  const isCurrentSong = useCallback((mid: string) => currentSong?.mid === mid, [currentSong]);

  const togglePlayPause = useCallback(() => {
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
  }, []);

  const canPrev = useMemo(
    () => (playMode === "shuffle" ? shuffleHistoryRef.current.length > 1 : currentIndex > 0),
    [currentIndex, playMode],
  );
  const canNext = useMemo(
    () => (playMode === "shuffle" ? queue.length > 1 : queue.length > 0 && currentIndex >= 0 && currentIndex < queue.length - 1),
    [currentIndex, playMode, queue.length],
  );

  const contextValue = useMemo(
    () => ({
      queue,
      currentIndex,
      currentSong,
      playing,
      audioUrl,
      loadingMid,
      errorMsg,
      playMode,
      queueSource,
      canPrev,
      canNext,
      play,
      enqueue,
      appendToPlaylistQueue,
      removeFromPlaylistQueue,
      playIndex,
      next,
      prev,
      clearQueue,
      setPlayingState: setPlaying,
      isCurrentSong,
      togglePlayPause,
      cyclePlayMode,
      audioRef
    }),
    [
      audioRef,
      audioUrl,
      canNext,
      canPrev,
      clearQueue,
      currentIndex,
      currentSong,
      enqueue,
      errorMsg,
      loadingMid,
      next,
      play,
      playIndex,
      playMode,
      playing,
      prev,
      queue,
      queueSource,
      appendToPlaylistQueue,
      removeFromPlaylistQueue,
      setPlaying,
      togglePlayPause,
      cyclePlayMode,
      isCurrentSong,
    ],
  );

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
