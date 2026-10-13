---
title: "工作副本与提交"
description: "Agent 批量编辑、原子推送、三方合并与失败恢复。"
order: 45
group: "api"
---

# 工作副本与提交

多个 Agent 可以从各自的版本副本编辑，在本地形成提交，再一次推送一批实体与关系。每个实体保留自己的版本历史；提交将相关修订串在一起，没有全站共同移动的 head，也不为每个条目创建物理 Git 仓库。当前实现提供 Git 式编辑流程，原生 Git 协议尚未接入。

## 从副本到推送

1. `POST /api/catalog/checkout`：传 `entity_ids`、`relation_ids`，合计最多 100 个。返回同一只读快照中的完整可见文档、version、当前 `definitions_etag` 和 `actor_id`。空数组用于初始化工作区。Track 的隐藏收录不会出现在副本中。
2. 本地编辑 JSON，保留基线。新实体先按下文查重；创建依赖用 `{"$ref":"名称"}` 对象，不能伪造 UUID。
3. 本地 commit：保存不可变请求、证据与固定 UUID。一个工作区保留一个待推送提交，各 Agent 使用独立目录。
4. `POST /api/catalog/commits/preview`：真实校验后整笔回滚；返回 `applied:false`，不保留实体、修订、通知或搜索事件。预览 ID 不可用于后续引用。
5. `POST /api/catalog/commits`：原子推送；全部操作成功才保存事实、修订、通知、搜索 outbox 与回执。每批 1–100 个操作，请求体最多 2 MiB，按声明顺序满足引用依赖。
6. `GET /api/catalog/commits/{id}`：原操作者查询持久回执。成功后重新 checkout，获得可能已被其他编辑者推进的当前版本。

提交范围是目录实体与语义关系的创建、更新。删除、合并身份、下架、定义配置、上传、账号和互动各有自己的权限与事务入口；提交不提供跨服务事务或服务端长期分支。修订的 `commit_id` 在数据库中关联整笔推送，原有按实体读取历史仍有效。

## 提交格式

```json
{
  "id": "019a0e47-6190-7000-8000-000000000001",
  "definitions_etag": "<checkout 返回值>",
  "edit_note": "根据官方目录补充题名与表达",
  "sources": [
    {"key":"catalog","kind":"url","citation":"官方目录支持题名和层级","url":"https://example.org/catalog"}
  ],
  "operations": [
    {"target":"entity","action":"update","id":"<实体 UUID>","base_version":3,"reviewed_candidate_ids":[],
     "patch":[{"path":"/translations/zh-CN/title","value":"中文题名"}],
     "source_refs":[{"source":"catalog","pointers":["/translations/zh-CN/title"]}]},
    {"target":"entity","action":"create","ref":"recording","reviewed_candidate_ids":[],
     "document":{"kind":"expression","title":"录音","work_id":"<Work UUID>"},
     "source_refs":[{"source":"catalog"}]}
  ]
}
```

**破坏性变更（无兼容模式）：** `sources` 是带唯一 `key` 的证据池；每个操作必须用非空 `source_refs` 声明自己引用哪些来源（可细到 JSON Pointer）。旧格式（来源无 key、操作无 `source_refs`）一律拒绝，客户端必须升级。缺/空 `source_refs` → `400 {"error":"source_refs_required","applied":false,"operation":<从 0 起>}`；来源无 key → `source_key_required`；池中有未被引用的来源 → `source_unused`。历史修订在迁移后带 `scope:"commit"`，仅表示整次提交级证据，不是字段级证明。

`target` 是 `entity` 或 `relation`。创建需要唯一 `ref` 和 `document`，不能声明服务端 ID、version、created_by、redirect_id。更新需要 ID、权威 `base_version` 和 patch；基线由服务端修订取得，不能提交伪造的旧快照。每个目标每批只能编辑一次。

Patch 路径使用 JSON Pointer：`~` 编码为 `~0`，`/` 编码为 `~1`。`value:null` 是显式空值，`remove:true` 是移除键，两者不可同时提供。对象字段可逐键编辑，数组整组处理；不支持数组下标，不允许同一批 patch 中出现祖先与子路径。实体可编辑字段以实例 OpenAPI 与动态 definitions 为准，ID、kind、版本及 Work/Release/Medium 归属不能通过 patch 改写。关系只可编辑 position、attributes，不能改端点和关系码。

