# Agent Note: Adopt the Shiguredo fork's Japanese UI, font setting, git-branch chip, and flat workspace label

Status: proposed

English | [中文](2026-09-28-adopt-shiguredo-fork-features.zh.md)

## Problem

This fork of `deepseek-ai/deepseek-harness` carries two local documentation commits on top of upstream release 0.1.6-alpha.2 (PR #4469), while the downstream Shiguredo fork (`shiguredo/deepseek-harness`) has already rebased four Japanese-first improvements onto upstream master and published them as one commit:

- *日本語ロケールとフォント設定とブランチチップをプラグインとして追加する*.

The four features are a `ja` language pack, a user-selectable font family, a host-side git checkout resolver with a composer git-branch chip, and an owning-Workspace label on flat Session rows. The fork currently has none of them, and the [cross-provider continuable subagents proposal](2026-09-18-cross-provider-continuable-subagents.md) only mentions the Shiguredo fork as a secondary integration source without a plan for taking its work.

The Shiguredo commit's parent is upstream master at PR #5282, so its changes assume the 0.1.7 line: language-pack registration, the `Config` plus configuration-form setting model, the composer session-stats row's lead seat, and the current `ui-workspace` projections. Taking the features without first moving this fork's base would force each plugin to be reimplemented against 0.1.6 seams, and would immediately diverge from the upstream design the Shiguredo notes record.

## Proposal

### Base update

Advance this fork's `master` to upstream master at PR #5282 by merging `upstream/master` into it, preserving the two local Agent Note documentation commits. The merged base is the same revision the Shiguredo feature commit was authored against, so the feature lands without a compatibility rewrite.

The fork's remotes are:

```text
origin      takezoh/deepseek-harness
upstream    deepseek-ai/deepseek-harness
shiguredo   shiguredo/deepseek-harness
```

### Feature adoption

Apply the Shiguredo feature commit as one change on the updated base, keeping its three implemented Agent Notes and its package structure. The four plugins are:

- `@deepseek-ai/dsh-client-locale-ja` (`packages/client/locale-ja`) registers `ja` through `ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })` and one typed `LocaleDictOf<'ns'>` Japanese dictionary per shipped namespace. It ships as a language pack, not a third built-in locale.
- `@deepseek-ai/dsh-client-ui-font-family` (`packages/client/ui-font-family`) owns the `ui-font-family` Host configuration entry, the `--dsw-font-family` and `--ds-font-family-code` body variables, a General-settings Font row, and an index bootstrap that applies a stored family on the first paint after a reload. With no stored family the shipped theme stacks stay the default.
- `@deepseek-ai/dsh-api-workspace-git` (`packages/api/workspace-git`) owns the `workspaceGit` Remote namespace over the Session-scoped workspace lookup and answers `branch`/`detached`/`none` from `git` through `ctx.subprocess`, bounding both the spawn and process range by a configured `timeoutMs`. `@deepseek-ai/dsh-client-ui-git-branch` (`packages/client/ui-git-branch`) renders the answer as a chip in the composer stats row's new `conversation.composer.stats.lead` seat and the question card's new `conversation.question.header.lead` seat, sharing one page-lifetime watch across mounted chips.
- `ui-workspace` projects the owning Workspace title onto every flat `SessionNode` and renders it as a tertiary line above the title, falling back to the localized **Ungrouped** label.

### Integration boundary

The Shiguredo feature commit is a normal contribution to the harness plugin roster: it adds packages, registers them in the web-app bundle, and changes only the packages it owns (plus one lead seat in `ui-chat` and one in `ui-user-questions`). The fork keeps an independently understandable tree against official DSH; the plugins are additive and removable per profile, and no Shiguredo interface becomes a required runtime dependency.

## Alternatives considered

**Reimplement the four features against the 0.1.6 base.** Rejected: the language-pack mechanism exists in 0.1.6, but the configuration-form setting model, the composer stats lead seat, and the current workspace projections do not, so each plugin would need a second design that the upstream sync immediately invalidates. The chosen base update makes the upstream design applicable as written.

**Cherry-pick the feature commit without updating the base.** Rejected: the commit's parent is upstream master at PR #5282; applying it to a base hundreds of commits behind produces conflicts across shared files (`ui-chat`, `ui-workspace`, bundle configuration, catalogs) and silently assumes APIs the base lacks.

**Depend on the Shiguredo fork at runtime.** Rejected: the four plugins are ordinary harness packages, not an external service; a runtime dependency would make a downstream fork authoritative over this repository's composition.

**Reimplement Japanese as a third built-in locale (`ja` in `LOCALE_IDS`).** Rejected by the Shiguredo design and adopted here: the typed `register(ns, { zh, en, ja })` form would force a Japanese dictionary into every package's registration and make every upstream string change a conflict surface in this fork. Language packs are the documented mechanism for languages outside the shipped pair.

**Adopt only the language pack and defer the rest.** Rejected: the four features share the base update, so deferring is not cheaper; the user asked for all four.

## Acceptance criteria

- `master` is a descendant of upstream master at PR #5282 and still carries the two local Agent Note documentation commits.
- The Shiguredo feature commit's changes are present in the tree, with its three implemented Agent Notes retained.
- `pnpm run typecheck`, focused unit tests for the four packages, and the Agent Note gates pass on the merged tree.
- The `settings-chrome` and `desktop-locale` web e2e expectations, the client slot/api catalogs, and the config catalog match the adopted code.
- No Shiguredo package is a required runtime dependency; disabling the four plugins from a profile removes their behavior.
- The proposal's lifecycle is updated to reflect what shipped, and these notes supersede or cross-link the passing Shiguredo mention in the cross-provider proposal.

## Risks

- The upstream merge touches thousands of files; a conflict in a shared file (`ui-chat`, `ui-workspace`, bundle roster) could silently drop either side, so the merge must be reviewed against unrelated local changes, and the two local documentation commits must survive.
- The Shiguredo feature commit was authored against upstream master at PR #5282; if upstream master advances while this proposal is reviewed, the feature application acquires conflicts and must be rebased or re-verified.
- The `ja` pack is complete only for the namespaces it covers; later upstream key changes break the pack build until translated, which is the intended maintenance pressure but is real work.
- The git-branch chip spawns `git` on a 15-second poll while a page is visible; a slow or hanging `git` is bounded only by the configured `timeoutMs`.
- A user-specified font family applies to code as well as UI text, so a proportional family makes code proportional until cleared.
- The fork accumulates distribution-specific packages that must stay additive and removable, or upstream submission of generic parts becomes harder.
