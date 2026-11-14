---
title: "AI 助手 API"
description: "模型调用、BYO 服务商与模型、后台问答、积分用量、生成介绍、网页搜索与自动维护接口。"
order: 75
group: "api"
---

# AI 助手 API

统一前缀为 `/api/assistant`。公开模型列表与有效共享介绍可匿名读取，其余本人接口需要第一方身份；第三方 OAuth 身份不能访问会话、自备 API、积分或管理接口。后台还需要 `assistant.manage`。AI 工具执行目录编辑时继续校验原有目录权限，不获得第二个服务账号或额外免审资格。

请求为 JSON，拒绝未知字段，请求体上限 1 MiB。列表响应使用 `items/total/limit/offset`；`limit` 默认 50、最大 200，按返回的分页信息继续读取。成功通常返回 200，删除会话、模型、平台服务商或自备配置成功返回 204。

## 模型、积分与自备 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /models` | 站点可用模型及输入、输出费率 |
| `GET /account` | 同步一次性赠分与采纳奖励，返回 `balance`、`registration_credits`、`accepted_edit_credits`、`default_model_id` |
| `GET /byo/providers` | 本人的自备服务商列表 |
| `POST /byo/providers` | 新建本人自备服务商 |
| `PUT /byo/providers/:id` | 修改本人自备服务商 |
| `DELETE /byo/providers/:id` | 删除本人自备服务商（仍有关联自备模型时返回 409） |
| `GET /byo/models` | 本人的自备模型列表 |
| `POST /byo/models` | 新建本人自备模型 |
| `PUT /byo/models/:id` | 修改本人自备模型 |
| `DELETE /byo/models/:id` | 删除本人自备模型 |
| `GET /usage` | 本人的模型调用用量 |

`balance` 包含 `credits`、`reserved_credits`、`available_credits`。注册赠分按账号唯一；采纳奖励仅同步 `reward_effective_at` 之后已批准或免审且 `applied=true` 的提交，按提交 ID 唯一。历史提交不会在首次访问时全部补发。

创建自备服务商（`POST /byo/providers`）：

```json
{
  "name": "我的服务商",
  "protocol": "openai_compatible",
  "base_url": "https://provider.example/v1",
  "enabled": true,
  "api_key": "<服务商密钥>"
}
```

接口只返回 `has_key/key_hint`，不回显密钥。更新不传 `api_key` 保留原密钥，传新值替换。

创建自备模型（`POST /byo/models`）：

```json
{
  "provider_id": "<本人自备服务商 UUID>",
  "name": "DeepSeek Chat",
  "upstream_model": "deepseek-chat",
  "context_window": 65536,
  "max_output_tokens": 4096,
  "max_tokens_parameter": "max_tokens",
  "reasoning_effort": "medium",
  "enabled": true
}
```

自备服务商与自备模型只能由其所有者用于调用；管理权限不赋予代用他人密钥的能力。问答、上下文预览、介绍生成及自动维护的 `model_id` 均可直接传站点 `models.id` 或本人启用的 `byo_models.id`。

平台服务商和自备服务商共用 `protocol` 字段，默认 `openai_compatible`：

| protocol | 路径 | 认证 |
| --- | --- | --- |
| `openai_compatible` | `/chat/completions` | `Authorization: Bearer` |
| `openai_responses` | `/responses` | `Authorization: Bearer` |
| `anthropic_messages` | `/messages` | `x-api-key` 和固定 `anthropic-version` |
| `gemini_generate_content` | `/models/{model}:generateContent` | `x-goog-api-key` |

`base_url` 包含版本前缀，见[接入示例](/assistant)。请求非流式，工具声明、调用及结果按所选格式转换，不通过失败重试探测格式。Responses 使用 `store=false`；返回的推理项、Claude 签名块及 Gemini thought signature 保存在本人会话的 `provider_context`，只回传到相同端点、密钥和模型，不向其他连接传递。前端只展示可见回答，不展示这些协议元数据。

用量统一为 `input_tokens/output_tokens/cached_input_tokens`：Anthropic 输入包括普通输入、缓存读取和缓存创建；Gemini 输出包括候选输出与思考 token；Responses 使用其 input/output 及缓存输入字段。缺失 usage 不视为免费成功，沿用既有不重复调用与估算结算规则。

