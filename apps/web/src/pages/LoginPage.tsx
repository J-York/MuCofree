import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type Tab = "login" | "register";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      if (tab === "login") {
        await login(username.trim(), password);
      } else {
        if (!name.trim()) {
          setError("请填写昵称");
          return;
        }
        await register(username.trim(), password, name.trim());
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-card">
          {/* Header */}
          <div className="login-header">
            <div className="login-logo-mark">♫</div>
            <h1 className="login-title">音乐广场</h1>
            <p className="login-subtitle">打工人的音乐分享空间</p>
          </div>

          {/* Tabs */}
          <div className="login-tabs">
            <button
              className={`login-tab ${tab === "login" ? "active" : ""}`}
              onClick={() => { setTab("login"); setError(null); }}
              type="button"
            >
              登录
            </button>
            <button
              className={`login-tab ${tab === "register" ? "active" : ""}`}
              onClick={() => { setTab("register"); setError(null); }}
              type="button"
            >
              注册
            </button>
          </div>

          {/* Form */}
          <form onSubmit={(e) => void onSubmit(e)}>
            {tab === "register" && (
              <div className="form-field">
                <label className="form-label" htmlFor="name">昵称</label>
                <input
                  id="name"
                  className="input input-lg"
                  placeholder="你的显示名字"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required={tab === "register"}
                  autoComplete="nickname"
                />
              </div>
            )}

            <div className="form-field">
              <label className="form-label" htmlFor="username">用户名</label>
              <input
                id="username"
                className="input input-lg"
                placeholder="字母或数字"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                className="input input-lg"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={tab === "login" ? "current-password" : "new-password"}
              />
            </div>

            {error ? <div className="alert alert-error mb-16">{error}</div> : null}

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: "100%", marginTop: 8 }}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  处理中…
                </span>
              ) : tab === "login" ? "登录" : "创建账号"}
            </button>
          </form>

          <p className="text-xs" style={{ textAlign: "center", marginTop: 20 }}>
            {tab === "login" ? "还没有账号？" : "已有账号？"}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: "2px 6px" }}
              onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(null); }}
            >
              {tab === "login" ? "注册" : "去登录"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
