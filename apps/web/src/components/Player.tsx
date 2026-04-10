import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { apiQqLyric } from "../api";
import { usePlayer, type PlayerSong, type QueueSource } from "../context/PlayerContext";
import { getActiveLyricLineIndex, parseLyrics, type ParsedLyrics } from "../lyrics";
import { safeUrl } from "../utils";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M7 6h3v12H7zm7 0h3v12h-3z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6l-8.5 6Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6v12Z" />
    </svg>
  );
}

function SequentialIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M2 6h14v2H2zm0 5h14v2H2zm0 5h14v2H2zm16-9v10l5-5-5-5Z" />
    </svg>
  );
}

function RepeatOneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M7 7h10v1.8L21 5l-4-3.8V3H5v6h2V7zm10 10H7v-1.8L3 19l4 3.8V21h12v-6h-2v2zm-4-8h-1.5v1H10v1h1.5v4H13V9z" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M4 7h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm13-8.5V6l5 3-5 3V9.5z" />
    </svg>
  );
}

function LyricsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M4 6h16v2H4zm0 5h10v2H4zm0 5h16v2H4zm13-5.25V8.5h2v6.18a2.75 2.75 0 1 1-2-2.63z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="m18.3 5.71-1.41-1.42L12 9.17 7.11 4.29 5.7 5.71 10.59 10.6 5.7 15.49l1.41 1.41L12 12.01l4.89 4.89 1.41-1.41-4.88-4.89 4.88-4.89z" />
    </svg>
  );
}

const playModeLabels = {
  sequential: "顺序播放",
  "repeat-one": "单曲循环",
  shuffle: "随机播放"
} as const;

const queueSourceLabels: Record<Exclude<QueueSource, null>, string> = {
  playlist: "来自歌单",
  search: "来自搜索结果",
  daily: "来自今日推荐",
  share: "来自分享",
  single: "单曲播放"
};

type PlayerPanel = "queue" | "lyrics" | null;

type LyricViewState = {
  mid: string | null;
  status: "idle" | "loading" | "ready" | "empty" | "error";
  parsed: ParsedLyrics | null;
  message: string | null;
};

type CachedLyricEntry = {
  status: "ready" | "empty";
  parsed: ParsedLyrics;
  message: null;
};

