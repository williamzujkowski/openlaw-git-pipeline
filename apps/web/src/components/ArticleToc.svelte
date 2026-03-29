<script lang="ts">
  /**
   * Auto-generated table of contents for statute content.
   * Scans the target element for h2/h3 headings and renders a
   * sticky sidebar TOC with active section highlighting.
   * Only renders when 3+ headings are found.
   */

  interface TocEntry {
    id: string;
    text: string;
    level: number;
  }

  interface Props {
    /** CSS selector for the content element to scan for headings */
    contentSelector?: string;
  }

  let { contentSelector = '.prose' }: Props = $props();

  let entries = $state<TocEntry[]>([]);
  let activeId = $state('');

  $effect(() => {
    const content = document.querySelector(contentSelector);
    if (!content) return;

    // Scan for headings
    const headings = content.querySelectorAll('h2, h3');
    const found: TocEntry[] = [];
    let counter = 0;

    for (const el of headings) {
      const heading = el as HTMLElement;
      // Ensure heading has an id for linking
      if (!heading.id) {
        heading.id = `toc-${counter++}`;
      }
      found.push({
        id: heading.id,
        text: heading.textContent?.trim() ?? '',
        level: heading.tagName === 'H2' ? 2 : 3,
      });
    }

    entries = found;

    if (found.length < 3) return; // Don't observe if too few headings

    // IntersectionObserver for active section highlighting
    const observer = new IntersectionObserver(
      (intersections) => {
        for (const entry of intersections) {
          if (entry.isIntersecting) {
            activeId = entry.target.id;
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    for (const heading of headings) {
      observer.observe(heading);
    }

    return () => observer.disconnect();
  });
</script>

{#if entries.length >= 3}
  <nav class="sticky top-6 font-sans" aria-label="On this page">
    <h2 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate dark:text-gray-500">
      On this page
    </h2>
    <ul class="max-h-[calc(100vh-10rem)] space-y-0.5 overflow-y-auto text-xs">
      {#each entries as entry (entry.id)}
        <li>
          <a
            href="#{entry.id}"
            class="block rounded px-2 py-0.5 transition-colors {entry.level === 3 ? 'pl-4' : ''}
              {activeId === entry.id
                ? 'bg-teal/10 font-medium text-teal dark:text-teal-bright'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
              }"
          >
            {entry.text}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
