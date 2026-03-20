# Share Reactions Design

**Date:** 2026-03-20

**Status:** Approved in chat

## Goal

为现有音乐分享站增加一个轻量的“表情回应”能力，让用户可以对歌曲分享做低成本互动，同时尽量不增加服务器压力，不引入实时系统、通知系统或开放文本审核成本。

## Context

当前项目已经具备这些基础能力：

- 用户分享歌曲
- 广场分页浏览分享
- 用户主页查看个人分享
- 将分享歌曲加入个人歌单

现有技术栈以轻量为主：

- 后端：Express + SQLite
- 前端：React + Vite
- 广场数据：分页读取

因此，本次设计优先选择“弱互动、固定选项、低写入、非实时”的方案，而不是评论、私信、通知或聊天。

## Scope

第一版只做以下能力：

- 每条分享支持固定 5 个“表情 + 文案标签”回应
- 每个用户对同一条分享最多保留 1 个回应
- 用户可以修改或取消自己的回应
- 在广场页和用户主页展示回应计数
- 已登录用户可以直接回应，未登录用户需要先登录

第一版明确不做：

- 开放评论
- 自定义 emoji
- 通知红点
- 实时刷新
- 热度排序
- “谁回应了你”的明细列表

## Reaction Set

固定回应项使用白名单枚举，不单独建表：

- `slacking`: 摸鱼神曲
- `boost`: 提神
- `healing`: 治愈
- `after_work`: 下班路上
- `loop`: 单曲循环

这组回应满足几个目标：

- 贴合当前产品语境
- 数量少，移动端易展示
- 不需要文本审核
- 便于统计与缓存

## Product Behavior

### Entry Points

回应条只出现在两个已有高频页面：

- `apps/web/src/pages/PlazaPage.tsx`
- `apps/web/src/pages/UserPage.tsx`

不扩展到首页搜索、我的歌单、每日推荐，避免第一版范围膨胀。

### Interaction Rules

- 每条分享展示 5 个固定回应按钮
- 按钮格式为 `emoji + 文案 + 计数`
- 用户未选择任何回应时，点击任一按钮会创建回应
- 用户已选择某个回应时，点击其他按钮会切换回应
- 用户点击自己当前已选中的按钮时，会取消回应
- 分享作者不能对自己的分享回应
- 未登录用户点击回应时，引导登录

### Display Rules

- 广场页展示每条分享的回应计数和当前用户已选回应
- 用户主页展示每条分享的回应计数；如实现成本可控，也可同时展示当前用户已选回应
- 分享排序仍按发布时间，不因回应数量变化

## Architecture

整体采用“现有分享对象扩展字段 + 单独回应表”的方式：

1. `shares` 继续作为主内容对象
2. 新增 `share_reactions` 表保存用户对分享的轻量回应
3. 现有读接口直接补充回应聚合信息
4. 新增两个写接口处理设置回应和取消回应

这样做的好处是：

- 不破坏现有分享流程
- 不需要引入消息系统
- 不需要前端新增单独的详情查询
- 可以继续复用现有分页模型

## Data Model

新增表：`share_reactions`

建议字段：

