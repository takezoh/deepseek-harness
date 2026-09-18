# Agent Note: 跨 Provider 的可持续 Subagent 与 Main-Child 消息通信

Status: proposed

[English](2026-09-18-cross-provider-continuable-subagents.md) | 中文

## Problem

DeepSeek Harness 已经提供 `ctx.subagents`，并支持原生可持续 child agent，但 Claude Code 与 Codex 的 subagent provider 目前仍偏向一次性执行。这使得需要长期 implementer / reviewer 的工作流存在缺口：worker 无法跨 turn 保持、无法在后续接收反馈、无法向 main session 提问，也无法在之后恢复同一个 provider 原生会话。

直接需求来自 `dev-skills`。其现有 subsession 与 communication runtime 的目的，是让 role session 跨 workflow phase 存活，并在 conductor 与 delegated worker 之间传递 implementation feedback 等消息。如果继续在 DSH 外部重复实现这些机制，就会重复 DSH 已经拥有的 session、process、messaging 与 provider lifecycle 概念。

因此目标不是再做一层 wrapper harness，而是让 DSH 本身可以在同一个以 main session 为中心的 subagent 模型下托管 Claude Code、Codex 与 DSH native child。

## Proposal

扩展 DSH，使 DSH main session 可以通过 `ctx.subagents` spawn Claude Code、Codex 或 DSH-native child，并共享统一 lifecycle：

```text
DSH main session
    |
    +-- ctx.subagents -> Claude Code child
    |
    +-- ctx.subagents -> Codex child
    |
    +-- ctx.subagents -> DSH native child
```

第一阶段刻意限定为 main-centered：

- main session 可以 spawn child；
- main session 可以向同一个 child 发送后续消息；
- child 可以向 main session 发送普通会话消息；
- child 可以向 main session 显式 report；
- inactive child 在收到新消息时可以恢复同一个 provider 原生会话；
- main session 可以 inspect 与 interrupt child。

初期不要求 child-to-child 直接通信。Claude child 若需要影响 Codex child，应先经由 main session。

### Runtime vocabulary

尽可能使用 DSH 原生术语。除非确认存在具体缺口，不新增第二套 `SubsessionRef`、provider registry、mailbox 或 session store。

对 `dev-skills` 的映射为：

```text
dev-skills subsession
        ~= DSH continuable child session
```

DSH child Session 表示逻辑生命周期。实际存活的 Claude Code process、Codex app-server process 或 DSH Agent activation 只是该逻辑 child 的 activation。

### Provider-native continuation

对 external provider，持久化足够的 binding metadata，以恢复 provider 原生会话：

```text
DSH child Session
    |
    +-- Claude Code native session identity
    |
    +-- Codex native thread/session identity
```

当 settled / inactive child 收到新消息时：

1. 恢复 DSH child Session；
2. 必要时启动 provider runtime；
3. 恢复 provider 原生 session，而不是重建一份 fresh prompt；
4. 投递 pending message；
5. 继续 streaming 或 tool execution；
6. 通过 DSH 正常机制记录 lifecycle 与 result event。

如果 provider 无法原生 resume，应显式暴露能力限制，不能静默把 reconstructed conversation 当成同一 session。

### Messaging semantics

普通会话消息与 report 分离：

```text
main -> child : message
child -> main : message
child -> main : report
```

message 用于继续会话，包括 follow-up instruction、question、clarification、feedback 与 progress notification。

report 是面向 workflow 的显式 handback，例如 completion、blocker、result 或 artifact summary。

child 的普通 assistant output 不应自动等价于 workflow report。

初期应复用 DSH inbox、session log、report 与 wake/resume 机制，而不是新增第二套 durable mailbox。诸如 `Task`、`Feedback`、`ReviewRequest`、`ReviewResult`、`Evidence` 等 domain-specific message type 留在 `dev-skills`；DSH 只负责 delivery、lifecycle 与 resume。

### Golden contract

DSH-native continuable child 作为 reference behavior。修改 external provider 前，先用 E2E contract 固定如下行为：

```text
main
  -> spawn child
child
  -> work
  -> message main (optional question)
main
  -> reply
child
  -> explicit report
  -> settle

main
  -> send message to same child
runtime
  -> cold resume same logical child
  -> resume same native conversation
child
  -> continue
  -> explicit report
```

最终 DSH-native、Claude Code 与 Codex provider 都应通过同一 contract。

### Implementation sequence

#### Phase 0 — Repository and upstream discipline

实现位于本仓库，即 `deepseek-ai/deepseek-harness` 的 fork。

推荐 remote：

```text
origin      takezoh/deepseek-harness
upstream    deepseek-ai/deepseek-harness
shiguredo   shiguredo/deepseek-harness
```

官方 DSH 保持 primary upstream。Shiguredo fork 作为实用改进的 secondary source。优先通过 plugin/package 增量实现；只有 public seam 无法正确表达所需 lifecycle 时才修改 core。

#### Phase 1 — Establish the native golden contract

追踪并测试现有 Session、Agent activation、continuable child、inbox、report、interrupt 与 cold-resume 路径。

增加一个 DSH-native child 的 E2E fixture，证明 create -> message -> report -> settle -> cold resume -> second message -> second report。

本阶段不新增 abstraction。

#### Phase 2 — Claude Code continuation

调查当前 Claude Code provider 与 Agent SDK 的 session semantics。

