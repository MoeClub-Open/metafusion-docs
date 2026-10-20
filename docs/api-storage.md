---
title: "存储上传与下载"
description: "内容寻址存储、分片直传、绑定用途与读取可见性。"
order: 60
group: "api"
---

# 存储上传与下载

资源协议使用 `/api/storage/*`，由独立存储服务提供。接入时核对目标实例是否启用服务；所需端点不可用时停止依赖写入，并记录响应与文档的差异。

文件本体、哈希与绑定由存储服务负责，目录只保存作品、表达与发行元数据。
两者用实体 UUID 互指：存储侧不复制目录数据，目录侧不保存对象存储物理路径。

存储基于内容寻址（SHA-256）去重，元数据与物理资产完全解耦。

写接口（`initiate` / `complete` / `upload/stream` / `bind` / `unbind`）与 `/stats` 需要登录：
`Authorization: Bearer <token>` 或 HttpOnly Cookie `mf_session`。
其余读接口允许匿名，但只返回对调用者可见的内容，不可读一律 404。

`initiate` / `complete` / `upload/stream` / `bind` 另外要求 `storage.asset.upload`，缺码返回 `403 forbidden`（未登录为 `401 authentication_required`）。可用权限以账号现时权限和凭证 scopes 为准。

`unbind` 不要求上传权限：绑定创建者、文件上传者或持 `storage.asset.moderate` 的审核者可以解绑。

两个存储权限码的分工：

| 权限码 | 分工 |
|---|---|
| `storage.asset.upload` | 创建并登记自己的东西 |
| `storage.asset.moderate` | 处置他人的东西：续传/覆盖他人未完成的上传、完成或绑定他人资产、读全局 `/stats` |

两者互不蕴含：创建资产仍需上传权限，管理他人资产还需审核权限。可读已有文件不代表可以为它新建绑定。

## 初始化（秒传检测）

下列请求与响应展示形状，哈希、大小、地址和 ID 为示例值。实际上传须计算本地文件的 SHA-256，使用真实字节数。

```http
POST /api/storage/upload/initiate
Authorization: Bearer <token>
Content-Type: application/json

{
  "file_name": "track.flac",
  "file_size": 18874368,
  "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mime_type": "audio/flac",
  "part_count": 3,
  "target_entity_id": "<uuid>",
  "binding_role": "track_audio"
}
```

字段说明：

- `sha256_hash`（必填）：客户端本地计算的 64 位十六进制 SHA-256，是文件的身份
- `part_count`（可选，默认 1）：分片数量，`presigned_urls` 按它给出对应个数的预签名地址，>1 时另给 `part_size_hint`
- 超过 `STORAGE_MAX_PARTS`（默认 10000）返回 `400 too_many_parts`
- `target_entity_id`（可选）：同时绑定到该实体，必须对调用者可见；`target_entity_type` 若填写，必须与目录给出的 kind 一致
- `binding_role`（可选，默认 `master_archive`）：绑定用途，取值匹配 `^[a-z][a-z0-9_]{0,31}$`，例如 `track_audio`、`disc_image`、`video`、`scans`
- `binding_role` 不设封闭枚举，新增用途不需要改代码；`cover_image` 由目录管理，不能在初始化时同时传 `target_entity_id`，否则返回 `409 catalog_managed_binding`

响应：

```json
{
  "is_instant_upload": false,
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "object_key": "objects/e3/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/track.flac",
  "upload_id": "VXBsb2FkIElE…",
  "presigned_urls": [
    "https://<对象存储对外地址>/metafusion-master/objects/…?partNumber=1&uploadId=…",
    "https://<对象存储对外地址>/metafusion-master/objects/…?partNumber=2&uploadId=…",
    "https://<对象存储对外地址>/metafusion-master/objects/…?partNumber=3&uploadId=…"
  ],
  "part_size_hint": 6291456,
  "expires_at": "2026-09-15T10:00:00Z"
}
```

