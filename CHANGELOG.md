## [0.3.0](https://github.com/civic-source/us-code-tracker/compare/v0.2.0...v0.3.0) (2026-03-29)

### Features

* **web:** wire Pagefind search and update content submodule ([2769c1f](https://github.com/civic-source/us-code-tracker/commit/2769c1f38a89cc77db7b0925c2efd8860e33a94a))

### Bug Fixes

* **ci:** add submodule checkout for Content Collections in CI/deploy ([f645f72](https://github.com/civic-source/us-code-tracker/commit/f645f729599993202d51fbabbe4384811ab92ac8))
* **ci:** correct deploy-pages and upload-pages-artifact SHA pins ([1f68c32](https://github.com/civic-source/us-code-tracker/commit/1f68c329e29d010ea410eca7c789834ca049a36a))
## [0.2.0](https://github.com/civic-source/us-code-tracker/compare/v0.1.0...v0.2.0) (2026-03-28)

### Features

* **web:** Content Collections, dynamic pages, Pagefind search ([#33](https://github.com/civic-source/us-code-tracker/issues/33), [#34](https://github.com/civic-source/us-code-tracker/issues/34)) ([ceaa785](https://github.com/civic-source/us-code-tracker/commit/ceaa785c1215d7a4d05a0ed1f5fb5dbf5f98758f))

### Bug Fixes

* **ci:** update action-gh-release to v2.6.1 for Node.js 24 ([#32](https://github.com/civic-source/us-code-tracker/issues/32)) ([40b2994](https://github.com/civic-source/us-code-tracker/commit/40b29943d837b010becb709cbb25b939da092562))
## 0.1.0 (2026-03-28)

### Features

* add observability package and Title 18 golden snapshot tests ([#11](https://github.com/civic-source/us-code-tracker/issues/11), [#3](https://github.com/civic-source/us-code-tracker/issues/3)) ([950ecf3](https://github.com/civic-source/us-code-tracker/commit/950ecf38500592eac4fe1a4cfa9dd540a1244d3b))
* add sync pipeline, deploy workflow, and mixed content tests ([#1](https://github.com/civic-source/us-code-tracker/issues/1), [#20](https://github.com/civic-source/us-code-tracker/issues/20)) ([cfadb7e](https://github.com/civic-source/us-code-tracker/commit/cfadb7ee7586de3b6a13e17ffb62fdfe5c64e15f)), closes [#21](https://github.com/civic-source/us-code-tracker/issues/21)
* align implementation to spec v1.1.0 ([#15](https://github.com/civic-source/us-code-tracker/issues/15), [#16](https://github.com/civic-source/us-code-tracker/issues/16), [#17](https://github.com/civic-source/us-code-tracker/issues/17)) ([3a343dc](https://github.com/civic-source/us-code-tracker/commit/3a343dc53e655b26221660793c29d1ba9c7b9582))
* **annotator:** implement CourtListener sidecar precedent annotator ([#15](https://github.com/civic-source/us-code-tracker/issues/15)) ([c12e37a](https://github.com/civic-source/us-code-tracker/commit/c12e37a3dcd1822a777f60c659a477c00e58d7e1))
* **fetcher:** implement OLRC fetcher with idempotency and retry ([#2](https://github.com/civic-source/us-code-tracker/issues/2)) ([e07442e](https://github.com/civic-source/us-code-tracker/commit/e07442ef33b7df0489dc62cce15359fa5456592d))
* **pipeline:** add orchestrator tests, E2E validation, and fetch CLI ([#6](https://github.com/civic-source/us-code-tracker/issues/6)) ([3b08b14](https://github.com/civic-source/us-code-tracker/commit/3b08b147a930ee8bf950c1bcdae01585cb068317))
* scaffold Turborepo monorepo with packages and CI ([#1](https://github.com/civic-source/us-code-tracker/issues/1)) ([67d6f69](https://github.com/civic-source/us-code-tracker/commit/67d6f6907cc902d52bcb6a1089b09986e98fc9e3))
* **transformer:** implement USLM XML → Markdown transformer ([#3](https://github.com/civic-source/us-code-tracker/issues/3)) ([5c3f9ff](https://github.com/civic-source/us-code-tracker/commit/5c3f9ff924d5d92d59e9d3452e1d6814349475b1))
* **web:** build Astro frontend with Tailwind v4, Svelte 5, Pagefind ([#4](https://github.com/civic-source/us-code-tracker/issues/4), [#16](https://github.com/civic-source/us-code-tracker/issues/16)) ([702f8fa](https://github.com/civic-source/us-code-tracker/commit/702f8fa237fea54c3cf43996bace279e44ecd5a1)), closes [#1B3A5C](https://github.com/civic-source/us-code-tracker/issues/1B3A5C) [#0D7377](https://github.com/civic-source/us-code-tracker/issues/0D7377) [#D4A843](https://github.com/civic-source/us-code-tracker/issues/D4A843)
* **web:** implement DiffViewer and PrecedentDrawer components ([#4](https://github.com/civic-source/us-code-tracker/issues/4)) ([0cbb4b1](https://github.com/civic-source/us-code-tracker/commit/0cbb4b1582500b5b9c9cc081f569b29e1d6e7b84))

### Bug Fixes

* **ci:** add @types/node to fetcher and transformer packages ([736347e](https://github.com/civic-source/us-code-tracker/commit/736347ef030378425c579bb587bc9bd537362767))
* **ci:** pin GitHub Actions to SHA + Node.js 24 + add test step ([#8](https://github.com/civic-source/us-code-tracker/issues/8)) ([5c67ffb](https://github.com/civic-source/us-code-tracker/commit/5c67ffb3658d22c6f537f8dd962dd8b46f3a8239))
* resolve critical QA findings — paths, security, timestamps ([#22](https://github.com/civic-source/us-code-tracker/issues/22)-[#25](https://github.com/civic-source/us-code-tracker/issues/25)) ([a78e9f1](https://github.com/civic-source/us-code-tracker/commit/a78e9f18fdfbc25d9d11938733a3b4685a813e02))
* **transformer:** migrate parser to preserveOrder for mixed content ([#21](https://github.com/civic-source/us-code-tracker/issues/21)) ([b2450ad](https://github.com/civic-source/us-code-tracker/commit/b2450ad97a3a768f2ff637844b1b0f58f15cb76c))
* **transformer:** support real OLRC USLM 1.0 data (uscDoc root) ([#31](https://github.com/civic-source/us-code-tracker/issues/31)) ([e2e3ffd](https://github.com/civic-source/us-code-tracker/commit/e2e3ffd5edbfe81176a5b17f2495cb869459b8af))
