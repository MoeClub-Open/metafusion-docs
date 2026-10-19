---
title: "AI 助手 API"
description: "模型调用、BYO、积分用量、生成介绍、公开来源与后台管理接口。"
order: 75
group: "api"
---

# AI 助手 API

统一前缀为 `/api/assistant`。公开模型列表与有效共享介绍可匿名读取，其余本人接口需要第一方身份；第三方 OAuth 身份不能访问会话、BYO 凭据、积分或管理接口。后台还需要 `assistant.manage`。AI 工具执行目录编辑时继续校验原有目录权限，不获得第二个服务账号或额外免审资格。

请求为 JSON，拒绝未知字段，请求体上限 1 MiB。列表响应使用 `items/total/limit/offset`；`limit` 默认 50、最大 200，按返回的分页信息继续读取。成功通常返回 200，删除会话、模型、Provider 或凭据成功返回 204。

## 模型、积分与凭据

| 方法与路径 | 用途 |
| --- | --- |
| `GET /models` | 可用模型及输入、输出费率 |
| `GET /account` | 同步一次性赠分与采纳奖励，返回 `balance`、`registration_credits`、`accepted_edit_credits` |
| `GET /credentials` | 本人的 BYO 凭据列表 |
| `POST /credentials` | 新建 BYO 凭据 |
| `PUT /credentials/:id` | 修改本人凭据 |
| `DELETE /credentials/:id` | 删除本人凭据 |
| `GET /usage` | 本人的模型调用用量 |

`balance` 包含 `credits`、`reserved_credits`、`available_credits`。注册赠分按账号唯一；采纳奖励仅同步 `reward_effective_at` 之后已批准或免审且 `applied=true` 的提交，按提交 ID 唯一。历史提交不会在首次访问时全部补发。

创建 BYO：

```json
{
  "name": "我的服务商",
  "base_url": "https://provider.example/v1",
  "upstream_model": "可选的服务商模型名",
  "enabled": true,
  "api_key": "<服务商密钥>"
}
```

接口只返回 `has_key/key_hint`，不回显密钥。更新不传 `api_key` 保留原密钥，传新值替换。凭据只能由其所有者用于调用；管理权限不赋予代用他人密钥的能力。可选 `upstream_model` 覆盖所选模型的上游名称，空值沿用站点模型配置；仍受所选模型的上下文与输出 token 上限约束。

Provider 和 BYO 凭据共用 `protocol` 字段，默认 `openai_compatible`：

| protocol | 路径 | 认证 |
| --- | --- | --- |
| `openai_compatible` | `/chat/completions` | `Authorization: Bearer` |
| `openai_responses` | `/responses` | `Authorization: Bearer` |
| `anthropic_messages` | `/messages` | `x-api-key` 和固定 `anthropic-version` |
| `gemini_generate_content` | `/models/{model}:generateContent` | `x-goog-api-key` |

`base_url` 包含版本前缀，见[接入示例](/assistant)。请求非流式，工具声明、调用及结果按所选格式转换，不通过失败重试探测格式。Responses 使用 `store=false`；返回的推理项、Claude 签名块及 Gemini thought signature 保存在本人会话的 `provider_context`，只回传到相同端点、凭据密钥和模型，不向其他连接传递。前端只展示可见回答，不展示这些协议元数据。

用量统一为 `input_tokens/output_tokens/cached_input_tokens`：Anthropic 输入包括普通输入、缓存读取和缓存创建；Gemini 输出包括候选输出与思考 token；Responses 使用其 input/output 及缓存输入字段。缺失 usage 不视为免费成功，沿用既有不重复调用与估算结算规则。

## 问答与修改

`POST /chat`：

```json
{
  "client_request_id": "<本次请求的 UUID>",
  "message": "查询这个发行版的发行主体和收录内容",
  "model_id": "<站点模型 UUID>",
  "credential_id": "<可选的本人 BYO UUID>",
  "conversation_id": "<可选的已有会话 UUID>"
}
```

新会话省略 `conversation_id`；省略 `model_id` 时使用会话或站点默认模型。省略 `credential_id` 时沿用会话的凭据，显式传 `"credential_id":""` 切回积分计费。`message` 必须为非空 UTF-8，最多 32768 字节。

