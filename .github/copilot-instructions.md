# Copilot Instructions for Joudo

Joudo is a local-first, web-first mobile access frontend for GitHub Copilot CLI. All implementation decisions should preserve the project's security boundaries and avoid shortcuts that weaken repo isolation.

## Product intent

- The primary MVP client is a mobile-first web interface that can be opened on a phone.
- A native mobile app is a later packaging step, not the first delivery target.
- The Mac bridge is the control plane.
- GitHub Copilot CLI is the coding engine.
- ACP is the default integration path for persistent sessions.
- One-shot programmatic prompt mode is acceptable only for isolated tasks.

## Architecture rules

- Do not implement terminal scraping, OCR, or UI parsing of Copilot's interactive interface when ACP or structured output can be used.
- Keep session state repo-scoped and explicit.
- Prefer a bridge design that separates transport, policy evaluation, session control, and summarization.
- Keep bridge state logic split across focused `state/*` modules rather than re-growing `mvp-state.ts` into a catch-all file.
- Preserve a clean boundary between mobile client code and local execution code.

## Security rules

- Never assume Copilot CLI permissions are a full sandbox.
- Do not trust the user's home directory as a session root.
- Keep all write and shell permissions scoped to the selected repository.
- Treat interpreters and shells such as `bash`, `sh`, `zsh`, `python`, `node`, and `ruby` as high-risk unless a task explicitly requires them and policy allows them.
- Default to deny or confirm for destructive, privilege-escalating, or networked actions.
- Maintain an audit trail for approvals, denials, and executed commands.

## Policy model expectations

- Support per-repo policy files.
- Model policy separately for tools, shell commands, paths, and URLs.
- Compile static policy into Copilot CLI flags where possible.
- Re-check requests at runtime before approval.
- Prefer explicit allowlists over broad allow-all behavior.

## Implementation guidance

- Favor simple, inspectable formats for repo policy.
- Make approval decisions explainable in logs and UI.
- When summarizing agent output, prefer structured fields over lossy free-text compression.
- Treat `.joudo/repo-instructions.md`, `.joudo/sessions-index.json`, and `.joudo/sessions/<id>/snapshot.json` as the source of truth for first-phase repo-scoped persistence.
- Preserve the current recovery contract:
	- completed `idle` / `disconnected` historical sessions may use best-effort attach
	- interrupted `running` / `awaiting-approval` sessions recover as history-only context
	- never present old approvals as still actionable after bridge restart
- Keep LAN transport authenticated.
- Design for local-first operation before considering remote access.
- The current development machine is older hardware locked to macOS Ventura.
- Do not assume the latest Homebrew can be installed or used on this machine.
- If dependency installation fails because of network access, source `~/.zshrc` and run `proxyon` in the current shell before retrying.

## Non-goals

- No cloud dependency for core operation.
- No hidden auto-approval of risky commands.
- No repo-wide write access without policy.
- No implicit expansion from one trusted repo to sibling directories.

## Documentation expectations

Maintain `docs/iteration-plan.md` as the source of truth for pending iteration planning.

Whenever a meaningful task finishes or requirements/plans change:

- review `docs/iteration-plan.md`
- update completed items, current decisions, and the next implementation candidates
- record any code-change plans or requirement-change plans there before they drift into chat-only context

When adding features, update the relevant docs in `docs/` if the change affects:

- architecture
- security boundaries
- repo policy behavior
- approval flow
- session lifecycle

When changing bridge state or recovery behavior, keep these docs aligned at minimum:

- `docs/current-status.md`
- `docs/iteration-plan.md`
