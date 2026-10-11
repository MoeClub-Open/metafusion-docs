---
title: "社区与互动 API"
description: "讨论、收藏、用户统计、私信、通知、举报与管理协议。"
order: 65
group: "api"
---

# 社区与互动 API

普通用户操作见[社区使用指南](/community-guide)。本页描述互动服务的请求与响应；凭据见[认证与凭证](/api-auth)。

公开讨论支持匿名读取。发主题、回复与短评需要登录及 `community.post.create`；收藏和私信需要登录。管理操作按各自权限放行。

## 讨论与条目短评

| 端点 | 用途 |
| --- | --- |
| `GET /api/community/boards` | 当前板块 |
| `GET|POST /api/community/topics` | 主题列表 / 创建主题 |
| `GET|DELETE /api/community/topics/:id` | 主题详情 / 删除 |
| `POST /api/community/topics/:id/posts` | 回复 |
| `DELETE /api/community/topics/:id/posts/:postId` | 删除回复 |
| `GET|POST /api/community/entities/:id/posts` | 条目短评 |
| `GET|DELETE /api/community/posts/:id` | 单条短评或回复 |
| `GET /api/community/feed` | 条目短评信息流 |
| `GET /api/community/topic-tags` | 话题标签 |

作者可删除自己的内容，处置他人内容需要 `community.post.moderate`。条目短评锚定实体，论坛主题可以关联实体；两者的列表与统计分别处理。

## 收藏

| 端点 | 请求与响应 |
| --- | --- |
| `POST /api/favorites/toggle` | `{target_type, target_id}` → `{favorited}` |
| `GET /api/favorites/status` | target_type、逗号分隔 target_ids → `{favorited:[id,...]}`；匿名返回空集 |
| `GET /api/favorites/mine` | 本人收藏，需登录 |
| `GET /api/users/:id/favorites` | 用户公开收藏，按访问者的实体可见性过滤 |

target_type 为八种实体 kind。切换前验证目标种类与可见性，并用合并身份归一；目录依赖故障为 503，不能当作目标不存在。

收藏列表支持 target_type、page、page_size，默认 1 / 20，上限 100，越界值取默认，响应 `{items,total}`。

## 用户主页统计

`GET /api/users/:id/stats` 返回 `{stats:{topics_created, comments_created, favorites_count}}`：

- topics_created 是论坛主题数，排除实体短评。
- comments_created 是楼中回复数，不计主题正文与实体短评。
- favorites_count 是收藏行数，读取列表仍会按调用者可见性过滤目标。

非 UUID 的 id 返回 404；互动服务不检查账号是否存在，没有记录时返回零统计。账号资料见[认证与凭证](/api-auth)，目录贡献见[实体查询与详情](/api-entities)。

## 私信

以下端点只对当前账号开放：

| 端点 | 用途 / 响应 |
| --- | --- |
| `GET /api/messages/conversations` | `{items:[{peer_id,last_message,unread_count}],total}` |
| `GET /api/messages/unread` | `{unread_count}` |
| `GET /api/messages/with/:id` | `{items:[{id,sender_id,recipient_id,body,created_at}],total}` |
| `POST /api/messages/with/:id` | `{body}` → `{message}` |
| `PUT /api/messages/with/:id/read` | `{marked}` |
| `GET|PUT /api/messages/settings` | `{accept_from_strangers:boolean}` |

列表使用 page / page_size，默认 1 / 20，上限 100，最新消息在前。peer_id 的昵称与头像从公开账号资料获取。

GET 会话不自动标记已读；只有收件人能标记自己的未读，重复调用 marked=0。自己发出的消息不计入未读。

正文去空白后需 1–4000 字符，不能向自己发信。发送默认按账号令牌桶限频，容量 180、每分钟回满；陌生人新会话另有容量 5、每小时回满的额度，两者均需满足。计数由互动服务数据库共享，超限返回 429 和 Retry-After。容量及管理员默认豁免可配置，见下文限流策略。收件设置控制陌生人的新会话，PUT 必须明确传入布尔字段；设置属于本人，不能读写他人设置。

非 UUID 的对方 ID 返回 404，未登录返回 401。对方账号引用不在互动服务跨库验证，收件受限时返回 `403 recipient_not_accepting_messages`。

## 限流策略

互动服务的所有业务 API 默认每账号 180 次/分钟，读写合计；匿名按客户端 IP 计数。API 使用数据库固定分钟窗口，多副本共享；私信还需满足上述独立令牌桶。额度不与目录、账号或存储服务共用。

