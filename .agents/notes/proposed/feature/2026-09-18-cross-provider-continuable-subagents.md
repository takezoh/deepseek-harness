# Agent Note: Cross-provider continuable subagents and main-child messaging

Status: proposed

English | [中文](2026-09-18-cross-provider-continuable-subagents.zh.md)

## Problem

DeepSeek Harness already exposes `ctx.subagents` and supports native continuable child agents, but the Claude Code and Codex subagent providers are currently oriented around one-shot execution. That leaves a gap for workflows that need a long-lived implementer or reviewer to survive beyond one turn, receive follow-up instructions, ask the main session questions, and resume the same provider-native conversation later.

The immediate consumer is `dev-skills`, whose current subsession and communication runtimes exist to keep role sessions alive across workflow phases and to pass messages such as implementation feedback between a conductor and its delegated workers. Re-implementing those runtime mechanisms outside DSH would duplicate session, process, messaging, and provider lifecycle concepts that DSH already owns.

The target is therefore not a new wrapper harness around DSH. The target is a two-layer design: a host-neutral external-agent runtime core that owns provider-native create/resume/send/interrupt capabilities, plus a DSH plugin/adapter that maps those capabilities onto DSH `ctx.subagents`, Session, inbox, report, and activation semantics. DSH remains the first host and integration target, but the provider-control core must not depend on DSH so it can later be embedded by other harnesses.

## Proposal

Build a host-neutral provider-control core and a DSH integration so a main DSH session can use `ctx.subagents` to spawn Claude Code, Codex, or DSH-native children with a common lifecycle:

```text
DSH main session
    |
    +-- ctx.subagents -> Claude Code child
    |
    +-- ctx.subagents -> Codex child
    |
    +-- ctx.subagents -> DSH native child
```

The first implementation scope is deliberately main-centered:

- the main session can spawn a child;
- the main session can send additional messages to that same child;
- a child can send a conversational message back to the main session;
- a child can emit an explicit report back to the main session;
- an inactive child can resume the same provider-native conversation when messaged again;
- the main session can inspect and interrupt the child.

Direct child-to-child messaging is not required initially. A Claude child that needs to affect a Codex child communicates through the main session.

### Runtime layering

Split the implementation into two layers:

```text
host-neutral agent runtime core
    |- provider session identity
    |- create / resume / send / interrupt
    |- capability description
    |- native continuation adapters
    |
    +-- DSH plugin / adapter
          |- ctx.subagents integration
          |- DSH Session binding
          |- inbox / report mapping
          |- activation / event wiring
```

The host-neutral core must not own a durable session store, mailbox, scheduler, or DSH-specific lifecycle. When hosted by DSH, DSH remains authoritative for logical child lifetime, persistence, inbox, reports, wake/resume, and event logging.

Use DSH-native vocabulary at the integration boundary wherever possible. Do not introduce a second DSH-facing `SubsessionRef`, mailbox, or session store unless a concrete gap requires it.

The mapping for `dev-skills` is:

```text
dev-skills subsession
        ~= DSH continuable child session
```

The DSH child Session is the logical lifetime. A live Claude Code process, Codex app-server process, or DSH Agent activation is only an activation of that logical child.

### Host-neutral provider contract

The reusable core should expose only the provider-native control surface needed by a host:

```text
create
resume
send
interrupt
dispose
capabilities
```

A concrete API should be derived from both Claude Code and Codex rather than designed from one provider. The core may carry opaque provider session bindings and provider capability metadata, but it must not decide workflow policy, persistence policy, or DSH message semantics.

Claude Code, Codex, and later ACP adapters belong on this host-neutral side when their logic does not require DSH types.

### Provider-native continuation

For external providers, persist enough binding metadata to resume the provider's native conversation:

```text
DSH child Session
    |
    +-- Claude Code native session identity
    |
    +-- Codex native thread/session identity
```

When a settled or inactive child receives a new message:

1. restore the DSH child Session;
2. start the provider runtime if needed;
3. resume the provider-native session instead of reconstructing a fresh prompt;
4. deliver the pending message;
5. continue streaming or tool execution;
6. write lifecycle and result events through normal DSH mechanisms.

If a provider cannot resume natively, expose that as a capability limitation rather than silently presenting a reconstructed conversation as the same session.

