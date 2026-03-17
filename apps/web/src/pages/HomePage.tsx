import { useEffect, useRef, useState } from "react";
import {
  apiCreateShare,
  apiGetPlaylist,
  apiAddToPlaylist,
  apiRemoveFromPlaylist,
  apiQqSearch,
  type QqSong,
  type PlaylistSong
} from "../api";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";

type Tab = "search" | "playlist";

export default function HomePage() {
  const { user } = useAuth();
  const { play, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "playlist" ? "playlist" : "search";

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

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Load playlist on mount
  useEffect(() => {
    void loadPlaylist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      showToast(`已添加《${song.title}》到我的歌单`);
      void loadPlaylist();
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function removeFromPlaylist(songMid: string, title: string) {
    try {
      await apiRemoveFromPlaylist(songMid);
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
    if (!shareSong) return;
    setShareLoading(true);
    setShareError(null);

    try {
      await apiCreateShare({
        songMid: shareSong.songMid,
        songTitle: shareSong.songTitle,
        songSubtitle: shareSong.songSubtitle,
        singerName: shareSong.singerName,
        albumMid: shareSong.albumMid,
        albumName: shareSong.albumName,
        coverUrl: shareSong.coverUrl,
        comment: shareComment.trim() || null
      });

      showToast(`已将《${shareSong.songTitle ?? shareSong.songMid}》分享到广场`);
      cancelShare();
    } catch (e) {
      setShareError((e as Error).message);
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

    play(song, queue.length ? queue : undefined);
  }

  function playPlaylistSong(song: PlayerSong) {
    const queue = playlist.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined
    }));

    play(song, queue.length ? queue : undefined);
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
              <div className="card-sm stack-sm mb-16" style={{ background: "var(--gold-light)", borderColor: "#f0ddb8" }}>
                <div className="row-between">
                  <div className="section-label" style={{ color: "#8B6430" }}>分享到广场</div>
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
                    action={{
                      label: shareSong?.songMid === song.songMid ? "已选中" : "分享",
                      onClick: () => startShare(song),
                      variant: shareSong?.songMid === song.songMid ? "btn-gold" : "btn-secondary"
                    }}
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
