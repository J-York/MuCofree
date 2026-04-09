import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  apiListPlaylists,
  apiCreatePlaylist,
  type PlaylistSummary,
} from "../api";
import { useAuth } from "../context/AuthContext";

export default function PlaylistListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    loadPlaylists();
  }, []);

  async function loadPlaylists() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiListPlaylists(0, 100);
      setPlaylists(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = prompt("请输入歌单名称");
    if (!name?.trim()) {
      if (name !== null) showToast("歌单名称不能为空");
      return;
    }

    setCreating(true);
    try {
      const result = await apiCreatePlaylist({ name: name.trim() });
      showToast("歌单创建成功");
      navigate(`/playlists/${result.playlist.id}`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function visibilityLabel(v: string) {
    switch (v) {
      case "private":
        return "私密";
      case "link_readonly":
        return "链接可见";
      case "link_collab":
        return "链接协作";
      default:
        return v;
    }
  }

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      {/* Back */}
      <div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          ← 返回
        </button>
      </div>

      {/* Toast */}
      {toast ? <div className="alert alert-success">{toast}</div> : null}

      {/* Header */}
      <div className="row-between" style={{ alignItems: "center" }}>
        <div>
          <h1 className="page-title">我的歌单</h1>
          <p className="page-subtitle">
            {loading ? "加载中…" : `共 ${playlists.length} 个歌单`}
          </p>
        </div>
        {user ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? "创建中…" : "新建歌单"}
          </button>
        ) : null}
      </div>

      {/* Error */}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {/* Loading */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner" />
          <div>正在加载歌单…</div>
        </div>
      ) : null}

      {/* Empty */}
      {!loading && !error && playlists.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎵</div>
          <div>还没有歌单，点击上方按钮创建一个吧</div>
        </div>
      ) : null}

      {/* Playlist grid */}
      {!loading && playlists.length > 0 ? (
        <div className="grid-3">
          {playlists.map((pl) => (
            <Link
              key={pl.id}
              to={`/playlists/${pl.id}`}
              className="section-card card-hover"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="stack-sm">
                <div className="row" style={{ alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>
                    {pl.name}
                  </span>
                  {pl.isDefault ? (
                    <span className="badge badge-teal">默认</span>
                  ) : null}
                </div>

                <div className="text-xs" style={{ color: "var(--ink-light)" }}>
                  {pl.itemCount} 首歌 · {visibilityLabel(pl.visibility)}
                </div>

                {pl.description ? (
                  <div
                    className="text-xs"
                    style={{
                      color: "var(--ink-ghost)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pl.description}
                  </div>
                ) : null}

                <div className="row" style={{ gap: 6 }}>
                  <span className="badge">{pl.role === "owner" ? "拥有者" : pl.role === "editor" ? "编辑" : "查看"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
