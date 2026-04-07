# 歌单管理系统设计

## 概述

将现有的单一扁平收藏列表升级为完整的多歌单管理系统，支持创建/编辑/删除歌单、公开/私密设置、订阅他人公开歌单。现有用户的歌曲数据作为普通歌单迁移保留。

## 一、数据模型

### 1.1 新增表 `playlists`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | 自增主键 |
| `user_id` | INTEGER NOT NULL FK → users(id) | 创建者 |
| `name` | TEXT NOT NULL | 歌单名称 |
| `description` | TEXT | 歌单简介（可选） |
| `cover_url` | TEXT | 封面图 URL（可选，不设则取第一首歌封面） |
| `is_public` | INTEGER NOT NULL DEFAULT 0 | 0=私密, 1=公开 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) | 创建时间 |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) | 最后修改时间 |

索引：`idx_playlists_user (user_id, created_at DESC)`

### 1.2 新增表 `playlist_songs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | 自增主键 |
| `playlist_id` | INTEGER NOT NULL FK → playlists(id) ON DELETE CASCADE | 所属歌单 |
| `song_mid` | TEXT NOT NULL | QQ 歌曲 MID |
| `song_title` | TEXT | 歌曲标题 |
| `song_subtitle` | TEXT | 副标题 |
| `singer_name` | TEXT | 歌手 |
| `album_mid` | TEXT | 专辑 MID |
| `album_name` | TEXT | 专辑名 |
| `cover_url` | TEXT | 封面 |
| `added_at` | TEXT NOT NULL DEFAULT (datetime('now')) | 加入时间 |

唯一约束：`UNIQUE(playlist_id, song_mid)`
索引：`idx_playlist_songs_playlist (playlist_id, added_at DESC)`

### 1.3 新增表 `playlist_subscriptions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | 自增主键 |
| `user_id` | INTEGER NOT NULL FK → users(id) | 订阅者 |
| `playlist_id` | INTEGER NOT NULL FK → playlists(id) ON DELETE CASCADE | 被订阅的歌单 |
| `subscribed_at` | TEXT NOT NULL DEFAULT (datetime('now')) | 订阅时间 |

唯一约束：`UNIQUE(user_id, playlist_id)`

### 1.4 数据迁移

在应用启动时检测旧 `playlist` 表是否存在且新表已建好，在一个事务中执行：

1. 为旧表中每个 distinct `user_id` 在 `playlists` 中创建一条记录（name="我的收藏"）
2. 将旧表歌曲数据迁移到 `playlist_songs`，关联到对应的新歌单
3. 重命名旧表为 `playlist_legacy`（保留备份，不删除）

## 二、API 设计

所有歌单接口需登录（`requireAuth`）。

### 2.1 歌单 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/playlists` | 获取当前用户所有歌单列表（含歌曲数量） |
| `POST` | `/api/playlists` | 创建歌单。body: `{ name, description?, coverUrl?, isPublic? }` |
| `PATCH` | `/api/playlists/:id` | 修改歌单信息（名称/简介/封面/公开状态）。仅歌单拥有者可操作 |
| `DELETE` | `/api/playlists/:id` | 删除歌单。级联删除歌曲关系和订阅关系。仅歌单拥有者可操作 |
| `GET` | `/api/playlists/:id` | 获取单个歌单详情+歌曲列表。公开歌单任何人可访问，私密歌单仅本人 |

### 2.2 歌单内歌曲管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/playlists/:id/songs` | 往歌单添加歌曲。body: `{ songMid, songTitle, singerName, ... }` |
| `DELETE` | `/api/playlists/:id/songs/:songMid` | 从歌单移除歌曲 |

### 2.3 订阅

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/playlists/:id/subscribe` | 订阅一个公开歌单 |
| `DELETE` | `/api/playlists/:id/subscribe` | 取消订阅 |
| `GET` | `/api/subscriptions` | 获取当前用户订阅的所有歌单列表 |

### 2.4 社交发现

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/users/:id/playlists` | 获取某用户的公开歌单列表（用于用户主页） |

### 2.5 向后兼容

旧的 `GET/POST/DELETE /api/playlist` 保留作为兼容层，内部转发到新接口（操作用户的第一个歌单）。前端全部切到新接口后再移除。

