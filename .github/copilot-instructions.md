# Copilot Instructions for Joudo

Joudo is a local-first, mobile-first frontend for GitHub Copilot CLI. It consists of a Mac bridge (Fastify HTTP+WS server), a React mobile web UI, and a Tauri macOS desktop shell. The project is at v0.1.0 — main loop, CI/CD, and desktop packaging are stable; current focus is policy governance, signed distribution, and product polish.

## Monorepo structure

- `apps/bridge/` — Fastify 5 backend (TypeScript, NodeNext). Core files in `src/`, split into `state/` (18 modules), `policy/` (8 files), `auth/` (3 files).
- `apps/web/` — React 19 mobile-first web UI. Components in `src/components/` (25+), hooks in `src/hooks/`, styles in `src/styles/` (CSS custom properties, "Quiet Sanctuary" palette).
- `apps/desktop/` — Tauri 2 macOS desktop shell. Rust entry (`src-tauri/src/main.rs`), TS control panel (`src/main.ts`), packaging scripts.
- `packages/shared/` — Zero-runtime TypeScript types. Single barrel `src/index.ts`. Source-exported (no build step).
- `scripts/` — Dev/ops scripts (cleanup, startup, smoke test, P0 policy validation).
- `.github/instructions/` — 12 scoped instruction files + 1 lessons file.
- `.github/agents/` — 4 agent definitions (planner, dev, reviewer, scanner).
- `.github/skills/` — 7 skill definitions.
- `.ai/` — Task plans, decisions, docs, project overview.

## Product intent

- The primary client is a mobile-first web interface opened on a phone over LAN.
- The Mac bridge is the control plane; GitHub Copilot CLI (via `@github/copilot-sdk`) is the coding engine.
- ACP is the default integration path for persistent sessions.
- The Tauri desktop app bundles bridge + web + Node runtime into a self-contained macOS `.app`.
- A native mobile app is a later packaging step, not the first delivery target.

## Architecture rules

- Do not implement terminal scraping, OCR, or UI parsing of Copilot's interactive interface when ACP or structured output can be used.
- Keep session state repo-scoped and explicit.
- Separate transport, policy evaluation, session control, and summarization.
- Keep bridge state logic split across focused `state/*` modules — do not re-grow `mvp-state.ts` into a catch-all file.
- Preserve a clean boundary between mobile client code and local execution code.
- All internal bridge imports use `.js` extensions (NodeNext resolution).
- All user-facing text is in Chinese (中文); code identifiers remain in English.

## Security rules

- Never assume Copilot CLI permissions are a full sandbox.
- Do not trust the user's home directory as a session root.
- Keep all write and shell permissions scoped to the selected repository.
- Treat interpreters and shells (`bash`, `sh`, `zsh`, `python`, `node`, `ruby`) as high-risk unless policy explicitly allows them.
- Default to deny or confirm for destructive, privilege-escalating, or networked actions.
- Maintain an audit trail for approvals, denials, and executed commands.
- TOTP setup is restricted to localhost only; bearer tokens have 8h TTL with activity renewal.

## Policy model

- Per-repo YAML policy files at `.github/joudo-policy.yml` or `.joudo/policy.yml`.
- Model policy separately for tools, shell commands, paths, write paths, and URLs.
- Shell commands are canonicalized before matching (e.g. `git --no-pager diff --stat` → `git diff`).
- Re-check requests at runtime before approval.
- Prefer explicit allowlists over broad allow-all behavior.
- Three-outcome approval: deny / allow-once / allow-and-persist (writes narrowest pattern to YAML).

## Session & recovery contract

- `.joudo/repo-instructions.md`, `.joudo/sessions-index.json`, and `.joudo/sessions/<id>/snapshot.json` are the source of truth for repo-scoped persistence.
- Completed `idle` / `disconnected` sessions: best-effort attach recovery.
- Interrupted `running` / `awaiting-approval` sessions: history-only recovery.
- Never present old approvals as still actionable after bridge restart.
- Rollback: last-turn whole-turn revert only (write journal + watcher based). No checkpoint restore or arbitrary turn rewind.
- Agent selection is runtime state from filesystem scan — not persisted to snapshots.

## Development environment

- pnpm 10.6 via corepack. Always invoke as `corepack pnpm`.
- TypeScript 5.8+ with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Bridge tests: Node.js built-in `node:test` + `node:assert/strict`, run via `tsx --test`.
- Web tests: Vitest + `@testing-library/react` + jsdom.
- The current development machine is older hardware locked to macOS Ventura.
- Do not assume the latest Homebrew can be installed or used on this machine.
- If dependency installation fails because of network access, source `~/.zshrc` and run `proxyon` in the current shell before retrying.

## Non-goals

- No cloud dependency for core operation.
- No hidden auto-approval of risky commands.
- No repo-wide write access without policy.
- No implicit expansion from one trusted repo to sibling directories.

## Agent workflow

- `@planner` — analysis, task plans in `.ai/tasks/`, decisions in `.ai/decisions/`, docs in `.ai/docs/`. Does not write source code.
- `@dev` — executes implementation tasks. Ticks task checkboxes `[ ]` → `[x]`. Updates `.ai/overview.md` when architecture changes.
- `@reviewer` — verifies completed tasks by running verification commands. Sole authority for `status: done`.
- `@scanner` — scans repo conventions, proposes and writes `.github/instructions/` files.

## Documentation expectations

Maintain `docs/iteration-plan.md` as the source of truth for pending iteration planning.

Whenever a meaningful task finishes or requirements/plans change:

- review `docs/iteration-plan.md`
- update completed items, current decisions, and the next implementation candidates
- record any code-change plans or requirement-change plans there before they drift into chat-only context

When adding features, update the relevant docs in `docs/` if the change affects:

- architecture, security boundaries, repo policy behavior, approval flow, or session lifecycle

When changing bridge state or recovery behavior, keep these docs aligned at minimum:

- `docs/current-status.md`
- `docs/iteration-plan.md`
