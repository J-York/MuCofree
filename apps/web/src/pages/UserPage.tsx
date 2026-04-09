import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  apiAddSongToDefaultPlaylist,
  apiDeleteShare,
  apiDeletePlaylistShare,
  apiDeleteShareReaction,
  apiGetUser,
  apiSetShareReaction,
  apiUserPlaylistShares,
  apiUserShares,
  type PlaylistShare,
  type Share,
  type User,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";
import Avatar from "../components/Avatar";
import ShareReactionBar from "../components/ShareReactionBar";
import { applyOptimisticReaction, type ReactionKey } from "../share-reactions";
import { formatDateTime, safeUrl } from "../utils";
import { useDefaultPlaylistMids } from "../hooks";
import { resetPlazaPageCache } from "./PlazaPage";

export default function UserPage() {
  const params = useParams();
  const userId = Number(params.userId);
  const navigate = useNavigate();

  const { user: me } = useAuth();
  const { play, appendToPlaylistQueue, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();
  const { playlistMids, addMid } = useDefaultPlaylistMids();

  const isOwner = !!me && me.id === userId;

  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [shareTotal, setShareTotal] = useState(0);
  const [sharesCursor, setSharesCursor] = useState<number | null>(null);
  const [sharesHasMore, setSharesHasMore] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(false);

  const [playlistShares, setPlaylistShares] = useState<PlaylistShare[]>([]);
  const [playlistShareTotal, setPlaylistShareTotal] = useState(0);
  const [playlistSharesCursor, setPlaylistSharesCursor] = useState<number | null>(null);
  const [playlistSharesHasMore, setPlaylistSharesHasMore] = useState(false);
  const [playlistSharesLoading, setPlaylistSharesLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingReactionShareIds, setPendingReactionShareIds] = useState<Set<number>>(new Set());

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
      const [uRes, sRes, playlistRes] = await Promise.all([
        apiGetUser(userId),
        apiUserShares(userId, null, 20),
        apiUserPlaylistShares(userId, null, 20),
      ]);
      setProfileUser(uRes.user);

      setShares(sRes.shares);
      setShareTotal(sRes.total);
      setSharesCursor(sRes.nextCursor);
      setSharesHasMore(sRes.nextCursor !== null);

      setPlaylistShares(playlistRes.shares);
      setPlaylistShareTotal(playlistRes.total);
      setPlaylistSharesCursor(playlistRes.nextCursor);
      setPlaylistSharesHasMore(playlistRes.nextCursor !== null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreShares() {
    if (sharesLoading || !sharesHasMore) return;
    setSharesLoading(true);
    try {
      const data = await apiUserShares(userId, sharesCursor, 20);
      setShares((prev) => [...prev, ...data.shares]);
      setShareTotal(data.total);
      setSharesCursor(data.nextCursor);
      setSharesHasMore(data.nextCursor !== null);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSharesLoading(false);
    }
  }

  async function loadMorePlaylistShares() {
    if (playlistSharesLoading || !playlistSharesHasMore) return;
    setPlaylistSharesLoading(true);
    try {
      const data = await apiUserPlaylistShares(userId, playlistSharesCursor, 20);
      setPlaylistShares((prev) => [...prev, ...data.shares]);
      setPlaylistShareTotal(data.total);
      setPlaylistSharesCursor(data.nextCursor);
      setPlaylistSharesHasMore(data.nextCursor !== null);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setPlaylistSharesLoading(false);
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
      setShareTotal((prev) => Math.max(0, prev - 1));
      resetPlazaPageCache();
      showToast("已删除分享");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function onDeletePlaylist(share: PlaylistShare) {
    if (!confirm(`确定撤回歌单《${share.playlistName}》这条分享？`)) return;
    try {
      await apiDeletePlaylistShare(share.id);
      setPlaylistShares((prev) => prev.filter((item) => item.id !== share.id));
      setPlaylistShareTotal((prev) => Math.max(0, prev - 1));
      resetPlazaPageCache();
      showToast("已撤回歌单分享");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function addToPlaylist(share: Share) {
    try {
      const result = await apiAddSongToDefaultPlaylist({
        songMid: share.songMid,
        songTitle: share.songTitle,
        songSubtitle: share.songSubtitle,
        singerName: share.singerName,
        albumMid: share.albumMid,
        albumName: share.albumName,
        coverUrl: share.coverUrl,
      });
      appendToPlaylistQueue(
        {
          mid: share.songMid,
          title: share.songTitle ?? share.songMid,
          singer: share.singerName ?? undefined,
          coverUrl: share.coverUrl ?? undefined,
        },
        result.playlistId,
      );
      addMid(share.songMid);
      showToast(`已添加《${share.songTitle ?? share.songMid}》到我的收藏`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function onReact(share: Share, clickedReactionKey: ReactionKey) {
    const optimistic = applyOptimisticReaction(
      share.reactionCounts,
      share.viewerReactionKey,
      clickedReactionKey,
      { canReact: !!me && me.id !== share.userId },
    );

    if (
      optimistic.reactionCounts === share.reactionCounts &&
      optimistic.viewerReactionKey === share.viewerReactionKey
    ) {
      return;
    }

    setPendingReactionShareIds((prev) => new Set([...prev, share.id]));
    setShares((prev) =>
      prev.map((item) =>
        item.id === share.id
          ? {
              ...item,
              reactionCounts: optimistic.reactionCounts,
              viewerReactionKey: optimistic.viewerReactionKey,
            }
          : item,
      ),
    );

    try {
      if (share.viewerReactionKey === clickedReactionKey) {
        await apiDeleteShareReaction(share.id);
      } else {
        await apiSetShareReaction(share.id, clickedReactionKey);
      }
    } catch (e) {
      setShares((prev) =>
        prev.map((item) =>
          item.id === share.id
            ? {
                ...item,
                reactionCounts: share.reactionCounts,
                viewerReactionKey: share.viewerReactionKey,
              }
            : item,
        ),
      );
      showToast((e as Error).message);
    } finally {
      setPendingReactionShareIds((prev) => {
        const next = new Set(prev);
        next.delete(share.id);
        return next;
      });
    }
  }

  function playSong(song: PlayerSong) {
    const queue = shares.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined
    }));

    play(song, queue.length ? queue : undefined, "share");
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
                共分享了 {shareTotal} 首歌曲，{playlistShareTotal} 个歌单
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
            先把喜欢的歌加入歌单，再到歌单详情里点击“分享”或“分享到广场”，即可发布歌曲或歌单。
          </div>
          <div className="row">
            <Link className="btn btn-primary" to="/playlists">
              去歌单里分享
            </Link>
          </div>
        </div>
      ) : null}

      {/* Shares list */}
      {!loading && profileUser ? (
        <div className="section-card stack">
          <div className="row-between">
            <h2 className="heading-serif" style={{ fontSize: 17, margin: 0 }}>
              {isOwner ? "我的" : `${profileUser.name} 的`}歌曲分享
            </h2>
            <span className="text-xs">{shareTotal} 首</span>
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
                        ? playlistMids.has(sh.songMid)
                          ? { label: "已收藏", onClick: () => {}, variant: "btn-teal-ghost", disabled: true }
                          : { label: "+ 歌单", onClick: () => void addToPlaylist(sh), variant: "btn-teal-ghost" }
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
                  <div style={{ marginTop: 8 }}>
                    <ShareReactionBar
                      reactionCounts={sh.reactionCounts}
                      viewerReactionKey={sh.viewerReactionKey}
                      disabled={!me || isOwner}
                      disabledReason={!me ? "登录后即可互动" : isOwner ? "不能给自己的分享互动" : undefined}
                      pending={pendingReactionShareIds.has(sh.id)}
                      onSelect={(key) => void onReact(sh, key)}
                    />
                  </div>
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
              {isOwner ? <div className="text-xs">去歌单里挑一首歌，点“分享”发布到主页和广场</div> : null}
            </div>
          )}

          {sharesHasMore ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
              <button
                className="btn btn-secondary"
                onClick={() => void loadMoreShares()}
                disabled={sharesLoading}
              >
                {sharesLoading ? "加载中…" : "加载更多歌曲分享"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && profileUser ? (
        <div className="section-card stack">
          <div className="row-between">
            <h2 className="heading-serif" style={{ fontSize: 17, margin: 0 }}>
              {isOwner ? "我的" : `${profileUser.name} 的`}歌单分享
            </h2>
            <span className="text-xs">{playlistShareTotal} 个</span>
          </div>

          {playlistShares.length ? (
            <div className="stack-sm">
              {playlistShares.map((sh) => (
                <div key={sh.id} className="share-item">
                  <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                    {safeUrl(sh.coverUrl) ? (
                      <img
                        src={safeUrl(sh.coverUrl)!}
                        alt={sh.playlistName}
                        className="cover"
                        style={{ width: 72, height: 72, borderRadius: 12, flexShrink: 0 }}
                      />
                    ) : (
                      <div className="cover-placeholder" style={{ width: 72, height: 72, flexShrink: 0 }}>♪</div>
                    )}
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="row-between" style={{ alignItems: "start", gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="song-title truncate">{sh.playlistName}</div>
                          <div className="song-meta">
                            {sh.itemCount} 首歌曲
                            {sh.playlistDescription ? ` · ${sh.playlistDescription}` : ""}
                          </div>
                        </div>
                        {isOwner ? (
                          <button
                            className="btn btn-danger-ghost btn-sm"
                            onClick={() => void onDeletePlaylist(sh)}
                          >
                            撤回
                          </button>
                        ) : (
                          <Link className="btn btn-ghost btn-sm" to={sh.sharePath}>
                            查看歌单
                          </Link>
                        )}
                      </div>
                      {sh.comment ? (
                        <div className="share-comment" style={{ marginTop: 8 }}>
                          {sh.comment}
                        </div>
                      ) : null}
                      <div className="text-xs" style={{ marginTop: 8 }}>
                        {formatDateTime(sh.createdAt)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>{isOwner ? "你还没有分享过歌单" : "Ta 还没有分享过歌单"}</div>
              {isOwner ? <div className="text-xs">去歌单详情页点击“分享到广场”，发布整张歌单</div> : null}
            </div>
          )}

          {playlistSharesHasMore ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
              <button
                className="btn btn-secondary"
                onClick={() => void loadMorePlaylistShares()}
                disabled={playlistSharesLoading}
              >
                {playlistSharesLoading ? "加载中…" : "加载更多歌单分享"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div className="alert alert-success toast-fixed">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