### Messaging semantics

Separate conversational messages from reports.

```text
main -> child : message
child -> main : message
child -> main : report
```

A message continues the conversation. It covers follow-up instructions, questions, clarifications, feedback, and progress notifications.

A report is an explicit workflow-facing handback such as completion, blocker, result, or artifact summary.

A child's ordinary assistant output must not automatically become a workflow report.

The initial design should use DSH inbox, session log, report, and wake/resume mechanisms rather than adding a second durable mailbox. Domain-specific message types such as `Task`, `Feedback`, `ReviewRequest`, `ReviewResult`, and `Evidence` stay in `dev-skills`; DSH owns delivery, lifecycle, and resume.

### Golden contract

DSH-native continuable children define the reference behavior. Pin this with an end-to-end contract before changing external providers:

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

The same contract must eventually pass for DSH-native, Claude Code, and Codex providers.

### Implementation sequence

#### Phase 0 — Repository and upstream discipline

The implementation lives in this fork of `deepseek-ai/deepseek-harness`.

Recommended remotes:

```text
origin      takezoh/deepseek-harness
upstream    deepseek-ai/deepseek-harness
shiguredo   shiguredo/deepseek-harness
```

Official DSH remains the primary upstream. The Shiguredo fork is a secondary source for useful operational improvements. Prefer plugin/package additions; make core changes only when the public seams cannot express the required lifecycle correctly.

#### Phase 1 — Establish the native golden contract

Trace and test the existing Session, Agent activation, continuable child, inbox, report, interrupt, and cold-resume paths.

Add an E2E fixture proving create -> message -> report -> settle -> cold resume -> second message -> second report for a DSH-native child.

Do not add new abstractions in this phase.

#### Phase 2 — Host-neutral runtime-core spike

Before modifying DSH provider lifecycle deeply, implement the smallest DSH-independent control contract needed to create, resume, send to, and interrupt an external provider-native session.

Do not add persistence, mailbox, scheduler, or workflow semantics to this core. Its purpose is portability of provider control, not replacement of DSH runtime.

Use both Claude Code and Codex feasibility probes to shape the contract.

#### Phase 3 — Claude Code continuation

Investigate the current Claude Code provider and Agent SDK session semantics.

Make the provider retain and restore the native session identity so repeated messages reach the same Claude Code conversation. Support main-to-child send, child-to-main message/report bridging, interruption, settlement, and cold resume.

#### Phase 4 — Codex continuation

Apply the same contract to the Codex provider using the app-server protocol and its native thread/session identity. Preserve existing ChatGPT/Codex authentication instead of introducing a parallel API-key path.

#### Phase 5 — Extract the generic external-continuation seam

Only after both Claude Code and Codex work, stabilize the host-neutral runtime-core contract and extract any remaining DSH-specific common lifecycle into a generic DSH capability or provider seam. Avoid designing an abstraction from one provider.

The reusable runtime core should remain independently packageable outside this repository even if it initially lives in the DSH monorepo. Any DSH core addition should be provider-neutral and suitable for upstream submission.

#### Phase 6 — Main-child messaging parity

Ensure all three providers expose equivalent main-to-child messaging, child-to-main conversational messaging, explicit reports, inspection, and interruption.

Keep child-to-child direct messaging out of scope until a concrete workflow requires it.

#### Phase 7 — dev-skills migration

Integrate `dev-skills` incrementally:

1. map `delegate` execution to `ctx.subagents`;
2. map long-lived role sessions to continuable DSH child Sessions;
3. move communication transport to DSH messaging/reporting;
4. preserve development-specific payload semantics in `dev-skills`;
5. validate the implement -> review -> feedback -> resume same implementer -> re-review flow;
6. remove only the `dev-skills` runtime pieces that are proven equivalent to DSH.

`dev-skills` continues to own Development Loop, Goal/Profile/Capability semantics, role definitions, task decomposition, acceptance, evidence, retry, routing, and completion policy.

### Packaging and repository boundary

Start by keeping the host-neutral runtime core physically inside this monorepo so its API can evolve next to the DSH integration and contract tests. Maintain a hard dependency rule: the reusable core must not import DSH/Cordis packages.