平台模型、自备模型、会话、单次聊天请求、自主任务及自动维护均支持可选 `reasoning_effort`（思考强度），可选值为 `""`（跟随模型默认）、`"none"`、`"minimal"`、`"low"`、`"medium"`、`"high"`、`"xhigh"`、`"max"`：`openai_compatible` 映射为顶层 `reasoning_effort`，`openai_responses` 映射为 `reasoning.effort`，`anthropic_messages` 映射为 `thinking`（`disabled` 或受限于 `max_output_tokens` 的 `budget_tokens`），`gemini_generate_content` 映射为 `generationConfig.thinkingConfig.thinkingBudget`。

## 问答、后台执行与修改

`POST /chat`：

```json
{
  "client_request_id": "<本次请求的 UUID>",
  "message": "查询这个发行版的发行主体和收录内容",
  "model_id": "<站点模型或本人自备模型 UUID>",
  "reasoning_effort": "medium",
  "search_provider_id": "<可选的搜索服务 UUID>",
  "search_byo_provider_id": "<可选的本人自备服务商 UUID>",
  "conversation_id": "<可选的已有会话 UUID>",
  "background": true
}
```

新会话省略 `conversation_id`；省略 `model_id` 时使用会话已记录模型或站点默认模型。`message` 必须为非空 UTF-8，最多 32768 字节。

`background=false`（默认）同步等待执行结束（受 HTTP 请求 150 秒超时限制），返回 `conversation_id`、`request_id`、`status`（`completed` 或 `failed`）、`answer`、累计 `usage`、`credits_spent`、`balance` 以及可选 `tool_results`、`push_receipts`、`error`。

`background=true` 在校验并封存请求后立即返回 `200`，其中 `status="pending"`，同时服务端在独立后台上下文继续执行（最长 5 分钟），每完成一轮模型或工具调用即实时保存进度到会话 `messages` 与 `chat_requests.response`。会话在后台执行期间携带 `active_request_id`，调用方可通过 `GET /conversations/:id` 读取最新消息与工具调用进度，并通过 `GET /requests/:id` 查询最终状态、用量和 `push_receipts`。

工具可读取定义、实体、身份候选、关系、工作副本、网页搜索和公开来源，修改统一在服务器工作副本中 stage、commit、push。查询工具支持按需筛选字段与语种以节省上下文（`catalog_search` 支持 `fields`；`catalog_get` 支持 `fields`、`locales`、`attribute_keys`、`include_body`；`catalog_relationships` 支持 `classes` 与 `include_entities`；`catalog_definitions` 支持可选 `codes` 与 `locale`；`external_source_query` 支持可选 `source`、`include_raw`、`include_preview`；`catalog_workspace_*` 默认精简重复的快照载荷）。普通账号发起 PR，免审账号可直接合入；不要求来源池、source_refs 或查证记录。工具轮数由站点配置为 1–24（默认 12），每轮最多 8 次工具调用；当工具轮次执行完毕且尚未生成最终文本时，服务端自动追加一轮无工具的总结回合（或根据 `push_receipts` 生成保底变更摘要），输出完整的操作总结与实体链接。达到限制或后续上游失败时，响应仍保留已经发生的提交回执和用量，调用方必须同时检查 `error` 与 `push_receipts`，不能把整轮当作未写入。

`catalog_candidates` 查重工具默认覆盖 `core_title` 规范化匹配（`title_core`），并支持可选布尔参数 `include_approximate`（传入 `titles` 时默认 `true`，召回子串与 `pg_trgm` 近似候选 `title_similar`，显式传 `false` 可关闭）、主分类 `attributes` 冲突检测（`agent_type_mismatch` / `creation_form_mismatch` / `collection_type_mismatch` -> `distinct`）及 `context`。工作副本协议不要求提交 `reviewed_candidate_ids`，但助手与后台 Worker（含 `edit` 子代理）在新建任何实体前必须先调用 `catalog_candidates` 执行近似查重；命中 `reuse` 或 `review` 候选时须结合 `assessment` 并用 `catalog_get` / `catalog_relationships` 核查候选详情与关系，确认是独立实体后再新建。

`client_request_id` 封存原请求。同 ID、同载荷的已完成请求回放原结果，不重复调用或提交；进行中的请求、不同载荷或其他账号复用该 ID 返回 `409 assistant_request_conflict`。断线后使用原 ID、会话或请求查询接口恢复，勿立即换 ID 重发修改。