### 2.6 返回格式

歌单列表项：

```json
{
  "id": 1,
  "name": "我的收藏",
  "description": null,
  "coverUrl": null,
  "isPublic": false,
  "songCount": 12,
  "createdAt": "2026-04-01T10:00:00Z",
  "updatedAt": "2026-04-07T15:30:00Z",
  "owner": { "id": 1, "nickname": "小明" }
}
```

歌单详情在列表项基础上增加 `songs: PlaylistSong[]` 和 `isSubscribed: boolean`。

## 三、前端 UI 设计

### 3.1 路由变化

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 保持不变（搜索 / 日推） |
| `/playlists` | PlaylistsPage（新增） | 当前用户的歌单管理主页 |
| `/playlists/:id` | PlaylistDetailPage（新增） | 单个歌单详情页 |
| `/plaza` | PlazaPage | 不变 |
| `/user/:userId` | UserPage | 新增"公开歌单"区块 |

导航栏新增"歌单"入口（在"首页"和"广场"之间）。

### 3.2 首页改动

移除现有的"我的歌单" Tab，首页只保留搜索和日推两个 Tab。搜索结果和日推中的"加入歌单"按钮改为弹出歌单选择弹窗（PlaylistPicker）。

### 3.3 PlaylistsPage

两个 Tab 切换：

**"我的歌单"：**
- 卡片网格展示：封面、名称、歌曲数量、公开/私密标记
- "新建歌单"按钮 → 弹窗填写名称、简介、公开/私密
- 卡片点击 → 进入详情页
- 卡片上快捷操作：编辑、删除

**"我的订阅"：**
- 卡片网格展示订阅的歌单 + 原作者信息
- 点击进入详情页
- 可取消订阅

### 3.4 PlaylistDetailPage

**顶部区域：** 封面 + 歌单名 + 简介 + 创建者 + 歌曲数量
- 自己的歌单：编辑按钮、播放全部、公开/私密切换
- 别人的公开歌单：订阅/取消订阅按钮、播放全部

**歌曲列表：** 复用 SongCard 组件
- 自己的歌单：可移除歌曲
- 所有人：可播放、可加入自己的歌单

### 3.5 UserPage 改动

在分享动态上方新增"公开歌单"区块：卡片横向滚动或网格展示，点击进入歌单详情页。

### 3.6 PlaylistPicker 组件

统一的"加入歌单"弹窗，用于搜索、日推、广场、用户页、歌单详情页等所有场景：
- 列出当前用户所有歌单（已包含该歌曲的歌单显示勾选状态）
- 底部"新建歌单"快捷入口
- 选中/取消即时生效

## 四、播放器集成

### 4.1 PlayerContext 改动

`queueSource` 从字符串扩展为结构体：
- `{ type: "playlist", playlistId: number }` — 歌单播放模式
- `{ type: "search" }` — 搜索结果播放
- 其他现有类型保持

"播放全部"将歌单所有歌曲替换到队列，记录对应 `playlistId`。订阅歌单也可播放全部。

### 4.2 封面降级策略

优先级：用户自定义 coverUrl → 歌单第一首歌 cover_url → 默认占位图。暂不做图片上传，自定义封面通过填写 URL 实现。

## 五、权限与边界处理

| 场景 | 处理 |
|------|------|
| 访问别人的私密歌单 | API 返回 403，前端显示"该歌单不可访问" |
| 订阅自己的歌单 | API 返回 400，前端隐藏订阅按钮 |
| 订阅私密歌单 | API 返回 403 |
| 删除有订阅者的歌单 | 允许删除，级联删除订阅关系 |
| 歌单内歌曲数上限 | 暂不限制 |
| 用户歌单数上限 | 暂不限制 |

## 六、迁移对现有功能的影响

| 现有功能 | 处理 |
|------|------|
| 首页"我的歌单" Tab | 移除，改为导航栏"歌单"入口 |
| 搜索/日推/广场的"+ 歌单"按钮 | 从直接加入改为弹出歌单选择器 |
| 播放队列"歌单模式" | queueSource 结构变化 |
| 日推算法 | 查询改为 playlist_songs 表 |
| 旧版 `/api/playlist` | 兼容层转发到新接口 |
