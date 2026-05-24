import { collection, field } from '@async/db/schema';

export default collection({
  description: 'People who write or edit content records.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable author id used by content frontmatter.',
    }),
    name: field.string({
      required: true,
      description: 'Display name shown on bylines.',
    }),
    role: field.enum(['Editor', 'Author'], {
      default: 'Author',
      description: 'Editorial role in the local content workflow.',
    }),
  },
});