返回 `conversation_id`、`answer`、累计 `usage`、`credits_spent`、`balance`，以及可选 `tool_results`、`commit_receipts`、`error`。工具可读取定义、实体、身份候选、关系、工作副本和公开来源，修改统一在服务器工作副本中 stage、commit、push。普通账号发起 PR，免审账号可直接合入；不要求来源池、source_refs 或查证记录。不提供任意 SQL、任意身份或绕过审核参数。

一次请求总执行时间最多 150 秒，工具轮数由站点配置为 1–12，每轮最多 8 次工具调用。达到限制或后续上游失败时，响应仍保留已经发生的提交回执和用量，调用方必须同时检查 `error` 与 `commit_receipts`，不能把整轮当作未写入。

`client_request_id` 封存原请求。同 ID、同载荷的已完成请求回放原结果，不重复调用或提交；进行中的请求、不同载荷或其他账号复用该 ID 返回 `409 assistant_request_conflict`。断线后使用原 ID 与原载荷恢复，勿立即换 ID 重发修改。

会话接口：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /conversations` | 本人会话列表，列表不带完整消息 |
| `POST /conversations` | 创建空会话，字段为 `title/model_id/credential_id` |
| `GET /conversations/:id` | 本人会话与消息 |
| `DELETE /conversations/:id` | 删除未在执行中的本人会话 |

## Token、价格与预算

`POST /context` 免费预览下一轮上下文，使用本人登录身份。请求为必填 `model_id`，以及可选 `conversation_id`、`message`（未发送草稿，最多 32768 个 UTF-8 字节）。会话只能属于本人；响应包含 `input_tokens_bound`、`context_window`、`max_output_tokens`、`message_count`、`tool_count`、`estimated=true`。输入上界包含最新系统提示、已保存消息、草稿、工具定义及协议开销，与实际调用的上限判据共用实现；这不是供应商返回的 token 用量，也不是历史调用的累计数。预览不保存草稿、不调用模型、不预留或消耗积分。

`usage` 包含 `input_tokens`、`output_tokens`、`cached_input_tokens`，缓存输入是输入总量的一部分，不能再相加作为总 token。用量记录保存 `price_snapshot`、`credits`、`cost_microusd`、`status`、`usage_estimated` 与结算时间，之后修改模型费率不改写历史结算。

平台价格为每百万 token 的微美元整数：`1000000 microusd = 1 USD`。分别配置 `input_price_microusd_per_million`、`cached_input_price_microusd_per_million`、`output_price_microusd_per_million`。用户积分独立配置 `input_credits_per_million`、`output_credits_per_million`，各项按 `ceil(tokens × rate / 1000000)` 计算。

调用前按输入上界与最大输出预留积分及预算，完成后按上游 usage 结算。全局和 Provider 月预算同时检查“已花费 + 已预留”，`monthly_budget_microusd=0` 表示不设上限；按 UTC 自然月计数。BYO 的平台积分和成本记为 0，保留 token 记录，第三方账单不由本站结算。

上游超时、中断或进程退出后无法确认用量时，按预留上界保守结算，标记 `status=unknown`、`usage_estimated=true`。它不是成功响应或精确计量。服务每分钟回收超过 10 分钟的遗留预留；若上游可能已调用，仍按此规则保守结算，不作为免费失败。明确拒绝请求的上游 4xx 可零扣，不自动重试网络请求。

## 生成介绍与缓存

| 方法与路径 | 用途 |
| --- | --- |
| `GET /generated/:entity_id?locale=zh-CN` | 读取当前有效缓存，不调用模型 |
| `POST /generated/:entity_id` | 已登录用户生成介绍，优先复用缓存 |

POST 字段：`locale`、`model_id`、`credential_id`、`client_request_id`、`regenerate`。支持 `zh-CN/zh-TW/en-US/ja-JP`，默认 `zh-CN`；`regenerate=true` 强制重新生成并消耗额度。建议固定本次 `client_request_id`，避免重试重复发起上游调用；已发起付费生成的同 ID 请求返回 409，不再次调用提供方，先用 GET 检查是否已有有效缓存。

GET 返回 `{"item":null,"stale":false}` 表示未生成；指纹变化返回 `{"item":null,"stale":true}`。有效结果包含 `item`；POST 新生成还返回 `usage/credits_spent/balance`，命中缓存时 `credits_spent=0`。

`item` 保留 `entity_id/locale/model_id/context_hash/entity_version/definitions_etag`、生成时间、`usage`、`sources` 与 `blocks`。每条 source 包含 `entity_id/title/url/version`。块的 `type` 为 `markdown/table/timeline/chart`：

- `markdown` 使用 `markdown` 字段提供说明。
- `table` 使用 `columns` 与 `rows`。
- `timeline` 使用 `events`，日期保留原始精度。
- `chart` 使用 `chart_type/labels/series`，数值由服务端从结构化事实计算。

`partial/partial_reasons` 标记受数量或大小上限限制的资料范围。生成始终按匿名可见性读取实体、关系和引用，不能将管理员可读的隐藏资料写入共享缓存。指纹涵盖公开事实、相关实体版本、关系、定义、语言、输出规则及模型配置；生成期间事实变化则拒绝发布该旧快照。平台额度缓存共享，BYO 缓存按所有者隔离，读取时优先使用本人缓存。人工正文与结构化事实不受生成操作改写。

## 后台管理

后台页面入口为 `/admin#assistant`。以下路径均相对 `/api/assistant/admin/` 前缀，需要 `assistant.manage`：

