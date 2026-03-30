<script lang="ts">
  /**
   * In-title search filter for the expandable TOC.
   * Filters sections by keyword, auto-expanding matching chapters
   * and hiding non-matching sections. Zero-overhead when empty.
   */

  interface Props {
    /** CSS selector for the TOC container */
    tocSelector?: string;
    /** Placeholder text */
    placeholder?: string;
  }

  let { tocSelector = '#title-toc', placeholder = 'Filter sections...' }: Props = $props();
  let query = $state('');
  let matchCount = $state(0);
  let totalCount = $state(0);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function applyFilter(q: string): void {
    const toc = document.querySelector(tocSelector);
    if (!toc) return;

    const details = toc.querySelectorAll('details');
    const normalizedQuery = q.toLowerCase().trim();
    let matches = 0;
    let total = 0;

    for (const detail of details) {
      const items = detail.querySelectorAll('li');
      let chapterHasMatch = false;

      for (const item of items) {
        total++;
        const text = item.textContent?.toLowerCase() ?? '';
        if (!normalizedQuery || text.includes(normalizedQuery)) {
          (item as HTMLElement).style.display = '';
          matches++;
          chapterHasMatch = true;
        } else {
          (item as HTMLElement).style.display = 'none';
        }
      }

      // Auto-expand chapters with matches, collapse empty ones
      if (normalizedQuery) {
        detail.open = chapterHasMatch;
        (detail as HTMLElement).style.display = chapterHasMatch ? '' : 'none';
      } else {
        // Reset: show all, restore default open state
        (detail as HTMLElement).style.display = '';
      }
    }

    matchCount = matches;
    totalCount = total;
  }

  $effect(() => {
    const q = query;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applyFilter(q), 150);
    return () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    };
  });
</script>

<div class="relative font-sans">
  <div class="relative">
    <svg class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      type="text"
      bind:value={query}
      placeholder={placeholder}
      class="w-full rounded border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-xs text-gray-900 placeholder-gray-400 focus:border-teal focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600 sm:w-72"
      aria-label="Filter sections within this title"
    />
    {#if query}
      <button
        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        onclick={() => { query = ''; }}
        aria-label="Clear filter"
      >&times;</button>
    {/if}
  </div>
  {#if query}
    <p class="mt-1 text-[11px] text-gray-400">
      {matchCount} of {totalCount} sections match
    </p>
  {/if}
</div>
