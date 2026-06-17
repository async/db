import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

export default collection({
  source: gitFiles('content/authors/{id}.json', {
    remote: 'content',
    read: 'json',
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    name: field.string({ required: true }),
    role: field.string(),
  },
});
