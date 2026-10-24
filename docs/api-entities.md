---
title: "实体查询与详情"
description: "统一实体端点：多维过滤、详情、关系、收录、修订与对比。"
order: 30
group: "api"
---

# 实体查询与详情

目录里所有实体走同一套端点：查询用 `GET /api/catalog/entities`，详情用 `GET /api/catalog/entities/:id`。

八类 kind 共用这两个端点：`agent` / `collection` / `work` / `content_unit` / `expression` / `release` / `medium` / `track`。
按关联 id 过滤（`work_id` / `release_id` / `medium_id` / `content_unit_id` / `parent_id`）
或按 `kind` / `tags` 过滤拿到子集；语义关系、结构与声明的实体引用可以经统一 links 或 relationships/query 读取，实际收录也可用 occurrences 反查。

## 列表与过滤

```http
GET /api/catalog/entities?kind=work&limit=24&offset=0
GET /api/catalog/entities?q=攻壳机动队&kind=work
GET /api/catalog/entities?kind=release&work_id=<work_id>&limit=24
GET /api/catalog/entities?kind=medium&release_id=<release_id>
```

| 参数 | 说明 |
|---|---|
| `kind` | 单个 kind 过滤 |
| `kinds` | 多值 kind（重复出现或逗号分隔，命中任一即返回） |
| `state` | 生命周期过滤 active / deleted / merged；普通列表排除 deleted / merged，可见性另见[API 概览](/api-overview) |
| `original_language` / `has_pictures` | 原始语言精确筛选 / `has_pictures=1` 仅返回有图实体 |
| `q` | 关键词查询，匹配、索引计数与分页见[检索](/api-search) |
| `field` + `value` | 按 `document` 内属性字段精确过滤（支持点分路径，见下） |
| `work_id` | 该作品下的内容单元与表达，以及声明收录它的发行版 |
| `content_unit_id` | 该内容单元下的表达 |
| `release_id` | 该发行版下的载体 |
| `medium_id` | 该载体下的曲目 |
| `parent_id` | 同层子节点（内容单元 / 载体 / 曲目） |
| `tags` | 多值标签过滤：重复出现或逗号分隔；服务端走 JSONB 包含匹配，匹配方式由 `tags_mode` 决定 |
| `tags_mode` | `any`（默认）匹配任一已选标签；`all` 要求同时包含全部已选标签。普通列表和关键词搜索均适用，非法值返回 400 `invalid_query_param` |
| `sort` / `order` / `locale` | sort 可取 updated_at / created_at / title，order 为 asc / desc；题名排序可指定 locale，未知排序/方向返回 invalid_sort / invalid_order |
| `limit` / `offset` | 默认 50 / 0；limit 为 1–100，offset 为非负整数，非法值返回 400 |
| `page` | 从 1 起，等价 offset=(page-1)×limit，不能与 offset 同时提交 |
| `cursor` | 仅用于关键词深分页，不能与 offset/page 同时提交；见[检索](/api-search) |

无关键词浏览响应含 `items`、数据库计数 `total`、`total_relation="eq"` 和 `has_more`。关键词查询的索引计数与深分页标记见[检索](/api-search)。

浏览、关键词检索与首页 `/api/catalog/shelves/feed` 还返回按条目 ID 索引的 `covers`：无自身封面的条目可借用关联作品、发行或载体的封面，包含 `url`、来源类型 `origin` 和来源条目 `from`（ID、原题名及多语言题名）。只采用当前可见的活动来源，界面注明借用来源；自身首图优先。此字段只用于显示，不会改写条目的 `pictures`；`has_pictures=1` 仍只筛选条目自身收录的图片。

无关键词浏览默认按 `updated_at DESC, id`；带 `content_unit_id` / `release_id` / `medium_id` / `parent_id` 且未显式排序时改按 `position` 升序，
便于直接渲染分碟与曲目顺序（`work_id` 不触发该排序，仍是默认序）。

