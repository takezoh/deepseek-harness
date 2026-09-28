# Agent Note: Adopt the Shiguredo fork's Japanese UI, font setting, git-branch chip, and flat workspace label

Status: proposed

[English](2026-09-28-adopt-shiguredo-fork-features.md) | 中文

## Problem

本仓库是 `deepseek-ai/deepseek-harness` 的 fork，在上游 0.1.6-alpha.2 版本（commit `ddefc45fbc`，PR #4469）之上带有两个本地文档 commit；而下游的 Shiguredo fork（`shiguredo/deepseek-harness`）已经把四项日文优先的改进 rebase 到上游 master，并作为一个 commit 发布：

- `5539e6f1cb` *日本語ロケールとフォント設定とブランチチップをプラグインとして追加する*。

这四项功能分别是 `ja` 语言包、用户可选的字体族、Host 侧 git checkout 解析与 composer 的 git 分支 chip，以及扁平 Session 行上显示所属 Workspace 的标签。本 fork 目前一项都没有，而[跨 Provider 可持续 Subagent 提案](2026-09-18-cross-provider-continuable-subagents.zh.md)只是把 Shiguredo fork 列为次要集成来源，并未给出取其成果的计划。

Shiguredo commit 的父 commit 是上游 master `21638c5631`（PR #5282），因此其改动假定的是 0.1.7 系列：语言包注册、`Config` 加配置表单的设置模型、composer 会话统计行的 lead 座位，以及当前的 `ui-workspace` 投影。若不先移动本 fork 的 base 就直接取这些功能，每个插件都必须针对 0.1.6 的 seam 重新实现，并且会立刻偏离 Shiguredo notes 所记录的上游设计。

## Proposal

### Base 更新

通过把 `upstream/master` 合并进本 fork 的 `master`，将其推进到上游 master `21638c5631`，同时保留两个本地 Agent Note 文档 commit（`b34806a627`、`b73c981368`）。合并后的 base 与 Shiguredo 功能 commit 的编写基准是同一 revision，因此功能可以无需兼容性改写地落地。

本 fork 的 remote 为：

```text
origin      takezoh/deepseek-harness
upstream    deepseek-ai/deepseek-harness
shiguredo   shiguredo/deepseek-harness
```

### 功能采纳

在更新后的 base 上把 Shiguredo 功能 commit 作为一个变更应用，保留它的三份 implemented Agent Note 与包结构。四个插件如下：

- `@deepseek-ai/dsh-client-locale-ja`（`packages/client/locale-ja`）通过 `ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })` 注册 `ja`，并为每个已发布 namespace 提供一个带类型的 `LocaleDictOf<'ns'>` 日文词典。它以语言包形式发布，而不是第三个内置 locale。
- `@deepseek-ai/dsh-client-ui-font-family`（`packages/client/ui-font-family`）拥有 `ui-font-family` Host 配置项、`--dsw-font-family` 与 `--ds-font-family-code` 两个 body 变量、General 设置里的 Font 行，以及在 reload 后首帧就应用已存字体族的 index bootstrap。没有已存字体族时，随包发布的 theme 字体栈保持为默认。
- `@deepseek-ai/dsh-api-workspace-git`（`packages/api/workspace-git`）在 Session 作用域的 workspace lookup 之上拥有 `workspaceGit` Remote namespace，并通过 `ctx.subprocess` 调用 `git` 返回 `branch`/`detached`/`none`，用可配置的 `timeoutMs` 同时约束 spawn 与进程范围。`@deepseek-ai/dsh-client-ui-git-branch`（`packages/client/ui-git-branch`）把该结果渲染为 chip，注册进 composer 统计行新增的 `conversation.composer.stats.lead` 座位与问题卡新增的 `conversation.question.header.lead` 座位，多个已挂载 chip 共享一个页面生命周期内的 watch。
- `ui-workspace` 把所属 Workspace 标题投影到每个扁平 `SessionNode`，并渲染为标题上方的三级行，缺失时回退到本地化的 **Ungrouped** 标签。

