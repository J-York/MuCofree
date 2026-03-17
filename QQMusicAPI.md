# QQ Music API（api.ygking.top）使用文档

> Base URL：`https://api.ygking.top`  
> 请求方式：**全部为 GET**  
> 返回格式：`application/json`（成功时）

---

## 1. 通用返回结构

多数接口成功时结构类似：

```json
{
  "code": 0,
  "data": {}
}
```

- `code = 0`：成功
- `data`：接口数据（不同接口字段不同）

错误情况（常见）：
- 参数缺失等非法请求可能返回 **HTTP 400**
- 不存在的路由返回 **HTTP 404**

---

## 2. 快速上手（推荐调用流程）

1) **搜索**获取歌曲 MID  
2) 用 MID 获取 **歌曲详情 / 播放链接 / 歌词 / 封面**  
3) 需要更多内容再请求 **专辑 / 歌单 / 歌手 / 排行榜**

示例（已验证可用）：
- 搜索：`/api/search?keyword=周杰伦&type=song&num=1` 返回的第一首歌 `mid = 002tNzue0g8xQA`
- 用这个 `mid` 可继续请求下游接口（见下文示例）

---

## 3. 接口列表与用法

### 3.1 搜索

**GET** `/api/search`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `keyword` | string | 是 | 搜索关键词 |
| `type` | string | 否 | `song / singer / album / playlist` |
| `num` | int | 否 | 返回数量 |
| `page` | int | 否 | 页码 |

示例：

```bash
curl "https://api.ygking.top/api/search?keyword=周杰伦&type=song&num=1"
```

---

### 3.2 获取歌曲播放链接

**GET** `/api/song/url`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 是 | 歌曲 MID，**多个用逗号分隔** |
| `quality` | string | 否 | `master / atmos / atmos_51 / flac / 320 / 128` |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/song/url?mid=002tNzue0g8xQA&quality=320"
```

成功返回示例（节选）：

```json
{
  "code": 0,
  "data": {
    "002tNzue0g8xQA": "https://isure.stream.qqmusic.qq.com/M800....mp3?...&vkey=..."
  },
  "quality": "320"
}
```

注意：
- 返回的播放链接通常携带 `vkey`，**可能会过期**；过期后重新调用本接口刷新即可。

---

### 3.3 获取歌曲详情

**GET** `/api/song/detail`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 否 | 歌曲 MID |
| `id` | int | 否 | 歌曲 ID |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/song/detail?mid=002tNzue0g8xQA"
```

---

### 3.4 获取歌词

**GET** `/api/lyric`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 否 | 歌曲 MID |
| `id` | int | 否 | 歌曲 ID |
| `qrc` | bool | 否 | `1/0`，逐字歌词（开启后 `lyric` 字段返回 QRC XML） |
| `trans` | bool | 否 | `1/0`，翻译歌词（`trans` 字段） |
| `roma` | bool | 否 | `1/0`，罗马音歌词（`roma` 字段，XML 格式） |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/lyric?mid=002tNzue0g8xQA&trans=1&roma=1"
```

---

### 3.5 获取歌曲封面

**GET** `/api/song/cover`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 否 | 歌曲 MID（可自动获取详情并回退到专辑封面） |
| `album_mid` | string | 否 | 专辑 MID（回退/指定用） |
| `size` | int | 否 | `150 / 300 / 500 / 800` |
| `validate` | bool | 否 | 是否验证（默认 `true`） |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/song/cover?mid=002tNzue0g8xQA&size=300"
```

---

### 3.6 获取专辑详情

**GET** `/api/album`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 是 | 专辑 MID |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/album?mid=003Ow85E3pnoqi"
```

---

### 3.7 获取歌单详情

**GET** `/api/playlist`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | int | 是 | 歌单 ID |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/playlist?id=8052190267"
```

---

### 3.8 获取歌手信息

**GET** `/api/singer`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `mid` | string | 是 | 歌手 MID |

示例（已验证可用）：

```bash
curl "https://api.ygking.top/api/singer?mid=0025NhlN2yWrP4"
```

---

### 3.9 排行榜

**GET** `/api/top`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | int | 否 | 榜单 ID（不传则返回榜单列表） |
| `num` | int | 否 | 返回数量 |

示例：

```bash
# 获取榜单列表（已验证可用）
curl "https://api.ygking.top/api/top"

# 获取某个榜单详情（已验证可用）
curl "https://api.ygking.top/api/top?id=4&num=10"
```

---

## 4. 前端 / Node 调用示例（fetch）

```js
const base = "https://api.ygking.top";

// 1) 搜索拿 mid
const search = await fetch(`${base}/api/search?keyword=周杰伦&type=song&num=1`).then(r => r.json());
const mid = search.data?.list?.[0]?.mid;

// 2) 拿播放链接
const urlRes = await fetch(`${base}/api/song/url?mid=${mid}&quality=320`).then(r => r.json());
const playUrl = urlRes.data?.[mid];

console.log({ mid, playUrl });
```

---

## 5. 相关链接

- 站点首页（接口列表）：https://api.ygking.top/
- 文档入口：https://doc.ygking.top
- GitHub：https://github.com/tooplick/qq-music-api
