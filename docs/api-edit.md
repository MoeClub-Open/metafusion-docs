---
title: "新建与编辑"
description: "实体与关系字段、工作副本编辑、生命周期与外部来源只读查询。"
order: 50
group: "api"
---

# 新建与编辑

交互编辑器与 Agent 统一通过[工作副本与提交](/api-commits)编辑目录。先将修改保存到服务器副本，可连续编辑和 commit；push 时由免审账号直接合入，其他账号发起 PR。正式目录只在合入后改变。

本页说明副本中实体与关系的文档形状，以及独立的生命周期、外部来源查询和配置入口。没有草稿或发布状态；条目 `state` 只表示 active / deleted / merged 生命周期，已生效资料为 `review_status=reviewed`。

## 认证与权限

编辑需要登录。副本访问权限与操作权限同时生效：能加入副本不代表能提交任何类型的修改。

| 权限码 | 用途 |
| --- | --- |
| `catalog.entity.edit` | 创建与编辑实体 |
| `catalog.relation.edit` | 创建、修改与删除关系 |
| `catalog.review.manage` | 审阅并合并 PR，不自动取得直接 push 资格 |
| `catalog.review.bypass` | 账号 push 时可直接合入；Key / MCP 按账号当前免审资格判定，操作本身仍须满足令牌编辑范围 |
| `catalog.lifecycle.manage` | 合并与退役条目 |
| `catalog.definitions.manage` | 保存动态定义与目录配置 |
| `catalog.shelves.manage` | 维护货架规则 |
| `storage.asset.upload` | 上传与登记自己的资产 |

没有协作编辑权限的登录用户可在自己的权限范围内新建或维护自己创建的资料；能编辑不代表免审。账号权限与令牌 scopes 的关系见[认证与凭证](/api-auth)。

## 修改说明与来源

commit 使用 `message` 说明本次修改。来源、查证记录和质量报告不要求填写，也不阻止保存或合入。文档支持的历史来源仍保留；提供来源时填写真实内容，不自动补造 self 或其他占位来源。

图片 URL 表示图片地址，可选 `source` 表示出处；收录可选 `sources` 表示该条事实的出处。来源中的 URL、类型等仍须符合字段格式。外部来源读取不会自动形成目录修改。

## 实体引用格式

写入的实体引用使用小写、带连字符的规范 UUID，例如 `018f4d3a-2b1c-7def-8a90-123456789abc`。此规则适用于结构归属、`subjects[].work_id`、`contents[].expression_id`、关系端点，以及 definitions 声明为 `entity` 的属性（含嵌套 group/list）。大写、无连字符、括号包裹、`urn:uuid:` 前缀或额外空白会返回 `400 invalid_reference`。

旧库存中的动态属性引用由 `000023_reference_canonicalization` 一次性迁移规范化；客户端不能依赖写入时自动转换旧格式。`external_links` 是外部链接数组，其中的 `external_id` 按各库编号规则校验，不套用目录实体引用规则。

## 实体文档

新建实体时，把以下文档放入 workspace stage 操作的 `document`，使用 `target:entity`、`action:create` 和本次操作内唯一的 `ref`；稳定 UUID 由服务器分配后返回。正式条目的 ID、版本、创建者和生命周期由服务端管理。

```json
{
  "kind": "work",
  "title": "攻殻機動隊",
  "original_language": "ja",
  "translations": {
    "ja": {"title": "攻殻機動隊", "summary": "作品简介", "body": "## 解説\n条目正文。"}
  },
  "attributes": {},
  "external_links": [],
  "pictures": []
}
```

- `kind` 是 agent / collection / work / content_unit / expression / release / medium / track。
- `translations` 按 locale 分组，每个语种含 `title`、`summary`、`body`、`aliases`。原语言题名放在对应语种行。
- `summary` 是简短纯文本简介；可选 `body` 为 Markdown 正文，省略或空串表示没有正文。每语种最多 100000 个 Unicode 字符，超长返回 `article_too_long`，含 NUL 返回 `invalid_article_body`。
- `attributes` 的键必须在当前 definitions 中声明，适用种类由 `applicable_kinds` 决定。不能自行添加 `cover_aspect` 等未定义键。
- `external_links[].kind` 须为已登记的外部权威库；`url` 必填，`role` 可省略。
- 更新已有文档使用 stage 的稀疏 `patch`，只声明实际变更，保留其他语言、正文与未编辑事实。

### 图片与自托管封面

`pictures` 是有序数组，最多 40 张。首项就是封面，服务端不重排；`role`、时间与版本名称不会自动选择封面。更换封面应调整数组顺序。

