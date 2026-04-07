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

## 环境变量

API 使用以下环境变量：

- `PORT`：服务端口，默认 `3001`。
- `DATABASE_PATH`：SQLite 数据库路径，默认自动指向 `apps/api/data/dev.sqlite`（兼容旧路径探测）。
- `QQMUSIC_BASE_URL`：QQ Music API 基础地址，默认 `https://api.ygking.top`。
- `CORS_ORIGIN`：允许携带凭证访问 API 的前端来源，默认 `http://127.0.0.1:5173`。
- `SESSION_SECRET`：会话签名密钥，**无默认值**，长度至少 16。开发和生产环境都必须设置；生产环境应使用高强度随机字符串。
- `SECURE_COOKIE`：是否仅通过 HTTPS 发送会话 Cookie，默认 `false`。生产环境在 HTTPS 下应设置为 `true`。
- `TRUST_PROXY`：是否信任反向代理头，默认 `false`。仅在服务部署于 Nginx、Ingress、云负载均衡等代理之后时设置为 `true`。

示例：

```bash
PORT=3001
DATABASE_PATH=apps/api/data/dev.sqlite
QQMUSIC_BASE_URL=https://api.ygking.top
CORS_ORIGIN=http://127.0.0.1:5173
SESSION_SECRET=replace-with-a-long-random-secret
SECURE_COOKIE=false
TRUST_PROXY=false
```

生产环境至少需要确认：

- 已显式设置 `SESSION_SECRET`
- `CORS_ORIGIN` 指向实际前端域名
- 在 HTTPS + 反向代理部署下，将 `SECURE_COOKIE=true` 且按需设置 `TRUST_PROXY=true`
- 若使用自定义数据库位置或第三方 QQ Music 服务地址，显式设置 `DATABASE_PATH` / `QQMUSIC_BASE_URL`
