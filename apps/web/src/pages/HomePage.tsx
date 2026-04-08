import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  apiAddSongToDefaultPlaylist,
  apiGetPlaylistItems,
  apiListPlaylists,
  apiQqSearch,
  apiRecommendDaily,
  type QqSong,
  type PlaylistSummary,
  type DailySong,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";

type Tab = "search" | "daily";
const DAILY_REFRESH_COOLDOWN_MS = 10_000;

export default function HomePage() {
  const { user } = useAuth();
  const { play, appendToPlaylistQueue, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "daily" ? "daily" : "search";

  function setTab(nextTab: Tab) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "search") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }
    setSearchParams(nextParams);
  }

  // Search
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<QqSong[]>([]);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Playlist mids (for showing "已收藏" state on search/daily results)
  const [playlistMids, setPlaylistMids] = useState<Set<string>>(new Set());
  const [defaultPlaylist, setDefaultPlaylist] = useState<PlaylistSummary | null>(null);

  // Daily recommendation
  const [dailySongs, setDailySongs] = useState<DailySong[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState<string | null>(null);
  const [dailyRefreshLocked, setDailyRefreshLocked] = useState(false);
  const dailyLoadedRef = useRef(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const loadDefaultPlaylistSnapshot = useCallback(async () => {
    try {
      const data = await apiListPlaylists(0, 100);
      const def = data.items.find((p) => p.isDefault) ?? data.items[0] ?? null;
      setDefaultPlaylist(def);

      if (!def) {
        setPlaylistMids(new Set());
        return;
      }

      const itemsRes = await apiGetPlaylistItems(def.id, 0, 500);
      setPlaylistMids(new Set(itemsRes.items.map((item) => item.songMid)));
    } catch {
      // Non-critical; users can still add songs, badges may be stale until next refresh.
      setDefaultPlaylist(null);
      setPlaylistMids(new Set());
    }
  }, []);

  useEffect(() => {
    void loadDefaultPlaylistSnapshot();
  }, [user?.id, loadDefaultPlaylistSnapshot]);

  // Daily recommendation
  const loadDaily = useCallback(async (refresh = false) => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiRecommendDaily(refresh);
      setDailySongs(data.songs);
      setDailyDate(data.seedDate);
      if (refresh) {
        setDailyRefreshLocked(true);
        setTimeout(() => setDailyRefreshLocked(false), DAILY_REFRESH_COOLDOWN_MS);
      }
    } catch (e) {
      setDailyError((e as Error).message);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "daily" || dailyLoadedRef.current) return;
    dailyLoadedRef.current = true;
    void loadDaily(false);
  }, [tab, loadDaily]);

  function refreshDaily() {
    if (dailyLoading || dailyRefreshLocked) return;
    void loadDaily(true);
  }

  // Search
  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw) return;

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

  // Add song to default playlist (used by search & daily tabs)
  async function addToPlaylist(song: QqSong) {
    try {
      const result = await apiAddSongToDefaultPlaylist({
        songMid: song.mid,
        songTitle: song.title,
        songSubtitle: song.subtitle ?? null,
        singerName: song.singer ?? null,
        albumMid: song.albumMid ?? null,
        albumName: song.albumName ?? null,
        coverUrl: song.coverUrl ?? null,
      });

      appendToPlaylistQueue(
        {
          mid: song.mid,
          title: song.title,
          singer: song.singer ?? undefined,
          coverUrl: song.coverUrl ?? undefined,
        },
        result.playlistId,
      );
      setPlaylistMids((prev) => new Set([...prev, song.mid]));
      showToast(`已添加《${song.title}》到${defaultPlaylist?.name ?? "默认歌单"}`);

      if (!defaultPlaylist || defaultPlaylist.id !== result.playlistId) {
        void loadDefaultPlaylistSnapshot();
      }
    } catch (e) {
      const message = (e as Error).message;
      showToast(message === "Default playlist not found" ? "请先创建歌单" : message);
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
      coverUrl: item.coverUrl,
    }));
    play(song, queue.length ? queue : undefined, "search");
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
        : undefined,
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
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">
            {user ? `你好，${user.name}` : "音乐广场"}
          </h1>
          <p className="page-subtitle">搜索 QQ Music，播放并保存你喜欢的歌曲</p>
        </div>
        <Link className="btn btn-primary btn-sm" to="/playlists">
          我的歌单
        </Link>
      </div>

      {/* Tabs */}
      <div>
        <div className="tabs">
          <button
            className={`tab-item ${tab === "search" ? "active" : ""}`}
            onClick={() => setTab("search")}
          >
            搜索
          </button>
          <button
            className={`tab-item ${tab === "daily" ? "active" : ""}`}
            onClick={() => setTab("daily")}
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
        <div className="alert alert-success toast-fixed">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