```json
{
  "url": "https://example.org/api/storage/assets/018f4d3a-2b1c-7def-8a90-123456789abc/content",
  "asset_id": "018f4d3a-2b1c-7def-8a90-123456789abc",
  "caption": {"zh-CN": "发行封面"},
  "role": "cover_art",
  "taken_at": "2026-10",
  "version_label": {"zh-CN": "2026 年版"},
  "usage_period": {"begin": "2026-10-01"},
  "source": {"kind": "url", "citation": "官方发行页的封面", "url": "https://publisher.example/releases/123"}
}
```

示例中的 `role` 须先在目标实例 `definitions.vocabularies.picture_role` 中确认。各字段含义：

| 字段 | 契约 |
| --- | --- |
| `url` | 必填的有效图片 URL；同一实体不能重复使用同一 URL |
| `source` | 可选图片出处；存储地址与来源页面分别记录，不因缺来源而阻止提交 |
| `caption` / `version_label` | 按语言码保存说明 / 图像版本名称；后者不是实体 version |
| `role` | 可省略；有值时必须为 `picture_role` 词表项码 |
| `taken_at` | 可省略；允许年、年月、完整日期或 RFC3339 时间，仅作图像时间信息 |
| `usage_period` | 可省略；填写时 begin/end 至少有一端，支持部分日期，包含两端，结束不能早于开始；可与其他图片使用期重叠 |
| `asset_id` | 自托管资产的 UUID；外链图可省略。先完成上传，stage 自动验证资产状态与保存者资格并预留私有引用；正式封面绑定由合入后的生命周期同步管理 |