会话与请求查询接口：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /conversations` | 本人会话列表（含可选 `active_request_id`，不含完整消息） |
| `POST /conversations` | 创建空会话，字段为 `title/model_id/reasoning_effort` |
| `GET /conversations/:id` | 本人会话详情、消息与 `active_request_id` |
| `DELETE /conversations/:id` | 删除未在执行中的本人会话 |
| `GET /requests` | 本人请求列表，可按 `status`、`conversation_id` 筛选 |
| `GET /requests/:id` | 本人单次请求的状态（`pending/completed/failed`）与 `response` |

## 自主探索任务（Planner–Worker）

对话主助手（MainAgent）仅在用户发送消息时按轮运行，用于直接问答或通过 `assistant_mission` 工具查看、创建和调控后台自主任务。大范围目录盘点与补全通过 `/api/assistant/missions`（个人范围）或 `/api/curator/missions`（后台维护范围）运行：规划器（Planner）只维护持久计划并向 Frontier 队列派发 `recon`、`research`、`edit`、`review` 四类 Worker 子代理，不直接调用目录查询或编辑工具；Worker 独立执行并通过 `list_worker_traces`、`get_worker_trace`、`search_worker_traces` 共享已发现的实体 UUID、来源与执行轨迹。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /missions` | 分页列出自主任务，可按 `status` 筛选 |
| `POST /missions` | 创建并启动自主任务（字段：`client_request_id/title/goal/model_id/worker_model_id/reasoning_effort/worker_reasoning_effort/search_provider_id/search_byo_provider_id/budget_credits/max_workers/max_tasks/max_planner_rounds/prefer_pull_request`） |
| `GET /missions/:id` | 读取任务进度、计划、Planner 轮次与 Frontier 子任务 |
| `GET /missions/:id/tasks/:task_id` | 读取指定 Worker 子任务的完整消息与工具轨迹 |
| `GET /missions/:id/planner-runs/:run_id` | 读取指定 Planner 规划轮次的完整轨迹 |
| `POST /missions/:id/steer` | 在运行或暂停期间补充范围指令（`message`）或调整积分预算（`budget_credits`） |
| `POST /missions/:id/pause`、`resume`、`stop` | 暂停、恢复或停止任务 |
| `DELETE /missions/:id` | 删除非运行状态的本人自主任务 |

## Token、价格与预算

`POST /context` 免费预览下一轮上下文，使用本人登录身份。请求为必填 `model_id`（站点模型或本人自备模型），以及可选 `conversation_id`、`message`（未发送草稿，最多 32768 个 UTF-8 字节）。会话只能属于本人；响应包含 `input_tokens_bound`、`context_window`、`max_output_tokens`、`message_count`、`tool_count`、`estimated=true`。输入上界包含最新系统提示、已保存消息、草稿、工具定义及协议开销，与实际调用的上限判据共用实现。预览不保存草稿、不调用模型、不预留或消耗积分。

`usage` 包含 `input_tokens`、`output_tokens`、`cached_input_tokens`，缓存输入是输入总量的一部分，不能再相加作为总 token。用量记录保存 `price_snapshot`、`byo_provider_id`、`credits`、`cost_microusd`、`status`、`usage_estimated` 与结算时间，之后修改模型费率不改写历史结算。

平台价格为每百万 token 的微美元整数：`1000000 microusd = 1 USD`。分别配置 `input_price_microusd_per_million`、`cached_input_price_microusd_per_million`、`output_price_microusd_per_million`。用户积分独立配置 `input_credits_per_million`、`output_credits_per_million`，各项按 `ceil(tokens × rate / 1000000)` 计算。

调用前按输入上界与最大输出预留积分及预算，完成后按上游 usage 结算。全局和 Provider 月预算同时检查“已花费 + 已预留”，`monthly_budget_microusd=0` 表示不设上限；按 UTC 自然月计数。自备模型的平台积分和成本记为 0，保留 token 记录，第三方账单由上游服务商结算。

上游超时、中断或进程退出后无法确认用量时，按预留上界保守结算，标记 `status=unknown`、`usage_estimated=true`。它不是成功响应或精确计量。服务每分钟回收超过 10 分钟的遗留预留；若上游可能已调用，仍按此规则保守结算。明确拒绝请求的上游 4xx 可零扣，不自动重试网络请求。

