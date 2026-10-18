---
title: "工作副本与提交"
description: "服务器工作副本、多次提交、推送、PR 与并发冲突处理。"
order: 45
group: "api"
---

# 工作副本与提交

目录编辑使用服务器上的工作副本。保存修改、创建 commit 都不改变公开条目；push 后，免审账号直接合入，其他账号创建或更新 PR，由有权限的成员合并。一个副本可以包含多个实体、关系和 Track 收录，也可以连续产生多个 commit。

这是目录记录的协作协议，不使用原生 Git 传输或文件系统分支。实体保留自己的版本；commit 将相关修改和作者串在一起，PR 表达一次待合入的任务。

## 编辑流程

1. 创建 workspace，按需 checkout 已有实体和关系。
2. 多次 stage 修改。跨页面编辑与协作者的修改保存在同一个服务器副本中。
3. 检查副本差异，用固定 UUID 和修改说明创建不可变 commit。
4. 继续编辑并 commit，或 push 当前 head。
5. 检查 push 的 `applied`、`commits` 与 `pull_request`。直接合入才改变正式目录；PR 尚未合入时，公开条目保持原内容。

来源、查证记录、质量检查均不是保存、commit、push 或合并的前置条件。已有来源资料仍保留；可在图片、收录等资料支持的字段中补充来源，不需要填写独立证据池或每操作 `source_refs`。

## 工作副本 API

以下路径的接口前缀为 `/api/catalog/*`。实时工作副本只对所有者和明确加入的协作者开放；`catalog.review.manage` 允许审阅冻结 PR 和已 push 的提交，不允许读取副本后续未提交内容。不能以知道 UUID 代替访问权限。已合入 commit 或 PR 的详情仅在全部涉及对象仍公开时允许公开读取，其他情况继续按权限隔离。

| 方法与路径 | 请求体 | 返回 |
| --- | --- | --- |
| `POST /workspaces` | `{name, entity_ids?, relation_ids?}` | `Workspace` |
| `GET /workspaces` | `limit` / `offset` 查询参数 | `{items,total,limit,offset}` |
| `GET /workspaces/:id` | 无 | `Workspace` |
| `PATCH /workspaces/:id` | `{expected_version, name?, state?}` | `Workspace` |
| `POST /workspaces/:id/checkout` | `{expected_version, entity_ids?, relation_ids?}` | `Workspace` |
| `PUT /workspaces/:id/changes` | `{expected_version, operations}` | `{workspace, refs}` |
| `PUT /workspaces/:id/members` | `{expected_version, user_ids}` | `Workspace` |
| `POST /workspaces/:id/commits` | `{id, expected_version, message}` | `CollaborationCommit` |
| `GET /workspaces/:id/commits` | 无 | `{items: CollaborationCommit[]}` |
| `POST /workspaces/:id/push` | `{expected_version, expected_head, title?}` | `WorkspacePushResult` |
| `POST /workspaces/:id/rebase` | `{id, expected_version, expected_head, message?, resolutions?}` | `{workspace, commit}` |
| `GET /commits/:id` | 无 | `CollaborationCommit` |

`Workspace` 包含 `id`、`owner_id`、`name`、`version`、`head_commit_id`、`state`、`members`、`objects`、`dirty_count`、`created_at` 与 `updated_at`。每个 object 有 `target`、`id`、`base_version`、`base`、`committed`、`document`、`dirty`，分别保留正式基线、最近已提交状态和当前编辑状态。提交或推送前先回读副本，不从浏览器旧缓存猜测版本。

副本 `state` 为 `active` 或 `archived`，所有者可归档或恢复。列表默认 `limit=20`、最大 100，`offset` 从 0 起。

### 暂存修改

`operations` 支持实体与关系；每项字段为 `target`、`action`、`id`、`ref`、`document`、`patch`、`content_change`，按操作选择适用项。

修改已有对象前先 checkout。下面只修改某一语言正文：

```http
PUT /api/catalog/workspaces/<workspace_id>/changes
Content-Type: application/json

{
  "expected_version": 2,
  "operations": [{
    "target": "entity",
    "action": "update",
    "id": "<entity_uuid>",
    "patch": [{"path": "/translations/ja/body", "value": "## 解説\n本文。"}]
  }]
}
```

patch 使用 JSON Pointer；明确删除字段时使用 `remove:true`。省略的字段保留，不把可见性裁剪后的实体整份覆盖回正式目录。正文是 `translations.<locale>.body`，与其他字段一起进入副本与提交；同一语言正文发生并发修改时，需要人工合并该字段。

创建对象使用 `action:create`、`ref` 和 `document`。一次 stage 的文档内可用 `{"$ref":"<ref>"}` 引用本次新建对象；响应 `refs` 提供实际分配的稳定 UUID，后续 stage 和 commit 使用该 UUID，不重新创建。创建顺序应满足依赖，例如 Work → ContentUnit → Expression，Release → Medium → Track。每次 stage 包含 1–100 个操作，数组字段按整体值修改。

关系修改使用同一入口的 `target:relation`；删除关系使用 `action:delete` 和关系 ID。Track 的收录使用 `target:entity`、`action:content` 与 `content_change`：`action` 为 `add`、`replace` 或 `delete`，`position` 指已有位置，增加或替换时携带 `inclusion`。只改本次收录，保留其他和不可见的历史收录。实体、图片、关系和收录的字段约束见[新建与编辑](/api-edit)。

### 创建 commit

```json
{
  "id": "<新的提交UUID>",
  "expected_version": 3,
  "message": "补充发行目录并修正参与关系"
}
```