多值过滤在服务端完成，不会先取固定条数再由客户端过滤，避免合法候选被截断。
关系编辑器的对端选择器就是用它收敛候选：

```http
GET /api/catalog/entities?kinds=work,collection&tags=专辑,歌曲&limit=24
```

### 嵌套字段筛选

`field` 支持点分路径，沿 definitions 递归解析：`group` 逐层下钻；`list` 中途节点按「任一元素命中」比较；
叶子保持与单层一致的等值语义（`->>` 文本比较）。

要求叶子 `searchable` 为 true 且链路上所有字段 `enabled`，否则返回 `field_not_searchable`；未知路径返回 `unknown_field`。

```http
GET /api/catalog/entities?field=attachments.store&value=<agent_id>
GET /api/catalog/entities?field=store_bonuses.channel&value=animate&kind=release
```

结构属性伪字段命中收录 / 发行对象表而非实体属性，编译成 `EXISTS` 子查询：

| 伪字段 | 含义 | 列表语境 |
|---|---|---|
| `locator.<子字段>` | 收录位置（`catalog.track_contents.locator`） | `kind=track` |
| `inclusion_attributes.<子字段>` | 收录附加属性（`catalog.track_contents.attributes`） | `kind=track` |
| `subject_attributes.<子字段>` | 发行对象附加属性（`catalog.release_subjects.attributes`） | `kind=release` |

```http
GET /api/catalog/entities?kind=track&field=locator.path&value=/disc1/chapter01
GET /api/catalog/entities?kind=track&field=inclusion_attributes.translator&value=<agent_id>
GET /api/catalog/entities?kind=release&field=subject_attributes.seq&value=1
```

::: warning 注意
`kind` 与伪字段归属显式不匹配时（如 `kind=release` 配 `locator.path`）谓词恒假、返回空集，
而不是报错；不传 `kind` 时按 `EXISTS` 自然过滤。
:::

子字段是否可用以 `GET /api/catalog/definitions` 为准（含后台新增的子字段）。

## 并发编目的查重候选

`POST /api/catalog/entities/candidates` 是只读查询。在 PostgreSQL 的同一个 repeatable-read 快照中查找候选并解析保留身份；题名、别名、外部 ID 和标量属性使用随实体写入同步更新的索引。其他 Agent 修改无关条目不会使查询因全库总数变化失败。

```json
{
  "kind": "work",
  "titles": ["夜明け", "Dawn"],
  "external_links": [{"kind": "wikidata", "value": "Q123"}],
  "attributes": [{"key": "duration", "value": "213"}],
  "limit": 1000
}
```

`kind` 必填，至少提供一类条件，每类最多 20 项、每个值最多 256 字节。条件之间为 OR：题名匹配基础题名、翻译题名及别名，忽略大小写并合并空白；外部 ID 和标量/标量数组属性按文本精确比较。Expression/ContentUnit 可用 `work_id` 限定所属 Work，Medium 可用 `release_id` 限定 Release，Track 可用 `medium_id` 限定 Medium。相同题名、时长或版次属性只能定位候选，不能确认身份。

响应包含 `items`、`total`、`complete`、`basis="postgres_repeatable_read"`。每项含 `matched` 原始实体摘要和 `canonical` 保留实体摘要；不能解析时 `canonical=null` 并带 `resolution_error`。摘要不能当作完整的副本编辑文档。

