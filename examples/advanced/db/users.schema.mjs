import { collection, field } from '@async/db/schema';

export default collection({
  description: 'Users who can sign into the local test app.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.',
    }),
    name: field.string({
      required: true,
      description: 'Display name shown in the UI.',
    }),
    email: field.string({
      required: true,
      description: 'Unique email address.',
    }),
    role: field.enum(['admin', 'editor', 'user'], {
      default: 'user',
      description: 'Local authorization role.',
    }),
    twitterHandle: field.string({
      description: 'Optional social handle used by local profile demos.',
    }),
    profile: field.object({
      title: field.string({ default: 'Contributor' }),
      location: field.string({ default: 'Remote' }),
    }),
  },
});
