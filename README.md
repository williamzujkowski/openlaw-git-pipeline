# US Code Tracker

[![CI](https://github.com/civic-source/us-code-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/civic-source/us-code-tracker/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Automated pipeline that fetches U.S. Code XML releases from the Office of the Law Revision Counsel (OLRC), transforms them into Markdown, and tracks changes over time using Git as a version control backend.

> **Independence disclaimer:** This is an independent community project. It is not affiliated with, endorsed by, or associated with any government agency, employer, or official body.

## What It Does

- Polls OLRC for new U.S. Code release points (Public Laws)
- Transforms USLM 2.0 XML into structured Markdown with YAML frontmatter
- Commits changes to [civic-source/us-code](https://github.com/civic-source/us-code) with full Git history
- Serves a searchable static site for browsing and diffing legislation

## Packages

| Package | Description |
|---------|-------------|
| `@civic-source/types` | Shared TypeScript types, Zod schemas, and interfaces |
| `@civic-source/fetcher` | OLRC release point fetcher with retry and idempotency |
| `@civic-source/transformer` | USLM XML to Markdown converter |
| `@civic-source/web` | Astro static site for browsing U.S. Code changes |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Requires Node.js 22.x LTS and pnpm 9.x.

## Architecture

```
OLRC XML → Fetcher → Transformer → Markdown → us-code repo → Astro site
                ↓                       ↓
           Hash check              Git commit
          (idempotent)         (weekly cron)
```

## Contributing

See [CONTRIBUTING.md](https://github.com/civic-source/.github/blob/main/CONTRIBUTING.md) for guidelines.

## License

Code is licensed under [Apache 2.0](LICENSE). The [us-code](https://github.com/civic-source/us-code) data repository uses [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain).