`CollaborationCommit` 包含 `id`、`workspace_id`、`parent_id`、`author:{id,name}`、`message`、`kind`、`created_at`、`merged_at`、`merged_by`、`pull_request_id` 与 `changes`。每个 change 包含 `target`、`id`、`base_version`、`before` 和 `after`。commit 不可修改；继续编辑会产生新的 commit，作者不会被推送者或合并者替换。多人共同暂存的参与者由服务器记录，公开贡献中的 authors 保留这些贡献者，不能由客户端伪造。

## 推送与 PR

push 指定当前副本的 `expected_version` 与 `expected_head`。具有 `catalog.review.bypass` 的账号可在其操作权限范围内直接合入；普通账号获得待合并的 PR。令牌的操作权限与账号当前免审资格分开判断，管理员通过已授权的 Key 或 MCP 编辑时同样适用。

`WorkspacePushResult` 为 `{applied, workspace, commits, pull_request}`。`workspace` 可为 null：非副本成员审核人合并或回读合入结果时，只返回冻结的 PR 和提交，不暴露实时副本。`applied=true` 表示正式目录已更新；存在 `pull_request` 表示需查看 PR 状态。PR 创建成功不表示没有合并冲突，合并时仍会重新检查。保存到副本或创建 commit 都不能报告成已上线。

| 方法与路径 | 请求体 | 返回 |
| --- | --- | --- |
| `POST /api/catalog/pull-requests` | `{workspace_id, expected_version, expected_head, title?}` | `PullRequest` |
| `GET /api/catalog/pull-requests` | `status` / `workspace_id` / `limit` / `offset` 查询参数 | `{items,total,limit,offset}` |
| `GET /api/catalog/pull-requests/:id` | 无 | `PullRequest` |
| `PATCH /api/catalog/pull-requests/:id` | `{expected_version, title?, status?}` | `PullRequest` |
| `POST /api/catalog/pull-requests/:id/merge` | `{expected_version, expected_head}` | `WorkspacePushResult` |

commit 的 `author` 记录执行提交的账号，`authors` 记录本次修改的贡献者；合并者另存于 `merged_by`。

PR 包含 `id`、`workspace_id`、`author_id`、`title`、`status`、`source_head_id`、只读 `source_base_id`（可为空）和 `version`、`merged_at`、`merged_by`、时间、`commits` 与 `changes`。合并校验 PR 版本和源 head，不能把审阅后新增的提交静默带入；源分支继续修改后，应回读最新差异再合并。

PR 状态为 `open`、`merged`、`closed`；closed 可重新打开。合并需要 `catalog.review.manage`；免审账号通过自己的或参与协作的副本 push 直接合入。列表默认 `limit=20`、最大 100，`offset` 从 0 起。

定义管理、实体身份合并与退役仍是独立管理员动作；上传由存储服务处理，不属于跨服务事务。常规实体、关系与收录写入只有工作副本这一个入口。

## 多人编辑与冲突

同一副本的写操作带 `expected_version`，避免协作者相互覆盖。副本版本过期时先回读，保留自己尚未保存的修改，再重新组合操作。`expected_head` 还保护 push、rebase 和 PR 合并的提交边界。

正式目录发生变化时，服务端从副本基线到已提交 tip 计算净变更，再与正式目录做三方合并。互不相交的字段可自动合并；自己修改后又撤销的字段不应覆盖其他人的新内容。结构依赖和引用约束在合入时重新验证，同一批修改在事务中原子应用。

真实冲突返回 HTTP 409、`{error:"workspace_conflict",applied:false,conflicts:[...]}`。冲突项含 `target`、`id`、`base_version`、`current_version`、`pointer`、`base`、`current`、`proposed`、`remove`、`kind`。比较基线、当前正式值和副本值后，通过 rebase 的 `resolutions` 提交取舍：

```json
{
  "id": "<新的rebase提交UUID>",
  "expected_version": 5,
  "expected_head": "<当前副本head>",
  "message": "合并并发正文修改",
  "resolutions": [{
    "target": "entity",
    "id": "<entity_uuid>",
    "pointer": "/translations/ja/body",
    "current_version": 8,
    "value": "<人工合并后的正文>"
  }]
}
```

选正式值或副本值时，将对应值明确写入 `value`；删除用 `remove:true`。`current_version` 防止解决冲突期间正式目录再次变化。rebase 保留原提交，并在需要时生成新 commit；完成后重新检查 head，再 push 或更新 PR。

## 断线与重试

创建 commit 使用固定 UUID。结果未知时先 `GET /api/catalog/commits/:id` 并回读副本 head；不要立即换 ID 重建相同内容。push 或合并结果未知时，回读副本、commit 的 `merged_at` 和 PR 状态后决定后续动作。

同一 head 已合入时再次 push 返回已应用结果，不重复写正式目录；同一 head 已有 open PR 时返回原 PR。创建 workspace 没有客户端幂等键，结果未知应先列出本人副本确认，不能盲目重复创建。

副本、commit、PR 和正式修订各自保留自己的状态。未知结果不能当成未执行，409 不能通过盲目换版本或整实体覆盖解决。实际错误码与载荷以目标实例 OpenAPI 和响应为准；限流与依赖错误见[API 概览](/api-overview)。

## 贡献归属

正式合入保留原 commit 作者，合并者另记。一个批量 commit 对每位真实参与者只计一次，不按修改对象数重复计数；个人主页的贡献日历按真正合入的时间统计。未合入的私有副本、提交消息和修改目标不进入公开贡献流，见[用户贡献流](/api-entities#用户贡献流)。
