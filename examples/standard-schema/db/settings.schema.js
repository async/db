import { document } from '@async/db/schema';

const SettingsSchema = {
  '~standard': {
    version: 1,
    vendor: 'opaque-standard-schema',
    validate(value) {
      return value && typeof value === 'object' && !Array.isArray(value)
        ? { value }
        : { issues: [{ message: 'Expected settings object' }] };
    },
  },
};

export default document(SettingsSchema, {
  seed: {
    theme: 'light',
    flags: {
      preview: true,
    },
  },
});
