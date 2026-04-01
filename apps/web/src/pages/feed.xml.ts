import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const statutes = await getCollection('statutes');

  // Sort by generated_at descending to get most recently updated sections
  const sorted = statutes
    .filter(s => s.data.generated_at)
    .sort((a, b) => {
      const aDate = a.data.generated_at ?? '';
      const bDate = b.data.generated_at ?? '';
      return bDate.localeCompare(aDate);
    })
    .slice(0, 50);

  return rss({
    title: 'US Code Tracker — Recent Updates',
    description: 'Track amendments to the United States Code. Updated weekly from the Office of the Law Revision Counsel.',
    site: context.site ?? 'https://civic-source.github.io/us-code-tracker/',
    items: sorted.map(entry => ({
      title: `${entry.data.usc_title} U.S.C. § ${entry.data.usc_section} — ${entry.data.title.replace(/^Section \S+ - /, '')}`,
      pubDate: new Date(entry.data.generated_at ?? Date.now()),
      link: `/us-code-tracker/statute/${entry.id}/`,
      description: `${entry.data.classification}. Current through ${entry.data.current_through}.`,
    })),
  });
}