- `is_instant_upload: true`：已有同一 SHA-256、服务端已验证且当前可读的资产，无需再上传。摘要本身不授予读取权限；不可读的既有资产返回 404
- 新建资产时可同时按 `target_entity_id` 建绑定；秒传复用时新增绑定仍须为上传者本人或持审核权限，其他可读者传目标会返回 403
- 同一 SHA-256 的未完成资产不算秒传，上传者可续传；不会另建重复资产
- 未配置对象存储端点时是本地对象模式：不返回预签名地址，而是给出 `direct_upload_url`，客户端把原始字节 `PUT` 到该地址即可（服务端边收边算 SHA-256 并校验）

::: warning 注意
同一 SHA-256 的未完成上传由上传者本人续传（复用同一次分片会话），他人重传得到 `409 upload_in_progress`；
持 `storage.asset.moderate` 的审核者可接手。续传会刷新上传租约；过期未完成资产可能被回收，重新初始化时以响应中的 asset_id 和上传地址为准。
:::

## 直传分片（浏览器/客户端 → 对象存储）

```bash
# 各分片直接 PUT 到预签名地址，完成后从响应头 ETag 取值回传
curl --fail-with-body -D part_1.headers -X PUT "<presigned_url_1>" --data-binary @part_1.bin
```

按 part_size_hint 切分文件，对全部分片重复上传并保存各自响应头里的 ETag。S3 分片除最后一片外通常须至少 5 MiB；本例为 18 MiB 文件的三个 6 MiB 分片。预签名直传不携带 MetaFusion Bearer 或 Cookie；若签名约束了 Content-Type，按初始化 MIME 设置该请求头。

::: warning 注意
预签名 URL 的 host 参与签名，因此对象存储必须从客户端可达：编排里对象存储端口默认不对宿主机开放，
需要浏览器直传时应经反代暴露并设置 `STORAGE_S3_PUBLIC_ENDPOINT`。
:::

## 完成上传

```http
POST /api/storage/upload/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "upload_id": "VXBsb2FkIElE…",
  "parts": [
    { "part_number": 1, "etag": "\"etag-from-part1\"" },
    { "part_number": 2, "etag": "\"etag-from-part2\"" },
    { "part_number": 3, "etag": "\"etag-from-part3\"" }
  ]
}
```

服务端在对象存储完成 Multipart 合并，然后回读对象核验内容：

- 合并后先 HEAD 回读实际大小（S3 的合并响应体里没有长度），与 `file_size` 不一致返回 `409 size_mismatch`
- 随后把整份对象读回、重算 SHA-256 与 `sha256_hash` 比对：一致才置 `complete` 并记 `hash_verified=true`
- 不一致返回 `409 hash_mismatch`，资产留在 `pending`（`fail_reason=hash_mismatch`），并删除对不上声明的对象键，绝不发布
- 读回受两个部署上限约束：对象超过 `STORAGE_VERIFY_MAX_MB` 返回 `413 hash_verify_too_large`，读回超过 `STORAGE_VERIFY_TIMEOUT_SECONDS` 返回 `408 verify_timeout`；两者同样令资产留在 `pending`
- 声明的 `file_size` 就已超限时不再合并，直接失败，避免留下必然发布不了的碎片
- 这两个上限默认不限制；实例可以收紧，客户端仍须为大文件校验预留时间
- 读回阶段的其它失败（客户端断开、对象存储不可用）返回 `503 storage_unavailable`

成功响应仍是 `{"asset": {…}}`：资产已置 `complete`、`hash_verified=true` 且 `size_bytes` 用实际读回字节数。

资产已是 `complete` 时重复提交直接返回同一结构并加 `already_complete: true`（不再合并与回读）。
`upload_id` 省略时使用该资产已记录的分片会话。

本地对象模式下内容已在 `PUT /api/storage/upload/stream/{asset_id}` 边收边算并校验（摘要不符在那里就返回 `409 hash_mismatch`），complete 只做幂等确认。

大文件可选择分片直传，或使用服务端流式 `PUT /api/storage/upload/stream/{asset_id}` 边收边校验。后者经过业务服务器；按 asset 调用 `verify-hash` 仍需读取整份对象，不替代 complete，也不应作为每次上传的必需步骤。

