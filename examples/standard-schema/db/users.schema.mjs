import { collection, field } from '@async/db/schema';

const UserSchema = {
  '~standard': {
    version: 1,
    vendor: 'example-standard-schema',
    async validate(value) {
      await Promise.resolve();
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'Expected an object' }] };
      }
      if (typeof value.email !== 'string' || !value.email.includes('@')) {
        return {
          issues: [
            {
              message: 'Email must include @',
              path: ['email'],
            },
          ],
        };
      }
      return {
        value: {
          ...value,
          email: value.email.trim().toLowerCase(),
        },
      };
    },
    jsonSchema: {
      output() {
        return {
          type: 'object',
          required: ['email', 'firstName', 'lastName'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string', description: 'Email address used for sign-in.' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        };
      },
    },
  },
};

export default collection({
  idField: 'id',
  validator: UserSchema,
  fields: {
    email: field.string({
      required: true,
      unique: true,
      description: 'Normalized login email.',
    }),
    displayName: field.computed(field.string(), {
      resolveMany({ records }) {
        return new Map(records.map((record) => [
          record.id,
          `${record.firstName} ${record.lastName}`,
        ]));
      },
    }),
  },
  seed: [
    {
      id: 'u_1',
      email: ' ADA@EXAMPLE.COM ',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
  ],
});
