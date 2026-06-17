import { document, field } from '@async/db/schema';
import { gitFile } from '@async/db/git';

export default document({
  source: gitFile('content/site.json', {
    remote: 'content',
    read: 'json',
  }),
  fields: {
    title: field.string({ required: true }),
    theme: field.string(),
  },
});