::: warning 职责边界：原始文件
存储服务收原始文件、按权限分发原始文件。HLS 切片、预览音频、波形图、雪碧图由客户端拿原档自行处理。
:::

## 绑定与解绑

```http
POST /api/storage/bind
Authorization: Bearer <token>

{ "asset_id": "<uuid>", "target_entity_id": "<uuid>", "binding_role": "track_audio" }

DELETE /api/storage/bindings/{binding_id}
```

绑定表达的是"这份文件是谁的什么用途"；收录位置（页码、时间码、路径）留在目录侧的 `locator`，两处不重复。

同一 `(asset, entity, role)` 只保留一条，重复绑定返回既有的真实绑定 ID，保留创建者与创建时间，并确认继续使用。解绑用于纠错，绑定创建者、文件上传者或审核者（持 `storage.asset.moderate`）都可以操作。

`cover_image` 是目录管理的保留用途：公开 `POST /bind` 或 `DELETE /bindings/{binding_id}` 操作该用途均返回 `409 catalog_managed_binding`。需要更换或移除封面时，编辑目录图片并合入；音频、原档等其他用途仍使用上述接口。

### 目录变更与资产保留

已配置目录与存储生命周期同步的实例，会异步按当前 canonical 身份、完整历史别名、各身份版本及图片资产集合对齐绑定。同步失败会重试，目录保存不等待存储处理；未启用同步的实例不能假定目录变更会自动处置绑定。

| 目录变更 | 绑定行为 |
| --- | --- |
| 合并身份 | 全部文件用途迁到 canonical 身份并去重；优先保留既有 canonical 绑定，否则保留一个来源绑定的 ID 与创建信息，历史别名图片资产继续保留 |
| 删除 canonical 实体 | 撤除该身份和完整历史别名的所有用途绑定 |
| 合入图片修改 | 根据已验证的副本资产引用自动创建正式 `cover_image` 绑定，保留原保存者；撤除已移出当前身份及历史别名图片集合的封面绑定，不影响音频、原档等其他用途 |
| 修改 TrackContent 收录 | 保留 Track 与 Expression 文件；收录引用不等于资产绑定 |

工作副本保存图片时自动建立私有资产预留，不改变正式绑定，也不授予公开读取权限。仍被副本、基线、不可变提交、正式快照或搁置记录引用的资产受到保留保护；回收前会向目录核对真实引用，核对失败时保留。派生、合并或恢复可读快照时，只转移同一实体/资产的保留，不扩大资产使用范围或创建公开绑定。正式封面绑定由合入后的目录生命周期同步创建和撤除，不由客户端补写。

已完成资产在失去最后一个绑定后默认保留 7 天，重新绑定取消计时；从未绑定的 complete 从完成时起算，升级前已有的无绑定资产从迁移时起算。保留期由实例配置，实际到期回收需运维定期运行存储 worker；禁发或仍有任何绑定的资产不回收。多个资产共享同一对象时，只撤除到期资产记录，保留仍被引用的字节。

公开写入还可能返回以下冲突：

| HTTP / error | 处理 |
| --- | --- |
| 409 `binding_target_changed` | 身份在读取与绑定写入之间发生合并或删除，重新读取 canonical 身份后再绑定 |
| 409 `catalog_managed_binding` | 封面绑定由目录管理，改用工作副本修改图片并合入 |
| 409 `asset_reclaiming` | 资产已进入字节删除阶段，不能重新绑定、续传、完成或禁发来恢复；核对资产状态后重新初始化上传 |

## 自托管封面

先核实图像与目标实体的关系及使用依据，再上传实际图像字节。HTTP 200 与 `image/*` 只能说明传输响应，不能证明图像身份或使用权。

