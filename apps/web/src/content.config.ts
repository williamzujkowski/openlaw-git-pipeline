import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const statutes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content-data/statutes' }),
  schema: z.object({
    title: z.string(),
    usc_title: z.number(),
    usc_section: z.string(),
    chapter: z.number(),
    current_through: z.string(),
    classification: z.string(),
    generated_at: z.string().optional(),
    status: z.enum(['active', 'repealed', 'reserved', 'omitted', 'transferred', 'renumbered']).default('active'),
  }),
});

export const collections = { statutes };
