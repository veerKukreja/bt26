# Dispatch Runbook — Unified Hackathon Plan

**For:** the Claude Code session that will orchestrate the implementation of `docs/superpowers/plans/2026-04-18-unified-hackathon.md`.

**Model:** one dispatcher agent (the Claude Code session reading this) spawns 14 subagents across 4 phases. Within each phase, all subagents run in parallel via the `Agent` tool with `isolation: "worktree"`. Phases are sequential; next phase only dispatches after the prior phase's PRs are merged.

## Human decisions needed before first dispatch

Do not skip. The dispatcher should halt and ask if any of these are undecided.

1. **Base branch:** Is `feat/export` merged into `main`? If yes, base is `main`. If no, base is `feat/export`. Every subagent must branch from the same base.
2. **Environment variables on the host machine:**
   - `SERVER_ANTHROPIC_API_KEY` — required by P7 (keyless access).
   - `SERVER_DAILY_COST_CEILING_USD` — recommend `50` for hackathon judging.
3. **Hosted target:** `raph.live` (current Cloudflare tunnel) or a fresh Vercel/Cloudflare Pages deploy? Affects where `SERVER_ANTHROPIC_API_KEY` is configured.
4. **Seed language list:** The plan ships Spanish, Haitian Creole, Mandarin, Arabic, Bengali, French, Russian by default. Change if a partner org has a different audience before P4.
5. **Cost ceiling per agent run:** subagents will call Anthropic during dev-testing. Confirm budget is acceptable for ~14 parallel agents.

## Phase structure

| Phase | Tasks | Count | Parallelism |
|---|---|---|---|
| 1 | P1 Ingest, P2 Brainstorm, P3 OG, P4 Language, P5 Ephemeral, P6 Shell, P7 Generate, P8 Print | 8 | all parallel |
| 2 | P9 Orchestrator, P10 PromptBar, P12 Layout | 3 | all parallel |
| 3 | P13 Refs panel, P14 Writeup panel | 2 | all parallel |
| 4 | P15 Verification | 1 | — |

**Between phases:** review each subagent's PR, request fixes if needed, merge when green. Never dispatch phase N+1 while phase N has open failures.

## Per-subagent prompt template

Each subagent starts cold. Its prompt must be fully self-contained. Construct from these five pieces, concatenated in this order:

```
You are implementing task [PX] from docs/superpowers/plans/2026-04-18-unified-hackathon.md.

## Your task

[COPY the entire "## P[X] — <Task Name>" section from the plan verbatim, including Goal, Owns, Scope, Depends on, Do not touch, and Acceptance]

## Codebase orientation

[COPY the plan's "## Codebase orientation" section verbatim]

## Branch state

[COPY the plan's "## Branch state (read before dispatching)" section verbatim]

## Shared guardrails

[COPY the plan's "## Shared guardrails" section verbatim]

## Ownership

This task owns these files (exclusively for this phase): [list from the task's "Owns" line].
Do not edit any file outside that list. If you need to, halt and report the blocker.

## Base branch

Branch from `[BASE_BRANCH]`. Your branch name must be `hack/[task-id]-<short-name>`.

## Definition of done

1. Every numbered acceptance criterion in the task spec passes — verified by running the app in a browser, not by type-checks alone.
2. Attach a screenshot or 30-second screencast to your PR showing at least one acceptance criterion passing.
3. Commit and push. Return to the dispatcher with: branch name, one-paragraph summary of what you did, explicit pass/fail for each acceptance criterion, and any blockers you hit.
```

## Tool call pattern (for the dispatcher agent)

**Phase 1:** one message, eight `Agent` tool calls in parallel.

```
Agent({
  description: "Ingest backend",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: "[P1 prompt constructed from template]"
})
Agent({ description: "Brainstorm backend", ... })  // P2
... (six more) ...
```

Wait for all 8 results. Review, request fixes on any that failed acceptance, merge approved PRs.

**Phase 2:** same pattern, three Agent calls (P9, P10, P12).

**Phase 3:** two Agent calls (P13, P14).

**Phase 4:** one Agent call (P15). No `isolation: "worktree"` needed — verification runs against the merged tree.

## Between-phase work (dispatcher responsibilities)

For each returning agent:
1. Pull their worktree branch.
2. Read the diff (at a high level).
3. Confirm acceptance criteria pass on a clean `npm install && npm run dev` startup.
4. If any fail: re-dispatch the same task with the failure details appended to its prompt.
5. Once passing, merge to the base branch.

Do not batch-merge without review. A broken Phase 1 task cascades into Phase 2 failures that are hard to diagnose.

## Failure handling

- **Agent returns blocker with a question for a human:** halt, surface the question, wait for a human answer.
- **Agent claims done but acceptance criteria fail:** re-dispatch with failure details. Do not try to fix it yourself unless it's a trivial one-line issue the agent missed.
- **Agent touches files outside its ownership:** reject the PR; re-dispatch with a sharper ownership reminder.
- **Two agents in the same phase both modified a file claimed by only one:** one of them violated ownership. Revert the violator, keep the owner's version, re-dispatch the violator.
- **Cascading failures after a merge:** revert the last merge, diagnose, then decide whether to re-merge with a patch or re-dispatch.

## Do not

- Merge `feat/export` into `main` without explicit human approval if the base-branch decision wasn't yet made.
- Force-push, reset-hard, or delete branches without human approval.
- Skip P15 (verification). If time is short, trim its scope, don't skip it.
- Run all four phases fully autonomously without a human review gate. Humans review at every phase boundary.

## Verification (P15) expectations

P15 is a single agent that runs the 14-step end-to-end flow from the plan. It must attach a 2-minute screencast to its PR. If any of the 14 steps fail, file a follow-up issue per failure and land the remaining passes — do not block the PR on a fully-green run unless the failure is a regression of previously-working behavior.

## After P15 lands

- Update `README.md` to reflect new defaults (keyless, multilingual, ephemeral, voice, print, brainstorm mode, OG images).
- Update `docs/PRIVACY.md` (created in P5/P7/P9) to reflect actual storage behavior.
- If any acceptance steps were deferred to follow-up issues, summarize them in a "Known gaps" section at the bottom of the plan.