1. 在客户端读取文件，计算 SHA-256 与真实字节数。
2. 调用 `POST /api/storage/upload/initiate`，提供 `file_name`、`file_size`、`sha256_hash`、`mime_type`，不传 `target_entity_id`。可用 `binding_role: "cover_image"` 说明用途，它不创建绑定；存储用途与目录图片的 `role` 是两个字段。
3. 若 `is_instant_upload=true`，复用返回的已验证资产；否则把原始字节 PUT 到响应中的 `presigned_urls` 或 `direct_upload_url`，分片方式保留各片 ETag。
4. 非秒传时调用 `POST /api/storage/upload/complete` 完成并验证摘要；成功后才把资产当作可用图像。保存到副本不创建正式实体绑定。
5. 在工作副本的实体 `pictures` 中写入 `asset_id`，`url` 保存实例的 `/api/storage/assets/{asset_id}/content` 绝对地址。stage 会自动预留私有引用，不需要客户端另调预留接口。新增资产须已完成、摘要已验证、未禁发且未进入回收；保存者须为上传者或当前持 `storage.asset.moderate` 的成员。要作为封面则放在数组首位，DTO 见[图片与自托管封面](/api-edit#图片与自托管封面)。
6. commit 后 push 或发起 PR。合入后的目录生命周期同步自动创建正式封面绑定，保留原保存者；客户端不调用 `POST /storage/bind` 创建封面。未合入的修改不改变公开封面。

目录合入与存储上传、生命周期同步没有跨服务事务。上传成功而 stage 失败时，保留 `asset_id`，修正目录错误后重用资产；同步失败由服务端重试，不能用公开封面绑定接口补写。公开读取仍要求资产 complete、未禁发且至少一个正式绑定目标可见。

### 副本与 PR 的私有图片预览

| 上下文 | 预览地址 |
| --- | --- |
| 工作副本 | `GET /api/catalog/workspaces/:id/assets/:assetID/content` |
| PR | `GET /api/catalog/pull-requests/:id/assets/:assetID/content` |
| 不可变提交 | `GET /api/catalog/commits/:id/assets/:assetID/content` |

副本预览只允许所有者或协作者，并检查图片确实在该副本引用中。PR 预览按冻结提交读取，commit 预览只读取该冻结提交/目录检查点的图片引用；审核者不能借 PR 查看副本尚未提交的编辑。无权或未引用均返回 404。成功返回图片原始字节，使用 `Cache-Control: private, no-store`。

这些地址只供展示时选择图片源，不能保存进 `pictures[].url`；图片字段始终保留权威存储地址。尚未 stage 的上传由上传者使用原存储地址预览，stage、commit 和 PR 页面按对应上下文选择私有预览地址。

## 查询与下载

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/storage/entities/{id}/files` | 实体可见 | 「这个介质/轨道/表达上挂了哪些文件」入口 |
| GET | `/api/storage/assets/{id}` | 可读 | 文件元数据与绑定列表 |
| GET | `/api/storage/assets?limit=50&offset=0&status=complete&name=cover` | 审核者 | 资产清单；状态和文件名可选筛选，按创建时间倒序 |
| GET | `/api/storage/bindings?limit=50&offset=0` | 审核者 | 全站绑定清单，含所指资产，按创建时间倒序 |
| GET | `/api/storage/download/{asset_id}` | 可读 | 对象存储模式返回预签名地址；本地模式直接流式下发 |
| GET | `/api/storage/assets/{id}/content` | 可读 | 长期可引用的原档内联地址 |
| POST | `/api/storage/verify-hash` | 探测匿名可用；按 asset 校验需登录 | 秒传探测或按 asset 校验摘要 |
| GET | `/api/storage/stats` | 审核者 | 完成态文件数与占用字节、待完成数、禁发数（`storage.asset.moderate`） |
| GET | `/api/storage/moderation/blocked?limit=100&offset=0` | 审核者 | 禁发资产清单；`limit` 范围 1–500，默认 100，按禁发时间倒序 |
| POST | `/api/storage/assets/{id}/block` | 审核者 | 禁发资产，可传 JSON `{"reason":"处置原因"}`（最多 280 字） |
| POST | `/api/storage/assets/{id}/unblock` | 审核者 | 解除禁发，保留资产状态与绑定 |

`/stats` 返回 `{ "assets": 0, "bytes": 0, "pending": 0, "blocked": 0 }`。禁发清单返回 `{ "assets": [...], "limit": 100, "offset": 0 }`；资产对象含 `blocked`、`blocked_reason`、`blocked_at`。

资产与绑定清单只允许持 `storage.asset.moderate` 的账号访问；两者的 `limit` 范围是 1–100（默认 50），`offset` 从 0 起，响应含 `has_more`。资产清单的 `status` 可为 `complete` 或 `pending`，`name` 最多 100 字符；清单只提供元数据，内容预览仍走 `/assets/{id}/content` 并逐次鉴权。

长期引用文件使用 `/api/storage/assets/{id}/content`：原样下发，不转码，按每次请求判定可见性并使用私有缓存。预签名下载地址会过期，不用于长期封面。

`verify-hash` 的两种分支：

- `sha256_hash` 探测：判定与 `initiate` 同一口径，只认服务端验过内容（`hash_verified=true`）且对调用者可见的资产；命中返回 `{"exists": true, "asset_id": …, "status": "complete", "size_bytes": …}`，否则 `{"exists": false}`
- `asset_id` 校验：必须登录（匿名返回 `401`，非法 uuid 先返回 `404`），读回整份对象重算摘要，返回 `{"asset_id", "sha256", "declared_sha256", "verified", "size_bytes"}`
- `asset_id` 校验摘要不符时 `verified=false`，尚未发布的资产会被钉在 `pending`（`fail_reason=hash_mismatch`）；已 `complete` 的资产不会因此降级（只记日志）

```http
GET /api/storage/download/{asset_id}

→ { "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "download_url": "https://…?X-Amz-Signature=…&response-content-disposition=attachment%3B%20filename%3D…",
    "file_name": "track.flac", "size_bytes": 18874368, "sha256": "…", "expires_at": "…" }
```

::: warning 注意
读取可见性只有一条口径：上传者本人或审核者（持 `storage.asset.moderate`）直通，
其余人仅在资产已 `complete`、未被禁发且任一绑定目标实体可见时可读。
:::

下载、元数据读取与哈希校验共用该判定；下载与内容入口还要求资产已完成。已签发的预签名 URL 在有效期内可能继续访问，解绑或禁发不会撤销对象存储签名；需要逐请求鉴权时使用 content 入口。
不可读返回 404，不泄露他人上传的存在性；目录依赖不可用返回 `503 upstream_unavailable`，不能解释为文件不存在。

## 上传失败与恢复

| HTTP / error | 处理 |
| --- | --- |
| 409 upload_in_progress | 同摘要已有他人的未完成上传，请审核者处理，不重复创建 |
| 413 quota_exceeded | 账号或站点容量不足，停止新增上传并检查额度 |
| 429 too_many_uploads | 并发上传额度已满，等现有任务完成或租约回收后再初始化 |
| 409 hash_mismatch / size_mismatch | 核对文件、声明大小和摘要；回读资产状态后重新上传正确内容 |
| 413 hash_verify_too_large / 408 verify_timeout | 超过实例校验限制，核对限制或改用适用的上传方式 |
| 503 storage_unavailable / upstream_unavailable | 对象存储或目录依赖故障，暂停后续绑定与完成，恢复后先回读 |

## 限流与审计

存储业务 API 按已验证账号分别维护读、写窗口，各默认 180 次/分钟；匿名按客户端 IP 计数，admin 组免此业务额度。计数仍在存储服务进程内，多副本不共用窗口，也不消耗目录服务的共享预算。超限返回 `429 rate_limited` 与 `Retry-After`，受限响应带 `X-RateLimit-Limit` / `Remaining` / `Reset`。

网关不按共享出口 IP 叠加业务额度。PUT 到存储服务的流式上传计入写窗口；预签名分片直传由对象存储入口处理。各服务限流边界见[API 概览](/api-overview#限流)。

初始化、流式上传、完成、绑定、解绑及禁发治理由存储服务记录操作审计。部署参数与清理策略见[存储运行约定](https://github.com/MoeclubM/MetaFusion/blob/main/docs/architecture/storage-operations.md)，客户端以目标实例响应确认能力。
