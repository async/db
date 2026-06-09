import { collection, field, files } from '@async/db/schema';

export default collection({
  description: 'Documentation pages loaded from frontmatter and raw MDX body files.',
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable document id. Defaults to the filename when frontmatter omits id.',
    }),
    title: field.string({
      required: true,
      description: 'Page title from frontmatter.',
    }),
    section: field.string({
      required: true,
      description: 'Navigation group for this page.',
    }),
    order: field.number({
      default: 100,
      description: 'Sort order inside the section.',
    }),
    summary: field.string({
      description: 'Short page summary.',
    }),
    body: field.string({
      required: true,
      description: 'Raw MDX body. Rendering and compilation are app-owned.',
    }),
  },
});
