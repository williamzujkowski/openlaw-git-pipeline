# US Code Tracker

[![CI](https://github.com/civic-source/us-code-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/civic-source/us-code-tracker/actions/workflows/ci.yml)
[![Deploy](https://github.com/civic-source/us-code-tracker/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/civic-source/us-code-tracker/actions/workflows/deploy-site.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**[Live site](https://civic-source.github.io/us-code-tracker/)** — Browse the entire U.S. Code with version history, change tracking, and case law references.

Automated pipeline that fetches U.S. Code XML releases from the Office of the Law Revision Counsel (OLRC), transforms them into Markdown, and tracks changes over time using Git. Includes a full static site for browsing, searching, and comparing legislative changes across 230 historical release points spanning 2013-2026.

> **Independence disclaimer:** This is an independent community project. It is not affiliated with, endorsed by, or associated with any government agency.

## Features

- **230 historical release points** across 7 Congresses (113th-119th, 2013-2026)
- **Full-text chapter pages** — read entire chapters inline without click-through
- **Version comparison** — congress-grouped timeline with side-by-side diffs
- **Change tracking** — per-section indicators showing which Public Law changed each section
- **Case law integration** — CourtListener case citations with court badges
- **Cross-reference linking** — "section N of this title" auto-linked to target section
- **Full-text search** — Pagefind across 53K+ sections
- **Keyboard navigation** — j/k to navigate sections, / to search
- **RSS feed** — subscribe to recent changes at `/feed.xml`
- **Schema.org Legislation** structured data for search engines
- **USWDS-inspired design** — Public Sans font, civic color palette, WCAG AA accessible

## Packages

| Package | Description |
|---------|-------------|
| `@civic-source/types` | Shared TypeScript types, Zod 4 schemas, and interfaces |
| `@civic-source/fetcher` | OLRC release point fetcher with retry and idempotency |
| `@civic-source/transformer` | USLM XML to Markdown converter with status detection |
| `@civic-source/annotator` | CourtListener precedent annotation generator |
| `@civic-source/pipeline` | Orchestration pipeline for bulk conversion |
| `@civic-source/observability` | Pipeline metrics collector and reporting |
| `@civic-source/shared` | Shared utilities (logger, retry, token bucket) |
| `@civic-source/web` | Astro 6 static site with Svelte components |

## Development

```bash
pnpm install
pnpm build
pnpm test          # 267 tests across 8 packages
pnpm lint
pnpm typecheck
```

Requires Node.js 22.x LTS and pnpm 9.x.

## Architecture

```
OLRC XML → Fetcher → Transformer → Markdown → us-code repo → Astro site
                ↓                       ↓              ↓
           Hash check              Git commit    Pre-computed diffs
          (idempotent)         (weekly cron)    (incremental gen)
```

### Repos

| Repo | Purpose |
|------|---------|
| [us-code-tracker](https://github.com/civic-source/us-code-tracker) | Pipeline code + Astro site (this repo) |
| [us-code](https://github.com/civic-source/us-code) | Git-versioned statute data (230 tagged release points) |
| [cap-citation-pipeline](https://github.com/civic-source/cap-citation-pipeline) | Case law citation extraction from CourtListener |

### Historical Import

```bash
# Import historical release points
npx tsx scripts/import-history.ts --repo /path/to/us-code --resume

# Generate pre-computed diffs (incremental)
npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/
```

### Key Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Astro | 6.x | Static site generator |
| Svelte | 5.x | Interactive components |
| Zod | 4.x | Schema validation |
| Tailwind CSS | 4.x | Styling |
| Pagefind | 1.x | Full-text search |
| Public Sans | — | USWDS civic font |

## Contributing

See [CONTRIBUTING.md](https://github.com/civic-source/.github/blob/main/CONTRIBUTING.md) for guidelines.

## License

Code is licensed under [Apache 2.0](LICENSE). The [us-code](https://github.com/civic-source/us-code) data repository uses [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain).
