import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiHome, type Share, type User } from "../api";
import Avatar from "../components/Avatar";
import { usePlayer, type PlayerSong } from "../context/PlayerContext";
import { formatDateTime, safeUrl } from "../utils";

type ViewMode = "songs" | "users";

type ShareWithUser = Share & {
  userName: string;
  userAvatarUrl: string | null;
};

export default function PlazaPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("songs");
  const { currentSong, playing, play, togglePlayPause, loadingMid } = usePlayer();

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiHome();
      setUsers(data.users);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  // Flatten all shares with user info, sorted by newest first
  const allShares = useMemo<ShareWithUser[]>(() => {
    const list: ShareWithUser[] = [];
    for (const u of users) {
      if (!u.shares) continue;
      for (const sh of u.shares) {
        list.push({ ...sh, userName: u.name, userAvatarUrl: u.avatarUrl });
      }
    }
    list.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return db - da;
    });
    return list;
  }, [users]);

  const totalShares = allShares.length;

  function handlePlayShare(sh: ShareWithUser) {
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
      play(song);
    }
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Banner */}
      <div className="plaza-banner">
        <div className="plaza-banner-title">打工人音乐广场</div>
        <div className="plaza-banner-sub">每个人都有一首属于自己的歌</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge badge-gold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
            {totalShares} 首分享
          </span>
          <span className="badge badge-gold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
            {users.length} 位分享者
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

      {/* Error */}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {/* Content */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : view === "songs" ? (
        /* ──── Song waterfall view ──── */
        allShares.length ? (
          <div className="masonry">
            {allShares.map((sh) => {
              const isActive = currentSong?.mid === sh.songMid;
              const isLoadingThis = loadingMid === sh.songMid;
              return (
                <div key={sh.id} className="masonry-item">
                  <div
                    className={`plaza-share-card${isActive ? " plaza-share-card--active" : ""}`}
                  >
                    {/* Large cover */}
                    <div className="plaza-share-cover-wrap" onClick={() => handlePlayShare(sh)}>
                      {safeUrl(sh.coverUrl) ? (
                        <img
                          src={safeUrl(sh.coverUrl)!}
                          alt={sh.songTitle ?? ""}
                          className="plaza-share-cover"
                        />
                      ) : (
                        <div className="plaza-share-cover-placeholder">♪</div>
                      )}
                      {/* Play overlay */}
                      <div className="plaza-share-play-overlay">
                        {isLoadingThis ? (
                          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2, borderTopColor: "white", borderColor: "rgba(255,255,255,0.3)" }} />
                        ) : (
                          <span className="plaza-share-play-icon">
                            {isActive && playing ? "▐▐" : "▶"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="plaza-share-body">
                      {/* Song title + singer */}
                      <div className="song-title truncate">{sh.songTitle ?? sh.songMid}</div>
                      {sh.singerName ? (
                        <div className="song-meta truncate">{sh.singerName}</div>
                      ) : null}

                      {/* Comment */}
                      {sh.comment ? (
                        <div className="share-comment">{sh.comment}</div>
                      ) : null}

                      {/* User + time */}
                      <Link to={`/user/${sh.userId}`} className="plaza-share-user">
                        <Avatar name={sh.userName} avatarUrl={sh.userAvatarUrl} size="sm" />
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="text-sm truncate" style={{ color: "var(--ink-mid)", fontWeight: 500 }}>{sh.userName}</div>
                          <div className="text-xs">{formatDateTime(sh.createdAt)}</div>
                        </div>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎵</div>
            <div>还没有人分享音乐</div>
            <div className="text-xs">登录后前往你的主页开始分享吧</div>
          </div>
        )
      ) : (
        /* ──── User card view (original) ──── */
        users.length ? (
          <div className="grid-3">
            {users.map((u) => (
              <Link key={u.id} to={`/user/${u.id}`} className="user-card">
                {/* Cover strip */}
                {u.shares && u.shares.length > 0 ? (
                  <div className="user-card-covers">
                    {u.shares.slice(0, 3).map((sh) =>
                      safeUrl(sh.coverUrl) ? (
                        <img
                          key={sh.id}
                          src={safeUrl(sh.coverUrl)!}
                          alt={sh.songTitle ?? ""}
                          className="cover"
                          style={{ flex: 1, height: 60, borderRadius: 6 }}
                        />
                      ) : (
                        <div
                          key={sh.id}
                          className="cover-placeholder"
                          style={{ flex: 1, height: 60, borderRadius: 6, fontSize: 20 }}
                        >
                          ♪
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div
                    className="cover-placeholder"
                    style={{ height: 60, borderRadius: 8, width: "100%", fontSize: 22 }}
                  >
                    ♪
                  </div>
                )}

                {/* User info */}
                <div className="row">
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="song-title truncate">{u.name}</div>
                    <div className="song-meta">
                      {u.shares?.length ?? 0} 首分享
                    </div>
                  </div>
                  <span className="text-xs">›</span>
                </div>

                {/* Latest song preview */}
                {u.shares && u.shares[0] ? (
                  <div className="text-xs truncate" style={{ color: "var(--ink-light)" }}>
                    最近：{u.shares[0].songTitle ?? u.shares[0].songMid}
                    {u.shares[0].singerName ? ` · ${u.shares[0].singerName}` : ""}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎵</div>
            <div>还没有人分享音乐</div>
            <div className="text-xs">登录后前往你的主页开始分享吧</div>
          </div>
        )
      )}
    </div>
  );
}