让 provider 保存并恢复 native session identity，使多次消息到达同一 Claude Code conversation。支持 main-to-child send、child-to-main message/report bridge、interrupt、settle 与 cold resume。

#### Phase 3 — Codex continuation

使用 app-server protocol 与其 native thread/session identity，把相同 contract 实现到 Codex provider。继续使用既有 ChatGPT/Codex authentication，不引入平行 API-key 路径。

#### Phase 4 — Extract the generic external-continuation seam

仅在 Claude Code 与 Codex 都完成后，才提取共同 lifecycle，形成通用 DSH capability / provider seam。不要基于单一 provider 提前设计 abstraction。

任何 core addition 都应 provider-neutral，并适合提交 upstream。

#### Phase 5 — Main-child messaging parity

确保三种 provider 都具备等价的 main-to-child messaging、child-to-main conversational messaging、explicit report、inspect 与 interrupt。

除非出现具体 workflow 需求，否则 child-to-child 直接通信保持 out of scope。

#### Phase 6 — dev-skills migration

渐进式集成 `dev-skills`：

1. 将 `delegate` execution 映射到 `ctx.subagents`；
2. 将长期 role session 映射为 continuable DSH child Session；
3. communication transport 迁移到 DSH messaging/reporting；
4. development-specific payload semantics 继续保留在 `dev-skills`；
5. 验证 implement -> review -> feedback -> resume same implementer -> re-review；
6. 只有在等价性被验证后，才删除 `dev-skills` 中对应 runtime。

`dev-skills` 继续拥有 Development Loop、Goal/Profile/Capability semantics、role definition、task decomposition、acceptance、evidence、retry、routing 与 completion policy。

### Sandbox and execution environment

Sandbox 与 execution-world 工作明确排在 continuation / communication 之后。

优先利用 DSH 现有 sandbox、subprocess、filesystem、shell、SSH 等 capability seam。在 WSL、Windows Sandbox、Docker 或 VM 的具体实现证明缺少组合 primitive 之前，不预先引入独立 `ExecutionEnvironment` abstraction。

一个 child 使用的 shell、filesystem、subprocess 与 sandbox capability 应指向一致的 execution world。

### Shiguredo fork

Shiguredo fork 可作为 secondary integration source，引入日文 locale、workspace Git 信息、UI 改进与 source-launch fix 等实用修改。

不把 Shiguredo 变成 runtime 必需依赖。我们的实现应始终可以直接相对于官方 DSH 理解，以便通用 runtime 改进能提交 upstream。

## Alternatives considered

**继续把 `agent-harness` 作为 DSH 外部 wrapper repository。** 拒绝。目标能力直接涉及 DSH Session、subagent、provider、inbox 与 activation lifecycle；wrapper 会重复 identifier、projection、provider registry 与 adapter，却没有产生有意义的隔离。

**继续在 `dev-skills` 中维护 subsession 与 communication runtime。** 拒绝。spawn、process lifetime、provider-native resume、transport、interrupt 与 session persistence 都属于通用 runtime mechanism，而不是 software-development policy。

**实现任意 subagent 直接跨 host message/spawn 的 global mesh。** 延后。第一阶段只需要 DSH main session 管理 Claude、Codex 与 DSH-native child。经 main 路由更容易推理，也足够满足目标开发工作流。

**把 Claude/Codex 当作 one-shot worker，每次重建 context。** 拒绝。目标行为依赖把 feedback 或 clarification 返回给同一个 worker，并保留 provider 原生 conversational state。

**同时设计 execution-environment abstraction。** 延后。continuation 与 execution-world composition 是两个独立的难题；第一阶段应隔离并解决 provider continuation 与 messaging。

## Acceptance criteria

- DSH main session 可通过 `ctx.subagents` spawn DSH-native、Claude Code 与 Codex child。
- Claude Code 与 Codex child 在 live process settle / exit 后仍保持稳定的 DSH child-session identity。
- main 后续发送消息时，可恢复同一个 provider 原生 Claude/Codex conversation。
- child 可以向 main 发送普通会话消息，而不因此完成 task。
- child 可以发送与普通 assistant output 区分的 explicit report。
- main-to-child messaging 可以多 turn 工作，且不会创建重复 logical child。
- 三种目标 provider 的 inspect 与 interrupt behavior 有一致定义。
- provider-native session identifier 与 credential 不泄露到 `dev-skills` workflow policy。
- E2E 流程 Claude implementer -> Codex reviewer -> feedback -> resume same Claude implementer -> re-review 成功。
- 只有在 parity 被证明后，`dev-skills` 才删除等价的 subsession lifecycle 与 communication transport。
- generic core change 与 provider-specific code 分离，并适合 upstream review。

## Risks

- Claude Code 或 Codex 可能没有暴露足够稳定的 native-session control，无法完全满足 DSH continuation contract；若无法达到 parity，provider capability 必须显式表达。
- upstream DSH 仍处于 developer preview，subagent/session seam 可能快速变化，从而增加 merge 与维护成本。
- fork 可能逐渐累积 distribution-specific behavior，导致难以上游化；core patch 必须保持通用且最小。
- main-centered messaging 有意形成中心化瓶颈，第一版不支持 child-to-child 直接协同。
- provider-native session continuity 不代表 workspace continuity；后续 execution-world 工作必须把两者作为独立保证。
- 如果过早把 runtime 责任从 `dev-skills` 删除，可能造成 workflow correctness 回归，因此 migration 必须由 contract 驱动，并在 parity 未证明前保持可回退。
