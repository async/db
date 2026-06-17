import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/pages/{slug}.mdx', {
    remote: 'content',
    read: 'frontmatter',
    bodyField: 'body',
  }),
  idField: 'slug',
  fields: {
    slug: field.string({ required: true }),
    title: field.string({ required: true }),
    status: field.enum(['draft', 'published'], { default: 'draft' }),
    body: field.string({ required: true }),
  },
});
