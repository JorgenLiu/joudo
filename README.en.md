# Joudo

> **⚠️ Archived** — On April 13, 2026, GitHub shipped `copilot --remote` (remote CLI session control), which covers Joudo's core use case. This project is no longer under active development. See the [archive decision](.ai/decisions/001-project-archive.md).

Joudo is a local-first, mobile-first web frontend for GitHub Copilot CLI. It provides a repo-scoped, approval-aware, recoverable interface to Copilot sessions over LAN.

**Timeline**: 2026-03-14 → 2026-03-25 (11 days, solo)  
**Final version**: v0.1.0 (unsigned test build)

---

## What it built

A fully packaged macOS app with CI/CD, from scratch:

- **Bridge**: Fastify 5 backend, 26 API routes, 18 state modules, driving `@github/copilot-sdk` sessions
- **Web UI**: React 19 mobile-first interface, 4 tabs (Console / Summary / Policy / History)
- **Desktop**: Tauri 2 macOS shell, menu bar tray app, bundled Node runtime
- **Policy Engine**: Per-repo YAML policies, shell command canonicalization, three-outcome approvals (deny / allow-once / allow-and-persist)
- **Auth**: TOTP (RFC 6238) local authentication, session token auto-renewal
- **CI/CD**: 3 GitHub Actions workflows, dual-arch DMG (x64 + arm64)

### Numbers

| Metric | Value |
|--------|-------|
| Bridge source | 33 files, ~8,000 LOC |
| Web source | 30 files, ~4,000 LOC |
| Tests | 26 files, ~4,500 LOC |
| Shared types | 528 LOC |
| API routes | 26 (17 POST / 8 GET / 1 WS) |
| Web components | 28 |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  macOS Desktop (Tauri 2)                     │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │ Control Panel│  │ Bundled Node Runtime  │  │
│  └─────────────┘  └───────────────────────┘  │
│         │                    │                │
│         ▼                    ▼                │
│  ┌────────────────────────────────────────┐  │
│  │  Bridge (Fastify 5, port 8787)        │  │
│  │  ┌──────────┐ ┌────────┐ ┌─────────┐  │  │
│  │  │ Session  │ │ Policy │ │  Auth   │  │  │
│  │  │ State    │ │ Engine │ │ (TOTP)  │  │  │
│  │  └──────────┘ └────────┘ └─────────┘  │  │
│  │         │                              │  │
│  │         ▼                              │  │
│  │  ┌──────────────────┐                  │  │
│  │  │ @github/copilot  │                  │  │
│  │  │    SDK 0.2.0     │                  │  │
│  │  └──────────────────┘                  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         ▲ HTTP + WebSocket (LAN)
         │
┌────────┴────────┐
│  Mobile Web UI  │
│  (React 19)     │
│  Any browser    │
└─────────────────┘
```

**Key design decisions**:

- Transport / Policy / Session separation
- Repo-scoped session state (not user home directory)
- Bridge state split across 18 focused modules instead of a monolith
- Mobile-first web over native app — any phone browser via LAN
- Pure LAN connection, no cloud relay

---

## Repository structure

```
joudo/
├── apps/
│   ├── bridge/      # Fastify backend — sessions, policy, approvals, persistence
│   ├── web/         # React mobile-first web UI
│   └── desktop/     # Tauri v2 macOS desktop shell
├── packages/
│   └── shared/      # Zero-runtime shared TypeScript types
├── scripts/         # Dev/ops scripts
├── docs/            # Project documentation
└── .github/         # CI/CD + Copilot instruction files
```

**Recommended code reading order**:

1. `apps/bridge/src/index.ts` — Entry point and route registration
2. `apps/bridge/src/mvp-state.ts` — Core state machine
3. `apps/bridge/src/state/session-orchestration.ts` — Session orchestration
4. `apps/web/src/hooks/useBridgeApp.ts` — Frontend state management
5. `packages/shared/src/index.ts` — Type definitions

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript, Fastify 5, NodeNext |
| Frontend | TypeScript, React 19, Vite |
| Desktop | Rust + TypeScript, Tauri 2 |
| Types | TypeScript 5.8+ strict mode |
| Testing | node:test + node:assert (Bridge), Vitest + Testing Library (Web) |
| CI | GitHub Actions, pnpm 10.6 via corepack |
| SDK | @github/copilot-sdk 0.2.0, @github/copilot 1.0.10 |

---

## Getting started

```bash
# Install dependencies
corepack pnpm install

# Start dev environment (bridge + web)
corepack pnpm dev

# Type check
corepack pnpm typecheck

# Run tests
corepack pnpm --filter @joudo/bridge test
corepack pnpm --filter @joudo/web test

# Build desktop app
corepack pnpm build:desktop
```

Default addresses: Web `http://localhost:5173`, Bridge `http://localhost:8787`

See [docs/quickstart.md](docs/quickstart.md) for details.

---

## Why it was archived

On April 13, 2026, GitHub shipped `copilot --remote`:

- Real-time CLI session streaming via GitHub servers
- Remote prompts, permission approvals, and mode switching from web and mobile
- QR code for quick mobile access, session resume, keep-alive
- Native GitHub Mobile app support

This covers Joudo's core value proposition: controlling CLI sessions from a phone.

### What Joudo still has that the official feature doesn't

| Capability | Details | Practical significance |
|------------|---------|----------------------|
| No GitHub repo requirement | Works with any local git repo | GitHub said "expanding support" — likely temporary |
| Pure LAN, no internet | No GitHub server relay | LLMs need internet anyway; very narrow niche |
| Policy persistence | YAML allowlist write-back | The author ran in bypass mode |
| Audit trail + rollback | Structured audit log + last-turn revert | No real user validation |

The remaining differentiators are either temporary or unvalidated. See [.ai/decisions/001-project-archive.md](.ai/decisions/001-project-archive.md) for the full analysis.

### What was validated

- ✅ Product intuition was correct — independently converged on the same product shape as GitHub's official feature
- ✅ Architecture decisions were sound — transport/policy/session separation, repo-scoped state, mobile-first web
- ✅ Engineering feasibility — solo, 11 days from zero to a packaged, distributed macOS app with full CI/CD

### Lessons learned

- Validate demand for governance before building a governance layer
- Platform wrappers have a shelf life measured in months, not years
- Your own usage patterns are the earliest demand signal — running in bypass mode should have been a warning

---

## Documentation

- [docs/current-status.md](docs/current-status.md) — Final product status
- [docs/iteration-plan.md](docs/iteration-plan.md) — Iteration plan (frozen)
- [docs/policy-guide.md](docs/policy-guide.md) — Policy usage guide
- [docs/quickstart.md](docs/quickstart.md) — Quick start
- [docs/code_guide/](docs/code_guide/) — Code walkthrough (7 articles)
- [.ai/decisions/001-project-archive.md](.ai/decisions/001-project-archive.md) — Archive decision record

## License

MIT
