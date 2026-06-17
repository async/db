import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/posts/{id}.mdx', {
    remote: 'content',
    read: 'frontmatter',
    bodyField: 'body',
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    status: field.enum(['draft', 'published'], { default: 'draft' }),
    body: field.string({ required: true }),
  },
});
