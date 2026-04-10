import React, { useEffect, useState } from "react";
import { usePlayer, type PlayerSong, type QueueSource } from "../context/PlayerContext";
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

export default function Player() {
  const {
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
    next,
    prev,
    playIndex,
    clearQueue,
    removeFromQueue,
    setPlayingState,
    cyclePlayMode,
    audioRef
  } = usePlayer();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastAudioUrlRef = React.useRef<string | null>(null);
  const [coverError, setCoverError] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const playerBarRef = React.useRef<HTMLDivElement | null>(null);
  const currentQueueItemRef = React.useRef<HTMLDivElement | null>(null);

  // Reset cover error whenever song changes
  const coverSrc = currentSong?.coverUrl;
  React.useEffect(() => {
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
      setCurrentTime(0);
      setDuration(0);
    }

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      setDuration(audio.duration || 0);
    }

    void audio.play().catch(() => {
      setPlayingState(false);
    });
  }, [audioRef, audioUrl, setPlayingState]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const audio = element;

    function syncTimeState() {
      setCurrentTime(audio.currentTime || 0);
      setDuration(audio.duration || 0);
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
        void audio.play().catch(() => setPlayingState(false));
        return;
      }
      setCurrentTime(0);
      setPlayingState(false);
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
  }, [audioRef, audioUrl, next, playMode, setPlayingState]);

  useEffect(() => {
    if (!isQueueOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (playerBarRef.current?.contains(target)) return;
      setIsQueueOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsQueueOpen(false);
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
  }, [isQueueOpen]);

  useEffect(() => {
    if (queue.length === 0) {
      setIsQueueOpen(false);
    }
  }, [queue.length]);

  useEffect(() => {
    if (!isQueueOpen) return;
    const currentQueueItem = currentQueueItemRef.current;
    if (currentQueueItem && typeof currentQueueItem.scrollIntoView === "function") {
      currentQueueItem.scrollIntoView({ block: "nearest" });
    }
  }, [currentIndex, isQueueOpen]);

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

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }

  if (!currentSong && !loadingMid && !errorMsg) return null;

  return (
    <div className="player-bar" ref={playerBarRef}>
      <div className="player-progress-bar" onClick={handleProgressClick}>
        <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="player-shell">
        {isQueueOpen && queue.length > 0 ? (
          <div className="player-queue-drawer" id="player-queue-panel" role="dialog" aria-label="待播队列">
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
                  setIsQueueOpen(false);
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
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (audio.paused) {
                  void audio.play().catch(() => {
                    setPlayingState(false);
                  });
                } else {
                  audio.pause();
                }
              }}
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
            {queue.length > 0 ? (
              <button
                className={`player-queue-toggle ${isQueueOpen ? "player-queue-toggle-active" : ""}`}
                onClick={() => setIsQueueOpen((open) => !open)}
                aria-expanded={isQueueOpen}
                aria-controls="player-queue-panel"
                title="查看待播队列"
              >
                <QueueIcon />
                <span>队列 {queue.length}</span>
              </button>
            ) : null}
            <audio
              ref={audioRef as React.RefObject<HTMLAudioElement>}
              onEmptied={() => setPlayingState(false)}
              style={{ display: "none" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