### 集成边界

Shiguredo 功能 commit 是对 harness 插件 roster 的普通贡献：它新增包、在 web-app bundle 中注册，并且只改动自己拥有的包（外加 `ui-chat` 与 `ui-user-questions` 各一个 lead 座位）。本 fork 保持相对官方 DSH 可独立理解的树；这些插件是可叠加、可按 profile 移除的，且没有任何 Shiguredo 接口成为必需的运行时依赖。

## Alternatives considered

**针对 0.1.6 base 重新实现这四项功能。** 已否决：语言包机制在 0.1.6 中就存在，但配置表单设置模型、composer 统计行 lead 座位以及当前的 workspace 投影并不存在，因此每个插件都需要第二套设计，而上游同步会立刻使其失效。选择先更新 base，可以让上游设计按原样适用。

**不更新 base 而直接 cherry-pick 功能 commit。** 已否决：该 commit 的父 commit 是上游 master `21638c5631`；把它应用到落后数百个 commit 的 base 上，会在共享文件（`ui-chat`、`ui-workspace`、bundle 配置、catalog）产生冲突，并悄悄假设 base 并不具备的 API。

**运行时依赖 Shiguredo fork。** 已否决：这四个插件是普通 harness 包而非外部服务；运行时依赖会让一个下游 fork 对本仓库的 composition 拥有权威。

**把日文作为第三个内置 locale（`LOCALE_IDS` 中的 `ja`）。** 依 Shiguredo 设计否决并在此采纳：带类型的 `register(ns, { zh, en, ja })` 形式会强制每个包的注册都携带日文词典，并让每一处上游字符串变更都成为本 fork 的冲突面。语言包是已发布的、用于内置语言对之外语言的机制。

**只采纳语言包、其余延后。** 已否决：四项功能共享同一次 base 更新，延后并不更省；用户要求四项全部采纳。

## Acceptance criteria

- `master` 是上游 master `21638c5631` 的后代，并且仍然带有两个本地 Agent Note 文档 commit。
- Shiguredo 功能 commit 的改动存在于树中，其三份 implemented Agent Note 得到保留。
- 在合并后的树上，`pnpm run typecheck`、四个包的聚焦单元测试以及 Agent Note 各 gate 通过。
- `settings-chrome` 与 `desktop-locale` 的 web e2e 预期、client slot/api catalog 以及 config catalog 与所采纳的代码一致。
- 没有任何 Shiguredo 包成为必需的运行时依赖；从 profile 中禁用这四个插件即可移除其行为。
- 提案的生命周期被更新为反映实际落地内容，且这些 note 取代或交叉链接跨 Provider 提案中对 Shiguredo 的顺带提及。

## Risks

- 上游合并会触及数千个文件；共享文件（`ui-chat`、`ui-workspace`、bundle roster）中的冲突可能悄悄丢掉某一侧，因此必须针对无关本地改动审查该合并，并且两个本地文档 commit 必须存活。
- Shiguredo 功能 commit 是针对 `21638c5631` 编写的；若在本提案评审期间上游 master 前进，功能应用会产生冲突，需要 rebase 或重新验证。
- `ja` 语言包只对它覆盖的 namespace 完整；之后的上游 key 变更会在完成翻译前使语言包构建失败，这是预期的维护压力，但确实是实际工作量。
- git 分支 chip 在页面可见时以 15 秒轮询 spawn `git`；慢速或挂起的 `git` 仅由所配置的 `timeoutMs` 约束。
- 用户指定的字体族会同时应用于代码与 UI 文本，因此比例字体在清空之前会让代码也变为比例字体。
- 本 fork 会累积发行方特有的包，这些包必须保持可叠加、可移除，否则通用部分向上游提交会变得更困难。
