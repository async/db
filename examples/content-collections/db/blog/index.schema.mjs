import { collection, field, files } from '@async/db/schema';

export default collection({
  description: 'Blog posts loaded from frontmatter and raw MDX body files.',
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable post id. Defaults to the filename when frontmatter omits id.',
    }),
    title: field.string({
      required: true,
      description: 'Post title from frontmatter.',
    }),
    status: field.enum(['draft', 'published'], {
      default: 'draft',
      description: 'Publication state.',
    }),
    publishedAt: field.datetime({
      description: 'Publication timestamp.',
    }),
    authorId: field.string({
      required: true,
      description: 'Author id from the authors fixture.',
      relation: {
        name: 'author',
        to: 'authors',
        toField: 'id',
        cardinality: 'one',
      },
    }),
    tags: field.string({
      description: 'Comma-separated tags kept scalar for the dependency-free frontmatter parser.',
    }),
    summary: field.string({
      description: 'Short post summary.',
    }),
    body: field.string({
      required: true,
      description: 'Raw MDX body. Rendering and compilation are app-owned.',
    }),
    permalink: field.computed(field.string({
      description: 'Read-only URL path derived from the post id.',
    }), function blog_permalink_resolver({ record }) {
      return `/blog/${record.id}`;
    }),
    readingTimeMinutes: field.computed(field.number({
      description: 'Read-only one-minute minimum estimate derived from the raw body.',
    }), {
      resolveMany({ records }) {
        return records.map((record) => readingTimeMinutes(record.body));
      },
    }),
  },
});

function readingTimeMinutes(body) {
  const wordCount = String(body ?? '').trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}
