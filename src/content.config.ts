import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().nullable().default(null),
    category: z.enum(['picture-book', 'short-fiction', 'ya-novel', 'poetry', 'other']),
    status: z
      .enum(['querying', 'on-submission', 'in-progress', 'drafting', 'complete', 'published', 'tbd'])
      .default('tbd'),
    wordCount: z.number().int().positive().nullable().default(null),
    genre: z.string().nullable().default(null),
    audience: z.string().nullable().default(null),
    year: z.number().int().nullable().default(null),
    recognition: z.string().nullable().default(null),
    excerpt: z.string().nullable().default(null),
    featured: z.boolean().default(false),
    order: z.number().default(999),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      updated: z.coerce.date().nullable().default(null),
      cover: image().nullable().default(null),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

const causes = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/causes' }),
  schema: z.object({
    name: z.string(),
    url: z.string().url(),
    blurb: z.string(),
    handles: z
      .array(
        z.object({
          platform: z.enum(['instagram', 'bluesky', 'facebook', 'x', 'tiktok', 'youtube']),
          url: z.string().url(),
          label: z.string(),
        }),
      )
      .default([]),
    order: z.number().default(999),
  }),
});

export const collections = { works, blog, causes };
