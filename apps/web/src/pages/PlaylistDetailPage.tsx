import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  apiGetPlaylistDetail,
  apiGetPlaylistItems,
  apiUpdatePlaylist,
  apiArchivePlaylist,
  apiRemovePlaylistItem,
  apiReorderPlaylistItems,
  apiCreatePlaylistShareLink,
  apiCreateShare,
  apiImportQqPlaylist,
  apiUpdatePlaylistMember,
  apiRemovePlaylistMember,
  apiUserShares,
  type PlaylistSummary,
  type PlaylistItem,
  type PlaylistMember,
} from "../api";
import { useAuth } from "../context/AuthContext";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import SongCard from "../components/SongCard";
import SortableSongItem from "../components/SortableSongItem";
import { resetPlazaPageCache } from "./PlazaPage";
import { safeUrl } from "../utils";

export default function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { play, removeFromPlaylistQueue, loadingMid, isCurrentSong, currentSong, playing } = usePlayer();

  const [playlist, setPlaylist] = useState<PlaylistSummary | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [members, setMembers] = useState<PlaylistMember[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLinkScope, setShareLinkScope] = useState<"read" | "edit" | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [sharedSongMids, setSharedSongMids] = useState<Set<string>>(new Set());
  const [shareDraftItem, setShareDraftItem] = useState<PlaylistItem | null>(null);
  const [shareComment, setShareComment] = useState("");
  const [shareSubmittingMid, setShareSubmittingMid] = useState<string | null>(null);
  const [playlistImportLoading, setPlaylistImportLoading] = useState(false);
  const [memberActionUserId, setMemberActionUserId] = useState<number | null>(null);

  // Ref to track current playlistId for stale-closure safety in async
  const playlistIdRef = useRef<string | null>(null);
  const shareComposerRef = useRef<HTMLDivElement | null>(null);
  const shareCommentRef = useRef<HTMLTextAreaElement | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── Data loading ──────────────────────────────────────────────────────

  async function loadItems(id: string) {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const data = await apiGetPlaylistItems(id, 0, 500);
      setItems(data.items);
      // Keep revision in sync
      setPlaylist((prev) =>
        prev ? { ...prev, revision: data.revision, itemCount: data.total } : prev,
      );
    } catch (e) {
      setItemsError((e as Error).message);
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const data = await apiGetPlaylistDetail(id);
      setPlaylist(data.playlist);
      setMembers(data.members);
    } catch (e) {
      setPageError((e as Error).message);
    } finally {
      setMembersLoading(false);
    }
  }

  async function reloadAll(id: string) {
    await Promise.all([loadItems(id), loadDetail(id)]);
  }

  async function loadMySharedSongMids(userId: number) {
    try {
      const data = await apiUserShares(userId);
      setSharedSongMids(new Set(data.shares.map((share) => share.songMid)));
    } catch {
      // Non-blocking for playlist browsing; duplicate share attempts are still rejected server-side.
    }
  }

  useEffect(() => {
    if (!playlistId) {
      setPageError("缺少歌单 ID");
      return;
    }
    playlistIdRef.current = playlistId;
    setPageError(null);
    setShareLink(null);
    void reloadAll(playlistId);
  }, [playlistId]);

  useEffect(() => {
    if (!me) {
      setSharedSongMids(new Set());
      return;
    }
    void loadMySharedSongMids(me.id);
  }, [me?.id]);

  // ── Derived state ─────────────────────────────────────────────────────

  const isOwner = playlist?.role === "owner";
  const canEdit = Boolean(
    playlist &&
    playlist.status === "active" &&
    (playlist.role === "owner" || playlist.role === "editor"),
  );

  // ── Business logic ────────────────────────────────────────────────────

  async function removeFromPlaylist(songMid: string, title: string) {
    if (!playlist) return;

    try {
      const result = await apiRemovePlaylistItem(playlist.id, songMid, playlist.revision);
      removeFromPlaylistQueue(songMid, playlist.id);
      setItems((prev) => prev.filter((song) => song.songMid !== songMid));
      if (shareDraftItem?.songMid === songMid) {
        setShareDraftItem(null);
        setShareComment("");
      }
      setPlaylist((prev) =>
        prev
          ? { ...prev, revision: result.revision, itemCount: Math.max(0, prev.itemCount - 1) }
          : prev,
      );
      showToast(`已从歌单移除《${title}》`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadAll(playlist.id);
      }
      showToast(message);
    }
  }

  const [reordering, setReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !playlist || reordering) return;

      const oldIndex = items.findIndex((s) => s.songMid === active.id);
      const newIndex = items.findIndex((s) => s.songMid === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(items, oldIndex, newIndex);
      setItems(reordered);

      const songMids = reordered.map((s) => s.songMid);
      setReordering(true);
      try {
        const result = await apiReorderPlaylistItems(playlist.id, songMids, playlist.revision);
        setItems(result.items);
        setPlaylist((prev) => (prev ? { ...prev, revision: result.revision } : prev));
      } catch (e) {
        const message = (e as Error).message;
        if (message === "Playlist revision conflict") {
          await reloadAll(playlist.id);
        } else {
          setItems(items);
        }
        showToast(message);
      } finally {
        setReordering(false);
      }
    },
    [items, playlist, reordering],
  );

  async function renamePlaylist() {
    if (!playlist) return;

    const nextName = window.prompt("歌单名称", playlist.name);
    if (nextName === null) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      showToast("歌单名称不能为空");
      return;
    }

    const nextDescription = window.prompt("歌单描述", playlist.description ?? "");
    if (nextDescription === null) return;

    try {
      const response = await apiUpdatePlaylist(playlist.id, {
        expectedRevision: playlist.revision,
        name: trimmedName,
        description: nextDescription.trim() || null,
      });
      setPlaylist(response.playlist);
      showToast("歌单已更新");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadAll(playlist.id);
      }
      showToast(message);
    }
  }

  async function archivePlaylist() {
    if (!playlist) return;
    if (playlist.isDefault) {
      showToast("默认歌单不能删除");
      return;
    }

    if (!window.confirm(`确定删除歌单《${playlist.name}》吗？`)) return;

    try {
      await apiArchivePlaylist(playlist.id, playlist.revision);
      showToast("歌单已删除");
      navigate("/playlists");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadAll(playlist.id);
      }
      showToast(message);
    }
  }

  async function generateShareLink(scope: "read" | "edit") {
    if (!playlist) return;

    if (playlist.role !== "owner") {
      showToast("只有 owner 可以生成分享链接");
      return;
    }

    try {
      setShareLinkLoading(true);
      const response = await apiCreatePlaylistShareLink(playlist.id, { scope, expiresInHours: 72 });
      const fullLink = new URL(response.sharePath, window.location.origin).toString();
      setShareLink(fullLink);
      setShareLinkScope(scope);
      showToast(scope === "read" ? "已生成歌单只读链接" : "已生成歌单协作链接");
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setShareLinkLoading(false);
    }
  }

  async function copyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      showToast("歌单分享链接已复制");
    } catch {
      showToast("复制失败，请手动复制");
    }
  }

  async function importQqPlaylist() {
    if (!playlist) return;

    if (!canEdit) {
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

    const targetId = playlist.id;
    const targetRevision = playlist.revision;

    try {
      setPlaylistImportLoading(true);
      const result = await apiImportQqPlaylist(targetId, {
        source: trimmedSource,
        expectedRevision: targetRevision,
      });
      const sourceTitle = result.sourcePlaylist.title ? `《${result.sourcePlaylist.title}》` : "QQ 歌单";

      if (playlistIdRef.current === targetId) {
        await reloadAll(targetId);
      }

      const truncatedSuffix = result.truncatedSourceSongCount > 0
        ? `，另有 ${result.truncatedSourceSongCount} 首因单次导入上限未处理`
        : "";
      showToast(`${sourceTitle} 导入完成：新增 ${result.importedCount} 首，跳过 ${result.skippedCount} 首${truncatedSuffix}`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict" && playlistIdRef.current === targetId) {
        await reloadAll(targetId);
      }
      showToast(message);
    } finally {
      setPlaylistImportLoading(false);
    }
  }

  async function updateMemberRole(targetUserId: number, role: "editor" | "viewer", status: "active" | "pending" = "active") {
    if (!playlist) return;

    setMemberActionUserId(targetUserId);
    try {
      const response = await apiUpdatePlaylistMember(playlist.id, targetUserId, {
        role,
        status,
        expectedRevision: playlist.revision,
      });

      setMembers((prev) =>
        prev.map((member) =>
          member.userId === targetUserId ? response.member : member,
        ),
      );
      setPlaylist((prev) => prev ? { ...prev, revision: response.revision } : prev);
      showToast(status === "active" ? "成员权限已更新" : "成员状态已更新");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadAll(playlist.id);
      }
      showToast(message);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function removeMember(targetUserId: number) {
    if (!playlist) return;

    setMemberActionUserId(targetUserId);
    try {
      const response = await apiRemovePlaylistMember(playlist.id, targetUserId, playlist.revision);
      setMembers((prev) => prev.filter((member) => member.userId !== targetUserId));
      setPlaylist((prev) => prev ? { ...prev, revision: response.revision } : prev);
      showToast("成员已移除");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Playlist revision conflict") {
        await reloadAll(playlist.id);
      }
      showToast(message);
    } finally {
      setMemberActionUserId(null);
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────

  function startShare(item: PlaylistItem) {
    if (sharedSongMids.has(item.songMid) || shareSubmittingMid === item.songMid) return;

    setShareDraftItem(item);
    setShareComment("");

    requestAnimationFrame(() => {
      if (typeof shareComposerRef.current?.scrollIntoView === "function") {
        shareComposerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      shareCommentRef.current?.focus();
    });
  }

  async function submitShare() {
    if (!playlist || !shareDraftItem) return;

    const currentSong = shareDraftItem;
    const trimmedComment = shareComment.trim();

    setShareSubmittingMid(currentSong.songMid);
    try {
      await apiCreateShare({
        playlistId: playlist.id,
        songMid: currentSong.songMid,
        comment: trimmedComment || null,
      });
      setSharedSongMids((prev) => new Set([...prev, currentSong.songMid]));
      setShareDraftItem(null);
      setShareComment("");
      resetPlazaPageCache();
      showToast(`已将《${currentSong.songTitle ?? currentSong.songMid}》发布到主页和广场`);
    } catch (e) {
      const message = (e as Error).message;
      if (message === "这首歌已经分享过了") {
        setSharedSongMids((prev) => new Set([...prev, currentSong.songMid]));
        setShareDraftItem(null);
        setShareComment("");
      }
      showToast(message);
    } finally {
      setShareSubmittingMid(null);
    }
  }

  function playPlaylistSong(song: PlayerSong) {
    const queue = items.map((item) => ({
      mid: item.songMid,
      title: item.songTitle ?? item.songMid,
      singer: item.singerName ?? undefined,
      coverUrl: item.coverUrl ?? undefined,
    }));

    play(song, queue.length ? queue : undefined, "playlist", playlist?.id ?? null);
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (pageError) {
    return (
      <div className="section-card stack-lg">
        <div className="alert alert-error">{pageError}</div>
        <Link to="/playlists" className="btn btn-ghost btn-sm">← 返回歌单列表</Link>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="section-card">
        <div className="empty-state">
          <div className="spinner" />
          <div>加载中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="section-card stack-lg">
      {/* Toast */}
      {toast ? <div className="alert alert-info">{toast}</div> : null}

      {/* Back */}
      <Link to="/playlists" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
        ← 返回歌单列表
      </Link>

      {/* Header */}
      <div>
        <div className="page-title">{playlist.name}</div>
        <div className="text-xs" style={{ color: "var(--ink-light)", marginTop: 4 }}>
          {playlist.itemCount} 首 · 权限 {playlist.role}
          {playlist.visibility !== "private" ? ` · ${playlist.visibility}` : null}
          {playlist.description ? ` · ${playlist.description}` : null}
        </div>
      </div>

      {/* Action buttons */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void renamePlaylist()}
          disabled={!isOwner}
        >
          编辑歌单
        </button>
        <button
          className="btn btn-danger-ghost btn-sm"
          onClick={() => void archivePlaylist()}
          disabled={!isOwner || playlist.isDefault}
        >
          删除歌单
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void importQqPlaylist()}
          disabled={playlistImportLoading || !canEdit}
        >
          {playlistImportLoading ? "导入中…" : "导入 QQ 歌单"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void generateShareLink("read")}
          disabled={shareLinkLoading || !isOwner}
        >
          {shareLinkLoading && shareLinkScope === "read" ? "生成中…" : "歌单只读链接"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void generateShareLink("edit")}
          disabled={shareLinkLoading || !isOwner}
        >
          {shareLinkLoading && shareLinkScope === "edit" ? "生成中…" : "歌单协作链接"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void copyShareLink()}
          disabled={!shareLink}
        >
          复制歌单链接
        </button>
      </div>

      {/* Share link */}
      {shareLink ? (
        <div className="alert alert-info" style={{ wordBreak: "break-all" }}>
          {shareLinkScope === "edit" ? "歌单协作链接" : "歌单只读链接"}：{shareLink}
        </div>
      ) : null}

      {/* Songs section */}
      <div>
        <div className="section-label" style={{ marginBottom: 8 }}>歌曲</div>

        {canEdit ? (
          <div className="alert alert-info mb-16">
            在下方歌曲右侧点击“分享”，即可发布到个人主页和广场。
          </div>
        ) : null}

        {shareDraftItem ? (
          <div ref={shareComposerRef} className="playlist-share-panel mb-16">
            <div className="playlist-share-panel-header">
              <div>
                <div className="section-label" style={{ marginBottom: 10 }}>发布分享</div>
                <div className="page-subtitle" style={{ marginTop: 0 }}>
                  发布后会同步展示在你的主页和音乐广场。
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShareDraftItem(null);
                  setShareComment("");
                }}
                disabled={shareSubmittingMid === shareDraftItem.songMid}
              >
                取消
              </button>
            </div>

            <div className="playlist-share-preview">
              {safeUrl(shareDraftItem.coverUrl) ? (
                <img
                  src={safeUrl(shareDraftItem.coverUrl)!}
                  alt={shareDraftItem.songTitle ?? shareDraftItem.songMid}
                  className="cover"
                  style={{ width: 56, height: 56 }}
                />
              ) : (
                <div className="cover-placeholder" style={{ width: 56, height: 56 }}>♪</div>
              )}
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="song-title">
                  {shareDraftItem.songTitle ?? shareDraftItem.songMid}
                </div>
                <div className="song-meta">
                  {[shareDraftItem.singerName, shareDraftItem.songSubtitle].filter(Boolean).join(" · ") || "发布到音乐广场"}
                </div>
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="share-comment">
                分享文案
              </label>
              <textarea
                id="share-comment"
                ref={shareCommentRef}
                className="textarea"
                rows={3}
                maxLength={200}
                placeholder="写一句此刻想分享它的理由（可选）"
                value={shareComment}
                onChange={(e) => setShareComment(e.target.value)}
                disabled={shareSubmittingMid === shareDraftItem.songMid}
              />
              <div className="row-between">
                <span className="text-xs">可选，最多 200 字</span>
                <span className="text-xs">{shareComment.length} / 200</span>
              </div>
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                className="btn btn-gold"
                onClick={() => void submitShare()}
                disabled={shareSubmittingMid === shareDraftItem.songMid}
              >
                {shareSubmittingMid === shareDraftItem.songMid ? "发布中…" : "发布到主页 / 广场"}
              </button>
            </div>
          </div>
        ) : null}

        {itemsError ? (
          <div className="alert alert-error">{itemsError}</div>
        ) : null}

        {itemsLoading ? (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        ) : items.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext
              items={items.map((s) => s.songMid)}
              strategy={verticalListSortingStrategy}
            >
              <div className="stack-sm">
                {items.map((song) => (
                  <SortableSongItem
                    key={song.songMid}
                    id={song.songMid}
                    disabled={!canEdit || reordering}
                  >
                    <SongCard
                      item={song}
                      active={isCurrentSong(song.songMid)}
                      playing={isCurrentSong(song.songMid) && playing && currentSong?.mid === song.songMid}
                      selected={shareDraftItem?.songMid === song.songMid}
                      loading={loadingMid === song.songMid}
                      onPlay={playPlaylistSong}
                      action={canEdit ? (
                        sharedSongMids.has(song.songMid)
                          ? { label: "已分享", onClick: () => {}, variant: "btn-secondary", disabled: true }
                          : {
                              label: shareSubmittingMid === song.songMid ? "发布中…" : "分享",
                              onClick: () => startShare(song),
                              variant: "btn-gold",
                              disabled: shareSubmittingMid === song.songMid,
                            }
                      ) : undefined}
                      secondAction={canEdit ? {
                        label: "移除",
                        onClick: () =>
                          void removeFromPlaylist(song.songMid, song.songTitle ?? song.songMid),
                      } : undefined}
                    />
                  </SortableSongItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎵</div>
            <div>当前歌单为空</div>
            <div className="text-xs">在搜索或今日推荐里点击 &quot;+ 歌单&quot; 添加歌曲</div>
          </div>
        )}
      </div>

      {/* Members section (owner only) */}
      {isOwner ? (
        <div className="stack-sm">
          <div className="section-label">成员管理</div>

          {membersError ? (
            <div className="alert alert-error">{membersError}</div>
          ) : null}

          {membersLoading ? (
            <div className="empty-state">
              <div className="spinner" />
            </div>
          ) : members.length ? (
            members.map((member) => {
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
            <div className="text-xs" style={{ color: "var(--ink-light)" }}>
              暂无成员
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