export default function Player() {
  const {
    queue,
    currentIndex,
    currentSong,
    playing,
    audioUrl,
    currentTime,
    duration,
    loadingMid,
    errorMsg,
    playMode,
    queueSource,
    canPrev,
    canNext,
    next,
    prev,
    playIndex,
    clearQueue,
    removeFromQueue,
    setPlayingState,
    setPlaybackProgress,
    seekTo,
    togglePlayPause,
    cyclePlayMode,
    audioRef
  } = usePlayer();
  const lastAudioUrlRef = useRef<string | null>(null);
  const [coverError, setCoverError] = useState(false);
  const [openPanel, setOpenPanel] = useState<PlayerPanel>(null);
  const [lyricState, setLyricState] = useState<LyricViewState>({
    mid: null,
    status: "idle",
    parsed: null,
    message: null,
  });
  const lyricCacheRef = useRef<Map<string, CachedLyricEntry>>(new Map());
  const playerBarRef = useRef<HTMLDivElement | null>(null);
  const currentQueueItemRef = useRef<HTMLDivElement | null>(null);
  const activeLyricLineRef = useRef<HTMLDivElement | null>(null);
  const isQueueOpen = openPanel === "queue";
  const isLyricsOpen = openPanel === "lyrics";
  const lyricsPanelId = "player-lyrics-panel";
  const queuePanelId = "player-queue-panel";

  // Reset cover error whenever song changes
  const coverSrc = currentSong?.coverUrl;
  useEffect(() => {
    setCoverError(false);
  }, [coverSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (lastAudioUrlRef.current !== audioUrl) {
      lastAudioUrlRef.current = audioUrl;
      audio.pause();
      audio.src = audioUrl;
      audio.load();
      setPlaybackProgress(0, 0);
    }

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      setPlaybackProgress(audio.currentTime || 0, audio.duration || 0);
    }

    void audio.play().catch(() => {
      setPlayingState(false);
    });
  }, [audioRef, audioUrl, setPlaybackProgress, setPlayingState]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const audio = element;

    function syncTimeState() {
      setPlaybackProgress(audio.currentTime || 0, audio.duration || 0);
    }

    function handleTimeUpdate() {
      syncTimeState();
    }

    function handleLoadedMetadata() {
      syncTimeState();
    }

    function handlePlay() {
      setPlayingState(true);
      syncTimeState();
    }

    function handlePause() {
      setPlayingState(false);
      syncTimeState();
    }

    function handleEnded() {
      if (playMode === "repeat-one") {
        audio.currentTime = 0;
        syncTimeState();
        void audio.play().catch(() => setPlayingState(false));
        return;
      }
      setPlayingState(false);
      setPlaybackProgress(0, audio.duration || 0);
      next();
    }

    syncTimeState();

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioRef, audioUrl, next, playMode, setPlaybackProgress, setPlayingState]);

  useEffect(() => {
    if (!openPanel) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (playerBarRef.current?.contains(target)) return;
      setOpenPanel(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPanel(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPanel]);

  useEffect(() => {
    if (queue.length === 0 && isQueueOpen) {
      setOpenPanel(null);
    }
  }, [isQueueOpen, queue.length]);

  useEffect(() => {
    if (!isQueueOpen) return;
    const currentQueueItem = currentQueueItemRef.current;
    if (currentQueueItem && typeof currentQueueItem.scrollIntoView === "function") {
      currentQueueItem.scrollIntoView({ block: "nearest" });
    }
  }, [currentIndex, isQueueOpen]);

  useEffect(() => {
    if (!currentSong && isLyricsOpen) {
      setOpenPanel(null);
    }
  }, [currentSong, isLyricsOpen]);

  useEffect(() => {
    if (!isLyricsOpen) return;
    const songMid = currentSong?.mid;
    if (!songMid) {
      setLyricState({ mid: null, status: "idle", parsed: null, message: null });
      return;
    }

    const cached = lyricCacheRef.current.get(songMid);
    if (cached) {
      setLyricState({ mid: songMid, ...cached });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLyricState({ mid: songMid, status: "loading", parsed: null, message: null });

    void apiQqLyric(songMid, { trans: true }, controller.signal)
      .then((payload) => {
        if (cancelled) return;
        const parsed = parseLyrics(payload);
        const nextState: CachedLyricEntry = parsed.lines.length > 0
          ? { status: "ready", parsed, message: null }
          : { status: "empty", parsed, message: null };
        lyricCacheRef.current.set(songMid, nextState);
        setLyricState({ mid: songMid, ...nextState });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const errorName = typeof error === "object" && error && "name" in error
          ? (error as { name?: string }).name
          : null;
        if (errorName === "AbortError") return;
        setLyricState({
          mid: songMid,
          status: "error",
          parsed: null,
          message: error instanceof Error ? error.message : "歌词加载失败",
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentSong?.mid, isLyricsOpen]);

  const activeLyricLineIndex = useMemo(() => {
    if (!lyricState.parsed?.timed) return -1;
    return getActiveLyricLineIndex(lyricState.parsed.lines, currentTime * 1000);
  }, [currentTime, lyricState.parsed]);

  useEffect(() => {
    if (!isLyricsOpen || activeLyricLineIndex < 0) return;
    const activeLyricLine = activeLyricLineRef.current;
    if (activeLyricLine && typeof activeLyricLine.scrollIntoView === "function") {
      activeLyricLine.scrollIntoView({ block: "center" });
    }
  }, [activeLyricLineIndex, isLyricsOpen]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const queueSourceLabel = queueSource ? queueSourceLabels[queueSource] : "当前播放";
  const otherSongs = queue.filter((_, index) => index !== currentIndex);
  const otherSongsTitle = playMode === "sequential" ? "接下来" : "队列中的其他歌曲";
  const playbackStateLabel =
    currentSong && loadingMid === currentSong.mid ? "加载中…" : playing ? "播放中" : "已暂停";

  function renderQueueItem(song: PlayerSong, index: number, options?: { current?: boolean; stateLabel?: string }) {
    const isCurrent = Boolean(options?.current);
    const stateLabel = options?.stateLabel;

    const content = (
      <>
        <span className="player-queue-item-index">{index + 1}</span>
        {song.coverUrl && safeUrl(song.coverUrl) ? (
          <img
            src={safeUrl(song.coverUrl)!}
            alt={song.title}
            className="cover"
            style={{ width: 40, height: 40, borderRadius: 10 }}
          />
        ) : (
          <div className="cover-placeholder" style={{ width: 40, height: 40, fontSize: 14 }}>♪</div>
        )}
        <div className="player-queue-item-text">
          <div className="player-queue-item-title truncate">{song.title}</div>
          {song.singer ? (
            <div className="player-queue-item-meta truncate">{song.singer}</div>
          ) : (
            <div className="player-queue-item-meta truncate">{queueSourceLabel}</div>
          )}
        </div>
        {stateLabel ? <span className="player-queue-item-state">{stateLabel}</span> : null}
      </>
    );

    return (
      <div
        key={`${song.mid}-${index}${isCurrent ? "-current" : ""}`}
        ref={isCurrent ? currentQueueItemRef : undefined}
        className={`player-queue-item ${isCurrent ? "player-queue-item-current" : ""}`}
      >
        {isCurrent ? (
          <div className="player-queue-item-main">{content}</div>
        ) : (
          <button
            type="button"
            className="player-queue-item-main player-queue-item-jump"
            onClick={() => playIndex(index)}
          >
            {content}
          </button>
        )}
        <button
          type="button"
          className="player-queue-item-remove"
          title={`从队列移除《${song.title}》`}
          aria-label={`从队列移除《${song.title}》`}
          onClick={() => removeFromQueue(song.mid)}
        >
          <RemoveIcon />
        </button>
      </div>
    );
  }

  function handleProgressClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  function renderLyricContent() {
    if (!currentSong) {
      return <div className="player-lyrics-empty">当前没有正在播放的歌曲</div>;
    }

    if (lyricState.status === "loading") {
      return (
        <div className="player-lyrics-empty player-lyrics-status">
          <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
          <span>正在加载歌词…</span>
        </div>
      );
    }

    if (lyricState.status === "error") {
      return <div className="player-lyrics-empty">{lyricState.message ?? "歌词加载失败"}</div>;
    }

    if (!lyricState.parsed || lyricState.parsed.lines.length === 0 || lyricState.status === "empty") {
      return <div className="player-lyrics-empty">这首歌暂无可显示的歌词</div>;
    }

    return (
      <div className={`player-lyrics-list ${lyricState.parsed.timed ? "" : "player-lyrics-list-plain"}`}>
        {lyricState.parsed.lines.map((line, index) => {
          const isActive = index === activeLyricLineIndex;
          return (
            <div
              key={line.key}
              ref={isActive ? activeLyricLineRef : undefined}
              className={`player-lyric-line ${isActive ? "player-lyric-line-active" : ""}`}
            >
              <div className="player-lyric-line-text">{line.text}</div>
              {line.transText ? (
                <div className="player-lyric-line-trans">{line.transText}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (!currentSong && !loadingMid && !errorMsg) return null;

  return (
    <div className="player-bar" ref={playerBarRef}>
      <div className="player-progress-bar" onClick={handleProgressClick}>
        <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="player-shell">
        {isQueueOpen && queue.length > 0 ? (
          <div className="player-queue-drawer" id={queuePanelId} role="dialog" aria-label="待播队列">
            <div className="player-queue-header">
              <div>
                <div className="player-queue-title">待播队列</div>
                <div className="player-queue-subtitle">
                  {queueSourceLabel} · {playModeLabels[playMode]} · 共 {queue.length} 首
                </div>
              </div>
              <button
                className="btn btn-danger-ghost btn-sm"
                onClick={() => {
                  setOpenPanel(null);
                  clearQueue();
                }}
              >
                清空
              </button>
            </div>

            <div className="player-queue-content">
              {currentSong ? (
                <div className="player-queue-section">
                  <div className="player-queue-section-label">正在播放</div>
                  {renderQueueItem(currentSong, currentIndex, { current: true, stateLabel: playbackStateLabel })}
                </div>
              ) : null}

              {otherSongs.length > 0 || !currentSong ? (
                <div className="player-queue-section">
                  <div className="player-queue-section-label">
                    {currentSong ? otherSongsTitle : "当前队列"}
                  </div>
                  <div className="player-queue-list">
                    {queue.map((song, index) => {
                      if (index === currentIndex && currentSong) return null;
                      return renderQueueItem(song, index);
                    })}
                  </div>
                </div>
              ) : (
                <div className="player-queue-empty">队列里还没有其他歌曲</div>
              )}
            </div>
          </div>
        ) : null}

        {isLyricsOpen ? (
          <div className="player-queue-drawer player-lyrics-drawer" id={lyricsPanelId} role="dialog" aria-label="当前歌词">
            <div className="player-queue-header">
              <div>
                <div className="player-queue-title">当前歌词</div>
                <div className="player-queue-subtitle">
                  {currentSong?.title ?? "当前播放"}
                  {currentSong?.singer ? ` · ${currentSong.singer}` : ""}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setOpenPanel(null)}
              >
                收起
              </button>
            </div>

            <div className="player-lyrics-content">
              {renderLyricContent()}
            </div>
          </div>
        ) : null}

        <div className="player-inner">
          <div className="player-song-info">
            {currentSong?.coverUrl && safeUrl(currentSong.coverUrl) && !coverError ? (
              <img
                src={safeUrl(currentSong.coverUrl)!}
                alt={currentSong.title}
                width={42}
                height={42}
                className="cover"
                style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0 }}
                onError={() => setCoverError(true)}
              />
            ) : (
              <div className="cover-placeholder" style={{ width: 42, height: 42, fontSize: 16, flexShrink: 0 }}>
                ♪
              </div>
            )}

            <div style={{ minWidth: 0 }}>
              <div className="song-title truncate">{currentSong?.title ?? (errorMsg ? "播放失败" : "加载中…")}</div>
              {errorMsg ? (
                <div className="song-meta truncate" style={{ color: "var(--red)" }}>{errorMsg}</div>
              ) : currentSong?.singer ? (
                <div className="song-meta truncate">{currentSong.singer}</div>
              ) : (
                <div className="song-meta truncate">{queueSourceLabel}</div>
              )}
            </div>
          </div>

          <div className="player-controls">
            <button
              className={`ctrl-btn ${playMode !== "sequential" ? "ctrl-btn-active" : ""}`}
              onClick={cyclePlayMode}
              title={playModeLabels[playMode]}
            >
              {playMode === "repeat-one" ? <RepeatOneIcon /> : playMode === "shuffle" ? <ShuffleIcon /> : <SequentialIcon />}
            </button>

            <button className="ctrl-btn" onClick={prev} disabled={!canPrev} title="上一首">
              <PrevIcon />
            </button>

            <button
              className="play-btn"
              onClick={togglePlayPause}
              title={playing ? "暂停" : "播放"}
            >
              {loadingMid ? (
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              ) : playing ? (
                <PauseIcon />
              ) : (
                <PlayIcon />
              )}
            </button>

            <button
              className="ctrl-btn"
              onClick={next}
              disabled={!canNext}
              title="下一首"
            >
              <NextIcon />
            </button>
          </div>

          <div className="player-audio-wrap">
            <span className="player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            {currentSong ? (
              <button
                className={`player-queue-toggle ${isLyricsOpen ? "player-queue-toggle-active" : ""}`}
                onClick={() => setOpenPanel((panel) => panel === "lyrics" ? null : "lyrics")}
                aria-expanded={isLyricsOpen}
                aria-controls={lyricsPanelId}
                title="查看当前歌词"
              >
                <LyricsIcon />
                <span>歌词</span>
              </button>
            ) : null}
            {queue.length > 0 ? (
              <button
                className={`player-queue-toggle ${isQueueOpen ? "player-queue-toggle-active" : ""}`}
                onClick={() => setOpenPanel((panel) => panel === "queue" ? null : "queue")}
                aria-expanded={isQueueOpen}
                aria-controls={queuePanelId}
                title="查看待播队列"
              >
                <QueueIcon />
                <span>队列 {queue.length}</span>
              </button>
            ) : null}
            <audio
              ref={audioRef}
              onEmptied={() => setPlayingState(false)}
              style={{ display: "none" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
