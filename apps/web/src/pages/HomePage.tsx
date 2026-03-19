import { useEffect, useRef, useState } from "react";
import {
  apiCreateShare,
  apiGetPlaylist,
  apiAddToPlaylist,
  apiRemoveFromPlaylist,
  apiQqSearch,
  apiUserShares,
  apiRecommendDaily,
  type QqSong,
  type PlaylistSong,
  type DailySong
} from "../api";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";

type Tab = "search" | "playlist" | "daily";
const ALREADY_SHARED_MESSAGE = "这首歌已经分享过了";
const DAILY_REFRESH_COOLDOWN_MS = 10_000;

export default function HomePage() {
  const { user } = useAuth();
  const { play, appendToPlaylistQueue, removeFromPlaylistQueue, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab =
    searchParams.get("tab") === "playlist"
      ? "playlist"
      : searchParams.get("tab") === "daily"
      ? "daily"
      : "search";

  // Search
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<QqSong[]>([]);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Playlist
  const [playlist, setPlaylist] = useState<PlaylistSong[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [shareSong, setShareSong] = useState<PlaylistSong | null>(null);
  const [shareComment, setShareComment] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharedSongMids, setSharedSongMids] = useState<Set<string>>(new Set());

  // Daily recommendation
  const [dailySongs, setDailySongs] = useState<DailySong[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState<string | null>(null);
  const [dailyRefreshLockedUntil, setDailyRefreshLockedUntil] = useState<number>(0);
  const [dailyRefreshLocked, setDailyRefreshLocked] = useState(false);
  const dailyLoadedRef = useRef(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Load playlist and existing shares on mount
  useEffect(() => {
    void loadPlaylist();
    void loadSharedSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Load daily recommendation when switching to daily tab (lazy, once per session)
  useEffect(() => {
    if (tab === "daily" && !dailyLoadedRef.current) {
      void loadDaily().then(() => {
        dailyLoadedRef.current = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (dailyRefreshLockedUntil <= Date.now()) {
      setDailyRefreshLocked(false);
      return;
    }

    setDailyRefreshLocked(true);
    const timer = window.setTimeout(() => {
      setDailyRefreshLocked(false);
    }, dailyRefreshLockedUntil - Date.now());

    return () => window.clearTimeout(timer);
  }, [dailyRefreshLockedUntil]);

  async function loadPlaylist() {
    setPlaylistLoading(true);
    setPlaylistError(null);
    try {
      const data = await apiGetPlaylist();
      setPlaylist(data.songs);
    } catch (e) {
      setPlaylistError((e as Error).message);
    } finally {
      setPlaylistLoading(false);
    }
  }

  async function loadSharedSongs() {
    if (!user) {
      setSharedSongMids(new Set());
      return;
    }

    try {
      const data = await apiUserShares(user.id);
      setSharedSongMids(new Set(data.shares.map((share) => share.songMid)));
    } catch {
      // Server-side validation still blocks duplicate shares if this refresh fails.
    }
  }

  async function loadDaily(refresh = false) {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiRecommendDaily(refresh);
      setDailySongs(data.songs);
      setDailyDate(data.seedDate);
      if (refresh) {
        setDailyRefreshLockedUntil(Date.now() + DAILY_REFRESH_COOLDOWN_MS);
      }
    } catch (e) {
      setDailyError((e as Error).message);
    } finally {
      setDailyLoading(false);
    }
  }

  function refreshDaily() {
    if (dailyLoading || dailyRefreshLocked) return;
    dailyLoadedRef.current = false;
    void loadDaily(true).then(() => {
      dailyLoadedRef.current = true;
    });
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw) return;

    // Cancel previous in-flight search
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const list = await apiQqSearch(kw, controller.signal);
      setResults(list);
      if (!list.length) setSearchError("没有搜到歌曲，换个关键词试试");
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return;
      setSearchError((err as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
      }
    }
  }

  const playlistMids = new Set(playlist.map((s) => s.songMid));

  async function addToPlaylist(song: QqSong) {
    try {
      await apiAddToPlaylist({
        songMid: song.mid,
        songTitle: song.title,
        songSubtitle: song.subtitle ?? null,
        singerName: song.singer ?? null,
        albumMid: song.albumMid ?? null,
        albumName: song.albumName ?? null,
        coverUrl: song.coverUrl ?? null
      });
      appendToPlaylistQueue({
        mid: song.mid,
        title: song.title,
        singer: song.singer ?? undefined,
        coverUrl: song.coverUrl ?? undefined
      });
      showToast(`已添加《${song.title}》到我的歌单`);
      void loadPlaylist();
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function removeFromPlaylist(songMid: string, title: string) {
    try {
      await apiRemoveFromPlaylist(songMid);
      removeFromPlaylistQueue(songMid);
      showToast(`已从歌单移除《${title}》`);
      setPlaylist((prev) => prev.filter((s) => s.songMid !== songMid));
      if (shareSong?.songMid === songMid) {
        setShareSong(null);
        setShareComment("");
        setShareError(null);
      }
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  function startShare(song: PlaylistSong) {
    setShareSong(song);
    setShareComment("");
    setShareError(null);
  }

  function cancelShare() {
    setShareSong(null);
    setShareComment("");
    setShareError(null);
  }

  async function submitShare() {
    const selectedSong = shareSong;
    if (!selectedSong) return;

    setShareLoading(true);
    setShareError(null);

    try {
      await apiCreateShare({
        songMid: selectedSong.songMid,
        songTitle: selectedSong.songTitle,
        songSubtitle: selectedSong.songSubtitle,
        singerName: selectedSong.singerName,
        albumMid: selectedSong.albumMid,
        albumName: selectedSong.albumName,
        coverUrl: selectedSong.coverUrl,
        comment: shareComment.trim() || null
      });

      showToast(`已将《${selectedSong.songTitle ?? selectedSong.songMid}》分享到广场`);
      setSharedSongMids((prev) => {
        const next = new Set(prev);
        next.add(selectedSong.songMid);
        return next;
      });
      cancelShare();
    } catch (e) {
      const message = (e as Error).message;
      if (message === ALREADY_SHARED_MESSAGE) {
        setSharedSongMids((prev) => {
          const next = new Set(prev);
          next.add(selectedSong.songMid);
          return next;
        });
        cancelShare();
        showToast(message);
        return;
      }

      setShareError(message);
    } finally {
      setShareLoading(false);
    }
  }

  function isLoading(mid: string) {
    return loadingMid === mid;
  }

  function playSearchSong(song: PlayerSong) {
    const queue = results.map((item) => ({
      mid: item.mid,
      title: item.title,
      singer: item.singer,
      coverUrl: item.coverUrl
    }));

    play(song, queue.length ? queue : undefined, "search");
  }

  function playPlaylistSong(song: PlayerSong) {
    const queue = playlist.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined
    }));

    play(song, queue.length ? queue : undefined, "playlist");
  }

  function dailySongToQqSong(s: DailySong): QqSong {
    return {
      mid: s.mid,
      title: s.title,
      subtitle: s.subtitle || undefined,
      singer: s.singerName || undefined,
      albumMid: s.albumMid || undefined,
      albumName: s.albumName || undefined,
      coverUrl: s.coverUrl
        ? s.coverUrl
        : s.albumMid
        ? `/api/qq/cover-proxy?album_mid=${encodeURIComponent(s.albumMid)}`
        : undefined
    };
  }

  function playDailySong(song: PlayerSong) {
    const queue = dailySongs.map((s) => {
      const q = dailySongToQqSong(s);
      return { mid: q.mid, title: q.title, singer: q.singer, coverUrl: q.coverUrl };
    });
    play(song, queue.length ? queue : undefined, "daily");
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Greeting */}
      <div>
        <h1 className="page-title">
          {user ? `你好，${user.name}` : "音乐广场"}
        </h1>
        <p className="page-subtitle">搜索 QQ Music，播放并保存你喜欢的歌曲</p>
      </div>

      {/* Tabs */}
      <div>
        <div className="tabs">
          <button
            className={`tab-item ${tab === "search" ? "active" : ""}`}
            onClick={() => setSearchParams({})}
          >
            搜索
          </button>
          <button
            className={`tab-item ${tab === "playlist" ? "active" : ""}`}
            onClick={() => setSearchParams({ tab: "playlist" })}
          >
            我的歌单 {playlist.length ? `(${playlist.length})` : ""}
          </button>
          <button
            className={`tab-item ${tab === "daily" ? "active" : ""}`}
            onClick={() => setSearchParams({ tab: "daily" })}
          >
            今日推荐
          </button>
        </div>

        {/* Search tab */}
        {tab === "search" ? (
          <div className="section-card" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", borderTop: "none" }}>
            {/* Search form */}
            <form onSubmit={(e) => void onSearch(e)} style={{ marginBottom: 20 }}>
              <div className="search-bar">
                <input
                  className="input"
                  placeholder="搜索歌曲、歌手…"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!keyword.trim() || searching}
                >
                  {searching ? (
                    <>
                      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      搜索中
                    </>
                  ) : "搜索"}
                </button>
              </div>
            </form>

            {searchError ? (
              <div className="alert alert-error mb-16">{searchError}</div>
            ) : null}

            {results.length ? (
              <div className="stack-sm">
                {results.map((song) => (
                  <SongCard
                    key={song.mid}
                    item={song}
                    active={isCurrentSong(song.mid)}
                    playing={isCurrentSong(song.mid) && playing && currentSong?.mid === song.mid}
                    loading={isLoading(song.mid)}
                    onPlay={playSearchSong}
                    action={
                      playlistMids.has(song.mid)
                        ? { label: "已收藏", onClick: () => {}, variant: "btn-teal-ghost", disabled: true }
                        : { label: "+ 歌单", onClick: () => void addToPlaylist(song), variant: "btn-teal-ghost" }
                    }
                  />
                ))}
              </div>
            ) : !searching && !searchError ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <div>输入关键词搜索歌曲</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Playlist tab */}
        {tab === "playlist" ? (
          <div className="section-card" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", borderTop: "none" }}>
            {playlistError ? (
              <div className="alert alert-error mb-16">{playlistError}</div>
            ) : null}

            {shareSong ? (
              <div
                className="card-sm stack-sm mb-16"
                style={{
                  background: "var(--gold-light)",
                  borderColor: "var(--gold-border)"
                }}
              >
                <div className="row-between">
                  <div className="section-label" style={{ color: "var(--gold-ink)" }}>分享到广场</div>
                  <button className="btn btn-ghost btn-sm" onClick={cancelShare}>
                    取消
                  </button>
                </div>
                <div>
                  <div className="song-title">{shareSong.songTitle ?? shareSong.songMid}</div>
                  <div className="song-meta">
                    {[shareSong.singerName, shareSong.songSubtitle].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <input
                  className="input"
                  placeholder="写一句分享理由（可选）"
                  value={shareComment}
                  onChange={(e) => setShareComment(e.target.value)}
                />
                {shareError ? <div className="alert alert-error">{shareError}</div> : null}
                <div className="row">
                  <button className="btn btn-primary" onClick={() => void submitShare()} disabled={shareLoading}>
                    {shareLoading ? "分享中…" : "发布分享"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="alert alert-info mb-16">
                从我的歌单里挑一首歌，写一句分享理由，就能发布到广场。
              </div>
            )}

            {playlistLoading ? (
              <div className="empty-state">
                <div className="spinner" />
              </div>
            ) : playlist.length ? (
              <div className="stack-sm">
                {playlist.map((song) => (
                  <SongCard
                    key={song.songMid}
                    item={song}
                    active={isCurrentSong(song.songMid)}
                    playing={isCurrentSong(song.songMid) && playing && currentSong?.mid === song.songMid}
                    loading={isLoading(song.songMid)}
                    onPlay={playPlaylistSong}
                    action={
                      sharedSongMids.has(song.songMid)
                        ? { label: "已分享", onClick: () => {}, variant: "btn-teal-ghost", disabled: true }
                        : {
                            label: shareSong?.songMid === song.songMid ? "已选中" : "分享",
                            onClick: () => startShare(song),
                            variant: shareSong?.songMid === song.songMid ? "btn-gold" : "btn-secondary"
                          }
                    }
                    secondAction={{
                      label: "移除",
                      onClick: () =>
                        void removeFromPlaylist(song.songMid, song.songTitle ?? song.songMid)
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🎵</div>
                <div>歌单还是空的</div>
                <div className="text-xs">在搜索结果里点"+ 歌单"来添加歌曲</div>
              </div>
            )}
          </div>
        ) : null}

        {/* Daily recommendation tab */}
        {tab === "daily" ? (
          <div className="section-card" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", borderTop: "none" }}>
            <div className="row-between mb-16" style={{ alignItems: "center" }}>
              <div>
                <div className="section-label">今日推荐</div>
                {dailyDate ? (
                  <div className="text-xs" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                    {dailyDate} · 根据你的歌单和分享偏好从榜单中精选
                  </div>
                ) : null}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={refreshDaily}
                disabled={dailyLoading || dailyRefreshLocked}
              >
                {dailyLoading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : "刷新"}
              </button>
            </div>

            {dailyError ? (
              <div className="alert alert-error mb-16">{dailyError}</div>
            ) : null}

            {dailyLoading ? (
              <div className="empty-state">
                <div className="spinner" />
                <div>正在生成今日推荐…</div>
              </div>
            ) : dailySongs.length ? (
              <div className="stack-sm">
                {dailySongs.map((s) => {
                  const song = dailySongToQqSong(s);
                  return (
                    <SongCard
                      key={song.mid}
                      item={song}
                      active={isCurrentSong(song.mid)}
                      playing={isCurrentSong(song.mid) && playing && currentSong?.mid === song.mid}
                      loading={isLoading(song.mid)}
                      onPlay={playDailySong}
                      action={
                        playlistMids.has(song.mid)
                          ? { label: "已收藏", onClick: () => {}, variant: "btn-teal-ghost", disabled: true }
                          : { label: "+ 歌单", onClick: () => void addToPlaylist(song), variant: "btn-teal-ghost" }
                      }
                    />
                  );
                })}
              </div>
            ) : !dailyLoading && !dailyError ? (
              <div className="empty-state">
                <div className="empty-icon">🎵</div>
                <div>暂无推荐</div>
                <div className="text-xs">先去搜索并收藏几首歌，让推荐更了解你的口味</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

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
