# OpenLaw-Git Pipeline

Automated pipeline that fetches the Office of the Law Revision Counsel (OLRC) US Code XML releases, transforms them into Markdown, and tracks changes over time using Git as a version control backend.

## Packages

- `@civic-source/types` — Shared TypeScript types, Zod schemas, and interfaces
- `@civic-source/fetcher` — OLRC release point fetcher
- `@civic-source/transformer` — XML-to-Markdown converter

## Apps

- `@civic-source/web` — Astro site for browsing US Code changes

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Requires Node.js 22.x LTS and pnpm 9.x.
