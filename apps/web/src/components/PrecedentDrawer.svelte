<script lang="ts">
  import type { CaseAnnotation } from '../lib/types';

  interface Props {
    sectionId: string;
    annotations: CaseAnnotation[];
  }

  const COURT_ORDER: CaseAnnotation['court'][] = ['SCOTUS', 'Appellate', 'District'];
  // Use custom theme colors (--color-amber, --color-teal, --color-slate) for consistency
  const COURT_COLORS: Record<CaseAnnotation['court'], string> = {
    SCOTUS: 'text-amber dark:text-amber',
    Appellate: 'text-teal dark:text-teal-bright',
    District: 'text-slate dark:text-gray-400',
  };

  const IMPACT_COLORS: Record<CaseAnnotation['impact'], string> = {
    interpretation: 'bg-teal/10 text-teal dark:bg-teal/20 dark:text-teal-bright',
    unconstitutional: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    narrowed: 'bg-amber/10 text-amber dark:bg-amber/20 dark:text-amber',
    historical: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  let { sectionId, annotations }: Props = $props();
  let open = $state(false);
  let expandedHoldings = $state<Set<number>>(new Set());

  function grouped(): Map<CaseAnnotation['court'], CaseAnnotation[]> {
    const map = new Map<CaseAnnotation['court'], CaseAnnotation[]>();
    for (const court of COURT_ORDER) {
      const cases = annotations.filter((a) => a.court === court);
      if (cases.length > 0) map.set(court, cases);
    }
    return map;
  }

  function toggleHolding(idx: number): void {
    const next = new Set(expandedHoldings);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedHoldings = next;
  }
</script>

{#if annotations.length > 0}
  <!-- Toggle button -->
  <button
    onclick={() => (open = !open)}
    class="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-md bg-teal px-2 py-3 text-xs font-semibold text-white shadow-lg hover:opacity-90 transition-opacity"
    aria-label={open ? 'Close precedent drawer' : 'Open precedent drawer'}
    aria-expanded={open}
    aria-controls="precedent-drawer-panel"
  >
    {open ? '›' : '‹'} Cases ({annotations.length})
  </button>

  <!-- Drawer panel -->
  {#if open}
    <aside
      id="precedent-drawer-panel"
      class="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl sm:w-[400px] dark:border-gray-700 dark:bg-gray-950"
      aria-label="Precedent annotations"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-bold text-slate-900 dark:text-gray-100">
          Precedent <code class="text-sm font-mono">§{sectionId}</code>
        </h2>
        <button
          onclick={() => (open = false)}
          class="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Close drawer"
        >✕</button>
      </div>

      <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
      </p>

      {#each [...grouped()] as [court, cases]}
        <h3 class="mt-4 mb-2 text-xs font-bold uppercase tracking-wide {COURT_COLORS[court]}">
          {court} ({cases.length})
        </h3>
        <ul class="space-y-3">
          {#each cases as c, i}
            {@const globalIdx = annotations.indexOf(c)}
            <li class="rounded border border-gray-100 p-3 dark:border-gray-700">
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm font-medium text-teal underline-offset-2 hover:underline dark:text-teal-bright"
              >{c.caseName}</a>
              <div class="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{c.citation} · {c.court} · {c.date}</span>
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium {IMPACT_COLORS[c.impact]}">
                  {c.impact}
                </span>
              </div>
              <p class="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                class:line-clamp-2={!expandedHoldings.has(globalIdx)}
              >
                {c.holdingSummary}
              </p>
              {#if c.holdingSummary.length > 120}
                <button
                  onclick={() => toggleHolding(globalIdx)}
                  class="mt-1 text-xs text-teal hover:underline dark:text-teal-bright"
                >{expandedHoldings.has(globalIdx) ? 'show less' : 'show more'}</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/each}
    </aside>
  {/if}
{/if}
