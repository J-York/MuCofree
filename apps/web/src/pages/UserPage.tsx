import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  apiDeleteShare,
  apiGetUser,
  apiAddToPlaylist,
  apiUserShares,
  type Share,
  type User
} from "../api";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";
import Avatar from "../components/Avatar";
import { formatDateTime } from "../utils";

export default function UserPage() {
  const params = useParams();
  const userId = Number(params.userId);
  const navigate = useNavigate();

  const { user: me } = useAuth();
  const { play, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();

  const isOwner = !!me && me.id === userId;

  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function refresh() {
    if (!Number.isFinite(userId) || userId <= 0) {
      setError("无效的用户 ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([apiGetUser(userId), apiUserShares(userId)]);
      setProfileUser(u.user);
      setShares(s.shares);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function onDelete(share: Share) {
    if (!confirm(`确定删除《${share.songTitle ?? share.songMid}》这条分享？`)) return;
    try {
      await apiDeleteShare(share.id);
      setShares((prev) => prev.filter((s) => s.id !== share.id));
      showToast("已删除分享");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function addToPlaylist(share: Share) {
    try {
      await apiAddToPlaylist({
        songMid: share.songMid,
        songTitle: share.songTitle,
        songSubtitle: share.songSubtitle,
        singerName: share.singerName,
        albumMid: share.albumMid,
        albumName: share.albumName,
        coverUrl: share.coverUrl
      });
      showToast(`已添加《${share.songTitle ?? share.songMid}》到我的歌单`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  function playSong(song: PlayerSong) {
    const queue = shares.map((item) => ({
          mid: item.songMid,
          title: item.songTitle ?? item.songMid,
          singer: item.singerName ?? undefined,
          coverUrl: item.coverUrl ?? undefined
        }));

    play(song, queue.length ? queue : undefined);
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Back */}
      <div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          ← 返回
        </button>
      </div>

      {/* Error */}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {/* Loading */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : null}

      {/* Profile */}
      {profileUser ? (
        <div className="section-card">
          <div className="row">
            <Avatar name={profileUser.name} avatarUrl={profileUser.avatarUrl} size="xl" />
            <div className="flex-1">
              <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>
                {profileUser.name}
              </h1>
              <p className="page-subtitle">
                共分享了 {shares.length} 首歌曲
              </p>
            </div>
            {isOwner ? (
              <span className="badge badge-teal">我的主页</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Share form — only for owner */}
      {isOwner ? (
        <div className="section-card stack">
          <div className="row-between">
            <h2 className="heading-serif" style={{ fontSize: 17, margin: 0 }}>分享新歌曲</h2>
          </div>
          <div className="alert alert-info">
            现在分享歌曲需要先加入你的“我的歌单”，再从歌单里选择发布。
          </div>
          <div className="row">
            <Link className="btn btn-primary" to="/?tab=playlist">
              去我的歌单分享
            </Link>
          </div>
        </div>
      ) : null}

      {/* Shares list */}
      {!loading && profileUser ? (
        <div className="section-card stack">
          <div className="row-between">
            <h2 className="heading-serif" style={{ fontSize: 17, margin: 0 }}>
              {isOwner ? "我的" : `${profileUser.name} 的`}分享
            </h2>
            <span className="text-xs">{shares.length} 首</span>
          </div>

          {shares.length ? (
            <div className="stack-sm">
              {shares.map((sh) => (
                <div key={sh.id} className="share-item">
                  <SongCard
                    item={sh}
                    active={isCurrentSong(sh.songMid)}
                    playing={isCurrentSong(sh.songMid) && playing && currentSong?.mid === sh.songMid}
                    loading={loadingMid === sh.songMid}
                    onPlay={playSong}
                    action={
                      !isOwner && me
                        ? { label: "+ 歌单", onClick: () => void addToPlaylist(sh), variant: "btn-teal-ghost" }
                        : undefined
                    }
                    secondAction={
                      isOwner
                        ? { label: "删除", onClick: () => void onDelete(sh) }
                        : undefined
                    }
                  />
                  {sh.comment ? (
                    <div className="share-comment" style={{ marginTop: 4 }}>
                      {sh.comment}
                    </div>
                  ) : null}
                  <div className="text-xs" style={{ marginTop: 6 }}>
                    {formatDateTime(sh.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>{isOwner ? "你还没有分享过歌曲" : "Ta 还没有分享过歌曲"}</div>
              {isOwner ? <div className="text-xs">在上方搜索一首歌开始分享吧</div> : null}
            </div>
          )}
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          className="alert alert-success"
          style={{
            position: "fixed",
            bottom: 96,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 300,
            boxShadow: "var(--shadow-float)",
            whiteSpace: "nowrap"
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
