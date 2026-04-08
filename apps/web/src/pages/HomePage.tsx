import { useEffect, useRef, useState } from "react";
import {
  apiAddPlaylistItem,
  apiArchivePlaylist,
  apiCreatePlaylist,
  apiCreatePlaylistShareLink,
  apiGetPlaylistDetail,
  apiGetPlaylistItems,
  apiImportQqPlaylist,
  apiListPlaylists,
  apiQqSearch,
  apiReorderPlaylistItems,
  apiRemovePlaylistItem,
  apiRemovePlaylistMember,
  apiRecommendDaily,
  apiUpdatePlaylist,
  apiUpdatePlaylistMember,
  type QqSong,
  type PlaylistItem,
  type PlaylistMember,
  type PlaylistSummary,
  type DailySong,
} from "../api";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";

type Tab = "search" | "playlist" | "daily";
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

  // Playlists
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [playlistItemsLoading, setPlaylistItemsLoading] = useState(false);
  const [playlistItemsError, setPlaylistItemsError] = useState<string | null>(null);
  const [playlistMembers, setPlaylistMembers] = useState<PlaylistMember[]>([]);
  const [playlistMembersLoading, setPlaylistMembersLoading] = useState(false);
  const [playlistMembersError, setPlaylistMembersError] = useState<string | null>(null);
  const [memberActionUserId, setMemberActionUserId] = useState<number | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLinkScope, setShareLinkScope] = useState<"read" | "edit" | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [playlistImportLoading, setPlaylistImportLoading] = useState(false);

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

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const canImportToSelectedPlaylist = Boolean(
    selectedPlaylist &&
    selectedPlaylist.status === "active" &&
    (selectedPlaylist.role === "owner" || selectedPlaylist.role === "editor"),
  );

  function patchPlaylistInState(playlistId: string, patch: Partial<PlaylistSummary>) {
    setPlaylists((prev) =>
      prev.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, ...patch } : playlist,
      ),
    );
  }

  async function loadPlaylists(preferredPlaylistId?: string | null) {
    setPlaylistsLoading(true);
    setPlaylistsError(null);

    try {
      const data = await apiListPlaylists(0, 100);
      setPlaylists(data.items);

      const nextSelectedId =
        (preferredPlaylistId && data.items.find((playlist) => playlist.id === preferredPlaylistId)?.id) ||
        data.items.find((playlist) => playlist.isDefault)?.id ||
        data.items[0]?.id ||
        null;

      setSelectedPlaylistId(nextSelectedId);
      if (!nextSelectedId) {
        setPlaylistItems([]);
        setPlaylistItemsError(null);
        setPlaylistMembers([]);
        setPlaylistMembersError(null);
      }
    } catch (e) {
      setPlaylistsError((e as Error).message);
    } finally {
      setPlaylistsLoading(false);
    }
  }

  async function loadPlaylistItems(playlistId: string) {
    setPlaylistItemsLoading(true);
    setPlaylistItemsError(null);

    try {
      const data = await apiGetPlaylistItems(playlistId, 0, 500);
      setPlaylistItems(data.items);
      patchPlaylistInState(playlistId, { revision: data.revision, itemCount: data.total });
    } catch (e) {
      setPlaylistItemsError((e as Error).message);
    } finally {
      setPlaylistItemsLoading(false);
    }
  }

  async function loadPlaylistMembers(playlistId: string) {
    setPlaylistMembersLoading(true);
    setPlaylistMembersError(null);

    try {
      const data = await apiGetPlaylistDetail(playlistId);
      setPlaylistMembers(data.members);
      patchPlaylistInState(playlistId, data.playlist);
    } catch (e) {
      setPlaylistMembersError((e as Error).message);
    } finally {
      setPlaylistMembersLoading(false);
    }
  }

  async function reloadSelectedPlaylistData(playlistId: string) {
    await Promise.all([
      loadPlaylists(playlistId),
      loadPlaylistItems(playlistId),
      loadPlaylistMembers(playlistId),
    ]);
  }

  useEffect(() => {
    void loadPlaylists(selectedPlaylistId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!selectedPlaylistId) {
      setPlaylistItems([]);
      setPlaylistItemsError(null);
      setPlaylistMembers([]);
      setPlaylistMembersError(null);
      return;
    }

    void Promise.all([
      loadPlaylistItems(selectedPlaylistId),
      loadPlaylistMembers(selectedPlaylistId),
    ]);
  }, [selectedPlaylistId]);

  useEffect(() => {
    setShareLink(null);
    setShareLinkScope(null);
  }, [selectedPlaylistId]);

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

  const playlistMids = new Set(playlistItems.map((song) => song.songMid));

  async function addToSelectedPlaylist(song: QqSong) {
    if (!selectedPlaylist) {
      showToast("请先创建或选择歌单");
      return;
    }

    if (selectedPlaylist.status !== "active" || (selectedPlaylist.role !== "owner" && selectedPlaylist.role !== "editor")) {
      showToast("当前歌单不可编辑");
      return;
    }

    try {
      const result = await apiAddPlaylistItem(selectedPlaylist.id, {
        songMid: song.mid,
        songTitle: song.title,
        songSubtitle: song.subtitle ?? null,
        singerName: song.singer ?? null,
        albumMid: song.albumMid ?? null,
        albumName: song.albumName ?? null,
        coverUrl: song.coverUrl ?? null,
        expectedRevision: selectedPlaylist.revision,
      });

      setPlaylistItems((prev) => [...prev, result.item]);
      setPlaylists((prev) =>
        prev.map((playlist) =>
          playlist.id === selectedPlaylist.id
            ? { ...playlist, revision: result.revision, itemCount: playlist.itemCount + 1 }
            : playlist,
        ),
      );

      appendToPlaylistQueue(
        {
          mid: song.mid,
          title: song.title,
          singer: song.singer ?? undefined,
          coverUrl: song.coverUrl ?? undefined,
        },
        selectedPlaylist.id,
      );
      showToast(`已添加《${song.title}》到${selectedPlaylist.name}`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    }
  }

  async function removeFromSelectedPlaylist(songMid: string, title: string) {
    if (!selectedPlaylist) {
      showToast("请先选择歌单");
      return;
    }

    try {
      const result = await apiRemovePlaylistItem(selectedPlaylist.id, songMid, selectedPlaylist.revision);
      removeFromPlaylistQueue(songMid, selectedPlaylist.id);
      setPlaylistItems((prev) => prev.filter((song) => song.songMid !== songMid));
      setPlaylists((prev) =>
        prev.map((playlist) =>
          playlist.id === selectedPlaylist.id
            ? { ...playlist, revision: result.revision, itemCount: Math.max(0, playlist.itemCount - 1) }
            : playlist,
        ),
      );
      showToast(`已从歌单移除《${title}》`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    }
  }

  async function movePlaylistItem(songMid: string, direction: -1 | 1) {
    if (!selectedPlaylist) return;

    const currentIndex = playlistItems.findIndex((song) => song.songMid === songMid);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= playlistItems.length) return;

    const songMids = playlistItems.map((song) => song.songMid);
    [songMids[currentIndex], songMids[targetIndex]] = [songMids[targetIndex]!, songMids[currentIndex]!];

    try {
      const result = await apiReorderPlaylistItems(
        selectedPlaylist.id,
        songMids,
        selectedPlaylist.revision,
      );
      setPlaylistItems(result.items);
      patchPlaylistInState(selectedPlaylist.id, { revision: result.revision });
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    }
  }

  async function createPlaylist() {
    const name = window.prompt("新歌单名称", "新建歌单")?.trim();
    if (!name) return;

    try {
      const response = await apiCreatePlaylist({ name });
      setPlaylists((prev) => [response.playlist, ...prev]);
      setSelectedPlaylistId(response.playlist.id);
      setShareLink(null);
      showToast(`已创建歌单《${response.playlist.name}》`);
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  async function renameSelectedPlaylist() {
    if (!selectedPlaylist) return;

    const nextName = window.prompt("歌单名称", selectedPlaylist.name);
    if (nextName === null) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      showToast("歌单名称不能为空");
      return;
    }

    const nextDescription = window.prompt("歌单描述", selectedPlaylist.description ?? "");
    if (nextDescription === null) return;

    try {
      const response = await apiUpdatePlaylist(selectedPlaylist.id, {
        expectedRevision: selectedPlaylist.revision,
        name: trimmedName,
        description: nextDescription.trim() || null,
      });
      patchPlaylistInState(selectedPlaylist.id, response.playlist);
      showToast("歌单已更新");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    }
  }

  async function archiveSelectedPlaylist() {
    if (!selectedPlaylist) return;
    if (selectedPlaylist.isDefault) {
      showToast("默认歌单不能删除");
      return;
    }

    if (!window.confirm(`确定删除歌单《${selectedPlaylist.name}》吗？`)) return;

    try {
      await apiArchivePlaylist(selectedPlaylist.id, selectedPlaylist.revision);
      showToast("歌单已删除");
      await loadPlaylists();
      setShareLink(null);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    }
  }

  async function generateShareLink(scope: "read" | "edit") {
    if (!selectedPlaylist) {
      showToast("请先选择歌单");
      return;
    }

    if (selectedPlaylist.role !== "owner") {
      showToast("只有 owner 可以生成分享链接");
      return;
    }

    try {
      setShareLinkLoading(true);
      const response = await apiCreatePlaylistShareLink(selectedPlaylist.id, { scope, expiresInHours: 72 });
      const fullLink = new URL(response.sharePath, window.location.origin).toString();
      setShareLink(fullLink);
      setShareLinkScope(scope);
      showToast(scope === "read" ? "已生成只读分享链接" : "已生成协作分享链接");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setShareLinkLoading(false);
    }
  }

  async function importIntoSelectedPlaylist() {
    if (!selectedPlaylist) {
      showToast("请先选择歌单");
      return;
    }

    if (!canImportToSelectedPlaylist) {
      showToast("当前歌单不可编辑");
      return;
    }

    const source = window.prompt("输入 QQ 音乐歌单链接或歌单 ID");
    if (source === null) return;

    const trimmedSource = source.trim();
    if (!trimmedSource) {
      showToast("请输入 QQ 音乐歌单链接或歌单 ID");
      return;
    }

    try {
      setPlaylistImportLoading(true);
      const result = await apiImportQqPlaylist(selectedPlaylist.id, {
        source: trimmedSource,
        expectedRevision: selectedPlaylist.revision,
      });
      await reloadSelectedPlaylistData(selectedPlaylist.id);
      const sourceTitle = result.sourcePlaylist.title ? `《${result.sourcePlaylist.title}》` : "QQ 歌单";
      showToast(`${sourceTitle} 导入完成：新增 ${result.importedCount} 首，跳过 ${result.skippedCount} 首`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    } finally {
      setPlaylistImportLoading(false);
    }
  }

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      showToast("分享链接已复制");
    } catch {
      showToast("复制失败，请手动复制");
    }
  }

  async function updateMemberRole(targetUserId: number, role: "editor" | "viewer", status: "active" | "pending" = "active") {
    if (!selectedPlaylist) return;

    setMemberActionUserId(targetUserId);
    try {
      const response = await apiUpdatePlaylistMember(selectedPlaylist.id, targetUserId, {
        role,
        status,
        expectedRevision: selectedPlaylist.revision,
      });

      setPlaylistMembers((prev) =>
        prev.map((member) =>
          member.userId === targetUserId ? response.member : member,
        ),
      );
      patchPlaylistInState(selectedPlaylist.id, { revision: response.revision });
      showToast(status === "active" ? "成员权限已更新" : "成员状态已更新");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function removeMember(targetUserId: number) {
    if (!selectedPlaylist) return;

    setMemberActionUserId(targetUserId);
    try {
      const response = await apiRemovePlaylistMember(
        selectedPlaylist.id,
        targetUserId,
        selectedPlaylist.revision,
      );
      setPlaylistMembers((prev) => prev.filter((member) => member.userId !== targetUserId));
      patchPlaylistInState(selectedPlaylist.id, { revision: response.revision });
      showToast("成员已移除");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadSelectedPlaylistData(selectedPlaylist.id);
      }
      showToast(message);
    } finally {
      setMemberActionUserId(null);
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
    const queue = playlistItems.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined,
    }));

    play(song, queue.length ? queue : undefined, "playlist", selectedPlaylist?.id ?? null);
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
            我的歌单 {playlists.length ? `(${playlists.length})` : ""}
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
                        : { label: "+ 歌单", onClick: () => void addToSelectedPlaylist(song), variant: "btn-teal-ghost" }
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
            {playlistsError ? (
              <div className="alert alert-error mb-16">{playlistsError}</div>
            ) : null}

            <div className="row-between mb-16" style={{ gap: 8, flexWrap: "wrap" }}>
              <div className="section-label">歌单管理</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" onClick={() => void createPlaylist()}>
                  新建歌单
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void renameSelectedPlaylist()}
                  disabled={!selectedPlaylist || selectedPlaylist.role !== "owner"}
                >
                  编辑歌单
                </button>
                <button
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => void archiveSelectedPlaylist()}
                  disabled={!selectedPlaylist || selectedPlaylist.role !== "owner" || selectedPlaylist.isDefault}
                >
                  删除歌单
                </button>
              </div>
            </div>

            <div className="grid-2 playlist-grid" style={{ alignItems: "start", gap: 12 }}>
              <div className="stack-sm playlist-list-col">
                {playlistsLoading ? (
                  <div className="empty-state">
                    <div className="spinner" />
                  </div>
                ) : playlists.length ? (
                  playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      className={`btn btn-sm ${selectedPlaylistId === playlist.id ? "btn-gold" : "btn-ghost"}`}
                      style={{ justifyContent: "space-between" }}
                      onClick={() => setSelectedPlaylistId(playlist.id)}
                    >
                      <span>{playlist.name}</span>
                      <span className="text-xs">{playlist.itemCount}</span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">🎵</div>
                    <div>还没有歌单</div>
                  </div>
                )}
              </div>

              <div className="playlist-detail-col">
                {!selectedPlaylist ? (
                  <div className="empty-state">
                    <div className="empty-icon">📁</div>
                    <div>请选择一个歌单</div>
                  </div>
                ) : (
                  <>
                    <div className="row-between mb-16" style={{ gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div className="section-label">{selectedPlaylist.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
                          {selectedPlaylist.itemCount} 首 · 权限 {selectedPlaylist.role}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void importIntoSelectedPlaylist()}
                          disabled={playlistImportLoading || !canImportToSelectedPlaylist}
                        >
                          {playlistImportLoading ? "导入中…" : "导入 QQ 歌单"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void generateShareLink("read")}
                          disabled={shareLinkLoading || selectedPlaylist.role !== "owner"}
                        >
                          {shareLinkLoading && shareLinkScope === "read" ? "生成中…" : "只读链接"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void generateShareLink("edit")}
                          disabled={shareLinkLoading || selectedPlaylist.role !== "owner"}
                        >
                          {shareLinkLoading && shareLinkScope === "edit" ? "生成中…" : "协作链接"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => void copyShareLink()}
                          disabled={!shareLink}
                        >
                          复制链接
                        </button>
                      </div>
                    </div>

                    {shareLink ? (
                      <div className="alert alert-info mb-16" style={{ wordBreak: "break-all" }}>
                        {shareLinkScope === "edit" ? "协作" : "只读"}：{shareLink}
                      </div>
                    ) : null}

                    {playlistItemsError ? (
                      <div className="alert alert-error mb-16">{playlistItemsError}</div>
                    ) : null}

                    {playlistItemsLoading ? (
                      <div className="empty-state">
                        <div className="spinner" />
                      </div>
                    ) : playlistItems.length ? (
                      <div className="stack-sm">
                        {playlistItems.map((song, index) => (
                          <div key={song.songMid} className="stack-sm">
                            <SongCard
                              item={song}
                              active={isCurrentSong(song.songMid)}
                              playing={isCurrentSong(song.songMid) && playing && currentSong?.mid === song.songMid}
                              loading={isLoading(song.songMid)}
                              onPlay={playPlaylistSong}
                              secondAction={{
                                label: "移除",
                                onClick: () =>
                                  void removeFromSelectedPlaylist(song.songMid, song.songTitle ?? song.songMid),
                              }}
                            />
                            <div className="row" style={{ gap: 8 }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void movePlaylistItem(song.songMid, -1)}
                                disabled={index === 0}
                              >
                                上移
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void movePlaylistItem(song.songMid, 1)}
                                disabled={index === playlistItems.length - 1}
                              >
                                下移
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">🎵</div>
                        <div>当前歌单为空</div>
                        <div className="text-xs">在搜索或今日推荐里点击“+ 歌单”添加歌曲</div>
                      </div>
                    )}

                    {selectedPlaylist.role === "owner" ? (
                      <div className="stack-sm" style={{ marginTop: 16 }}>
                        <div className="section-label">成员管理</div>
                        {playlistMembersError ? (
                          <div className="alert alert-error">{playlistMembersError}</div>
                        ) : null}
                        {playlistMembersLoading ? (
                          <div className="empty-state">
                            <div className="spinner" />
                          </div>
                        ) : playlistMembers.length ? (
                          playlistMembers.map((member) => {
                            const busy = memberActionUserId === member.userId;
                            const isOwnerMember = member.role === "owner";

                            return (
                              <div key={member.userId} className="row-between" style={{ gap: 8, flexWrap: "wrap" }}>
                                <div className="text-sm">
                                  用户 #{member.userId} · 角色 {member.role} · 状态 {member.status}
                                </div>
                                {isOwnerMember ? (
                                  <span className="badge badge-teal">Owner</span>
                                ) : (
                                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => void updateMemberRole(member.userId, "viewer", "active")}
                                      disabled={busy || (member.role === "viewer" && member.status === "active")}
                                    >
                                      设为查看者
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => void updateMemberRole(member.userId, "editor", "active")}
                                      disabled={busy || (member.role === "editor" && member.status === "active")}
                                    >
                                      批准编辑
                                    </button>
                                    <button
                                      className="btn btn-danger-ghost btn-sm"
                                      onClick={() => void removeMember(member.userId)}
                                      disabled={busy}
                                    >
                                      移除
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            暂无成员
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
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
                          : { label: "+ 歌单", onClick: () => void addToSelectedPlaylist(song), variant: "btn-teal-ghost" }
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
