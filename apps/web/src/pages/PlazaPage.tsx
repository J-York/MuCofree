import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiHome, type User } from "../api";
import Avatar from "../components/Avatar";
import { safeUrl } from "../utils";

export default function PlazaPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Banner */}
      <div className="plaza-banner">
        <div className="plaza-banner-title">打工人音乐广场</div>
        <div className="plaza-banner-sub">每个人都有一首属于自己的歌</div>
        <div className="row">
          <span className="badge badge-gold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
            {users.length} 位分享者
          </span>
        </div>
      </div>

      {/* Error */}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {/* Grid */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : users.length ? (
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
      )}
    </div>
  );
}
