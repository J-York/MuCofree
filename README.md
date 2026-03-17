# Music Share（打工人音乐分享）

一个给每天上班的打工族用的音乐分享站：
- 每个人可以创建自己的主页并分享喜欢的歌曲（带封面）
- 首页按"分享人"分组展示所有人的分享
- 其他人可以直接在站内播放这些分享（播放链接由 QQMusic API 获取）
- 支持删除自己的分享
## 开发环境

- Node.js >= 18
- npm >= 9

## 启动

```bash
npm install
npm run dev
```

- API: http://127.0.0.1:3001
- Web: http://127.0.0.1:5173

## 目录结构

- `apps/api`：后端（Express + SQLite）
- `apps/web`：前端（React + Vite）

## 环境变量（可选）

API 支持：
- `PORT`（默认 3001）
- `DATABASE_PATH`（默认 `apps/api/data/dev.sqlite`）
- `QQMUSIC_BASE_URL`（默认 `https://api.ygking.top`）
