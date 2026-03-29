<script lang="ts">
  import {
    getFileHistory, getFileDiff, getReleaseTags, getFileAtRef,
    isRateLimited, formatTagName, extractYear,
    type CommitInfo, type DiffLine, type ReleaseTag,
  } from "../lib/github";

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
  let selectedTagContent = $state(""); let selectedTag = $state(""); let hasCompared = $state(false);

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
      const [commitResult, tagResult] = await Promise.all([
        getFileHistory(repoOwner, repoName, sectionPath, githubToken),
        getReleaseTags(repoOwner, repoName, githubToken),
      ]);
      // Deduplicate commits by message
      const seen = new Set<string>();
      commits = commitResult.filter(c => !seen.has(c.message) && seen.add(c.message));
      tags = tagResult;
      if (tags.length > 0) {
        compareTo = tags[tags.length - 1].name;
        if (tags.length > 1) compareFrom = tags[tags.length - 2].name;
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

  $effect(() => { void loadHistory(); });
</script>

<div class="rounded border border-gray-200 bg-white p-4 font-sans text-sm dark:border-gray-700 dark:bg-gray-900">
  {#if loading}
    <p class="text-gray-500">Loading history...</p>
  {:else if error}
    <p class="text-red-600 dark:text-red-400">{error}</p>
  {:else}
    {#if tags.length > 0}
      <h3 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200">Version Timeline</h3>
      <div class="relative mb-4 flex items-center gap-0 overflow-x-auto pb-2">
        {#each tags as tag, i (tag.name)}
          <button class="group relative flex flex-col items-center px-3" onclick={() => void viewTag(tag)}>
            {#if i > 0}
              <span class="absolute left-0 top-3 h-0.5 w-3 bg-teal/40"></span>
            {/if}
            <span class="h-3 w-3 rounded-full {selectedTag === tag.name
              ? 'bg-amber ring-2 ring-amber/40'
              : 'bg-teal group-hover:ring-2 group-hover:ring-teal/40'}"></span>
            <span class="mt-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium {selectedTag === tag.name
              ? 'bg-amber/15 text-amber-700 dark:text-amber-300'
              : 'bg-teal/10 text-teal-700 dark:text-teal-300'}">{formatTagName(tag.name)}</span>
            {#if extractYear(tag.date, tag.name)}
              <span class="text-[9px] text-gray-400">{extractYear(tag.date, tag.name)}</span>
            {/if}
          </button>
        {/each}
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

      <h3 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200">Compare Versions</h3>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <label class="text-xs text-gray-500">From:
          <select class="ml-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200" bind:value={compareFrom}>
            {#each tags as tag (tag.name)}<option value={tag.name}>{formatTagName(tag.name)}</option>{/each}
          </select>
        </label>
        <label class="text-xs text-gray-500">To:
          <select class="ml-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200" bind:value={compareTo}>
            {#each tags as tag (tag.name)}<option value={tag.name}>{formatTagName(tag.name)}</option>{/each}
          </select>
        </label>
        <button
          class="rounded bg-teal px-3 py-1 text-xs text-white hover:bg-teal/80 disabled:opacity-50"
          onclick={() => void compareVersions()}
          disabled={diffLoading || !compareFrom || !compareTo || compareFrom === compareTo}
        >{diffLoading ? "Comparing..." : "Compare"}</button>
      </div>

      {#if diffLines.length > 0}
        <pre class="mb-4 max-h-96 overflow-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5 dark:bg-gray-950">{#each diffLines as line}<span class="{line.type === 'add'
  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
  : line.type === 'del'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    : 'text-gray-600 dark:text-gray-400'} block">{line.content}</span>{/each}</pre>
      {:else if hasCompared && !diffLoading && compareFrom && compareTo && compareFrom !== compareTo}
        <p class="mb-4 rounded bg-gray-100 p-3 text-xs text-gray-500 dark:bg-gray-800">No changes between {formatTagName(compareFrom)} and {formatTagName(compareTo)} for this section.</p>
      {/if}
    {/if}

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
