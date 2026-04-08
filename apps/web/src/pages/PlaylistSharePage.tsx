import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  apiGetPlaylistItems,
  apiJoinPlaylistShareToken,
  apiResolvePlaylistShareToken,
  type PlaylistItem,
  type PlaylistShareResolveResponse,
} from "../api";
import SongCard from "../components/SongCard";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";

export default function PlaylistSharePage() {
  const { token } = useParams();
  const {
    play,
    isCurrentSong,
    currentSong,
    playing,
    loadingMid,
  } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<PlaylistShareResolveResponse | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  async function loadShare(shareToken: string) {
    setLoading(true);
    setError(null);

    try {
      const resolved = await apiResolvePlaylistShareToken(shareToken);
      setShare(resolved);

      if (resolved.canRead) {
        setItemsLoading(true);
        try {
          const data = await apiGetPlaylistItems(resolved.playlist.id, 0, 500);
          setItems(data.items);
        } finally {
          setItemsLoading(false);
        }
      } else {
        setItems([]);
      }
    } catch (e) {
      setError((e as Error).message);
      setShare(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setError("分享链接无效");
      setLoading(false);
      return;
    }

    void loadShare(token);
  }, [token]);

  async function joinSharedPlaylist() {
    if (!token) return;

    setJoining(true);
    setError(null);

    try {
      await apiJoinPlaylistShareToken(token);
      await loadShare(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  function playSharedSong(song: PlayerSong) {
    const queue = items.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined,
    }));

    play(song, queue.length ? queue : undefined, "playlist", share?.playlist.id ?? null);
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 className="page-title">歌单分享</h1>
          <p className="page-subtitle">登录后可查看并播放分享歌单</p>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/">
          返回首页
        </Link>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {loading ? (
        <div className="empty-state">
          <div className="spinner" />
          <div>正在解析分享链接…</div>
        </div>
      ) : null}

      {!loading && share ? (
        <div className="section-card stack">
          <div className="row-between" style={{ alignItems: "start", gap: 12 }}>
            <div>
              <div className="section-label">{share.playlist.name}</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                scope: {share.link.scope} · 过期时间: {share.link.expiresAt}
              </div>
            </div>
            {share.requiresJoin ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void joinSharedPlaylist()}
                disabled={joining}
              >
                {joining ? "加入中…" : "加入歌单"}
              </button>
            ) : null}
          </div>

          {share.membership?.status === "pending" ? (
            <div className="alert alert-info">你已提交加入申请，等待歌单 owner 审批后可查看内容。</div>
          ) : null}

          {!share.canRead && share.membership?.status !== "pending" ? (
            <div className="alert alert-info">加入歌单后可查看完整歌曲列表。</div>
          ) : null}

          {share.canRead ? (
            itemsLoading ? (
              <div className="empty-state">
                <div className="spinner" />
                <div>正在加载歌曲…</div>
              </div>
            ) : items.length ? (
              <div className="stack-sm">
                {items.map((song) => (
                  <SongCard
                    key={song.songMid}
                    item={song}
                    active={isCurrentSong(song.songMid)}
                    playing={isCurrentSong(song.songMid) && playing && currentSong?.mid === song.songMid}
                    loading={loadingMid === song.songMid}
                    onPlay={playSharedSong}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🎵</div>
                <div>这个歌单还没有歌曲</div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
