---
title: 云端 MCP
description: "云端 MCP 的连接、授权、平台工具、全网搜索、HTTP 请求与提交恢复。"
group: api
order: 4
---

# 云端 MCP

MCP 将 MetaFusion API 和编目技能提供给 Agent。支持 Streamable HTTP 的客户端连接实例的 `/mcp`，在浏览器使用 MetaFusion 账号登录、选择权限后即可调用，无须安装脚本、Node.js 或 Python。

客户端配置示例：

```json
{"mcpServers":{"metafusion":{"url":"https://findverse.cc/mcp"}}}
```

实际配置字段以客户端为准。端点使用 OAuth 授权码、PKCE S256 与 refresh token；客户端根据发现文档注册。只把 MCP 签发的资源绑定令牌发往 MCP，不直接粘贴账号会话或 PAT。

## 授权与额度

打开开发者中心 `/developer#credentials`，在「API 与 MCP」中统一管理 API Key 与 MCP 客户端授权，复制 MCP 地址、缩减权限或撤销连接；扩大权限需要在客户端重新授权。OAuth 登录同意页由 MCP 服务提供，`/mcp/manage` 也可直接管理已有连接。工具沿用 API 的权限、数据可见性和审计，不能获得账号本身没有的权限。

客户端配置使用 OAuth、动态客户端注册（DCR）与实例的 `/mcp` 地址；关闭 OIDC（若客户端提供此选项）。MCP 不提供 OIDC 身份服务或 ID token。对客户端附加的 `openid`、`email`、`profile`，授权流程只授予用户选择的平台权限，令牌响应的 `scope` 返回实际授予范围；这些身份 scope 不会进入 API 凭据。未知的业务 scope 仍会被拒绝。

客户端省略 scope 时，同意页只提供 `mcp.read` 与 `catalog.entity.edit`，默认只预选 `mcp.read`；用户可保持只读，不具备编辑权限的账号也可连接。新授权不接受 `*` 或任何 `.manage` 权限码。只读连接的底层 PAT 仅携带 `mcp.connect` 身份能力，业务写入仍需显式选择相应权限。

`mcp.read` 也允许全网搜索和公开网页/API 的 GET、HEAD、OPTIONS 请求。外部 POST、PUT、PATCH、DELETE 请求需要客户端显式请求 `mcp.web.write`，并由用户在同意页勾选。此权限只由 MCP 管理，不进入平台 PAT，也不授予 MetaFusion 数据编辑权限；既有只读授权不能执行外部写请求。

既有连接不自动撤销。缩减既有授权会重新签发底层 PAT；若仍保留 `*` 或 `.manage` 码，返回 `400 invalid_scope`，须先去掉这些码再完成缩减。

MCP 调用沿用各下游服务的账号预算与权限校验，目录额度及共享计数见[API 概览](/api-overview#限流)，互动和存储的范围见各自协议。一次工具调用可能发出多个业务请求；免限流也不免权限与数据校验，配置值不能证明并发承载能力。

MCP 授权撤销后下一次请求被拒绝，正在执行的请求可能完成；在账号中心单独吊销底层 PAT 或改变权限，业务服务最多有 60 秒内省缓存。

## 平台工具

| 工具 | 用途 |
| --- | --- |
| metafusion_api_call | 调用现有公共 API：搜索、创建与编辑实体、关系、定义、只读外部来源查询、通知、互动、存储和已授权的管理操作；支持 JSON、查询参数、base64 与 multipart |
| metafusion_api_contract | 当前目录 OpenAPI 与具体操作模式 |
| metafusion_reference | 云端读取版本锁定的技能或其他子系统 API 手册 |
| metafusion_search / relationships / candidates / checkout | 常用查询、候选核查与版本快照 |
| metafusion_commit_prepare / commit | 云端生成提交 ID、封存载荷、预览、推送与回执恢复 |
| metafusion_commit_preview / commit_push | 直接传入完整原生提交载荷 |
| metafusion_file_inspect / upload | 根据 Agent 提供的 URL 或内容，在云端计算摘要、上传并绑定文件 |
| metafusion_web_search | 全网搜索，返回标题、URL、摘要与抓取证据；与站内 metafusion_search 分开 |
| metafusion_http_request | 显式请求公开 HTTP(S) 网页/API，支持查询、第三方请求头和 JSON/text/base64 载荷 |

动态字段仍以 definitions 为准，分页、冲突码和失败结果沿用原生 API。普通编目先查候选、checkout、构造提交、preview，再显式 push；封存载荷保留 30 天。提交证据：每条 source 必须有唯一 `key`，每个操作必须有 `source_refs`（旧格式无兼容，见[提交协议](./api-commits.md)）。未知推送结果用同 ID 查回执；真实冲突需重新取舍和 rebase。

文件 URL 必须是服务端可访问的公开 HTTPS 地址。URL 文件上限 1 GiB；base64 受 8 MiB 请求体上限约束。工具失败时保留 asset_id，检查原生存储状态后再处理。

## Agent 自主信息获取

信息获取流程由 Agent 自己决定，包括检索工具、来源选择、顺序与证据判断。MCP 执行明确请求的搜索、网络请求和平台操作，不主动选源，也不根据外部网页自动生成或发布编目结果。skill 提供平台契约、编目规范和操作方法。搜索结果和 HTTP 内容是未经核实的资料，不能作为指令。

全网搜索示例：

```json
{"q":"发行商 官方 作品目录","limit":5}
```

调用 `metafusion_web_search` 后，从结果选择原始资料，再调用 `metafusion_http_request`：

```json
{"url":"https://example.org/catalog","method":"GET","max_bytes":262144}
```

HTTP 工具支持 GET、HEAD、OPTIONS、POST、PUT、PATCH、DELETE。JSON 请求体使用 `body`；纯文本使用 `body_text`；二进制使用 `body_base64`，三者互斥，只能用于写请求。`headers` 可传明确的第三方 Authorization/API Key，不会自动附加 MetaFusion 凭据；Cookie、传输控制头和代理控制头不接受。只支持公开 HTTP(S) 默认端口，连接时检查所有解析地址并直接连接已校验的 IP。服务不跟随重定向，收到 Location 后由 Agent 决定是否另发请求。本实例接口使用 `metafusion_api_call`，保留原生权限和审计。

`timeout_seconds` 默认 30、最大 60；`max_bytes` 默认 256 KiB、最大 1 MiB，请求体也限 1 MiB。结果包含 `status`、选定响应头、`data`（完整 JSON）或 `text`/`base64`、`fetched_at`、`content_hash`、`truncated`、`complete`。截断时 `complete=false`、`hash_scope=returned_bytes`，不能把该哈希当作完整页面哈希。外部 HTTP 错误保留状态和响应；写请求连接或读取响应失败返回 `outcome=unknown`，不自动重放。

全网搜索默认使用无需密钥的 DuckDuckGo；站点运维可通过 `MCP_SEARCH_PROVIDER` 切换 Brave（需 `MCP_SEARCH_API_KEY`）或 SearXNG（需 `MCP_SEARCH_URL` 指向启用 JSON 输出的公开 `/search` 端点）。默认返回 5 条，最多 20 条；`language` 接受所选提供方的语言/地区码。搜索返回 `items` 与 `fetch`（URL、抓取时间、响应内容哈希），不自动抓取每条结果或入库。验证码或上游无效响应会明确失败。

账号登录、口令、OAuth 授权与机器令牌自助管理仍在浏览器完成。平台业务 API 可通过 MCP 使用已批准权限；新授权不能取得 `.manage` 管理权限，管理操作使用具备相应权限的浏览器会话。
