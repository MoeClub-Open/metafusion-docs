---
title: "实体模型与字段"
description: "八类实体的公共字段、固定归属、收录与动态关系。"
order: 20
group: "model"
---

# 实体模型与字段

MetaFusion 借用 IFLA LRM 的分层思想，并以八类固定实体、收录结构和动态定义实现目录。建模示例见[元数据目录教程](/catalog)，本页用于查字段和约束。

## 概念与实现

| 概念 | kind | 主分类 / 核心标识字段 | 保存的事实 |
| --- | --- | --- | --- |
| 责任主体 | `agent` | `attributes.agent_type` | 个人、团体、机构或虚构角色身份 |
| 集合与企划 | `collection` | `attributes.collection_type` | 跨媒体企划、作品系列、选集或活动特辑 |
| 作品 | `work` | `attributes.creation_form` | 独立创作身份 |
| 内容单元 | `content_unit` | `attributes.entry_role` | 同作品内的稳定篇目与目录 |
| 具体表达 | `expression` | `attributes.version_label` | 录音、正文、译本或剪辑 |
| 发行 | `release` | `attributes.edition_type` 等正交维度 | 公开出版或发布记录 |
| 载体 | `medium` | `attributes.format` | 同发行内的承载单元 |
| 收录位置 | `track` | `attributes.role` + `contents[]` | 同载体内的位置与实际收录 |

文件资产由存储服务管理。目录引用表达与定位，文件绑定引用条目身份。

## 公共字段

| 字段 | 说明 |
| --- | --- |
| `id` / `kind` | UUID 与固定种类 |
| `version` / `state` | 乐观锁版本与生命周期（active / deleted / merged） |
| `review_status` | 已生效条目只读审核标记 reviewed；待合并状态属于 PR |
| `title` / `original_language` | 基础题名与原始语言 |
| `translations` | 按语言标签分组的对象，各项含 `title`、可选 `nonofficial`（仅非原始语种可标记非官方译名）、简短纯文本 `summary`、Markdown 条目正文 `body`、`aliases` 与 `nonofficial_aliases`；正文与实体共同修订 |
| `attributes` | 动态属性，允许键及适用种类由 definitions 决定 |
| `external_links` | 外部权威链接数组（kind/url/可选 external_id 与 role） |
| `pictures` | 有序图片引用及来源；首项为封面，时间信息不改变顺序 |
| `medium_formats` | 仅 `release` 读取响应附带的只读投影，按活动子 `medium` 聚合各 `format` 词条数量，不落库 |
| `created_by` / `created_at` / `updated_at` | 创建者与时间 |
| `redirect_id` | 合并后的目标，由生命周期操作维护 |

