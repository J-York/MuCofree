import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiAddSongToDefaultPlaylist,
  apiDeleteShare,
  apiDeleteShareReaction,
  apiGetDefaultPlaylist,
  apiGetPlaylistItems,
  apiSetShareReaction,
  apiSharesFeed,
  apiUsersList,
  type FeedShare,
  type UserWithPreview,
} from "../api";
import Avatar from "../components/Avatar";
import ShareReactionBar from "../components/ShareReactionBar";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import { applyOptimisticReaction, type ReactionKey } from "../share-reactions";
import { formatDateTime, safeUrl } from "../utils";

type ViewMode = "songs" | "users";

const PAGE_SIZE = 20;

export default function PlazaPage() {
  const [view, setView] = useState<ViewMode>("songs");
  const { currentSong, playing, play, appendToPlaylistQueue, togglePlayPause, loadingMid } = usePlayer();
  const { user: me } = useAuth();

  // ── 歌曲动态（游标分页）─────────────────────────────────────────────────
  const [feedItems, setFeedItems] = useState<FeedShare[]>([]);
  const [feedCursor, setFeedCursor] = useState<number | null | undefined>(undefined); // undefined = not loaded
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(true);

  // ── 分享者（偏移分页）──────────────────────────────────────────────────
  const [userItems, setUserItems] = useState<UserWithPreview[]>([]);
  const [userOffset, setUserOffset] = useState(0);
  const [userTotal, setUserTotal] = useState(0);
  const [totalShares, setTotalShares] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersHasMore, setUsersHasMore] = useState(true);

  // ── 我的歌单状态（用于“已收藏”判定）────────────────────────────────────
  const [playlistMids, setPlaylistMids] = useState<Set<string>>(new Set());
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [addingMids, setAddingMids] = useState<Set<string>>(new Set());
  const [pendingReactionShareIds, setPendingReactionShareIds] = useState<Set<number>>(new Set());

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // 首次加载
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void loadFeed(null);
    void loadUsers(0);
  }, []);

  useEffect(() => {
    if (!me) {
      setPlaylistMids(new Set());
      return;
    }
    void loadPlaylistMids();
  }, [me?.id]);

  async function loadFeed(cursor: number | null) {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const data = await apiSharesFeed(cursor, PAGE_SIZE);
      setFeedItems((prev) => cursor === null ? data.items : [...prev, ...data.items]);
      setFeedCursor(data.nextCursor);
      setFeedHasMore(data.nextCursor !== null);
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedLoading(false);
    }
  }

  async function loadUsers(offset: number) {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await apiUsersList(offset, PAGE_SIZE);
      setUserItems((prev) => offset === 0 ? data.users : [...prev, ...data.users]);
      setUserOffset(offset + data.users.length);
      setUserTotal(data.total);
      setTotalShares(data.totalShares);
      setUsersHasMore(offset + data.users.length < data.total);
    } catch (e) {
      setUsersError((e as Error).message);
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadPlaylistMids() {
    setPlaylistLoading(true);
    try {
      const defaultPlaylist = await apiGetDefaultPlaylist();
      if (!defaultPlaylist) {
        setPlaylistMids(new Set());
        return;
      }

      const data = await apiGetPlaylistItems(defaultPlaylist.id, 0, 500);
      setPlaylistMids(new Set(data.items.map((item) => item.songMid)));
    } catch {
      setPlaylistMids(new Set());
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function addToPlaylist(sh: FeedShare) {
    if (playlistMids.has(sh.songMid) || addingMids.has(sh.songMid)) return;

    setAddingMids((prev) => new Set([...prev, sh.songMid]));
    try {
      const result = await apiAddSongToDefaultPlaylist({
        songMid: sh.songMid,
        songTitle: sh.songTitle,
        songSubtitle: sh.songSubtitle,
        singerName: sh.singerName,
        albumMid: sh.albumMid,
        albumName: sh.albumName,
        coverUrl: sh.coverUrl,
      });
      appendToPlaylistQueue(
        {
          mid: sh.songMid,
          title: sh.songTitle ?? sh.songMid,
          singer: sh.singerName ?? undefined,
          coverUrl: sh.coverUrl ?? undefined,
        },
        result.playlistId,
      );
      setPlaylistMids((prev) => new Set([...prev, sh.songMid]));
      showToast(`已添加《${sh.songTitle ?? sh.songMid}》到我的收藏`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setAddingMids((prev) => {
        const next = new Set(prev);
        next.delete(sh.songMid);
        return next;
      });
    }
  }

  async function onDelete(sh: FeedShare) {
    if (!confirm(`确定撤回《${sh.songTitle ?? sh.songMid}》这条分享？`)) return;
    try {
      await apiDeleteShare(sh.id);
      setFeedItems((prev) => prev.filter((s) => s.id !== sh.id));
      showToast("已撤回分享");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function onReact(sh: FeedShare, clickedReactionKey: ReactionKey) {
    const optimistic = applyOptimisticReaction(
      sh.reactionCounts,
      sh.viewerReactionKey,
      clickedReactionKey,
      { canReact: !!me && me.id !== sh.userId },
    );

    if (
      optimistic.reactionCounts === sh.reactionCounts &&
      optimistic.viewerReactionKey === sh.viewerReactionKey
    ) {
      return;
    }

    setPendingReactionShareIds((prev) => new Set([...prev, sh.id]));
    setFeedItems((prev) =>
      prev.map((item) =>
        item.id === sh.id
          ? {
              ...item,
              reactionCounts: optimistic.reactionCounts,
              viewerReactionKey: optimistic.viewerReactionKey,
            }
          : item,
      ),
    );

    try {
      if (sh.viewerReactionKey === clickedReactionKey) {
        await apiDeleteShareReaction(sh.id);
      } else {
        await apiSetShareReaction(sh.id, clickedReactionKey);
      }
    } catch (e) {
      setFeedItems((prev) =>
        prev.map((item) =>
          item.id === sh.id
            ? {
                ...item,
                reactionCounts: sh.reactionCounts,
                viewerReactionKey: sh.viewerReactionKey,
              }
            : item,
        ),
      );
      showToast((e as Error).message);
    } finally {
      setPendingReactionShareIds((prev) => {
        const next = new Set(prev);
        next.delete(sh.id);
        return next;
      });
    }
  }

  const displayedShares = useMemo(() => feedItems.length, [feedItems]);

  function handlePlayShare(sh: FeedShare) {
    const song: PlayerSong = {
      mid: sh.songMid,
      title: sh.songTitle ?? sh.songMid,
      singer: sh.singerName ?? undefined,
      coverUrl: sh.coverUrl ?? undefined,
    };
    const isActive = currentSong?.mid === sh.songMid;
    if (isActive) {
      togglePlayPause();
    } else {
      play(song, undefined, "share");
    }
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Banner */}
      <div className="plaza-banner">
        <div className="plaza-banner-title">打工人音乐广场</div>
        <div className="plaza-banner-sub">每个人都有一首属于自己的歌</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {totalShares} 首分享
          </span>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {userTotal} 位分享者
          </span>
        </div>
      </div>

      {/* View Toggle */}
      <div className="row-between">
        <div className="plaza-view-toggle">
          <button
            className={`plaza-view-btn ${view === "songs" ? "active" : ""}`}
            onClick={() => setView("songs")}
          >
            歌曲动态
          </button>
          <button
            className={`plaza-view-btn ${view === "users" ? "active" : ""}`}
            onClick={() => setView("users")}
          >
            分享者
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "songs" ? (
        /* ──── 歌曲动态（游标分页）──── */
        <div>
          {feedError ? <div className="alert alert-error">{feedError}</div> : null}

          {feedItems.length > 0 ? (
            <div className="plaza-share-grid">
              {feedItems.map((sh) => {
                const isActive = currentSong?.mid === sh.songMid;
                const isLoadingThis = loadingMid === sh.songMid;
                const isOwner = !!me && me.id === sh.userId;
                const canAddToPlaylist = !!me && me.id !== sh.userId;
                const inPlaylist = playlistMids.has(sh.songMid);
                const isAdding = addingMids.has(sh.songMid);
                return (
                  <div
                    key={sh.id}
                    className={`plaza-share-card${isActive ? " plaza-share-card--active" : ""}`}
                  >
                    {/* Large cover */}
                    <div className="plaza-share-cover-wrap" onClick={() => handlePlayShare(sh)}>
                      {safeUrl(sh.coverUrl) ? (
                        <img
                          src={safeUrl(sh.coverUrl)!}
                          alt={sh.songTitle ?? ""}
                          className="plaza-share-cover"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = "none";
                            const placeholder = img.nextElementSibling as HTMLElement | null;
                            if (placeholder) placeholder.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div className="plaza-share-cover-placeholder" style={safeUrl(sh.coverUrl) ? { display: "none" } : {}}>♪</div>
                      <div className="plaza-share-play-overlay">
                        {isLoadingThis ? (
                          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                        ) : (
                          <span className="plaza-share-play-icon">
                            {isActive && playing ? "▐▐" : "▶"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="plaza-share-body">
                      <div className="song-title truncate">{sh.songTitle ?? sh.songMid}</div>
                      {sh.singerName ? <div className="song-meta truncate">{sh.singerName}</div> : null}
                      {sh.comment ? <div className="share-comment">{sh.comment}</div> : null}
                      <ShareReactionBar
                        reactionCounts={sh.reactionCounts}
                        viewerReactionKey={sh.viewerReactionKey}
                        disabled={!me || isOwner}
                        pending={pendingReactionShareIds.has(sh.id)}
                        onSelect={(key) => void onReact(sh, key)}
                      />

                      <div className="plaza-share-footer">
                        <Link to={`/user/${sh.userId}`} className="plaza-share-user">
                          <Avatar name={sh.userName} avatarUrl={sh.userAvatarUrl} size="sm" />
                          <div className="flex-1" style={{ minWidth: 0 }}>
                            <div className="text-sm truncate" style={{ color: "var(--ink-mid)", fontWeight: 500 }}>{sh.userName}</div>
                            <div className="text-xs">{formatDateTime(sh.createdAt)}</div>
                          </div>
                        </Link>
                        {canAddToPlaylist ? (
                          <button
                            className="btn btn-sm btn-teal-ghost"
                            style={{ flexShrink: 0 }}
                            onClick={() => void addToPlaylist(sh)}
                            disabled={inPlaylist || isAdding || playlistLoading}
                          >
                            {inPlaylist ? "已收藏" : isAdding ? "添加中…" : "+ 歌单"}
                          </button>
                        ) : isOwner ? (
                          <button
                            className="btn btn-sm btn-danger-ghost"
                            style={{ flexShrink: 0 }}
                            onClick={() => void onDelete(sh)}
                          >
                            撤回
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !feedLoading ? (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>还没有人分享音乐</div>
              <div className="text-xs">登录后前往你的主页开始分享吧</div>
            </div>
          ) : null}

          {/* 加载更多 */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {feedLoading ? (
              <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
            ) : feedHasMore ? (
              <button
                className="btn btn-secondary"
                onClick={() => void loadFeed(feedCursor ?? null)}
              >
                加载更多（已显示 {displayedShares} 条）
              </button>
            ) : feedItems.length > 0 ? (
              <span className="text-xs" style={{ color: "var(--ink-light)" }}>已加载全部 {displayedShares} 条分享</span>
            ) : null}
          </div>
        </div>
      ) : (
        /* ──── 分享者（偏移分页）──── */
        <div>
          {usersError ? <div className="alert alert-error">{usersError}</div> : null}

          {userItems.length > 0 ? (
            <div className="grid-3">
              {userItems.map((u) => (
                <Link key={u.id} to={`/user/${u.id}`} className="user-card">
                  {/* Cover strip */}
                  {u.recentCoverUrls.length > 0 ? (
                    <div className="user-card-covers">
                      {u.recentCoverUrls.map((url, i) =>
                        safeUrl(url) ? (
                          <img
                            key={i}
                            src={safeUrl(url)!}
                            alt=""
                            className="cover"
                            style={{ flex: 1, height: 60, borderRadius: 6 }}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : null
                      )}
                    </div>
                  ) : (
                    <div className="cover-placeholder" style={{ height: 60, borderRadius: 8, width: "100%", fontSize: 22 }}>♪</div>
                  )}

                  {/* User info */}
                  <div className="row">
                    <Avatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="song-title truncate">{u.name}</div>
                      <div className="song-meta">{u.shareCount} 首分享</div>
                    </div>
                    <span className="text-xs">›</span>
                  </div>

                  {/* Latest song preview */}
                  {u.latestSongTitle ? (
                    <div className="text-xs truncate" style={{ color: "var(--ink-light)" }}>
                      最近：{u.latestSongTitle}
                      {u.latestSingerName ? ` · ${u.latestSingerName}` : ""}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : !usersLoading ? (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>还没有人分享音乐</div>
              <div className="text-xs">登录后前往你的主页开始分享吧</div>
            </div>
          ) : null}

          {/* 加载更多 */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {usersLoading ? (
              <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
            ) : usersHasMore ? (
              <button
                className="btn btn-secondary"
                onClick={() => void loadUsers(userOffset)}
              >
                加载更多（已显示 {userItems.length} / {userTotal} 位）
              </button>
            ) : userItems.length > 0 ? (
              <span className="text-xs" style={{ color: "var(--ink-light)" }}>已显示全部 {userTotal} 位分享者</span>
            ) : null}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast ? (
        <div className="alert alert-success toast-fixed">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
