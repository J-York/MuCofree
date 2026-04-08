import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ThemeToggle from "./components/ThemeToggle";
import { PlayerProvider } from "./context/PlayerContext";
import Player from "./components/Player";
import Avatar from "./components/Avatar";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import PlazaPage from "./pages/PlazaPage";
import UserPage from "./pages/UserPage";
import PlaylistSharePage from "./pages/PlaylistSharePage";
import PlaylistListPage from "./pages/PlaylistListPage";
import PlaylistDetailPage from "./pages/PlaylistDetailPage";

// ── Route guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null; // or a full-page spinner
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function SiteHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        {/* Logo */}
        <NavLink to="/" className="logo">
          <div className="logo-mark">♫</div>
          <div>
            <div className="logo-text">音乐广场</div>
            <div className="logo-sub">打工人的音乐分享</div>
          </div>
        </NavLink>

        {/* Nav links */}
        <nav className="site-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            首页
          </NavLink>
          <NavLink
            to="/plaza"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            广场
          </NavLink>
          {user ? (
            <>
              <NavLink
                to={`/user/${user.id}`}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                我的主页
              </NavLink>
              <NavLink
                to="/playlists"
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                我的歌单
              </NavLink>
            </>
          ) : null}
        </nav>

        {/* User area */}
        <div className="nav-user">
          {user ? (
            <>
              <Avatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
              <span className="nav-name">{user.name}</span>
              <ThemeToggle />
              <button className="btn btn-ghost btn-sm" onClick={() => void handleLogout()}>
                退出
              </button>
            </>
          ) : (
            <>
              <ThemeToggle />
              <NavLink to="/login" className="btn btn-primary btn-sm">
                登录
              </NavLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppShell() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SiteHeader />

      <main className="page-content">
        <div className="container">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <HomePage />
                </RequireAuth>
              }
            />
            <Route
              path="/playlist/share/:token"
              element={
                <RequireAuth>
                  <PlaylistSharePage />
                </RequireAuth>
              }
            />
            <Route path="/plaza" element={<PlazaPage />} />
            <Route
              path="/playlists"
              element={
                <RequireAuth>
                  <PlaylistListPage />
                </RequireAuth>
              }
            />
            <Route
              path="/playlists/:playlistId"
              element={
                <RequireAuth>
                  <PlaylistDetailPage />
                </RequireAuth>
              }
            />
            <Route path="/user/:userId" element={<UserPage />} />
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <Player />
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PlayerProvider>
          <AppShell />
        </PlayerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
