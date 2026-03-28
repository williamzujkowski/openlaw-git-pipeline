<script lang="ts">
  // Pagefind types for the dynamically imported module
  interface PagefindResult {
    id: string;
    data: () => Promise<PagefindResultData>;
  }

  interface PagefindResultData {
    url: string;
    meta: { title?: string };
    excerpt: string;
  }

  interface PagefindResponse {
    results: PagefindResult[];
  }

  interface PagefindModule {
    init: () => Promise<void>;
    search: (query: string) => Promise<PagefindResponse>;
  }

  let query = $state('');
  let results = $state<PagefindResultData[]>([]);
  let loading = $state(false);
  let showResults = $state(false);
  let pagefind = $state<PagefindModule | null>(null);
  let devMode = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Load Pagefind on mount
  $effect(() => {
    loadPagefind();
    return () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    };
  });

  async function loadPagefind(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // Use string concatenation to prevent Vite/Rollup from resolving this at build time.
      // Pagefind generates its JS bundle into dist/pagefind/ during the post-build step.
      const path = '/pagefind/' + 'pagefind.js';
      const mod = (await import(/* @vite-ignore */ path)) as PagefindModule;
      await mod.init();
      pagefind = mod;
    } catch {
      // Pagefind bundle only exists after build; in dev mode it's unavailable
      devMode = true;
    }
  }

  // Debounced search triggered by query changes
  $effect(() => {
    const q = query;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);

    if (q.length === 0) {
      results = [];
      showResults = false;
      return;
    }

    loading = true;
    showResults = true;
    debounceTimer = setTimeout(() => {
      performSearch(q);
    }, 300);
  });

  async function performSearch(q: string): Promise<void> {
    if (!pagefind || q.length === 0) {
      loading = false;
      return;
    }

    try {
      const response = await pagefind.search(q);
      const loaded = await Promise.all(
        response.results.slice(0, 10).map((r) => r.data())
      );
      results = loaded;
    } catch {
      results = [];
    } finally {
      loading = false;
    }
  }

  function closeResults(): void {
    // Delay to allow click on result links
    setTimeout(() => {
      showResults = false;
    }, 200);
  }
</script>

<div class="relative font-sans" role="search">
  <label for="search-input" class="sr-only">Search the US Code</label>
  <div class="relative">
    <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </span>
    <input
      id="search-input"
      type="search"
      placeholder={devMode ? 'Search available in production build' : 'Search...'}
      disabled={devMode}
      bind:value={query}
      onfocusin={() => { if (query.length > 0) showResults = true; }}
      onfocusout={closeResults}
      class="w-full rounded border border-gray-300 bg-white py-1 pl-8 pr-2 text-xs text-gray-900 placeholder-gray-400 focus:border-teal focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-600 lg:w-48"
    />
  </div>

  {#if showResults}
    <div class="absolute left-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
      {#if loading}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Searching...</div>
      {:else if results.length === 0}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No results found.</div>
      {:else}
        <ul class="divide-y divide-gray-100 dark:divide-gray-800">
          {#each results as result}
            <li>
              <a
                href={result.url}
                class="block px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div class="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {result.meta.title ?? 'Untitled'}
                </div>
                <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html result.excerpt}
                </div>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
