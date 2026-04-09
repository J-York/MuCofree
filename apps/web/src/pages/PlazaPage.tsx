import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  apiAddSongToDefaultPlaylist,
  apiDeleteShare,
  apiDeletePlaylistShare,
  apiDeleteShareReaction,
  apiPlazaStats,
  apiPlaylistSharesFeed,
  apiSetShareReaction,
  apiSharesFeed,
  apiUsersList,
  type FeedShare,
  type FeedPlaylistShare,
  type UserWithPreview,
} from "../api";
import Avatar from "../components/Avatar";
import ShareReactionBar from "../components/ShareReactionBar";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import { useDefaultPlaylistMids } from "../hooks";
import { applyOptimisticReaction, type ReactionKey } from "../share-reactions";
import { formatDateTime, safeUrl } from "../utils";

type ViewMode = "songs" | "playlists" | "users";

const PAGE_SIZE = 20;
const PLAZA_CACHE_TTL_MS = 30_000;

type PlazaFeedCacheEntry = {
  items: FeedShare[];
  nextCursor: number | null;
  hasMore: boolean;
  fetchedAt: number;
};

type PlazaPlaylistFeedCacheEntry = {
  items: FeedPlaylistShare[];
  nextCursor: number | null;
  hasMore: boolean;
  fetchedAt: number;
};

type PlazaUsersCacheEntry = {
  items: UserWithPreview[];
  nextOffset: number;
  totalUsers: number;
  totalShares: number;
  songShares: number;
  playlistShares: number;
  hasMore: boolean;
  fetchedAt: number;
};

type PlazaStatsCacheEntry = {
  totalUsers: number;
  totalShares: number;
  songShares: number;
  playlistShares: number;
  fetchedAt: number;
};

const plazaFeedCache = new Map<string, PlazaFeedCacheEntry>();
const plazaPlaylistFeedCache = new Map<string, PlazaPlaylistFeedCacheEntry>();
let plazaUsersCache: PlazaUsersCacheEntry | null = null;
let plazaStatsCache: PlazaStatsCacheEntry | null = null;

export function resetPlazaPageCache() {
  plazaFeedCache.clear();
  plazaPlaylistFeedCache.clear();
  plazaUsersCache = null;
  plazaStatsCache = null;
}

function isPlazaCacheFresh(fetchedAt: number) {
  return Date.now() - fetchedAt < PLAZA_CACHE_TTL_MS;
}

function getFreshPlazaFeedCache(viewerCacheKey: string) {
  const cacheEntry = plazaFeedCache.get(viewerCacheKey);
  if (!cacheEntry || !isPlazaCacheFresh(cacheEntry.fetchedAt)) return null;
  return {
    ...cacheEntry,
    items: [...cacheEntry.items],
  };
}

function getFreshPlazaPlaylistFeedCache(viewerCacheKey: string) {
  const cacheEntry = plazaPlaylistFeedCache.get(viewerCacheKey);
  if (!cacheEntry || !isPlazaCacheFresh(cacheEntry.fetchedAt)) return null;
  return {
    ...cacheEntry,
    items: [...cacheEntry.items],
  };
}

function getFreshPlazaUsersCache() {
  if (!plazaUsersCache || !isPlazaCacheFresh(plazaUsersCache.fetchedAt)) return null;
  return {
    ...plazaUsersCache,
    items: [...plazaUsersCache.items],
  };
}

function getFreshPlazaStatsCache() {
  if (!plazaStatsCache || !isPlazaCacheFresh(plazaStatsCache.fetchedAt)) return null;
  return { ...plazaStatsCache };
}

function writePlazaFeedCache(viewerCacheKey: string, items: FeedShare[], nextCursor: number | null) {
  plazaFeedCache.set(viewerCacheKey, {
    items: [...items],
    nextCursor,
    hasMore: nextCursor !== null,
    fetchedAt: Date.now(),
  });
}

function writePlazaPlaylistFeedCache(
  viewerCacheKey: string,
  items: FeedPlaylistShare[],
  nextCursor: number | null,
) {
  plazaPlaylistFeedCache.set(viewerCacheKey, {
    items: [...items],
    nextCursor,
    hasMore: nextCursor !== null,
    fetchedAt: Date.now(),
  });
}