## 生成介绍与缓存

| 方法与路径 | 用途 |
| --- | --- |
| `GET /generated/:entity_id?locale=zh-CN` | 读取当前有效缓存，不调用模型 |
| `POST /generated/:entity_id` | 已登录用户生成介绍，优先复用缓存 |

POST 字段：`locale`、`model_id`（站点模型或本人自备模型）、`client_request_id`、`regenerate`。支持 `zh-CN/zh-TW/en-US/ja-JP`，默认 `zh-CN`；`regenerate=true` 强制重新生成并消耗额度。建议固定本次 `client_request_id`，避免重试重复发起上游调用；已发起生成的同 ID 请求返回 409，先用 GET 检查是否已有有效缓存。

GET 返回 `{"item":null,"stale":false}` 表示未生成；指纹变化返回 `{"item":null,"stale":true}`。有效结果包含 `item`；POST 新生成还返回 `usage/credits_spent/balance`，命中缓存时 `credits_spent=0`。

`item` 保留 `entity_id/locale/model_id/context_hash/entity_version/definitions_etag`、生成时间、`usage`、`sources` 与 `blocks`。每条 source 包含 `entity_id/title/url/version`。块的 `type` 为 `markdown/table/timeline/chart`：

- `markdown` 使用 `markdown` 字段提供说明。
- `table` 使用 `columns` 与 `rows`。
- `timeline` 使用 `events`，日期保留原始精度。
- `chart` 使用 `chart_type/labels/series`，数值由服务端从结构化事实计算。

`partial/partial_reasons` 标记受数量或大小上限限制的资料范围。生成始终按匿名可见性读取实体、关系和引用，不能将管理员可读的隐藏资料写入共享缓存。指纹涵盖公开事实、相关实体版本、关系、定义、语言、输出规则及模型配置；生成期间事实变化则拒绝发布该旧快照。平台模型缓存共享，自备模型缓存按所有者隔离，读取时优先使用本人缓存。人工正文与结构化事实不受生成操作改写。

## 后台管理

后台页面入口为 `/admin#assistant`。以下路径均相对 `/api/assistant/admin/` 前缀，需要 `assistant.manage`：

| 路径 | 支持方法与内容 |
| --- | --- |
| `/settings` | GET、PUT：启用、默认模型、赠分、奖励生效时间、全局月预算、工具轮数 |
| `/providers`、`/providers/:id` | GET 列表、POST 新建、PUT 修改、DELETE 删除 |
| `/models`、`/models/:id` | GET 列表、POST 新建、PUT 修改、DELETE 删除 |
| `/byo/providers`、`/byo/providers/:id` | GET 跨用户自备服务商列表、PUT 修改、DELETE 删除 |
| `/byo/models`、`/byo/models/:id` | GET 跨用户自备模型列表、PUT 修改、DELETE 删除 |
| `/accounts`、`/accounts/:user_id/adjust` | GET 账户、POST 带原因调整积分 |
| `/ledger`、`/usage`、`/budgets` | GET 积分流水、调用用量和各月预算 |
| `/conversations`、`/conversations/:id` | GET 列表或详情、DELETE 删除会话 |
| `/requests`、`/requests/:id`、`/requests/:id/cancel` | GET 封存请求列表或详情、POST 结束遗留 pending 请求 |
| `/generated`、`/generated/:id` | GET 缓存列表、DELETE 删除指定缓存 |

自备服务商、自备模型、用量、流水和会话列表可用 `user_id` 筛选；生成缓存列表用 `entity_id/owner_id`。Provider 管理名称、HTTPS 根地址、协议、密钥、启用状态与独立预算；Model 通过 `provider_id` 关联，管理 `upstream_model`、显示名、价格、积分费率、`max_output_tokens`、`context_window` 与 `max_tokens_parameter`（`max_tokens` 或 `max_completion_tokens`）。有关联记录时删除返回 `409 assistant_record_in_use`，可以先停用。