`total` 是该快照中命中的原始实体数；`limit` 为 1–1000，默认 1000。超过上限时 `complete=false`，应收窄过宽条件，不能把部分结果当成没有重复。查询仅覆盖调用者可见范围，排除已删除原始实体；零候选不证明不可见范围内没有重复。候选查询与其他目录请求共用每账号或匿名客户端 IP 每分钟 180 次的默认预算，见[限流](/api-overview#限流)。

创建前使用此接口查重，不用跨页扫全库，也不靠关键词搜索的异步索引证明实体不存在。候选查询不锁定后续创建；多个 Agent 仍应分配不同任务范围，已存在身份应复用，创建结果未知时先核对副本和原 commit，避免重复新建。

## 实体详情

```http
GET /api/catalog/entities/:id            # 通用实体详情（含 version，写入时要用）
GET /api/catalog/entities/:id/resolve    # 合并后跟随 redirect_id 取到保留实体
GET /api/catalog/entities/:id/identity   # 存活实体与完整历史别名
GET /api/catalog/entities/:id/links      # 结构、语义关系与字段引用，含两端实体表
GET /api/catalog/entities/:id/occurrences # 该实体被哪些发行版收录
GET /api/catalog/entities/:id/revisions  # 修订历史
```

- `/links` 的 `items` 是统一关系投影，`entities` 是按 id 索引的可见端点与引用实体（含被查询实体自身），`subject_id` 标出「哪个是自己」
- 客户端据此直接渲染「谁→谁」，不必再逐条取实体
- `/occurrences` 按 kind 收敛：`expression` 返回自身收录，`content_unit` / `work` 返回其表达被收录的情况
- `/revisions` 返回 `{items,total,limit,offset}`，默认20条、最多100条，可用 offset 或互斥的 page 继续读取全部历史。支持 `version` 精确匹配修订号、`author_id` 原操作人，以及 RFC3339 `since`（含）/`until`（不含）的修订创建时间区间。查当前修订可用 `?version=<entity.version>&limit=1`，无需扫描历史。
- 可见性检查先于计数和分页；Track 历史快照中的收录也按表达当前可见性裁剪，原始事实仍保留在库中。关系修订使用关系 ID 作为路径 id；已删除关系仍可查历史，但当前两端实体都必须 active。历史每行含 `id,version,actor_id,actor_name,edit_note,sources,snapshot,created_at`，有原提交关联时附 `commit_id`，snapshot 为实体或关系。
- `/links` 是固定结构与语义关系的统一只读投影；语义关系仍经 `/relations` 写入，不复制结构边。

实体详情包含当前 version，但不是全库事实的无损导出。Track 的 contents 会过滤当前不可见的 Expression；编辑时不要把可见性裁剪后的结果整份覆盖，以免误删历史引用。维护单条收录使用[工作副本的 content 操作](/api-edit#编辑实体与收录)。

### 身份解析和统一关系读取

`GET /api/catalog/entities/:id/identity` 返回 `{canonical_id, aliases, entity, complete}`。aliases 包含反向合并分支和多跳链；只有 `complete=true` 才能当作全集用于评论、收藏或文件聚合。终点不存在/不可见返回 404，查询失败返回错误，不把部分结果伪装成完整身份。

`POST /api/catalog/entities/identity` 是只读批量解析，请求 `{ids:[...]}`，1–500 项，返回按请求 ID 索引的 `items` 与 `missing`。不可见/不存在进入 missing，数据库故障使整批失败。

`GET /api/catalog/entities/:id/links?limit=50&offset=0` 返回 `{subject_id, definition_etag, items, entities, limit, offset, has_more}`。每项有 key、rule_code、class、direction、两端 ID、排序及可选角色、定位和属性。普通语义关系的 key 是关系 ID，version 是当前编辑版本；结构与字段引用没有独立可写版本，仍修改其权威字段。

规则从 `definitions.relationship_rules` 发现，覆盖以下事实：

| 规则码 / class | 权威数据与编辑方式 |
| --- | --- |
| `structure:*` / ownership、placement、inclusion | 固定归属、父子、subjects 与 contents，在工作副本中修改拥有者实体或单条收录 |
| `relation:*` / semantic | 动态语义关系，在工作副本中编辑 relation |
| `attribute:<path>` / reference | definitions 声明的实体属性引用，含嵌套 group/list，在工作副本中修改实体属性 |

例如规则码 `attribute:attachments[].content` 表示列表中的引用类型，具体 link.field 为 `attachments[0].content`。关系、发行对象和收录的附加引用在 `references:[{field,entity_id}]` 中保留原路径；当被查询主体是上下文引用而不是 source/target 时，`via:[field,...]` 标出匹配路径。引用只按定义解析，不从普通字符串猜测实体关系。

统一 links 不是第二份事实存储。需要更多页时按 has_more 继续取数；404 是不存在/不可见，401/403、429、5xx 要分别处理。

### Agent 批量关系查询

`POST /api/catalog/relationships/query` 是只读查询，批量读取主体的直接结构、收录、语义关系和声明的属性引用。规则来自当前 `definitions.relationship_rules`，包含 GUI 扩展的 relation 及嵌套属性引用。

```http
POST /api/catalog/relationships/query
Content-Type: application/json

{
  "ids": ["<release_uuid>", "<expression_uuid>"],
  "direction": "both",
  "limit": 25,
  "offset": 0
}
```

| 参数 | 含义 |
| --- | --- |
| `ids` | 1–20 个 UUID，去重并保留请求顺序 |
| `direction` | both（默认）、outgoing 或 incoming，相对于每个主体 |
| `rule_codes` | 可选数组，当前关系注册表中的完整码，例如 `structure:track_content`；多个码为命中任一 |
| `peer_kinds` | 可选数组，八类 kind 的对端筛选；多个 kind 为命中任一 |
| `limit` | 每个主体的页大小，默认 25，范围 1–100 |
| `offset` | 每个主体的偏移，默认 0，须为非负整数，无 10000 上限 |

筛选和端点可见性检查先于分页。响应含：

- `definition_etag`：本次读取的定义版本。
- `pages`：按可见主体的请求顺序返回 `{subject_id, items, limit, offset, has_more}`；每个主体独立分页。
- `entities`：去重的可见端点摘要，只有 `id`、`kind`、`version`、`title`、`original_language` 和 `translations`；不能当作完整实体写回。
- `unavailable_ids`：不存在或当前不可见的请求 ID，两者不区分。

items 沿用 links 的边形状，事实方向始终为 `source_id → target_id`；direction 标明相对主体的方向，反向名称不反转事实。references 包含非端点实体引用，via 标记当前主体匹配的上下文路径；它们不能只靠 source_id / target_id 推断。

单次请求的定义、主体与各页在一个一致性只读快照中读取；继续分页是新的快照。某页 `has_more=true` 时，用该主体和相同筛选继续请求，offset 增加本页 limit。接口只读一跳，不自动展开全图；多页或多跳未完成时不能将结果称为全集。

需要递归时，将本页端点及 references 中的可见实体 ID 加入待查队列，去重后每批最多 20 个主体。分别完成每个主体的 has_more 分页，再扩展下一跳；记录 definition_etag、已读页和 unavailable_ids。每次分页是新快照，数据变更时需重新核对范围。这里只能查询已声明的目录事实，外围文件、收藏或普通文本不会被自动推断为目录关系。

例如，Expression 向内筛选 Track 可查询实际收录位置，再沿 Track 的 Medium 和 Release 归属追踪发行；Work 的 `release_subject` 只证明发行声明了该作品，不能证明某个录音被收录。Release 向外筛选 Medium 可查询介质，完整曲序可用发行 toc。失败与限流处理见[API 概览](/api-overview)。

## 发行目录、组成与版本组

| 端点 | 返回内容 |
| --- | --- |
| `GET /api/catalog/releases/:id/toc` | Release、按位置排序的 Medium / Track、去重 Expression 与 definition_etag |
| `GET /api/catalog/expressions/:id/composition` | 直接 parts 与 wholes，关系及定义 ETag |
| `GET /api/catalog/releases/:id/editions` | 显式 group 与 editions，未分组时 group=null、editions 为空 |

发行 toc 在同一只读数据库快照内读取，各端点按调用者可见性过滤。composition 读取当前定义中用途为 expression_composition 的关系；editions 使用 release_group，不从共同 subjects 推断组。

这些聚合入口适合页面展示；需要批量直接关系或递归遍历时使用 relationships/query，并按每个主体的分页标记继续读取。

## 批量表达详情

发行版详情页一次取多条表达：表达实体 + 自身收录 + 同篇目兄弟收录 + 首个署名。
用 POST + JSON body 传 id 列表，避免把上百个 UUID 拼进 GET 查询串。

```http
POST /api/catalog/expressions/details
{ "ids": ["<expression_id>", "..."] }
```

请求体 `ids` 不能为空且不超过 500 条（`400 invalid_payload` / `400 too_many_ids`）。
响应含 `items`（按表达聚合，收录以引用 id 呈现）与共享的 `entities` 表。

## 批量身份候选与质量检查

`POST /api/catalog/entities/candidates/batch` 接受 `{"queries":[{"key":"work-a","kind":"work","titles":["题名"]}]}`，一次最多 50 个查询。每项使用前述候选查询的平铺字段，`key` 必须唯一且非空。响应为 `results[]`，保留各项 `key`、`items`、`total`、`complete` 与可能的 `error`；逐项核对，不能把失败或不完整结果当成零候选。

| 接口 | 输入与返回 |
| --- | --- |
| `GET /api/catalog/entities/{id}/quality` | 单条只读诊断；可见性与实体详情相同 |
| `POST /api/catalog/quality/batch` | `{"ids":["<UUID>"]}`，1–100 个实体；返回 `reports[]` 和按 ID 记录的 `errors`，单项失败不代表全批失败 |
| `GET /api/catalog/entities/stats` | 按生命周期统计条目，需要 `catalog.lifecycle.manage`；包括 deleted/merged，不能作为匿名探索页总数 |
| `GET /api/catalog/stats` | 公开 active 实体的总量、图片与标签覆盖数，按八种 kind 分组，无需生命周期管理权限 |

质量报告包含 `entity_id`、`kind`、`status`、`issues[]`、`checks[]` 和定义版本。`status` 为 `complete` / `partial` / `needs_verification`；`checks` 声明实际检查覆盖面。质量诊断可选，只提供建议，不是编辑、提交或应用的前置条件，诊断结果不会阻断这些操作；它不是人工审核结论，不会修改条目或赋予免审资格。

## 词表、标签、货架与对比

`GET /api/catalog/stats` 在同一数据库快照内返回 `total`、`with_pictures`、`with_tags` 与 `kinds`。前三项分别是 active 实体总数、pictures 非空的实体数、tags 非空的实体数；`kinds` 始终包含八种实体类型，每项具有相同三项计数，空类型补 0。只需要数量或覆盖率时使用此接口；按标签的频次继续读 `/tags`，不必遍历实体列表或逐标签查询来计算 tagged-entity 总数。该接口遵守目录读取限流。

| 端点 | 用途 |
|---|---|
| `GET /api/catalog/definitions` | 已发布的动态定义与固定骨架的多语言 kind 名 |
| `GET /api/catalog/tags` | 标签频次聚合（只统计 active 实体） |
| `GET /api/catalog/shelves` | 已启用的虚拟货架规则 |
| `GET /api/catalog/shelves/feed` | 每个货架加求值后的条目 |
| `GET /api/catalog/external-databases` | 可用的外部权威库定义（`external_links[].kind` 的合法平台码） |
| `GET /api/catalog/compare?ids=a,b` | 2–6 个可见实体的字段对比；Release/Medium 附完整载体/轨目树，属性只对比 comparable 字段 |

- definitions 的字段与规则说明见[动态定义与配置](/api-definitions)。
- 主体社交账号预设包括 `bilibili_space`（数字 UID）、`weibo`（数字 UID）、`douyin`（个人页 `/user/` 后的 sec_uid）。存量实例需显式执行内容 seed 才能新增预设，使用前先读取实例注册表；不要把个人空间写成 `official_website`。
- `tags` 支持 `q` 过滤，`limit` 默认 200 上限 500
- `shelves/feed` 的 `per_shelf` 默认 12、上限 100；登录用户按其首页偏好合并、重排与隐藏，每条 `shelf` 带 `source`（`system` / `custom`）
- compare 需要 2–6 个实体，越界返回 `compare_requires_two_to_six`。每项使用 `entity`；Release/Medium 的载体树在 `children` 中，每项为 `{medium, tracks}`。

## 后台条目与请求台账

以下只读端点需要 `catalog.lifecycle.manage`，第三方 OAuth 身份不可调用：

| 端点 | 查询参数与用途 |
| --- | --- |
| `GET /api/admin/catalog-entities` | 全量条目台账；`state=active|deleted|merged`、`kind`、`q`，不传 state 包含全部生命周期 |
| `GET /api/admin/catalog-request-logs` | 跨用户目录 API 日志；`user_id`、凭据显示名 `credential`、HTTP `status`、路由子串 `path` |

两者使用 PostgreSQL 计数与稳定排序，不依赖搜索索引；支持 `limit`（默认 50、范围 1–100）与 `offset`，返回 `items/total/limit/offset/has_more`。条目 q 按原名、翻译名或 UUID 做不区分大小写的字面子串匹配。公共条目列表仍排除 deleted/merged，不能用其代替后台台账。

日志只记录已认证调用，保留 30 天，包含账号、凭据类型与名称、时间、方法、路由模板、响应状态和耗时；不包含令牌、请求头、正文、查询串或路由内实体 ID。本人开发者日志仍仅返回本人的记录。

## 用户贡献流

用户主页展示已合入的提交、涉及条目、PR 与贡献日历：

```http
GET /api/users/:id/contributions?year=2026&page=1&page_size=20
```

| 参数 | 说明 |
| --- | --- |
| `year` | 缺省当前 UTC 年；显式值为 1970–9999 |
| `page` | 从 1 起，小于 1 时取 1 |
| `page_size` | 默认 20，范围 1–100；越界回落 20 |

响应包含 `year`、`timezone:"UTC"`、`summary`、`calendar`、`items`、`total`、`page` 与 `page_size`：

- `summary` 为 `merged_commits`、`changed_entities`、`created_entities`、`merged_pull_requests`、`legacy_revisions`。
- `calendar` 为所选年份的每日 `{date,count}`，包括零贡献日期。日期按实际合入时间的 UTC 日统计。
- `items` 每项含 `id`、可选 `commit_id`、`message`、`authored_at`、`merged_at`、`author:{id,name}`、`authors:[{id,name}]`、可选 `merged_by:{id,name}`、`pull_request_id`、`changes_count`、`entities:[{id,kind,title}]` 与 `legacy`。

一个多对象 commit 对每位真实参与者只算一次合入贡献。author 为实际创建 commit 的人，authors 保留服务器记录的全部编辑参与者，客户端不能任意指定作者；PR 内多个 commit 分别保留作者，合并者另记。未关联 commit 的历史修订标记 `legacy:true`，不伪造提交或父链。缺少历史昵称时 name 可回落为用户 ID。

私有副本、未合入提交和不可见目标不公开。一个 commit 的部分目标不可见时，不返回其 message 内容与 PR ID；全部目标不可见时，整项与对应计数均排除。审核操作或审计日志不当作编辑贡献。

该接口不返回账号资料，也不因合法 UUID 的空贡献列表证明账号存在；账号资料见[认证与凭证](/api-auth#公开账号资料)。历史修订和 commit 的公开详情仍需各自访问校验，不能凭贡献条目绕过可见性。

## 相关页面

- [API 概览](/api-overview)：认证、限流与错误码
- [检索](/api-search)：关键词、索引计数与分页
- [新建与编辑](/api-edit)：写入、关系与生命周期