function writePlazaUsersCache(
  items: UserWithPreview[],
  nextOffset: number,
  totalUsers: number,
  totalShares: number,
  songShares: number,
  playlistShares: number,
  hasMore: boolean,
) {
  plazaUsersCache = {
    items: [...items],
    nextOffset,
    totalUsers,
    totalShares,
    songShares,
    playlistShares,
    hasMore,
    fetchedAt: Date.now(),
  };
}

function writePlazaStatsCache(
  totalUsers: number,
  totalShares: number,
  songShares: number,
  playlistShares: number,
) {
  plazaStatsCache = {
    totalUsers,
    totalShares,
    songShares,
    playlistShares,
    fetchedAt: Date.now(),
  };
}

export default function PlazaPage() {
  const [view, setView] = useState<ViewMode>("songs");
  const { currentSong, playing, play, appendToPlaylistQueue, togglePlayPause, loadingMid } = usePlayer();
  const { user: me } = useAuth();
  const viewerCacheKey = me ? `user:${me.id}` : "guest";
  const cachedFeed = getFreshPlazaFeedCache(viewerCacheKey);
  const cachedPlaylistFeed = getFreshPlazaPlaylistFeedCache(viewerCacheKey);
  const cachedUsers = getFreshPlazaUsersCache();
  const cachedStats = getFreshPlazaStatsCache();
  const { playlistMids, addMid, loading: playlistLoading } = useDefaultPlaylistMids();

  // ── 歌曲动态（游标分页）─────────────────────────────────────────────────
  const [feedItems, setFeedItems] = useState<FeedShare[]>(() => cachedFeed?.items ?? []);
  const [feedCursor, setFeedCursor] = useState<number | null | undefined>(() =>
    cachedFeed ? cachedFeed.nextCursor : undefined,
  ); // undefined = not loaded
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(() => cachedFeed?.hasMore ?? true);
  const [feedLoaded, setFeedLoaded] = useState(Boolean(cachedFeed));

  // ── 歌单动态（游标分页）─────────────────────────────────────────────────
  const [playlistFeedItems, setPlaylistFeedItems] = useState<FeedPlaylistShare[]>(() => cachedPlaylistFeed?.items ?? []);
  const [playlistFeedCursor, setPlaylistFeedCursor] = useState<number | null | undefined>(() =>
    cachedPlaylistFeed ? cachedPlaylistFeed.nextCursor : undefined,
  );
  const [playlistFeedLoading, setPlaylistFeedLoading] = useState(false);
  const [playlistFeedError, setPlaylistFeedError] = useState<string | null>(null);
  const [playlistFeedHasMore, setPlaylistFeedHasMore] = useState(() => cachedPlaylistFeed?.hasMore ?? true);
  const [playlistFeedLoaded, setPlaylistFeedLoaded] = useState(Boolean(cachedPlaylistFeed));

  // ── 分享者（偏移分页）──────────────────────────────────────────────────
  const [userItems, setUserItems] = useState<UserWithPreview[]>(() => cachedUsers?.items ?? []);
  const [userOffset, setUserOffset] = useState(() => cachedUsers?.nextOffset ?? 0);
  const [userTotal, setUserTotal] = useState(() => cachedStats?.totalUsers ?? cachedUsers?.totalUsers ?? 0);
  const [totalShares, setTotalShares] = useState(() => cachedStats?.totalShares ?? cachedUsers?.totalShares ?? 0);
  const [songShares, setSongShares] = useState(() => cachedStats?.songShares ?? cachedUsers?.songShares ?? 0);
  const [playlistShares, setPlaylistShares] = useState(() => cachedStats?.playlistShares ?? cachedUsers?.playlistShares ?? 0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersHasMore, setUsersHasMore] = useState(() => cachedUsers?.hasMore ?? true);
  const [usersLoaded, setUsersLoaded] = useState(Boolean(cachedUsers));
  const [statsLoaded, setStatsLoaded] = useState(Boolean(cachedStats ?? cachedUsers));

  const [addingMids, setAddingMids] = useState<Set<string>>(new Set());
  const [pendingReactionShareIds, setPendingReactionShareIds] = useState<Set<number>>(new Set());

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const loadFeed = useCallback(async (cursor: number | null) => {
    setFeedLoaded(true);
    setFeedLoading(true);
    setFeedError(null);
    try {
      const data = await apiSharesFeed(cursor, PAGE_SIZE);
      setFeedCursor(data.nextCursor);
      setFeedHasMore(data.nextCursor !== null);
      setFeedItems((prev) => {
        const nextItems = cursor === null ? data.items : [...prev, ...data.items];
        writePlazaFeedCache(viewerCacheKey, nextItems, data.nextCursor);
        return nextItems;
      });
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedLoading(false);
    }
  }, [viewerCacheKey]);

  const loadPlaylistFeed = useCallback(async (cursor: number | null) => {
    setPlaylistFeedLoaded(true);
    setPlaylistFeedLoading(true);
    setPlaylistFeedError(null);
    try {
      const data = await apiPlaylistSharesFeed(cursor, PAGE_SIZE);
      setPlaylistFeedCursor(data.nextCursor);
      setPlaylistFeedHasMore(data.nextCursor !== null);
      setPlaylistFeedItems((prev) => {
        const nextItems = cursor === null ? data.items : [...prev, ...data.items];
        writePlazaPlaylistFeedCache(viewerCacheKey, nextItems, data.nextCursor);
        return nextItems;
      });
    } catch (e) {
      setPlaylistFeedError((e as Error).message);
    } finally {
      setPlaylistFeedLoading(false);
    }
  }, [viewerCacheKey]);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiPlazaStats();
      setUserTotal(data.totalUsers);
      setTotalShares(data.totalShares);
      setSongShares(data.songShares);
      setPlaylistShares(data.playlistShares);
      setStatsLoaded(true);
      writePlazaStatsCache(data.totalUsers, data.totalShares, data.songShares, data.playlistShares);
    } catch {
      // Keep stale/cache placeholders instead of surfacing a second error block.
    }
  }, []);

  const loadUsers = useCallback(async (offset: number) => {
    setUsersLoaded(true);
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await apiUsersList(offset, PAGE_SIZE);
      const nextOffset = offset + data.users.length;
      const hasMore = nextOffset < data.total;

      setUserOffset(nextOffset);
      setUserTotal(data.total);
      setTotalShares(data.totalShares);
      setSongShares(data.songShares);
      setPlaylistShares(data.playlistShares);
      setUsersHasMore(hasMore);
      setStatsLoaded(true);
      writePlazaStatsCache(data.total, data.totalShares, data.songShares, data.playlistShares);
      setUserItems((prev) => {
        const nextItems = offset === 0 ? data.users : [...prev, ...data.users];
        writePlazaUsersCache(
          nextItems,
          nextOffset,
          data.total,
          data.totalShares,
          data.songShares,
          data.playlistShares,
          hasMore,
        );
        return nextItems;
      });
    } catch (e) {
      setUsersError((e as Error).message);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  function updateFeedItems(updater: (prev: FeedShare[]) => FeedShare[]) {
    setFeedItems((prev) => {
      const nextItems = updater(prev);
      writePlazaFeedCache(viewerCacheKey, nextItems, feedCursor ?? null);
      return nextItems;
    });
  }

  function updatePlaylistFeedItems(updater: (prev: FeedPlaylistShare[]) => FeedPlaylistShare[]) {
    setPlaylistFeedItems((prev) => {
      const nextItems = updater(prev);
      writePlazaPlaylistFeedCache(viewerCacheKey, nextItems, playlistFeedCursor ?? null);
      return nextItems;
    });
  }

  function invalidateUsersSnapshot() {
    plazaUsersCache = null;
    setUserItems([]);
    setUserOffset(0);
    setUsersHasMore(true);
    setUsersError(null);
    setUsersLoaded(false);
  }

  useEffect(() => {
    const nextCachedFeed = getFreshPlazaFeedCache(viewerCacheKey);
    if (nextCachedFeed) {
      setFeedItems(nextCachedFeed.items);
      setFeedCursor(nextCachedFeed.nextCursor);
      setFeedHasMore(nextCachedFeed.hasMore);
      setFeedError(null);
      setFeedLoaded(true);
    } else {
      setFeedItems([]);
      setFeedCursor(undefined);
      setFeedHasMore(true);
      setFeedError(null);
      setFeedLoaded(false);
    }

    const nextCachedPlaylistFeed = getFreshPlazaPlaylistFeedCache(viewerCacheKey);
    if (nextCachedPlaylistFeed) {
      setPlaylistFeedItems(nextCachedPlaylistFeed.items);
      setPlaylistFeedCursor(nextCachedPlaylistFeed.nextCursor);
      setPlaylistFeedHasMore(nextCachedPlaylistFeed.hasMore);
      setPlaylistFeedError(null);
      setPlaylistFeedLoaded(true);
    } else {
      setPlaylistFeedItems([]);
      setPlaylistFeedCursor(undefined);
      setPlaylistFeedHasMore(true);
      setPlaylistFeedError(null);
      setPlaylistFeedLoaded(false);
    }
    setPendingReactionShareIds(new Set());
  }, [viewerCacheKey]);

  useEffect(() => {
    if (feedLoaded) return;
    void loadFeed(null);
  }, [feedLoaded, loadFeed]);

  useEffect(() => {
    if (statsLoaded) return;
    void loadStats();
  }, [statsLoaded, loadStats]);

  useEffect(() => {
    if (view !== "users" || usersLoaded) return;
    void loadUsers(0);
  }, [usersLoaded, view, loadUsers]);

  useEffect(() => {
    if (view !== "playlists" || playlistFeedLoaded) return;
    void loadPlaylistFeed(null);
  }, [playlistFeedLoaded, view, loadPlaylistFeed]);

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
      addMid(sh.songMid);
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
      updateFeedItems((prev) => prev.filter((s) => s.id !== sh.id));
      invalidateUsersSnapshot();
      plazaStatsCache = null;
      void loadStats();
      showToast("已撤回分享");
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function onDeletePlaylistShare(sh: FeedPlaylistShare) {
    if (!confirm(`确定撤回歌单《${sh.playlistName}》这条分享？`)) return;
    try {
      await apiDeletePlaylistShare(sh.id);
      updatePlaylistFeedItems((prev) => prev.filter((item) => item.id !== sh.id));
      invalidateUsersSnapshot();
      plazaStatsCache = null;
      void loadStats();
      showToast("已撤回歌单分享");
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
    updateFeedItems((prev) =>
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
      updateFeedItems((prev) =>
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
  const displayedPlaylistShares = useMemo(() => playlistFeedItems.length, [playlistFeedItems]);
  const totalSharesLabel = statsLoaded ? String(totalShares) : "…";
  const songSharesLabel = statsLoaded ? String(songShares) : "…";
  const playlistSharesLabel = statsLoaded ? String(playlistShares) : "…";
  const userTotalLabel = statsLoaded ? String(userTotal) : "…";

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
    <div className="stack-lg" style={{ marginTop: 8, gap: 22 }}>
      {/* Banner */}
      <div className="plaza-banner">
        <div className="plaza-banner-title">打工人音乐广场</div>
        <div className="plaza-banner-sub">单曲和整张歌单，都值得被更多人听见</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {totalSharesLabel} 条分享
          </span>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {userTotalLabel} 位分享者
          </span>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {songSharesLabel} 首歌曲
          </span>
          <span
            className="badge badge-gold"
            style={{
              background: "var(--banner-badge-bg)",
              color: "var(--banner-badge-text)"
            }}
          >
            {playlistSharesLabel} 个歌单
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
            className={`plaza-view-btn ${view === "playlists" ? "active" : ""}`}
            onClick={() => setView("playlists")}
          >
            歌单动态
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
                        disabledReason={!me ? "登录后即可互动" : isOwner ? "不能给自己的分享互动" : undefined}
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
          ) : !feedLoaded || feedLoading ? (
            <div className="empty-state">
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>还没有人分享音乐</div>
              <div className="text-xs">登录后前往你的主页开始分享吧</div>
            </div>
          )}

          {/* 加载更多 */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {feedLoading ? (
              feedItems.length > 0 ? <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /> : null
            ) : feedLoaded && feedHasMore ? (
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
      ) : view === "playlists" ? (
        /* ──── 歌单动态（游标分页）──── */
        <div>
          {playlistFeedError ? <div className="alert alert-error">{playlistFeedError}</div> : null}

          {playlistFeedItems.length > 0 ? (
            <div className="playlist-feed-grid">
              {playlistFeedItems.map((sh) => {
                const isOwner = !!me && me.id === sh.userId;
                const coverSrc = safeUrl(sh.coverUrl);
                return (
                  <div key={sh.id} className="playlist-feed-card">
                    <Link to={sh.sharePath} className="playlist-feed-cover-link">
                      {coverSrc ? (
                        <img
                          src={coverSrc}
                          alt={sh.playlistName}
                          className="playlist-feed-cover"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = "none";
                            const placeholder = img.nextElementSibling as HTMLElement | null;
                            if (placeholder) placeholder.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div className="playlist-feed-cover-placeholder" style={coverSrc ? { display: "none" } : {}}>♪</div>
                    </Link>
                    <div className="playlist-feed-body">
                      <div className="row-between" style={{ alignItems: "start", gap: 12 }}>
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="song-title truncate">{sh.playlistName}</div>
                          <div className="song-meta">{sh.itemCount} 首歌曲</div>
                        </div>
                        {isOwner ? (
                          <button
                            className="btn btn-sm btn-danger-ghost"
                            onClick={() => void onDeletePlaylistShare(sh)}
                          >
                            撤回
                          </button>
                        ) : (
                          <Link className="btn btn-sm btn-ghost" to={sh.sharePath}>
                            查看歌单
                          </Link>
                        )}
                      </div>

                      {sh.playlistDescription ? (
                        <div className="playlist-feed-description">{sh.playlistDescription}</div>
                      ) : null}
                      {sh.comment ? <div className="share-comment">{sh.comment}</div> : null}

                      <div className="playlist-feed-footer">
                        <Link to={`/user/${sh.userId}`} className="plaza-share-user">
                          <Avatar name={sh.userName} avatarUrl={sh.userAvatarUrl} size="sm" />
                          <div className="flex-1" style={{ minWidth: 0 }}>
                            <div className="text-sm truncate" style={{ color: "var(--ink-mid)", fontWeight: 500 }}>
                              {sh.userName}
                            </div>
                            <div className="text-xs">{formatDateTime(sh.createdAt)}</div>
                          </div>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !playlistFeedLoaded || playlistFeedLoading ? (
            <div className="empty-state">
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>还没有人分享歌单</div>
              <div className="text-xs">登录后前往歌单详情页，分享整张歌单吧</div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {playlistFeedLoading ? (
              playlistFeedItems.length > 0 ? <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /> : null
            ) : playlistFeedLoaded && playlistFeedHasMore ? (
              <button
                className="btn btn-secondary"
                onClick={() => void loadPlaylistFeed(playlistFeedCursor ?? null)}
              >
                加载更多（已显示 {displayedPlaylistShares} 条）
              </button>
            ) : playlistFeedItems.length > 0 ? (
              <span className="text-xs" style={{ color: "var(--ink-light)" }}>已加载全部 {displayedPlaylistShares} 条分享</span>
            ) : null}
          </div>
        </div>
      ) : (
        /* ──── 分享者（偏移分页）──── */
        <div>
          {usersError ? <div className="alert alert-error">{usersError}</div> : null}

          {userItems.length > 0 ? (
            <div className="grid-3">
              {userItems.map((u) => {
                const shareMeta = [
                  u.songShareCount > 0 ? `${u.songShareCount} 首歌曲` : null,
                  u.playlistShareCount > 0 ? `${u.playlistShareCount} 个歌单` : null,
                ].filter(Boolean).join(" · ");

                return (
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
                              style={{ flex: 1, height: 48, borderRadius: 6 }}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : null
                        )}
                      </div>
                    ) : (
                      <div className="cover-placeholder" style={{ height: 48, borderRadius: 8, width: "100%", fontSize: 20 }}>♪</div>
                    )}

                    {/* User info */}
                    <div className="row">
                      <Avatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                      <div className="flex-1" style={{ minWidth: 0 }}>
                        <div className="song-title truncate">{u.name}</div>
                        <div className="song-meta">{shareMeta || "暂无分享"}</div>
                      </div>
                      <span className="text-xs">›</span>
                    </div>

                    {u.latestShareKind === "song" && u.latestShareTitle ? (
                      <div className="text-xs truncate" style={{ color: "var(--ink-light)" }}>
                        最近歌曲：{u.latestShareTitle}
                        {u.latestShareSubtitle ? ` · ${u.latestShareSubtitle}` : ""}
                      </div>
                    ) : u.latestShareKind === "playlist" && u.latestShareTitle ? (
                      <div className="text-xs truncate" style={{ color: "var(--ink-light)" }}>
                        最近歌单：{u.latestShareTitle}
                      </div>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ) : !usersLoaded || usersLoading ? (
            <div className="empty-state">
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <div>还没有人分享内容</div>
              <div className="text-xs">登录后前往歌单详情页开始分享吧</div>
            </div>
          )}

          {/* 加载更多 */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
            {usersLoading ? (
              userItems.length > 0 ? <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /> : null
            ) : usersLoaded && usersHasMore ? (
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