封存请求列表可按 `user_id` 和 `status=pending|completed|failed` 筛选，列表不含响应正文，详情保留已记录的结果、用量及提交回执。取消请求体为 `{"note":"处理原因"}`，仅允许结束创建超过 10 分钟且仍为 pending 的请求，其他状态返回 409。取消保留请求 ID 和已有结果，不撤回已应用的编辑、不重发上游调用，也不赋予重新执行同 ID 的机会。

积分调整请求为 `{"id":"<调整 UUID>","credits":100,"note":"原因"}`，负数表示扣减，不能扣除已预留额度。相同 ID 与载荷只生效一次，载荷不同返回冲突。当前没有赞助或支付接口。

## 公开网络与百科来源

这些接口位于 `/api/external-sources`，需要登录，均只读：

| 方法与路径 | 请求 |
| --- | --- |
| `POST /fetch` | `{"url":"https://example.org/data","format":"text"}`；format 可为 text 或 json |
| `POST /wiki` | `{"site":"wikipedia","language":"ja","title":"条目名"}`，或用 `query` 搜索，二者互斥；`limit` 默认 5、最大 20 |

fetch 仅执行公开 HTTP(S) GET，不转发 Cookie、Authorization 或任意第三方请求头，上限 2 MiB、20 秒、最多 3 次重定向。每次连接验证所有 DNS 地址并固定连接到已校验的公网 IP。响应保留 `url/fetched_at/content_hash/content_type` 和 `text` 或 `data`。

wiki 使用已配置的 MediaWiki 公开 API，默认提供 `wikipedia/moegirl`。响应另带站点、标题、署名和许可信息，不自动导入或覆盖目录。上游禁止访问时返回 `public_source_access_denied`；MCP 的 `metafusion_wiki` 复用此接口。

`GET/PUT /api/admin/public-sources` 需要 `catalog.definitions.manage`。配置包含 `enabled/wiki_sites/updated_at`；更新体为 `{"settings":{...},"expected_updated_at":"<读取时的版本时间>"}`。每站可配置 `id/name/api_url/article_url/enabled/license/attribution`，API URL 支持 `{language}`，文章 URL 还支持 `{title}`，用于公开 MediaWiki 站点，不存储来源站密钥。

## 错误处理

| HTTP / error | 含义 |
| --- | --- |
| 401 `authentication_required` | 需要登录 |
| 403 `assistant_forbidden` | 第三方身份或缺少管理权限 |
| 404 `assistant_not_found` | 记录不存在或无权访问 |
| 409 `assistant_request_conflict` | 请求 ID 冲突或请求仍在执行 |
| 409 `assistant_record_in_use` | 服务商或模型仍被关联记录引用 |
| 409 `assistant_generation_context_changed` | 模型调用期间公开事实变化，结果未缓存 |
| 429 `assistant_insufficient_credits` | 可用积分不足 |
| 429 `assistant_budget_exceeded` | 平台或 Provider 月预算不足 |
| 503 `assistant_disabled` | 站点、模型或服务商已停用 |
| 503 `assistant_encryption_unavailable` | 服务端未配置可用加密主密钥 |
| 502 `assistant_upstream_failed` | 模型提供方调用失败 |
| 502 `assistant_invalid_generated_output` | 生成内容未通过输出校验，仍保留实际用量和扣费信息 |
| 504 `assistant_request_timeout` | 同步等待超时 |

问答已执行部分工具后发生的错误可能在 200 响应或请求记录的 `error` 字段中返回，同时保留实际提交与用量；始终读取完整响应再决定恢复方式。目录提交冲突继续使用[工作副本与提交](/api-commits)的规则处理。

## 网页搜索接口

`GET /api/assistant/search/providers` 返回已启用服务的数组（本接口不分页），包含 `id/name/kind/base_url/enabled/is_default/has_key/credits_per_request`。默认服务为免费 DuckDuckGo。DeepSeek 支持官方原生 Search 和 Fetch，管理员启用后可使用平台密钥或本人的自备服务商密钥。`byo_provider_id`（聊天中为 `search_byo_provider_id`）独立于所选模型，省略搜索服务时采用当前默认服务，省略自备服务商时采用平台配置。

`POST /api/assistant/search/:operation（operation=search）`：

```json
{
  "client_request_id": "<本次搜索 UUID>",
  "provider_id": "<可选，省略采用默认服务>",
  "byo_provider_id": "<可选的本人自备服务商 UUID>",
  "query": "官方作品资料",
  "count": 5,
  "need_content": true
}
```

