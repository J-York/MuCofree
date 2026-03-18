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

const PlayerContext = createContext<PlayerState | null>(null);

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
  const currentSong = currentIndex >= 0 ? queue[currentIndex] ?? null : null;

  function cyclePlayMode() {
    setPlayMode((m) => {
      const next: PlayMode = m === "sequential" ? "repeat-one" : m === "repeat-one" ? "shuffle" : "sequential";
      playModeRef.current = next;
      return next;
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
    void fetchAndPlay(song, idx === -1 ? 0 : idx, newQueue);
  }

  function enqueue(song: PlayerSong) {
    setQueue((q) => {
      if (q.find((s) => s.mid === song.mid)) return q;
      return [...q, song];
    });
  }

  const playIndex = useCallback((index: number) => {
    setQueue((q) => {
      const song = q[index];
      if (song) void fetchAndPlay(song, index);
      return q;
    });
  }, [fetchAndPlay]);

  const next = useCallback(() => {
    setCurrentIndex((idx) => {
      setQueue((q) => {
        if (q.length === 0) return q;
        if (playModeRef.current === "shuffle") {
          if (q.length === 1) {
            void fetchAndPlay(q[0]!, 0);
          } else {
            let randIdx: number;
            do {
              randIdx = Math.floor(Math.random() * q.length);
            } while (randIdx === idx);
            void fetchAndPlay(q[randIdx]!, randIdx);
          }
        } else {
          const nextIdx = idx + 1 >= q.length ? 0 : idx + 1;
          void fetchAndPlay(q[nextIdx]!, nextIdx);
        }
        return q;
      });
      return idx;
    });
  }, [fetchAndPlay]);

  const prev = useCallback(() => {
    setCurrentIndex((idx) => {
      setQueue((q) => {
        const prevIdx = idx - 1;
        if (prevIdx >= 0) void fetchAndPlay(q[prevIdx]!, prevIdx);
        return q;
      });
      return idx;
    });
  }, [fetchAndPlay]);

  function clearQueue() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
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
