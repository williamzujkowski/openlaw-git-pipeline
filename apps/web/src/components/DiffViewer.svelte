<script lang="ts">
  import {
    getFileHistory, getFileDiff, getFileAtRef,
    isRateLimited, formatTagName, extractYear,
    type CommitInfo, type DiffLine, type ReleaseTag,
  } from "../lib/github";

  interface SectionDiff {
    from: string;
    to: string;
    lines: { type: "add" | "del" | "context"; content: string }[];
  }

  interface DiffManifest {
    pairs: { from: string; to: string; changedSections: number }[];
    generatedAt: string;
  }

  interface CongressGroup {
    congress: number;
    label: string;
    years: string;
    tags: ReleaseTag[];
    changedCount: number;
  }

  interface Props {
    sectionPath: string;
    repoOwner?: string;
    repoName?: string;
    githubToken?: string;
  }

  let {
    sectionPath,
    repoOwner = "civic-source",
    repoName = "us-code",
    githubToken,
  }: Props = $props();

  let commits = $state<CommitInfo[]>([]);
  let tags = $state<ReleaseTag[]>([]);
  let diffLines = $state<DiffLine[]>([]);
  let loading = $state(false);
  let diffLoading = $state(false);
  let tagLoading = $state(false);
  let error = $state("");
  let compareFrom = $state("");
  let compareTo = $state("");
  let selectedTagContent = $state("");
  let selectedTag = $state("");
  let hasCompared = $state(false);
  let usingStaticDiffs = $state(false);
  let manifest = $state<DiffManifest | null>(null);
  let expandedCongress = $state<Set<number>>(new Set());
  let onlyShowChanges = $state(true);

  /** Parse congress number from a pl-* tag name */
  function parseCongress(tagName: string): number {
    const m = /pl-(\d+)-/.exec(tagName);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** Get year range for a congress number */
  function congressYears(congress: number): string {
    const startYear = 2013 + (congress - 113) * 2;
    return `${startYear}\u2013${startYear + 1}`;
  }

  /** Get ordinal suffix for congress number */
  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /** Check if a tag changed this section (using diff manifest) */
  function tagChangedThisSection(tagName: string): boolean {
    if (!manifest) return true; // No manifest = show all
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return true;
    // A tag "changed this section" if it appears as the `to` in a pair that has a diff for this section
    // We check by looking at pairs where this tag is the `to` side
    return sectionChangePairs.has(tagName);
  }

  /** Set of tag names that appear as the `to` in pairs that changed this section */
  let sectionChangePairs = $state<Set<string>>(new Set());

  /** Build sectionChangePairs from manifest by checking which pairs have diffs for this section */
  async function buildSectionChangePairs(): Promise<void> {
    if (!manifest) return;
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return;
    const baseUrl = getBaseUrl();
    const changed = new Set<string>();
    // Also mark the first tag as "changed" (initial import)
    if (tags.length > 0) {
      const first = tags[0];
      if (first) changed.add(first.name);
    }
    // Check each pair
    for (const pair of manifest.pairs) {
      try {
        const url = `${baseUrl}diffs/${pair.from}_${pair.to}/${parts.title}/${parts.section}.json`;
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) {
          changed.add(pair.to);
        }
      } catch {
        // Skip — section not changed in this pair
      }
    }
    sectionChangePairs = changed;
  }

  /** Group tags by congress */
  function groupByCongress(allTags: ReleaseTag[]): CongressGroup[] {
    const groups = new Map<number, ReleaseTag[]>();
    for (const tag of allTags) {
      const congress = parseCongress(tag.name);
      if (!groups.has(congress)) groups.set(congress, []);
      groups.get(congress)!.push(tag);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a) // Most recent congress first
      .map(([congress, congressTags]) => ({
        congress,
        label: `${ordinal(congress)} Congress`,
        years: congressYears(congress),
        tags: congressTags,
        changedCount: congressTags.filter(t => tagChangedThisSection(t.name)).length,
      }));
  }

  let congressGroups = $derived(groupByCongress(tags));

  function sectionPathToParts(path: string): { title: string; section: string } | null {
    const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(path);
    if (!m) return null;
    return { title: m[1] ?? "", section: m[2] ?? "" };
  }

  function pairKey(from: string, to: string): string {
    return `${from}_${to}`;
  }

  function getBaseUrl(): string {
    return document.querySelector('meta[name="base-url"]')?.getAttribute('content') ?? '/us-code-tracker/';
  }

  async function fetchManifest(): Promise<DiffManifest | null> {
    try {
      const res = await fetch(`${getBaseUrl()}diffs/manifest.json`);
      if (!res.ok) return null;
      return (await res.json()) as DiffManifest;
    } catch {
      return null;
    }
  }

  async function fetchStaticDiff(from: string, to: string): Promise<SectionDiff | null> {
    const parts = sectionPathToParts(sectionPath);
    if (!parts) return null;
    try {
      const url = `${getBaseUrl()}diffs/${pairKey(from, to)}/${parts.title}/${parts.section}.json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as SectionDiff;
    } catch {
      return null;
    }
  }

  function cleanMarkdownForDisplay(raw: string): string {
    return raw
      .replace(/^---[\s\S]*?---\n*/m, "")
      .replace(/^# .*/m, "")
      .replace(/- \*\*\(([^)]+)\)\*\*/g, "($1)")
      .replace(/^\s*- /gm, "")
      .trim();
  }

  async function loadHistory() {
    loading = true;
    error = "";
    try {
      const fetchedManifest = await fetchManifest();
      if (fetchedManifest && fetchedManifest.pairs.length > 0) {
        usingStaticDiffs = true;
        manifest = fetchedManifest;
        tags = fetchedManifest.pairs
          .flatMap((p) => [p.from, p.to])
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((name) => ({ name, date: "" }));
        const last = tags[tags.length - 1];
        const secondLast = tags[tags.length - 2];
        if (last) compareTo = last.name;
        if (secondLast) compareFrom = secondLast.name;
        // Auto-expand the most recent congress
        if (tags.length > 0) {
          const latestCongress = parseCongress(tags[tags.length - 1]?.name ?? "");
          if (latestCongress) expandedCongress = new Set([latestCongress]);
        }
        // Build section change map in background
        void buildSectionChangePairs();
        // Commit history still requires GitHub API — skip silently if unavailable
        try {
          const commitResult = await getFileHistory(repoOwner, repoName, sectionPath, githubToken);
          const seen = new Set<string>();
          commits = commitResult.filter(c => !seen.has(c.message) && seen.add(c.message));
        } catch {
          // Commit history optional when using static diffs
        }
        return;
      }

      // Fallback: fetch everything from GitHub API
      const [commitResult, tagResult] = await Promise.all([
        getFileHistory(repoOwner, repoName, sectionPath, githubToken),
        fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/tags?per_page=100`, {
          headers: githubToken ? { Authorization: `token ${githubToken}` } : {},
        }).then(async (r) => {
          if (!r.ok) return [] as ReleaseTag[];
          const data = (await r.json()) as { name: string }[];
          const parseTag = (name: string): [number, number] => {
            const m = /pl-(\d+)-(\d+)/.exec(name);
            return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
          };
          return data
            .filter((t) => t.name.startsWith("pl-"))
            .map((t): ReleaseTag => ({ name: t.name, date: "" }))
            .sort((a, b) => {
              const [ac, al] = parseTag(a.name);
              const [bc, bl] = parseTag(b.name);
              return ac !== bc ? ac - bc : al - bl;
            });
        }),
      ]);
      const seen = new Set<string>();
      commits = commitResult.filter(c => !seen.has(c.message) && seen.add(c.message));
      tags = tagResult;
      if (tags.length > 0) {
        compareTo = tags[tags.length - 1]?.name ?? "";
        if (tags.length > 1) compareFrom = tags[tags.length - 2]?.name ?? "";
        const latestCongress = parseCongress(tags[tags.length - 1]?.name ?? "");
        if (latestCongress) expandedCongress = new Set([latestCongress]);
      }
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error ? e.message : "Failed to load history";
    } finally {
      loading = false;
    }
  }

  async function compareVersions() {
    if (!compareFrom || !compareTo) return;
    diffLoading = true;
    error = "";
    try {
      if (usingStaticDiffs) {
        const staticDiff = await fetchStaticDiff(compareFrom, compareTo);
        if (staticDiff) {
          diffLines = staticDiff.lines;
        } else {
          diffLines = [];
        }
        hasCompared = true;
        return;
      }

      const result = await getFileDiff({
        owner: repoOwner, repo: repoName,
        base: compareFrom, head: compareTo,
        path: sectionPath, token: githubToken,
      });
      diffLines = result ?? [];
      hasCompared = true;
    } catch (e: unknown) {
      error = isRateLimited(e)
        ? "GitHub API rate limit reached. Try again later or provide a token."
        : e instanceof Error ? e.message : "Failed to load diff";
    } finally {
      diffLoading = false;
    }
  }

  async function viewTag(tag: ReleaseTag) {
    selectedTag = tag.name;
    selectedTagContent = "";
    tagLoading = true;
    error = "";
    try {
      const content = await getFileAtRef(repoOwner, repoName, sectionPath, tag.name, githubToken);
      selectedTagContent = content ? cleanMarkdownForDisplay(content) : "File not found at this version.";
    } finally {
      tagLoading = false;
    }
  }

  function toggleCongress(congress: number) {
    const next = new Set(expandedCongress);
    if (next.has(congress)) {
      next.delete(congress);
    } else {
      next.add(congress);
    }
    expandedCongress = next;
  }

  function formatCommitMessage(msg: string): string {
    const plMatch = /Update to (?:PL |Public Law )?([\d-]+)/i.exec(msg);
    if (plMatch) return `Updated to Public Law ${plMatch[1]}`;
    if (/regenerate|reformat|markdown/i.test(msg)) return "Formatting update";
    if (/import|initial/i.test(msg)) return "Initial import";
    return msg.replace(/^(?:chore|feat|fix)\([^)]*\):\s*/i, "");
  }

  function isLegislativeChange(msg: string): boolean {
    return /Update to (?:PL |Public Law )/i.test(msg);
  }

  function commitDisplayDate(msg: string, gitDate: string): string {
    const m = msg.match(/(\d{3})-(\d+)/);
    if (m) return `${2013 + (parseInt(m[1]) - 113) * 2}`;
    return gitDate ? new Date(gitDate).toLocaleDateString() : '';
  }

  /** Get the current (latest) tag name */
  let currentTag = $derived(tags.length > 0 ? tags[tags.length - 1]?.name ?? "" : "");

  $effect(() => { void loadHistory(); });
