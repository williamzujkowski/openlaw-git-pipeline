<script lang="ts">
  import { getFileHistory, getFileDiff, isRateLimited, type CommitInfo, type DiffLine } from "../lib/github";

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
  let selected = $state<string[]>([]);
  let diffLines = $state<DiffLine[]>([]);
  let loading = $state(false);
  let diffLoading = $state(false);
  let error = $state("");

  function toggleCommit(sha: string) {
    if (selected.includes(sha)) {
      selected = selected.filter((s) => s !== sha);
    } else if (selected.length < 2) {
      selected = [...selected, sha];
    } else {
      selected = [selected[1], sha];
    }
    diffLines = [];
  }

  async function loadHistory() {
    loading = true;
    error = "";
    try {
      commits = await getFileHistory(repoOwner, repoName, sectionPath, githubToken);
    } catch (e: unknown) {
      if (isRateLimited(e)) {
        error = "GitHub API rate limit reached. Try again later or provide a token.";
      } else {
        error = e instanceof Error ? e.message : "Failed to load history";
      }
    } finally {
      loading = false;
    }
  }

  async function loadDiff() {
    if (selected.length !== 2) return;
    diffLoading = true;
    error = "";
    const [a, b] = selected;
    const idxA = commits.findIndex((c) => c.sha === a);
    const idxB = commits.findIndex((c) => c.sha === b);
    const base = idxA > idxB ? a : b;
    const head = idxA > idxB ? b : a;
    try {
      const result = await getFileDiff({ owner: repoOwner, repo: repoName, base, head, path: sectionPath, token: githubToken });
      diffLines = result ?? [];
    } catch (e: unknown) {
      if (isRateLimited(e)) {
        error = "GitHub API rate limit reached. Try again later or provide a token.";
      } else {
        error = e instanceof Error ? e.message : "Failed to load diff";
      }
    } finally {
      diffLoading = false;
    }
  }

  $effect(() => {
    void loadHistory();
  });
</script>

<div class="rounded border border-gray-200 bg-white p-4 font-sans text-sm dark:border-gray-700 dark:bg-gray-900">
  <h3 class="mb-3 text-base font-semibold text-gray-800 dark:text-gray-200">Change History</h3>

  {#if loading}
    <p class="text-gray-500">Loading commit history...</p>
  {:else if error}
    <p class="text-red-600 dark:text-red-400">{error}</p>
  {:else if commits.length === 0}
    <p class="text-gray-500">No history yet for this section.</p>
  {:else}
    <p class="mb-2 text-xs text-gray-500">Select two commits to compare:</p>
    <ul class="mb-4 max-h-48 space-y-1 overflow-y-auto">
      {#each commits as commit (commit.sha)}
        <li>
          <button
            class="w-full rounded px-2 py-1 text-left text-xs transition-colors {selected.includes(commit.sha)
              ? 'bg-teal/10 text-navy ring-1 ring-teal/30 dark:bg-teal/20 dark:text-gray-100'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
            onclick={() => toggleCommit(commit.sha)}
            aria-pressed={selected.includes(commit.sha)}
          >
            <code class="font-mono text-teal dark:text-teal">{commit.sha.slice(0, 7)}</code>
            <span class="ml-2 text-gray-700 dark:text-gray-300">{commit.message}</span>
            <span class="ml-2 text-gray-400">{commit.date ? new Date(commit.date).toLocaleDateString() : ""}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if selected.length === 2}
      <button
        class="mb-3 rounded bg-teal px-3 py-1 text-xs text-white hover:bg-teal/80 disabled:opacity-50"
        onclick={() => void loadDiff()}
        disabled={diffLoading}
      >
        {diffLoading ? "Loading diff..." : "Compare selected commits"}
      </button>
    {/if}

    {#if diffLines.length > 0}
      <pre class="max-h-96 overflow-auto rounded bg-gray-50 p-3 font-mono text-xs leading-5 dark:bg-gray-950">{#each diffLines as line}<span class="{line.type === 'add'
  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
  : line.type === 'del'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    : 'text-gray-600 dark:text-gray-400'} block">{line.content}</span>{/each}</pre>
    {/if}
  {/if}
</div>
