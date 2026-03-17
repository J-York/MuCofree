import { useState } from "react";
import { safeUrl } from "../utils";
import type { PlaylistSong, QqSong, Share } from "../api";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";

// ── Unified song shape accepted by this component ────────────────────────────
export type SongItem = QqSong | Share | PlaylistSong;

function toPlayerSong(item: SongItem): PlayerSong {
  if ("mid" in item) {
    // QqSong
    return { mid: item.mid, title: item.title, singer: item.singer, coverUrl: item.coverUrl };
  }
  // Share or PlaylistSong
  return {
    mid: item.songMid,
    title: item.songTitle ?? item.songMid,
    singer: item.singerName ?? undefined,
    coverUrl: item.coverUrl ?? undefined
  };
}

function getCoverUrl(item: SongItem): string | null {
  if ("mid" in item) return item.coverUrl ?? null;
  return item.coverUrl ?? null;
}

function getTitle(item: SongItem): string {
  if ("mid" in item) return item.title;
  return item.songTitle ?? item.songMid;
}

function getMeta(item: SongItem): string {
  if ("mid" in item) {
    return [item.singer, item.subtitle].filter(Boolean).join(" · ");
  }
  return [item.singerName, item.songSubtitle].filter(Boolean).join(" · ");
}

type Props = {
  item: SongItem;
  /** Whether this card is the current active song */
  active?: boolean;
  /** Whether playback is currently running */
  playing?: boolean;
  /** Whether this card is in the selected-to-share set */
  selected?: boolean;
  /** Whether this card is loading (fetching URL) */
  loading?: boolean;
  onPlay?: (song: PlayerSong) => void;
  /** Secondary action button label + handler */
  action?: { label: string; onClick: () => void; variant?: string; disabled?: boolean };
  /** Tertiary action (e.g. delete) */
  secondAction?: { label: string; onClick: () => void };
  /** Click on the whole card */
  onClick?: () => void;
};

export default function SongCard({
  item,
  active,
  playing,
  selected,
  loading,
  onPlay,
  action,
  secondAction,
  onClick
}: Props) {
  const { togglePlayPause } = usePlayer();
  const cover = getCoverUrl(item);
  const title = getTitle(item);
  const meta = getMeta(item);
  const [coverError, setCoverError] = useState(false);

  const cardClass = [
    "song-card",
    active ? "playing" : "",
    selected ? "selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  function handleCardClick() {
    if (onClick) {
      onClick();
    } else if (onPlay) {
      onPlay(toPlayerSong(item));
    }
  }

  return (
    <div className={cardClass} onClick={handleCardClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCardClick(); }}>
      {/* Cover */}
      {safeUrl(cover) && !coverError ? (
        <img src={safeUrl(cover)!} alt={title} width={44} height={44} className="cover" style={{ width: 44, height: 44 }} onError={() => setCoverError(true)} />
      ) : (
        <div className="cover-placeholder" style={{ width: 44, height: 44 }}>♪</div>
      )}

      {/* Info */}
      <div className="song-info">
        <div className="song-title">{title}</div>
        {meta ? <div className="song-meta">{meta}</div> : null}
      </div>

      {/* Actions */}
      <div className="song-actions" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="spinner" />
        ) : onPlay ? (
          <button
            className="btn btn-teal-ghost btn-sm btn-icon"
            title={playing ? "暂停" : "播放"}
            onClick={() => {
              if (active) {
                togglePlayPause();
              } else {
                onPlay(toPlayerSong(item));
              }
            }}
          >
            {playing ? "▐▐" : "▶"}
          </button>
        ) : null}
        {action ? (
          <button
            className={`btn btn-sm ${action.variant ?? "btn-secondary"}`}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ) : null}
        {secondAction ? (
          <button
            className="btn btn-sm btn-danger-ghost"
            onClick={secondAction.onClick}
          >
            {secondAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