</script>

<div class="rounded border border-gray-200 bg-white p-4 font-sans text-sm dark:border-gray-700 dark:bg-gray-900">
  {#if loading}
    <p class="text-gray-500">Loading history...</p>
  {:else if error}
    <p class="text-red-600 dark:text-red-400">{error}</p>
  {:else}
    <!-- Historical version banner -->
    {#if selectedTag && selectedTag !== currentTag}
      <div class="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/50">
        <svg class="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M12 3l9.09 16.91H2.91L12 3z" />
        </svg>
        <span class="text-xs font-medium text-amber-800 dark:text-amber-200">
          Viewing historical version at {formatTagName(selectedTag)} &mdash; not current law.
          <button class="ml-1 underline hover:no-underline" onclick={() => { selectedTagContent = ""; selectedTag = ""; }}>View current</button>
        </span>
      </div>
    {/if}

    {#if tags.length > 0}
      <!-- Congress-grouped version timeline -->
      <div class="mb-4">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">Version Timeline</h3>
          <label class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <input type="checkbox" bind:checked={onlyShowChanges} class="h-3 w-3 rounded border-gray-300 accent-teal dark:border-gray-600" />
            Only versions with changes
          </label>
        </div>

        <div class="space-y-1">
          {#each congressGroups as group (group.congress)}
            {@const isExpanded = expandedCongress.has(group.congress)}
            {@const visibleTags = onlyShowChanges ? group.tags.filter(t => tagChangedThisSection(t.name)) : group.tags}
            <div class="rounded border border-gray-100 dark:border-gray-800">
              <!-- Congress header -->
              <button
                class="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                onclick={() => toggleCongress(group.congress)}
              >
                <span class="flex items-center gap-2">
                  <svg class="h-3 w-3 text-gray-400 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span class="font-medium text-gray-700 dark:text-gray-300">{group.label}</span>
                  <span class="text-gray-400">({group.years})</span>
                </span>
                <span class="flex items-center gap-2">
                  {#if group.changedCount > 0}
                    <span class="rounded-full bg-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                      {group.changedCount} changed this section
                    </span>
                  {/if}
                  <span class="text-[10px] text-gray-400">{group.tags.length} releases</span>
                </span>
              </button>

              <!-- Expanded release points -->
              {#if isExpanded}
                <div class="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                  {#if visibleTags.length === 0}
                    <p class="py-1 text-[11px] text-gray-400">No changes to this section in the {group.label}.</p>
                  {:else}
                    <div class="flex flex-wrap gap-1.5">
                      {#each visibleTags as tag (tag.name)}
                        {@const changed = tagChangedThisSection(tag.name)}
                        <button
                          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors
                            {selectedTag === tag.name
                              ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700'
                              : changed
                                ? 'bg-teal/10 text-teal-700 hover:bg-teal/20 dark:text-teal-300 dark:hover:bg-teal/20'
                                : 'bg-gray-50 text-gray-400 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-500 dark:hover:bg-gray-800'
                            }"
                          onclick={() => void viewTag(tag)}
                          title="{formatTagName(tag.name)} ({extractYear(tag.date, tag.name)})"
                        >
                          <span class="h-1.5 w-1.5 rounded-full {selectedTag === tag.name ? 'bg-amber' : changed ? 'bg-teal' : 'bg-gray-300 dark:bg-gray-600'}"></span>
                          {formatTagName(tag.name)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      {#if tagLoading}
        <p class="mb-4 text-xs text-gray-500">Loading version content...</p>
      {:else if selectedTagContent}
        <div class="mb-4 rounded border border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between bg-gray-50 px-3 py-1.5 text-xs dark:bg-gray-800">
            <span class="font-medium text-gray-600 dark:text-gray-300">Content at {formatTagName(selectedTag)}</span>
            <button class="text-gray-400 hover:text-gray-600" onclick={() => { selectedTagContent = ""; selectedTag = ""; }}>&times;</button>
          </div>
          <pre class="max-h-64 overflow-auto p-3 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300">{selectedTagContent}</pre>
        </div>
      {/if}

      <!-- Compare versions with congress-grouped dropdowns -->
      <h3 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200">Compare Versions</h3>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <label class="text-xs text-gray-500">From:
          <select class="ml-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200" bind:value={compareFrom}>
            {#each congressGroups as group (group.congress)}
              <optgroup label="{group.label} ({group.years})">
                {#each group.tags as tag (tag.name)}
                  <option value={tag.name}>{formatTagName(tag.name)}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
        <label class="text-xs text-gray-500">To:
          <select class="ml-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200" bind:value={compareTo}>
            {#each congressGroups as group (group.congress)}
              <optgroup label="{group.label} ({group.years})">
                {#each group.tags as tag (tag.name)}
                  <option value={tag.name}>{formatTagName(tag.name)}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
        <button
          class="rounded bg-teal px-3 py-1 text-xs text-white hover:bg-teal/80 disabled:opacity-50"
          onclick={() => void compareVersions()}
          disabled={diffLoading || !compareFrom || !compareTo || compareFrom === compareTo}
        >{diffLoading ? "Comparing..." : "Compare"}</button>
      </div>

      {#if diffLines.length > 0}
        <div class="mb-4">
          <div class="mb-1 flex items-center justify-between text-[11px] text-gray-500">
            <span>{formatTagName(compareFrom)} &rarr; {formatTagName(compareTo)}</span>
            <span>{diffLines.filter(l => l.type === 'add').length} additions, {diffLines.filter(l => l.type === 'del').length} deletions</span>
          </div>
          <pre class="max-h-96 overflow-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5 dark:bg-gray-950">{#each diffLines as line}<span class="{line.type === 'add'
  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
  : line.type === 'del'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    : 'text-gray-600 dark:text-gray-400'} block">{line.content}</span>{/each}</pre>
        </div>
      {:else if hasCompared && !diffLoading && compareFrom && compareTo && compareFrom !== compareTo}
        <p class="mb-4 rounded bg-gray-100 p-3 text-xs text-gray-500 dark:bg-gray-800">No changes between {formatTagName(compareFrom)} and {formatTagName(compareTo)} for this section.</p>
      {/if}
    {/if}

    <!-- Change history -->
    <h3 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200">Change History</h3>
    {#if commits.length === 0}
      <p class="text-gray-500">No history yet for this section.</p>
    {:else}
      {#if tags.length === 0}
        <p class="mb-3 rounded bg-teal/10 p-2 text-xs text-teal-700 dark:text-teal-300">Version timeline available when release point tags are published.</p>
      {:else if !commits.some(c => isLegislativeChange(c.message))}
        <p class="mb-3 rounded bg-amber/10 p-2 text-xs text-amber dark:bg-amber/5">No legislative changes tracked yet. Future updates will appear here as diffs.</p>
      {/if}
      <ul class="max-h-48 space-y-1 overflow-y-auto">
        {#each commits as commit (commit.sha)}
          <li class="rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
            <span>{formatCommitMessage(commit.message)}</span>
            <span class="ml-2 text-gray-400">{commitDisplayDate(commit.message, commit.date)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