受限响应提供 `X-RateLimit-Limit` / `Remaining` / `Reset`，超限返回 `429 rate_limited` 与 `Retry-After`；策略或共享计数不可用返回 `503 rate_limit_unavailable`。admin 组默认无限，可通过账号或组策略收回；私信的管理员豁免由 `messages.admin_unlimited` 单独控制。

持 `community.rate_limits.manage` 使用 `GET|PUT /api/community/admin/rate-limits`。GET 返回 `{etag, policy, messages, updated_at, updated_by?}`；PUT 完整替换两类策略：

```json
{
  "expected_etag": "<GET 返回值>",
  "policy": {
    "default_per_minute": 180,
    "default_unlimited": false,
    "groups": {"admin": {"unlimited": true}},
    "accounts": {}
  },
  "messages": {"send_per_minute": 180, "stranger_per_hour": 5, "admin_unlimited": true},
  "edit_note": "调整互动服务额度"
}
```

示例表示默认配置，修改前从 GET 的完整策略编辑。账号规则按 ID、用户名顺序匹配且优先于组；多组取最宽松，再回落全局。匿名使用保留组 `anonymous`。`edit_note` 可省略，最多 4000 字符，不要求 `sources`。过期或缺失 ETag 返回 `409 conflict`，非法额度、规则键或缺少 policy/messages 返回 `400 invalid_rate_limit`。该端点只治理互动服务；目录策略仍走 `/api/admin/rate-limits`。

## 站内通知

| 端点 | 用途 |
| --- | --- |
| `GET /api/notifications` | 本人通知，响应含 items / total / unread |
| `GET /api/notifications/unread-count` | 本人未读数量 |
| `POST /api/notifications/:id/read` | 单条标记已读 |
| `POST /api/notifications/read-all` | 全部标记已读 |

通知不接受 recipient 参数；收件人为令牌身份。访问他人通知与不存在的通知均返回 404。同一聚合键可合并事件，count 表示事件数，新活动重新标记为未读。

## 举报与申诉

| 端点 | 用途 |
| --- | --- |
| `POST /api/community/reports` | 提交 `{target_type,target_id,reason,detail?,evidence_url?}` |
| `GET /api/community/reports/mine` | 本人的举报与相关处置，page / page_size |
| `POST /api/community/reports/:id/appeal` | 被处置方提交 `{body}` |

登录即可提交。target_type 为 entity / comment / post / user / resource；reason 为 illegal / copyright / privacy / abuse / harassment / spam / misinformation / other。

detail 最多 2000 字符，evidence_url 为 HTTP(S) 绝对地址、最多 500 字符。短评和帖子验证本地存在；实体、用户和资源保留外部引用。

同一人对同一目标只能有一条未结束举报，重复为 `409 duplicate_report`；滚动 24 小时最多 20 条，超限 429 和 Retry-After。举报说明与证据不公开。

状态为 pending → accepted → resolved，或 pending → rejected。被处置方可在 accepted / resolved 时提交一次申诉；其他人、尚未处置或重复申诉分别返回 not_appealed_party / report_not_disposed / duplicate_appeal。实体与资源目标不能在本地解析被处置方时为 appeal_not_available。

采纳申诉只记录结论，不自动恢复已删除内容或改写举报状态。

## 管理接口

| 操作 | 端点 | 权限 |
| --- | --- | --- |
| 置顶 | `PUT /api/community/topics/:id/pin`，`{pinned:boolean}` | community.topic.pin |
| 板块设置 | `PUT /api/community/boards/:code` | community.board.manage |
| 回复巡检 | `GET /api/community/posts` | community.post.moderate |
| 举报队列与详情 | `GET /api/community/admin/reports`、`/:id` | community.report.review |
| 受理 / 驳回 / 处置 | `POST .../reports/:id/accept|reject|resolve` | community.report.review |
| 申诉队列 / 审核 | `GET /api/community/admin/appeals`、`POST .../:id/review` | community.report.review |

板块配置只更新传入字段，code 不可改；names 需四语，descriptions 可用四语空值清空。可配置 color、icon、sort_order、is_enabled、show_in_feed。

巡检支持 q / page / page_size，响应包含主题上下文、200 字摘要及 truncated；它不增加主题浏览数。q 为大小写不敏感子串，% / _ 按通配符处理。

举报队列支持 status、target_type、q、page、page_size；详情含 events、appeals、target_present。驳回需 note，处置需 enforcement / note，enforcement 为 none / content_removed / user_banned；申诉审核状态为 accepted / rejected，并需 note。

content_removed 要求先通过既有删除端点移除本地内容；仍存在时返回 `409 content_still_present`。user_banned 只登记结论，封禁在账号服务执行。实体和资源不支持 content_removed。