Once Claude Code and Codex both use the core and at least one non-DSH consumer is concrete, the package may move to a standalone repository without changing its public contract.

The DSH plugin/adapter may depend on both DSH and the runtime core; the runtime core must never depend back on DSH.

### Sandbox and execution environment

Sandbox and execution-world work is explicitly secondary to continuation and communication.

Use existing DSH sandbox, subprocess, filesystem, shell, SSH, and related capability seams first. Do not introduce a separate `ExecutionEnvironment` abstraction until concrete WSL, Windows Sandbox, Docker, or VM work demonstrates a missing composition primitive.

The main guarantee is that shell, filesystem, subprocess, and sandbox capabilities used by one child must refer to a coherent execution world.

### Shiguredo fork

The Shiguredo fork is useful as a secondary integration source for improvements such as Japanese locale, workspace Git information, UI refinements, and source-launch fixes.

Do not make Shiguredo a required runtime dependency. Keep the implementation independently understandable against official DSH so generic runtime improvements can be proposed upstream.

## Alternatives considered

**Keep `agent-harness` as a full wrapper runtime around DSH.** Rejected because DSH must remain authoritative for Session, inbox, report, persistence, and activation lifecycle. However, a smaller host-neutral provider-control core is adopted so Claude/Codex native continuation logic is reusable outside DSH without duplicating DSH runtime.

**Keep subsession and communication runtime in `dev-skills`.** Rejected because spawn, process lifetime, provider-native resume, transport, interrupt, and session persistence are generic runtime mechanisms rather than software-development policy.

**Create a global cross-host mesh where any subagent directly messages or spawns any other host.** Deferred. The first useful topology is a DSH main session controlling Claude, Codex, and DSH-native children. Main-mediated routing is simpler to reason about and sufficient for the target development workflows.

**Treat Claude/Codex as one-shot workers and recreate context on each call.** Rejected because the target behavior depends on returning feedback or clarification to the same worker with the provider-native conversational state intact.

**Design execution-environment abstraction at the same time.** Deferred because continuation and execution-world composition are independent hard problems. The first milestone should isolate and solve provider continuation and messaging.

## Acceptance criteria

- A DSH main session can spawn DSH-native, Claude Code, and Codex children through `ctx.subagents`.
- Claude Code and Codex children retain stable DSH child-session identity after their live process settles or exits.
- A later main-to-child message resumes the same provider-native Claude/Codex conversation.
- A child can send a conversational message to the main session without completing its task.
- A child can emit an explicit report distinct from ordinary assistant output.
- Main-to-child messaging works for multiple turns without creating a duplicate logical child.
- Inspect and interrupt behavior is defined consistently across the three target providers.
- Provider-native session identifiers and credentials do not leak into `dev-skills` workflow policy.
- The E2E flow Claude implementer -> Codex reviewer -> feedback -> resume the same Claude implementer -> re-review succeeds.
- `dev-skills` can remove its equivalent subsession lifecycle and communication transport only after parity is demonstrated.
- Claude/Codex provider-native control logic is implemented behind a DSH-independent runtime-core contract.
- The runtime core has no dependency on DSH/Cordis and can be packaged outside the monorepo without redesign.
- DSH remains authoritative for logical child lifetime, persistence, inbox, reports, and event logging.
- Generic DSH core changes are separated from provider-specific code and are suitable for upstream review.

## Risks

- Claude Code or Codex may not expose enough stable native-session control to satisfy the full DSH continuation contract; the provider capability must remain explicit if parity is impossible.
- Upstream DSH is in developer preview and its subagent/session seams may change quickly, increasing merge and maintenance cost.
- A fork can accumulate distribution-specific behavior that becomes difficult to upstream; core patches must stay generic and small.
- A host-neutral core can accidentally grow into a second harness runtime; it must stay limited to provider control and capability description, leaving persistence, scheduling, messaging durability, and workflow policy to the host.
- Main-centered messaging creates an intentional bottleneck and does not support direct child-to-child coordination in the first version.
- Provider-native session continuity does not by itself guarantee workspace continuity; later execution-world work must treat those as separate guarantees.
- Moving runtime responsibilities out of `dev-skills` too early could regress workflow correctness, so migration must be contract-driven and reversible until parity is proven.