图片可以记录多语言说明、用途、版本名称、使用期与存储资产 ID。字段与数量校验见[图片与自托管封面](/api-edit#图片与自托管封面)，完整形状以目标实例的 OpenAPI 为准。

动态属性的可写范围由 `fields.<code>.applicable_kinds` 声明；空集合表示只用于关系或内嵌结构。标签不会扩大字段权限。动态定义规则见[动态定义与配置](/api-definitions)。

## 主分类字段与种子词表

站点管理员可在 `definitions` 中扩展字段、词表与关系，运行时以 `GET /api/catalog/definitions` 为准；下表列出平台基准种子定义。详情页标题栏紧邻实体 `kind` 徽章并列展示主分类徽章（`work.creation_form`、`agent.agent_type`、`collection.collection_type`、`release.edition_type`、`medium.format`、`content_unit.entry_role`）。

### 八类实体分类与核心字段

| kind | 字段与类型 | 基准词项 / 取值 |
| --- | --- | --- |
| `agent` | `attributes.agent_type`（enum `agent_type`） | `person`（个人）、`group`（团体 / 组合）、`organization`（机构 / 公司）、`character`（虚构角色） |
| `collection` | `attributes.collection_type`（enum `collection_type`） | `franchise`（跨媒体企划）、`series`（作品系列）、`anthology`（选集 / 丛书）、`event_catalog`（展会 / 活动特辑） |
| `work` | `attributes.creation_form`（enum `creation_form`） | 见下表 `creation_form` 词项 |
| `content_unit` | `attributes.entry_role`（enum `entry_role`） | `main`（本篇）、`opening`（片头曲）、`ending`（片尾曲）、`trailer`（预告 / 宣传）、`extra`（其它附加）、`other`（其它） |
| `expression` | `attributes.version_label`（text）、`isrc`、`duration`、`language` | `version_label` 为自由文本（如录音室版、现场版、伴奏、导演剪辑） |
| `release` | 独立正交枚举维度 + `attributes.publisher`（`entity -> agent`） | `edition_type`：`standard`（普通版）、`limited`（限定版）、`deluxe`（豪华版）、`boxset`（套盒）<br>`edition_batch`：`regular`（通常发行）、`first_press`（初回发行）、`reissue`（再版 / 重发）、`reprint`（重印）<br>`distribution_channel`：`mixed`（混合）、`physical`（实体）、`digital`（数字）、`web`（网络配信）<br>`packaging`：`standard`（标准包装）、`jewel`（Jewel Case）、`slipcase`（腰封 / 外封套）、`box`（盒装）、`boxset`（套盒）、`digipak`（Digipak） |
| `medium` | `attributes.format`（enum `format`）+ `attributes.role` | `format`：`cd`、`bd`、`uhd_bd`、`dvd`、`vinyl`、`sacd`、`cassette`、`paper`、`digital`、`web` |
| `track` | `attributes.role` + `Track.contents[]` | `role` 取内容用途词表，实际收录表达写入 `contents[]` |

### 作品形态 `creation_form` 词表

| 媒介分组 | 基准词项 |
| --- | --- |
| 音乐 | `song`（歌曲——单首乐曲作品，仅作曲目收录时不填 `original_album`）、`single`（单曲）、`ep`（迷你专辑 / EP）、`original_album`（原创专辑）、`doujin_album`（同人专辑）、`soundtrack`（原声集）、`compilation_album`（精选集 / 合辑） |
| 动画 | `tv_anime`（TV动画）、`theater_anime`（剧场动画）、`ova`（OVA）、`ona`（Web动画） |
| 图书 / 画集 | `manga_serialized`（连载漫画）、`manga_volume`（漫画单行本）、`light_novel`（轻小说）、`novel_general`（一般小说）、`artbook`（画集 / 设定集）、`photobook`（写真集） |
| 游戏 | `visual_novel`（视觉小说）、`eroge`（美少女游戏）、`indie_game`（独立游戏）、`commercial_game`（商业游戏） |
| 音声 | `audio_drama`（音声作品）、`radio_drama`（广播剧） |
| 影视 / 视频 / 其他 | `film`（电影）、`tv_drama`（电视剧）、`music_video`（音乐视频）、`personal`（个人创作） |
| 宽泛兜底码 | `music`、`literature`、`screen`、`photography`、`game` |

### 角色、用途与图片词表

| 词表 / 字段 | 适用位置 | 基准词项 / 规则 |
| --- | --- | --- |
| `release_role` | `Release.subjects[].role` | `primary`（主作品）、`track_work`（曲目作品）、`compilation`（汇编作品）、`supplement`（附加作品） |
| `role` | `Medium` / `Track` / 关系属性 | `primary`（主要内容）、`supplement`（附加内容）、`side`（唱片面）、`extra`（额外收录）、`commentary`（解说音轨） |
| `character_rank` | 关系属性（角色番位） | `main`（主角）、`supporting`（配角）、`guest`（客串 / 单集登场）、`ensemble`（群像）、`narrator`（旁白）、`cameo`（彩蛋登场） |
| `picture_role` | `pictures[].role`（首项恒为封面） | `key_visual`（主视觉）、`cover_art`（封面图）、`back_cover`（封底）、`booklet`（手册内页）、`disc_art`（盘面 / 载体图）、`obi`（侧标 / 腰封）、`packaging`（包装实拍）、`poster`（海报）、`character_portrait`（角色立绘）、`person_portrait`（人物肖像）、`logo`（标识）、`scene_still`（剧照 / 场景图）、`event_photo`（活动现场）、`scan`（内页扫描）、`screenshot`（界面截图） |
| `credit_role` | 关系属性（自由文本） | 保存来源中的原始职衔文本（如 `アニメーション制作`、`シリーズ構成`、`Vo. & Gt.`），仅作修饰，绝不替代专用关系码 |

## 固定归属

| 字段 | 使用位置 | 约束 |
| --- | --- | --- |
| `work_id` | content_unit、expression | 必填 |
| `content_unit_id` | expression | 可选，须与表达同属一个 Work |
| `release_id` | medium | 必填 |
| `medium_id` | track | 必填 |
| `parent_id` | content_unit、medium、track | 可选，同层且同归属、无环 |
| `position` / `number` | 目录或位置项 | 非负排序整数 / 来源中的原始编号 |

`kind`、`work_id`、`release_id` 和 `medium_id` 写入后不能改归属；违反时返回 `immutable_scope`。同层父子受对应 Work、Release 或 Medium 的范围约束。

写入实体引用须使用小写、带连字符的规范 UUID；结构引用与 definitions 声明的实体属性引用都受此约束，详见[实体引用格式](/api-edit#实体引用格式)。

## 发行对象与实际收录

Release 没有 `work_id`，通过 `subjects[]` 声明收录了哪些作品：

```json
{"work_id": "<work_uuid>", "role": "primary", "position": 0, "attributes": {}}
```

`role` 使用 definitions 中 `release_role` 词表的当前启用词项；`primary`（主作品）、`track_work`（曲目作品）、`compilation`（汇编作品）、`supplement`（附加作品）是种子示例，不是封闭枚举。同一作品同一角色只保留一项；正常收录的曲目不因缺少词项而标为特典。

Track 的 `contents[]` 是实际收录的权威来源：

```json
{
  "expression_id": "<expression_uuid>",
  "position": 0,
  "locator": {},
  "attributes": {},
  "sources": [{"kind": "publication", "citation": "内页曲目表"}]
}
```

可以跨 Work 收录，但对应 Work 必须列入所属 Release 的 `subjects`。Track 的位置表示载体曲序，contents 的位置表示同一 Track 内多段内容的次序。

`locator` 与附加属性按 definitions 的组字段及场景方案校验。定位仅属于这次收录，不随 Expression 在不同发行之间复制。

收录 `sources` 可省略；修改时保留未编辑收录与历史来源。单条收录在[工作副本中编辑](/api-edit#编辑实体与收录)。

## 关系

语义关系记录来源端、目标端、关系码、位置及上下文属性。关系码、允许端点与约束由 `definitions.relations` 声明（站点管理员可扩展），下表列出 32 条平台基准种子语义关系。

固定外键、`subjects`、`contents` 以及 `definitions` 声明的实体属性引用（支持嵌套 `group` / `list`）由各自拥有者维护；统一查询把结构、语义关系与属性引用投影为可遍历链接（全部规则见 `definitions.relationship_rules`），不重复存边。查询接口见[实体查询与详情](/api-entities)。

### 署名组 `credits`（17 条，`counts_as_credit=true`）

署名边界硬规：`created_by` **仅限原作者、原案、著作人**，严禁用于动画公司、社团、游戏厂商或厂牌；制作公司、委员会、制片人、同人社团、游戏厂商使用 `produced_by`（发行版出版/发行商优先填 `Release.attributes.publisher`）；`credit_for` 仅在其余 16 条专用关系均不适用时作兜底，必须填 `credit_role` 原文，严禁与专用署名关系对同一职责重复建边。

| 关系码 | 正向 ↔ 反向名称 | `source_kinds -> target_kinds` | 适用边界与属性约定 |
| --- | --- | --- | --- |
| `created_by` | 原作 / 作者 ↔ 原作 / 著作 | `work\|content_unit\|expression\|release -> agent` | **仅限原作者、原案、著作人**；严禁用于动画制作公司、同人社团、游戏厂商或唱片厂牌 |
| `produced_by` | 制作 / 出品 ↔ 制作了 | `work\|content_unit\|expression\|release -> agent` | 动画制作公司（`アニメーション制作`）、出品/制作委员会、制片人（`プロデューサー`）、音乐制作人、同人社团（`サークル`）、游戏品牌/厂商（`メーカー`）；原始职衔写 `credit_role`；发行版出版/发行商优先写 `Release.attributes.publisher` |
| `directed_by` | 导演 ↔ 执导了 | `work\|content_unit\|expression -> agent` | 总导演、导演/监督、系列导演；分集演出无专用码时走 `credit_for` |
| `written_by` | 编剧 ↔ 编写了 | `work\|content_unit\|expression -> agent` | 系列构成、脚本、剧本 |
| `composed_by` | 作曲者 ↔ 作曲了 | `work\|content_unit\|expression -> agent` | 作曲、剧伴音乐作曲 |
| `lyricist_of` | 作词者 ↔ 作词了 | `work\|content_unit\|expression -> agent` | 作词 |
| `arranged_by` | 编曲者 ↔ 编曲了 | `work\|content_unit\|expression -> agent` | 编曲；通常落歌曲 `expression`，仅作品级来源明确时落 `work` |
| `performed_by` | 表演者 ↔ 表演了 | `work\|content_unit\|expression\|release -> agent` | 演唱、演奏、乐队/组合表演；团体已知成员时，个人与团体用 `member_of` 关联（乐器/声部写 `credit_role`） |
| `voiced_by` | 配音者 ↔ 配音于 | `work\|content_unit\|expression\|release\|agent -> agent` | 声优/配音；在作品/表达上带 `attributes.character` 与 `language`，也可在角色 `agent -> cv agent` 上记录固定声优 |
| `character_in` | 角色登场 ↔ 登场角色 | `agent -> work\|collection` | `participant_slot=character`；虚构角色登场，番位写 `character_rank` |
| `illustrated_by` | 插画者 ↔ 绘制了 | `work\|content_unit\|expression\|release -> agent` | 插画、角色原案、封面绘制、原画设计 |
| `developed_by` | 开发者 ↔ 开发了 | `work\|content_unit\|expression\|release -> agent` | 游戏/软件开发团队或程序开发 |
| `photographed_by` | 摄影者 ↔ 拍摄了 | `work\|content_unit\|expression\|release -> agent` | 写真摄影、影像摄影监督 |
| `modeled_by` | 出镜者 ↔ 出镜于 | `work\|content_unit\|expression\|release -> agent` | 写真模特、真人出镜演员 |
| `narrated_by` | 朗读 / 旁白 ↔ 朗读了 | `work\|content_unit\|expression\|release -> agent` | 有声书朗读、旁白 |
| `translated_by` | 译者 ↔ 翻译了 | `work\|content_unit\|expression\|release -> agent` | 文本或字幕翻译 |
| `credit_for` | 参与主体 ↔ 参与记录 | `work\|content_unit\|expression\|release -> agent` | **兜底署名**：仅以上 16 条均不适用时使用（音响监督、美术监督、色彩设计、剪辑、分镜、单集演出、录音/混音工程等），必填 `credit_role` 原文；严禁与专用关系重复建边 |

### 创作关系组 `creative`（9 条，`acyclic=true`，`participant_slot=peer`）

| 关系码 | 正向 ↔ 反向名称 | `source_kinds -> target_kinds` |
| --- | --- | --- |
| `adaptation_of` | 改编自 ↔ 被改编为 | `work -> work` |
| `sequel_of` | 续作于 ↔ 作为前作 | `work -> work` |
| `spin_off_of` | 外传自 ↔ 衍生出 | `work -> work` |
| `soundtrack_of` | 配乐用于 ↔ 配乐作品 | `work -> work` |
| `translation_of` | 翻译自 ↔ 被翻译为 | `expression -> expression` |
| `revision_of` | 修订自 ↔ 被修订为 | `expression -> expression` |
| `cover_of` | 翻唱自 ↔ 被翻唱为 | `expression -> expression` |
| `alternate_take_of` | 别版取自 ↔ 被用作别版 | `expression -> expression` |
| `pressing_of` | 再版自 ↔ 被再版为 | `release -> release` |

### 组成与成员组 `membership`（6 条）

| 关系码 | 正向 ↔ 反向名称 | `source_kinds -> target_kinds` | 约束与用途 |
| --- | --- | --- | --- |
| `includes` | 组成包含 ↔ 组成属于 | `collection\|work -> work\|collection` | `aggregate=true`、`acyclic=true`；企划/系列收录各季动画、游戏、漫画、音乐作品，或专辑 Work 包含曲目 Work |
| `member_of` | 所属团体 ↔ 成员 | `agent -> agent` | `acyclic=true`；个人成员指向乐队/组合/社团，担当位置写 `credit_role`，在籍期写 `begin_date` / `end_date` |
| `expression_part` | 表达包含 ↔ 所属整体表达 | `expression -> expression` | `usage=expression_composition`、`scope=work`、`aggregate=true`、`unique_position=true`、`acyclic=true` |
| `edition_of` | 发行组归属 ↔ 发行版本 | `release -> work\|collection` | `usage=release_group`、`max_outgoing=1` |
| `bonus_included_in` | 特典收录于 ↔ 收录特典 | `expression -> release\|medium` | `acyclic=true` |
| `store_bonus_for` | 渠道特典归属 ↔ 拥有渠道特典 | `expression\|release -> agent` | `participant_slot=person`、`acyclic=true` |

## 状态与修订

生命周期 `state` 只有 `active`、`deleted`、`merged`，没有草稿或发布状态。正常条目至少有一条语言资料，`review_status=reviewed` 为只读标记。工作副本和 commit 不改变当前条目；普通账号 push 发起 PR，免审账号 push 可直接合入，见[工作副本与提交](/api-commits)。可见性见[API 概览](/api-overview)。

正式合入保留作者、修改说明与修订快照；来源可省略。实体身份合并与退役通过专用生命周期入口执行；载荷与错误处理见[新建与编辑](/api-edit)。
