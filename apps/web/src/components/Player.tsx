import React, { useEffect, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
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

const playModeLabels = {
  sequential: "顺序播放",
  "repeat-one": "单曲循环",
  shuffle: "随机播放"
} as const;

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
    canPrev,
    canNext,
    next,
    prev,
    playIndex,
    clearQueue,
    setPlayingState,
    cyclePlayMode,
    audioRef
  } = usePlayer();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastAudioUrlRef = React.useRef<string | null>(null);

  const [coverError, setCoverError] = useState(false);

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

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }

  if (!currentSong && !loadingMid && !errorMsg) return null;

  return (
    <div className="player-bar">
      <div className="player-progress-bar" onClick={handleProgressClick}>
        <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
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
            ) : null}
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
          <audio
            ref={audioRef as React.RefObject<HTMLAudioElement>}
            onEmptied={() => setPlayingState(false)}
            style={{ display: "none" }}
          />
          {queue.length > 1 ? <span className="text-xs">{currentIndex + 1} / {queue.length}</span> : null}
        </div>
      </div>

      {queue.length > 1 ? (
        <div className="player-queue-strip">
          {queue.map((song, index) => (
            <button
              key={song.mid}
              onClick={() => playIndex(index)}
              className={`btn btn-sm ${index === currentIndex ? "btn-teal-ghost" : "btn-ghost"}`}
              style={{ flexShrink: 0 }}
            >
              {song.title}
            </button>
          ))}
          <button className="btn btn-sm btn-danger-ghost" onClick={clearQueue} style={{ flexShrink: 0 }}>
            清空
          </button>
        </div>
      ) : null}
    </div>
  );
}
