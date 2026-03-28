# OpenLaw-Git Pipeline - Claude Code Instructions

## Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Language:** TypeScript 5.8+ (strict mode, NodeNext)
- **Validation:** Zod v3
- **Testing:** Vitest
- **Web:** Astro v5
- **CI:** GitHub Actions (ubuntu-latest, Node 22)

## Quick Commands

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages (topological order)
pnpm test           # Run all tests
pnpm lint           # Lint all packages
pnpm typecheck      # Type-check all packages
```

## Core Principles

```
correctness > simplicity > performance
```

- **TDD** -- Write failing test first, then minimum code to pass, then refactor.
- **YAGNI** -- Only implement what is needed now. No speculative abstractions.
- **DRY** -- Extract shared logic at 3+ occurrences, not before.

## Zero `any` Policy

`any` is banned. Use `unknown` and narrow with type guards or Zod.

## Canonical Paths

| Concern         | Package                   | Entry Point     |
| --------------- | ------------------------- | --------------- |
| Shared types    | `@civic-source/types`      | `src/index.ts`  |
| OLRC fetcher    | `@civic-source/fetcher`    | `src/index.ts`  |
| XML transformer | `@civic-source/transformer`| `src/index.ts`  |
| Web app         | `@civic-source/web`        | `src/pages/`    |

## Self-Hosted Runner Policy

Cron and workflow_dispatch jobs may use self-hosted runners. Push/PR CI runs on ubuntu-latest only.

## Commit Messages

Use conventional commits: `type(scope): description`

Types: feat, fix, refactor, docs, test, chore, perf