图片校验错误为 `400 too_many_pictures`、`duplicate_picture`、`invalid_picture`、`invalid_picture_time`、`invalid_picture_period`、`invalid_picture_asset`；用途词表不存在或词项非法分别返回 `unknown_vocabulary`、`invalid_term`。自托管上传的完整步骤见[存储上传与下载](/api-storage#自托管封面)。

自托管图片的 `url` 始终保存 `/api/storage/assets/{asset_id}/content` 的绝对地址。上传不绑定正式实体；新增资产由上传者或当前存储管理员保存到副本，资产须已完成且摘要已验证、未禁发、未回收。副本、PR 和 commit 可用各自上下文的[私有预览地址](/api-storage#副本与-pr-的私有图片预览)展示，不能把预览代理地址写回图片字段。公开绑定或解绑 `cover_image` 返回 `409 catalog_managed_binding`；更换封面统一修改图片并合入。

### 外部标识

`external_links` 是外部链接数组。每条至少有 `kind`（平台码）与规范化后的 `url`，可选 `external_id`、`role`（`official|primary|secondary|operator`，空表示无角色标签）、`origin`、`source_refs`。「官方」徽标只由 `role=official` 推出。写入前读取 `GET /api/catalog/external-databases`：`category=all` 适用于所有 kind，其余分类必须等于实体的 kind。同一实体 `(kind, url)` 唯一。未知码返回 `400 invalid_external_key: <code>`，分类不匹配返回 `400 invalid_external_category: <code>`，非法链接返回 `400 invalid_external_link` / `invalid_external_id`。

`url` 使用绝对 HTTP(S) 地址；无网页的裸编号可使用 `mf://external/<kind>/<经过路径编码的external_id>` 作为展示标识，该值不作为网页链接打开。`000030_external_links` 将旧实体与修订快照中的 `external_ids` 转为数组，并转换对应来源指针；迁移条目标记 `origin="migration"`，不推断角色、不添加来源。来源连接器的候选标识对象不是实体载荷，须核实后转换为数组。相同地址的外链元数据不同，或同平台链接在合并时冲突，均须先人工解决；合并不会静默丢弃其中一方。

值不统一假定为裸编号：例如 `official_website`、`fandom`、`moegirlpedia` 保存完整 URL，其他码按注册表规则填写。`url_pattern` 只决定展示链接，展开后须为绝对 HTTP(S) URL；没有可跳转地址的条码仍可作为文本标识。权威库登记不代表存在抓取适配器，可查询来源以 `GET /api/external-sources` 为准。

哔哩哔哩标识应按语义选 `bilibili_bangumi`（Work，`ss`）、`bilibili_media`（Work，`md`）、`bilibili_episode`（ContentUnit，`ep`）、`bilibili_video`（ContentUnit，`BV` / `av`）。旧 `bilibili` 泛码默认停用，保留兼容历史及显式写入；停用仅隐藏可选预设，不能作为服务端拒绝所有写入的保证。

### 层级与归属字段

结构字段、必填归属、subjects 与 contents 的形状统一见[实体模型与字段](/frbr-model#固定归属)。

结构字段按层级收敛：发行版没有 `work_id`，收录关系只能经 `subjects`；`contents` 只对 `track` 有效，`subjects` 只对 `release` 有效。给某个 kind 传它用不到的结构字段会返回 `400 invalid_structural_field: <字段码>`，缺必填归属返回 `400 parent_required`。

按依赖顺序建立：先 `work` → `content_unit` → `expression`，再 `release` → `medium` → `track`，最后按需建关系。

::: warning 注意
`work_id` / `release_id` / `medium_id` / `kind` 在更新时不可改（`400 immutable_scope`），
写错了只能新建或走生命周期处置。
:::

## 编辑实体与收录

编辑已有实体前将其 checkout 到 workspace。修改使用 `PUT /api/catalog/workspaces/:id/changes`，提供当前副本 `expected_version` 和 `operations`。对象字段通过 JSON Pointer patch 修改，删除字段明确使用 `remove:true`。

Track 详情可能过滤不可见收录，不能把裁剪后的结果整份替换回去。修改单条收录使用 `target:entity`、`action:content`、Track ID 和 `content_change`：

```json
{
  "target": "entity",
  "action": "content",
  "id": "<track_uuid>",
  "content_change": {
    "action": "add",
    "position": 0,
    "inclusion": {"expression_id": "<expression_uuid>", "position": 0, "locator": {}, "attributes": {}}
  }
}
```

replace / delete 的 `position` 指原位置；删除省略 `inclusion`。收录来源可省略，已有其他收录与历史来源保留。副本保存、commit 和 push 的完整流程见[工作副本与提交](/api-commits)。

## 关系

关系在同一 workspace 中编辑。`target:relation`、`action:create` 时的 `document` 例如：

```json
{"type": "directed_by", "source_id": "<work_uuid>", "target_id": "<agent_uuid>", "position": 0, "attributes": {}}
```

更新关系使用 ID 与 patch；端点和类型不能原地修改。删除使用 `action:delete` 和 ID。关系码以当前 definitions 为准，示例不保证目标实例启用了该码。

服务端逐项校验，失败码可直接定位问题：

| 失败码 | 触发条件 |
|---|---|
| `invalid_relation_type` | 关系码不在已发布定义里，或该码已被停用 |
| `invalid_endpoints` | 自己连自己，或两端 kind 不在该关系的 `source_kinds` / `target_kinds` 白名单 |
| `duplicate_relation` | 同类型、同端点、同属性的边已存在（去重键不含 `position`） |
| `cardinality_exceeded` | 超过该关系的 `max_outgoing` / `max_incoming` |
| `relation_cycle` | 声明了 `acyclic` 的关系形成环路（如同类续作互指） |

判重的去重键是「端点 + 类型 + 属性」，不含 `position`。同一对端点、同一关系码、属性也完全相同、只有 `position` 不同的两条边会被库内唯一索引拦下（`400 constraint_violation`）。

要表达「同一演员在同一作品的两个角色位」，请让 `attributes` 不同（如 `character` 指向不同角色实体）。

关系码与上下文字段从当前[动态定义](/api-definitions#关系与模板)选择。外部职位没有精确关系时，只在定义允许的通用参与关系中保留职位原文，不虚构新码。

## 生命周期：合并与退役

```http
POST /api/catalog/entities/:id/lifecycle
{ "target_id": "<保留的实体>", "expected_version": 3, "edit_note": "merge duplicate",
  "sources": [{ "kind": "url", "citation": "两个条目指向同一实体的官方出处", "url": "https://example.com" }] }
```

- 带 `target_id` 为合并：目标必须同 kind、同归属（`work_id` / `release_id` / `medium_id` / `content_unit_id` / `parent_id` 一致）且 `state=active`，否则 `400 invalid_merge_target`
- 合并后源实体状态置 `merged` 并写入 `redirect_id`，指向它的关系与结构引用会被改写
- 旧 id 用 `GET /api/catalog/entities/:id/resolve` 跟随到保留实体
- 不带 `target_id` 为退役：状态置 `deleted`
- `edit_note` 与 `sources` 为可选补充，不因缺来源而拒绝；版本和生命周期权限仍须满足
- 已 `deleted` / `merged` 的实体再调会返回 `400 invalid_state`
- 两个动作都需要 `catalog.lifecycle.manage`

::: warning 注意
请求体是 `{target_id?, expected_version, edit_note, sources}`，没有 `action` 字段——
合并与退役由 `target_id` 有无决定，带 `{"action":"publish"}` 会 `400 invalid_payload`。
:::

生命周期为 active / deleted / merged。普通编辑的待合并状态属于 PR，不能用实体状态表达。

## 修订历史

```http
GET /api/catalog/entities/:id/revisions
```

每次正式合入都会生成修订行，保留作者、提交关联和快照；已有修改说明与来源仍可查看。副本中的 stage 或未合入 commit 不产生公开实体修订。

实体修订按实体可见性过滤。该端点也接受关系 ID，此时可见性由关系两端实体共同判定。

## 外部来源只读查询

外部来源适配器提供只读查询：返回上游原文、`FetchMeta`（`url` / `fetched_at` / `content_hash`），以及 preview 映射（lookup/detail）。录入使用[工作副本与提交](/api-commits)。

当前已实现 Bangumi、DLsite、DMM 适配器，可选来源以 `GET /api/external-sources` 为准。以下端点需要登录：

| 端点 | 作用 |
|---|---|
| `GET /api/external-sources` | 列出真有适配器的来源；只读注册表、不出站抓取 |
| `POST /api/external-sources/query` | 统一只读查询：`op=search\|lookup\|detail`，返回 raw + FetchMeta（lookup/detail 另含 preview） |

请求体（`ExternalSourceQueryRequest`）：

| 字段 | 说明 |
|---|---|
| `op` | `search` / `lookup` / `detail`（必填） |
| `source` | 适配器码；空/`auto` 时 lookup/detail 按 URL/ID 识别，search 默认 bangumi |
| `q` | search 必填 |
| `id` / `url_or_id` | lookup/detail 至少其一 |
| `entity_type` | Bangumi 等可选过滤 |
| `limit` | search 条数上限 |

::: warning 注意
出站抓取使用**按来源**的等待节流（约 1 次/秒，如 MusicBrainz 规范），与入站 API 的 `rate_budget` 计数/拒绝无关——`rate_budget` 不是出站队列。
端点仍计入目录共享默认 180 次/分钟入站预算。
:::

- DLsite/DMM 的 `search` 返回 `search_not_supported`；请用 lookup/detail（URL 或商品 ID）
- 明确来源接受当前适配器码，未实现的来源 `400 not_supported`；归一化会去空白、忽略大小写
- lookup/detail 的缺省/`auto` 按 URL/ID 选择来源，无法识别时回落 bangumi
- 响应含 `fetch`（主抓取）与可选 `fetches`（多次出站）、`raw`、以及 lookup/detail 的 `preview`（既有 `ImporterPreviewResponse` 形状，只读）
- 永不自动写入、合并或修改目录实体

### 来源清单：`GET /api/external-sources`

- `id` 是代码里实际实现的适配器集合，当前为 `bangumi` / `dlsite` / `dmm`
- `names` / `category` / `icon` / `description` / `url_pattern` 来自外部权威库注册表，含停用行
- `is_enabled` 只管外链字段是否出现，不决定有没有查询能力
- 管理员新增一行注册表不会自动出现在这里：适配器是代码事实
- `auto` 也不在清单里——它是解析别名，不是来源

### 公开网页与 MediaWiki

以下查询需要登录，均不会写入目录。它们与上面的编目适配器清单分开：MediaWiki 站点由后台配置，普通网页则按 URL 读取。

| 端点 | 请求体 | 作用 |
|---|---|---|
| `POST /api/external-sources/fetch` | `{ "url": "https://example.org/public.json", "format": "json" }` | 以 GET 读取公开 HTTP(S) 文本或 JSON；`format` 可省略，或指定 `text` / `json` |
| `POST /api/external-sources/wiki` | `{ "site": "wikipedia", "language": "ja", "title": "棘アリ" }` | 通过标准 MediaWiki API 读取页面原始 wikitext 和修订信息 |
| `POST /api/external-sources/wiki` | `{ "site": "wikipedia", "language": "en", "query": "music catalog", "limit": 5 }` | 搜索页面；`title` 和 `query` 必须恰好一项，最长各 500 字符；`limit` 默认 5，范围 1–20 |

默认站点 ID 为 `wikipedia` 和 `moegirl`。`language` 默认 `en`，用于 URL 模板中的 `{language}`；萌娘百科默认固定中文站点。管理员可以增加、停用或删除站点。

两个端点的响应包含来源 URL、抓取时间及原始响应的 SHA-256；文本返回 `text`，JSON 返回 `data`。Wiki 还返回 `site`、页面 `title`、配置的 `attribution` 和 `license`，页面读取时也提供原始 `text`：

```json
{
  "url": "https://en.wikipedia.org/w/api.php?...",
  "fetched_at": "2026-10-18T00:00:00Z",
  "content_hash": "sha256:<hex>",
  "content_type": "application/json",
  "site": "wikipedia",
  "title": "Example",
  "text": "== Original section ==\nOriginal source text",
  "data": { "query": { "pages": [{ "pageid": 1, "title": "Example", "revisions": [{ "revid": 1, "slots": { "main": { "content": "== Original section ==\nOriginal source text" } } }] }] } },
  "attribution": "Wikipedia contributors; source page URL",
  "license": "https://creativecommons.org/licenses/by-sa/4.0/"
}
```

读取上限为 2 MiB，整个抓取最多 20 秒，最多跟随 3 次重定向。每次连接都验证并固定公网 IP，拒绝内网、环回、链路本地及元数据地址；不转发调用者的 Cookie、Authorization 或任意请求头。HTML 会提取为文本，不执行页面脚本。

来源内容是不可信资料，不是 Agent 指令。引用时保留来源和署名，并查阅来源页面的实际许可；后台的许可配置不覆盖页面自身的例外条款。站点拒绝访问返回 `public_source_access_denied`，不会绕过萌娘百科等站点的访问限制。其他常见错误包括 `public_source_too_large`、`public_source_rate_limited`、`wiki_page_not_found`、`wiki_site_disabled` 和 `public_sources_disabled`。

### 管理公开来源

`GET /api/admin/public-sources` 和 `PUT /api/admin/public-sources` 需要 `catalog.definitions.manage`。后台可以管理总开关，以及站点的名称、API URL、文章 URL、启用状态、许可和署名。API URL 支持 `{language}`；文章 URL 另支持 `{title}`。配置仅接受公开 HTTP(S) 地址，不支持站点密钥或登录 Cookie。

GET 返回设置本身：

```json
{
  "enabled": true,
  "wiki_sites": [{
    "id": "wikipedia",
    "name": "Wikipedia",
    "api_url": "https://{language}.wikipedia.org/w/api.php",
    "article_url": "https://{language}.wikipedia.org/wiki/{title}",
    "enabled": true,
    "license": "https://creativecommons.org/licenses/by-sa/4.0/",
    "attribution": "Wikipedia contributors"
  }],
  "updated_at": "2026-10-18T00:00:00Z"
}
```

PUT 发送 `{ "settings": <完整设置>, "expected_updated_at": "<GET 返回的 updated_at>" }`，成功返回保存后的完整设置和新时间。它会替换整个站点数组，保存时保留仍需使用的站点；版本过期返回 `409 version_conflict`，应重新读取后合并修改。站点配置最多 32 项，ID 必须唯一。

## 实例间交换

| 端点 | 作用 |
|---|---|
| `GET /api/exchange/entities/:id` | 导出单个实体快照（JSON），供另一实例导入 |

- 导出按调用者身份判可见性（匿名读取正常条目），不存在或不可见都是 `404 not_found`；数据库或服务故障返回错误，不能当作条目缺失。Track 收录按表达可见性裁剪，不能把公开导出当作完整历史备份。
外部编辑使用[目录提交](/api-commits)，旧 `POST /exchange/proposals` 已移除。

## 动态定义管理

字段、词表、关系、模板与场景通过完整文档和 ETag 保存，详情见[动态定义与配置](/api-definitions)。实体编辑与定义编辑使用不同的并发标记，不能互换 version 和 etag。

## 编辑示例

一项题名纠正可按下列顺序执行：

1. `POST /api/catalog/workspaces`，传入 `name` 和待编辑的 `entity_ids`。
2. `PUT /api/catalog/workspaces/:id/changes`，用返回的副本版本和稀疏 patch 暂存题名。
3. `POST /api/catalog/workspaces/:id/commits`，传固定提交 UUID、最新副本版本和修改说明。
4. 回读副本，`POST /api/catalog/workspaces/:id/push`，传最新版本与 head。
5. 检查 `applied` 和 PR；冲突时比较 base/current/proposed，再 rebase。

完整载荷、断线恢复和协作者规则见[工作副本与提交](/api-commits)。常规编辑没有直写正式实体、关系或收录的第二套接口。

## 相关页面

- [API 概览](/api-overview)：错误码与限流
- [实体查询与详情](/api-entities)：读取实体与关系
- [AI Agent API 与工具规范](/api-agent)：Agent 接入与任务恢复