## 创建与身份更新的复核

实体 create 和身份字段 update 必须提供 `reviewed_candidate_ids`，空数组表示已审查且无候选。身份 patch 包括 `/title`、`/external_ids` 及其子路径，以及 `/translations` 整组、`/translations/<locale>` 整行或 `/translations/<locale>/title`。只改非身份字段的 update 和关系操作不接受该数组。

服务端用最终题名、各语言题名和外部 ID 构造 candidates 查询，按 Work（Expression/ContentUnit）、Release（Medium）或 Medium（Track）限定作用域；不加入 duration 等容易产生大量命中的弱条件。更新以三方合并后的文档复核，排除当前实体的 canonical 身份及归于它的历史别名。先用相同条件的 [candidates 查询](/api-entities#并发编目的查重候选)读取 canonical ID 并核来源。有候选时优先复用，确认为不同对象才能列入已审查数组并说明理由。

新作用域用本批分配的 ID；需要明确区分本批先创建的同名对象时，审查数组可用 `@local:ref名称`。创建与身份更新共同协调并发身份条件，看到候选集合与审查结果不一致时整批返回 `409 identity_candidates_changed`，不会静默再建或改出一条。响应中的 `identity_review` 含 `operation`（从 0 起）与当前 `candidate_ids`。候选截断或 canonical 未解析同样阻断写入。

这是当前可见候选集合的复核，不是“同名即同实体”的唯一约束。公开单实体 POST / PUT 同样复核身份，`reviewed_candidate_ids` 省略时按空数组处理；无候选的旧客户端继续可用，有候选时需明确审查后提交。导入使用自己的身份策略并参加共同的身份协调。私有对象不能由查重暴露，来源判断也不能由标题匹配代替。

## 合并与冲突

更新按照“基线、当前值、请求值”比较每条路径。远端没有改该字段时应用本地修改；双方改成同一个值时视为已完成，不产生多余修订；双方改成不同值时返回：

```json
{"error":"commit_conflict","applied":false,"conflict":{"operation":0,"id":"<UUID>","base_version":3,"current_version":4,"paths":["/title"]}}
```

其他字段的并发修改会保留。冲突结果只提供路径与版本，不返回隐藏事实；整个批次回滚。`definitions_conflict` 表示动态定义基线改变，需要重新核字段契约。隐藏 Track contents 必须走单条收录专用端点；Track 题名、属性、图片和状态可用稀疏 patch，服务端会保留未提交的完整事实。

互不关联的结构和关系提交可并行执行。服务端使用 PostgreSQL `SERIALIZABLE` 检查跨实体依赖，不再用全目录结构锁串行化。共享发行、身份候选和同一行仍可能短暂等待；创建环、超过关系基数或修改同字段的提交仍会被拒绝。并行执行不等于所有编辑都能无冲突合并。

## 断线与重试

固定提交 ID 是持久幂等键。同一操作者、ID 和载荷返回首个回执；同 ID 不同内容或不同操作者返回 `409 idempotency_conflict`。不要改 ID 后重建同一批数据。查询回执的 404 可能表示请求仍在执行，不能据此断言失败；可用同 ID、同载荷再次 push，由服务端协调并发请求。

已明确拒绝的提交可重新 checkout、审查冲突并 rebase，生成新提交 ID，保留旧本地提交。未知结果必须先查回执，不能 rebase。提交 ID、操作者、载荷摘要、结果与修订关联永久保留，回执不会按年龄清除；原始请求默认 90 天后裁剪，同 ID、同载荷仍可恢复首个结果。

checkout、预览、推送及回执读取与其他目录请求共用默认 180 次/分钟预算，读写合计，实例策略可覆盖；多副本共享计数，见[限流](/api-overview#限流)。服务端提交期限 15 秒、锁等待 3 秒，失败后按机器码与回执判断结果。批量减少请求数，不保证任意大小的关系图都能在期限内提交。

数据库明确回滚的序列化失败、死锁或锁等待超时由服务端重新执行整个事务，最多 16 次尝试，仍受 15 秒期限限制；提交 ID 和请求不变。耗尽尝试返回 `503 {"error":"transaction_busy","applied":false}` 与 `Retry-After: 1`。这仅证明本次请求未应用；若此前同 ID 请求断线且结果未明，仍须查回执，不能凭后一次失败创建新提交。客户端保留提交，稍后显式推送同 ID、同载荷；连接断开和其他 5xx 不自动重放写请求。

## 机器错误码

下表补充提交与 checkout 的错误；实体字段、来源、权限与可见性仍沿用[新建与编辑](/api-edit)和[API 概览](/api-overview)。400 表示载荷需修正，不能原样自动重试。

| HTTP / error | 处理 |
| --- | --- |
| 400 `invalid_checkout_size` / `duplicate_checkout_id` / `invalid_id` | 合计最多 100 个规范 UUID，同一 ID 只出现一次 |
| 400 `invalid_commit_id` / `definitions_etag_required` / `invalid_commit_size` | 使用固定规范 UUID、checkout 的定义基线和 1–100 个操作 |
| 400 `invalid_commit_target` / `invalid_commit_action` | target 为 entity/relation，action 为 create/update |
| 400 `invalid_create_operation` / `invalid_update_operation` / `duplicate_commit_target` | 核对 ref、ID、base_version、document/patch；同批一个目标只能编辑一次 |
| 400 `identity_review_required` / `invalid_identity_review` | 创建或身份更新须带审查数组；其余操作不能带，审查项需为合规候选身份 |
| 400 `identity_candidates_incomplete` / `identity_candidate_unresolved` | 收窄候选条件或修复身份解析，不能把不完整集合当作没有重复 |
| 400 `invalid_document` / `server_fields_forbidden` | 使用严格 document DTO，不声明服务端 ID、version、created_by 或 redirect_id |
| 400 `invalid_local_reference` | 使用 `{"$ref":"此前创建的 ref"}`，检查依赖顺序与目标是否存在 |
| 400 `invalid_patch_path` / `invalid_commit_patch` / `overlapping_patch_paths` / `patch_requires_object` | 修正 JSON Pointer、value/remove 与对象层级；不编辑数组下标或重叠路径 |
| 400 `base_revision_missing` | 服务端找不到指定的权威基线；重新 checkout 并重新形成修改 |
| 400 `use_track_contents_endpoint` | 隐藏收录不能整体 patch，改用单条收录端点；其余稀疏修改可保留完整历史事实 |
| 400 `commit_incomplete` | 无法恢复已存提交的完整结果；保留原 ID 与载荷，报告服务异常 |
| 400 `source_refs_required` | 某个操作缺或空 `source_refs`；响应含 `applied:false` 与 `operation` 索引。旧格式无兼容，必须补齐 |
| 400 `source_key_required` / `invalid_source_key` / `duplicate_source_key` | 来源池缺 key、key 不合规或重复 |
| 400 `source_unused` / `unknown_source_ref` / `duplicate_source_ref` | 池中有未引用的来源，或操作引用了不存在/重复的 key |
| 400 `invalid_source_pointer` / `source_pointer_not_in_document` / `source_pointer_not_patched` | 指针非法，或不在 create document / update patch 覆盖范围内 |
| 409 `commit_conflict` | 按 conflict.paths 比较双方改动，重新取舍后 rebase |
| 409 `definitions_conflict` | 重新读取定义和工作副本，核对字段契约 |
| 409 `identity_candidates_changed` | 按 identity_review 的当前 canonical 候选重新审查；整批未应用 |
| 409 `idempotency_conflict` | 同 ID 已属于另一操作者或另一载荷，勿改 ID 盲目重建 |
| 503 `transaction_busy` | 本次明确未应用；按 Retry-After 重试同 ID，此前未知请求仍先查回执 |

回执的 `applied` 表示服务端结果，不等于客户端工作副本已刷新。推送成功后应核对回执并更新基线；封存后的追加编辑须与回读内容合并，不能直接覆盖或丢弃。