| 路径 | 支持方法与内容 |
| --- | --- |
| `/settings` | GET、PUT：启用、默认模型、赠分、奖励生效时间、全局月预算、工具轮数 |
| `/providers`、`/providers/:id` | GET 列表、POST 新建、PUT 修改、DELETE 删除 |
| `/models`、`/models/:id` | GET 列表、POST 新建、PUT 修改、DELETE 删除 |
| `/credentials`、`/credentials/:id` | GET 跨用户 BYO 列表、PUT 修改、DELETE 删除 |
| `/accounts`、`/accounts/:user_id/adjust` | GET 账户、POST 带原因调整积分 |
| `/ledger`、`/usage`、`/budgets` | GET 积分流水、调用用量和各月预算 |
| `/conversations`、`/conversations/:id` | GET 列表或详情、DELETE 删除会话 |
| `/requests`、`/requests/:id`、`/requests/:id/cancel` | GET 封存请求列表或详情、POST 结束遗留 pending 请求 |
| `/generated`、`/generated/:id` | GET 缓存列表、DELETE 删除指定缓存 |

BYO、用量、流水和会话列表可用 `user_id` 筛选；生成缓存列表用 `entity_id/owner_id`。Provider 管理名称、HTTPS 根地址、协议、密钥、启用状态与独立预算；Model 通过 `provider_id` 关联，管理 `upstream_model`、显示名、价格、积分费率、`max_output_tokens` 和 `context_window`。`max_tokens_parameter` 可设为 `max_tokens`（默认）或 `max_completion_tokens`，按上游协议选择输出上限的请求字段。有关联记录时删除可能返回 `409 assistant_record_in_use`，可以先停用。

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
| 409 `assistant_generation_context_changed` | 模型调用期间公开事实变化，结果未缓存 |
| 429 `assistant_insufficient_credits` | 可用积分不足 |
| 429 `assistant_budget_exceeded` | 平台或 Provider 月预算不足 |
| 503 `assistant_disabled` | 站点、模型或 Provider 已停用 |
| 503 `assistant_encryption_unavailable` | 服务端未配置可用加密主密钥 |
| 502 `assistant_upstream_failed` | 模型提供方调用失败 |
| 502 `assistant_invalid_generated_output` | 生成内容未通过输出校验，仍保留实际用量和扣费信息 |
| 504 `assistant_request_timeout` | 执行超时 |

问答已执行部分工具后发生的错误可能在 200 响应的 `error` 字段中返回，同时保留实际提交与用量；始终读取完整响应再决定恢复方式。目录提交冲突继续使用[工作副本与提交](/api-commits)的规则处理。