`query` 最多 128 个 Unicode 字符，`count` 默认 5、范围 1–10。`need_content` 供 DeepSeek 返回正文；DuckDuckGo 返回标题、URL 和摘要。响应包含 `results`（`title/url/snippet/summary/content`）和 `credits`。`POST /api/assistant/search/:operation（operation=fetch）` 使用同样的 `client_request_id`、`provider_id`、`byo_provider_id`，请求字段改为 `url`；仅 DeepSeek 支持，返回 `title/content/credits`。普通网页读取继续使用助手的 `public_fetch`。

HTTP 200 且有结果按服务当时费率结算，空结果与明确失败释放预留；不能确认结果时保守记 `unknown`，不重复发起。相同 ID 相同参数的完成/空结果回放，其他封存状态或参数冲突返回 409。自备服务商按所有者校验，平台积分为 0。`GET /api/assistant/search/requests` 分页返回本人搜索用量；搜索按请求计费，独立于模型 token 记录。对话 `credits_spent` 包含该轮搜索与模型费用。

管理需要 `assistant.manage`：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/assistant/admin/search/providers` | 全部搜索服务数组 |
| `POST /api/assistant/admin/search/providers` | 添加服务 |
| `PUT /api/assistant/admin/search/providers/:id` | 更新服务、默认项、密钥和积分费率 |
| `GET /api/assistant/admin/search/requests` | 分页查看搜索结算；可筛 `user_id` |

服务字段：`name/kind/base_url/enabled/is_default/credits_per_request`，`kind` 为 `duckduckgo/deepseek`；可选 `api_key` 更新密钥，省略保留、空串清除。密钥加密保存，只返回掩码。DuckDuckGo 固定公开地址且费用为 0。DeepSeek 官方上游费用单独用人民币微元 `upstream_cost_microcny` 记录，与美元预算分开统计。

## 定时主 Agent 与子 Agent

统一前缀 `/api/curator`，读取需 `assistant.manage`，修改还需 `catalog.review.manage`。第三方 OAuth 身份不可用。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /summary`、`GET /settings`、`PUT /settings` | 状态、月用量与设置 |
| `GET /findings` | 待办及诊断，支持 status/code/kind 与分页 |
| `POST /tasks` | 以 id（UUID）、message、可选 entity_id 封存新维护任务，仅排队 |
| `GET /runs` | 分页运行列表；支持 kind=manager/agent/sweep/quality、parent_run_id；列表省略 messages |
| `GET /runs/:id` | 详细消息、工具结果、状态、费用和提交 |
| `GET /runs/:id/children` | 子 Agent 详细记录数组 |
| `POST /pause`、`POST /resume` | 暂停、恢复；pause 可含 reason |
| `POST /sweep` | 请求确定性扫描 |
| `POST /findings/:id/reopen`、`POST /findings/:id/ignore` | 重新排队、忽略待办 |

原设置字段保留，`execution` 包含：`child_model_id`（空值跟随主模型）、`reasoning_effort`、`child_reasoning_effort`、`search_provider_id`、`search_byo_provider_id`、`max_children`（1–8）、`allow_reviews`、`auto_merge_reviews`。`model_id` 与 `execution.child_model_id` 均可选择站点模型或管理员本人的 `byo_models`，`execution.search_byo_provider_id` 可选择管理员本人的 `byo_providers`。`billing_owner_id` 由服务器自动绑定实际保存配置的管理员，不能手填冒用。`interval_seconds` 是两轮检查间隔，`max_runs_per_hour` 限制子任务数。平台付费调用受 `monthly_credit_allowance` 约束，纯自备模型加免费或自备搜索可设 0 额度。保存设置不覆盖暂停状态。

主 Agent 只在有到期待办时运行，通过受控工具创建 review/research/repair 子 Agent，消息与父子关系持久保存。审核任务独立保存输入 `review_pr_id`，输出结果仍用 `pull_request_id`；同一 PR 的新冻结 head/version 创建新任务。默认 `auto_merge_reviews=false`，显式开启且模型实际读取差异并高置信批准时，服务器才按任务原始 head/version 校验并合入。服务账号自己的 PR 不会由其审核。重启将未完成尝试标为中断并恢复未完成任务，完成任务不重派，已发生的副本提交先回读恢复。