- `share_id INTEGER NOT NULL`
- `user_id INTEGER NOT NULL`
- `reaction_key TEXT NOT NULL`
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`

建议约束：

- `UNIQUE(share_id, user_id)`
- `FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE`
- `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`

建议索引：

- `INDEX idx_share_reactions_share_id_reaction_key ON share_reactions(share_id, reaction_key)`

设计原则：

- 一人一条分享最多一条记录
- 统计按 `share_id + reaction_key` 聚合
- 删除分享时自动删除回应
- 不在 `shares` 表中增加冗余计数字段，避免第一版写扩散

## API Design

### Write APIs

新增两个接口：

- `PUT /api/shares/:shareId/reaction`
  - body: `{ reactionKey: "boost" }`
  - 语义：创建或修改当前用户对目标分享的回应

- `DELETE /api/shares/:shareId/reaction`
  - 语义：取消当前用户对目标分享的回应

### Read API Extensions

扩展现有读接口：

- `GET /api/shares/feed`
- `GET /api/users/:userId/shares`

每条 `share` 增加两个字段：

- `reactionCounts: Record<ReactionKey, number>`
- `viewerReactionKey: ReactionKey | null`

示例结构：

```ts
{
  id: 123,
  songTitle: "晴天",
  reactionCounts: {
    slacking: 2,
    boost: 5,
    healing: 1,
    after_work: 0,
    loop: 3
  },
  viewerReactionKey: "boost"
}
```

### Query Strategy

对于当前页的分享列表：

1. 先按现有方式查询 share 列表
2. 收集当前页的 `shareIds`
3. 用一条聚合查询拉取当前页所有回应计数
4. 若用户已登录，再用一条查询拉取当前用户在当前页上的回应
5. 在 Node 层合并回每条 share

目标是避免出现按分享逐条请求或逐条查询的 N+1 问题。

## Frontend Behavior

前端建议采用乐观更新：

- 用户点击回应后，先本地更新 `viewerReactionKey`
- 同时同步增减 `reactionCounts`
- 请求成功则保持当前状态
- 请求失败则回滚并显示 toast

每条分享需要独立的请求中状态，例如 `reactionPendingByShareId`，用于：

- 防止用户连点导致重复请求
- 避免同一条分享的状态乱序覆盖

界面布局上，回应条应放在分享文案和时间信息附近，不打断现有“歌曲信息 + 播放 + 加歌单/删除”主操作区域。

## Load Control

本设计针对服务器负担做了明确限制：

- 不做 WebSocket
- 不做 SSE
- 不做实时轮询
- 不做开放评论
- 不做通知明细
- 不做热度排序

请求模型保持简单：

- 写入：显式点击才触发，频率远低于播放行为
- 读取：只跟随现有分页接口返回当前页聚合信息
- 刷新：仅在用户切页、刷新页面、重新进入页面时自然发生

在当前 SQLite 规模下，只要 `share_id + reaction_key` 有索引，页面级聚合查询是合理的。只有在数据规模明显扩大后，才考虑增加冗余统计字段或缓存层。

## Error Handling

后端需要覆盖这些错误场景：

- 未登录用户写回应，返回认证错误
- `shareId` 不存在，返回 404
- `reactionKey` 不在白名单，返回 400
- 作者尝试回应自己的分享，返回 403

前端处理原则：

- 失败时回滚本地乐观更新
- 通过现有 toast 告知用户失败原因
- 不因为回应失败影响歌曲播放、加歌单、删除分享等已有功能

## Testing

后端重点验证：

- 首次回应创建成功
- 切换回应时旧计数减 1、新计数加 1
- 取消回应后计数回退
- 非法 `reactionKey` 被拒绝
- 未登录请求被拒绝
- 删除分享后回应被级联删除

前端重点验证：

- 乐观更新立即生效
- 请求失败时正确回滚
- 同一条分享 pending 时不能重复提交
- 广场页和用户主页都能正确渲染回应计数

手工回归至少覆盖：

- 广场回应
- 广场切换回应
- 用户主页查看回应计数
- 删除分享后相关回应消失

## Rollout Order

建议实现顺序：

1. 增加数据库表、约束和索引
2. 扩展后端 share 返回结构
3. 新增设置回应和取消回应接口
4. 在广场页接入回应条与乐观更新
5. 在用户主页接入回应展示
6. 做完整回归，确认不影响现有分享与播放体验

## Future Expansion

如果第一版效果好，可以考虑第二阶段再做：

- 用户主页上的“最近收到的回应摘要”
- 更丰富的回应标签文案
- 低频通知摘要，而非逐条通知

这些都不属于当前第一版范围。
