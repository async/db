import { collection, field } from '@async/db/schema';

export default collection({
  description: 'People used by posts and orders.',
  idField: 'id',
  fields: {
    id: field.string({
      required: true,
      description: 'Stable user id.',
    }),
    firstName: field.string({
      required: true,
      description: 'Given name stored in the fixture.',
    }),
    lastName: field.string({
      required: true,
      description: 'Family name stored in the fixture.',
    }),
    role: field.enum(['admin', 'editor', 'customer'], {
      default: 'customer',
      description: 'Local role for examples.',
    }),
    fullName: field.computed(field.string({
      description: 'Display name assembled from first and last name.',
    }), function users_fullName_resolver() {
      return `${this.value.firstName} ${this.value.lastName}`;
    }),
  },
  seed: [
    {
      id: 'u_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'admin',
    },
    {
      id: 'u_2',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'editor',
    },
  ],
});
