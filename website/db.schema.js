// Repo-internal import; a consumer project would write:
// import { collection, field, files } from '@async/db/schema';
import { collection, field, files } from '../dist/schema-builders.js';

/** Curated allowlist and navigation registry for docs/*.md pages. */
export const registry = {
  'getting-started': {
    tier: 'start',
    order: 1,
    description: 'Install, scaffold, sync, serve, viewer, and first REST call.',
  },
  concepts: {
    tier: 'start',
    order: 2,
    description: 'Data-first JSON files, schema-first upgrades, mixed resources, and runtime stores.',
  },
  'data-files-and-schemas': {
    tier: 'build',
    order: 1,
    description: 'JSON data files, schema files, inference, validation, and computed fields.',
  },
  'generated-files': {
    tier: 'build',
    order: 2,
    description: '.db/ state, generated types, committed outputs, and schema manifests.',
  },
  configuration: {
    tier: 'build',
    order: 3,
    description: 'db.config.js, resource overrides, strictness, server options, and mocks.',
  },
  'typescript-schema-sources': {
    tier: 'build',
    order: 4,
    description: 'JavaScript ESM schemas and TypeScript-authored schemas compiled for runtime.',
  },
  'json-production': {
    tier: 'production',
    order: 1,
    description: 'Scoped production use for @async/db/json, limits, and operation boundaries.',
  },
  'prototype-to-production': {
    tier: 'production',
    order: 2,
    description: 'Move /db/* prototypes to reviewed operation refs and route lockdown.',
  },
  'store-graduation': {
    tier: 'production',
    order: 3,
    description: 'Graduate one resource from JSON to SQLite, Postgres, or custom stores.',
  },
  'fork-branch-workflows': {
    tier: 'production',
    order: 4,
    description: 'Tenants, snapshots, branches, and resource migrations as app-owned workflows.',
  },
  'cms-storage-patterns': {
    tier: 'production',
    order: 5,
    description: 'CMS draft/publish helpers over JSON, SQLite indexes, Postgres, and static outputs.',
  },
  'package-api': {
    tier: 'reference',
    order: 1,
    description: 'CLI commands, runtime API, HTTP client, schema/config helpers, and exports.',
  },
  'server-and-viewer': {
    tier: 'reference',
    order: 2,
    description: 'REST routes, registered operations, GraphQL boundary, viewer, and watch behavior.',
  },
  integrations: {
    tier: 'reference',
    order: 3,
    description: 'Vite plugin, Hono route registration, SQLite starter generation, and optional deps.',
  },
};

/** Advanced settings atlas under docs/advanced/*.md — separate collection to avoid id collisions. */
export const advancedRegistry = {
  overview: {
    tier: 'advanced',
    order: 1,
    description: 'Decision map for config, schema, stores, routes, operations, mocks, and generated output.',
  },
  configuration: {
    tier: 'advanced',
    order: 2,
    description: 'When defaults stop matching the app: folders, outputs, route bases, and strictness.',
  },
  schema: {
    tier: 'advanced',
    order: 3,
    description: 'Infer first, then make contracts explicit when the app depends on them.',
  },
  'runtime-stores': {
    tier: 'advanced',
    order: 4,
    description: 'Graduate one resource at a time from JSON to SQLite, Postgres, or custom stores.',
  },
  server: {
    tier: 'advanced',
    order: 5,
    description: 'REST as the local app contract; viewer and tool routes on their own base.',
  },
  operations: {
    tier: 'advanced',
    order: 6,
    description: 'Allowlisted REST or GraphQL templates, generated refs, and route lockdown.',
  },
  mocking: {
    tier: 'advanced',
    order: 7,
    description: 'Delay, random errors, and schema-only seed records for local UI states.',
  },
  'generated-files': {
    tier: 'advanced',
    order: 8,
    description: 'What stays ignored, what can be committed, and which examples do it.',
  },
};

const docPaths = Object.keys(registry).map((id) => `../docs/${id}.md`);

function createPageFields(sourceRegistry) {
  return {
    id: field.string({
      required: true,
      description: 'Stable page id from the markdown filename.',
    }),
    body: field.string({
      required: true,
      description: 'Raw markdown body. Rendering is site-owned.',
    }),
    title: field.computed(field.string({
      description: 'Page title derived from the first ATX heading.',
    }), function page_title_resolver({ record }) {
      const match = String(record.body ?? '').match(/^#\s+(.+)$/m);
      return match?.[1]?.trim() ?? record.id;
    }),
    slug: field.computed(field.string({
      description: 'URL slug, equal to the page id.',
    }), function page_slug_resolver({ record }) {
      return record.id;
    }),
    tier: field.computed(field.string({
      description: 'Navigation tier from the schema registry.',
    }), function page_tier_resolver({ record }) {
      return sourceRegistry[record.id]?.tier ?? 'reference';
    }),
    navOrder: field.computed(field.number({
      description: 'Sort order inside the navigation tier.',
    }), function page_nav_order_resolver({ record }) {
      return sourceRegistry[record.id]?.order ?? 999;
    }),
    description: field.computed(field.string({
      description: 'Short page summary from the schema registry.',
    }), function page_description_resolver({ record }) {
      return sourceRegistry[record.id]?.description ?? '';
    }),
    readingTimeMinutes: field.computed(field.number({
      description: 'One-minute minimum reading-time estimate from the raw body.',
    }), {
      resolveMany({ records }) {
        return records.map((record) => readingTimeMinutes(record.body));
      },
    }),
  };
}

export default {
  pages: collection({
    description: 'Documentation pages loaded from the curated ../docs markdown allowlist.',
    source: files(docPaths, { read: 'text' }),
    idField: 'id',
    fields: {
      ...createPageFields(registry),
      htmlPath: field.computed(field.string({
        description: 'Built HTML path relative to the site root.',
      }), function pages_html_path_resolver({ record }) {
        return `/docs/${record.id}.html`;
      }),
    },
  }),
  advanced: collection({
    description: 'Advanced settings atlas loaded from ../docs/advanced/*.md.',
    source: files('../docs/advanced/*.md', { read: 'text' }),
    idField: 'id',
    fields: {
      ...createPageFields(advancedRegistry),
      htmlPath: field.computed(field.string({
        description: 'Built HTML path relative to the site root.',
      }), function advanced_html_path_resolver({ record }) {
        return `/docs/advanced/${record.id}.html`;
      }),
    },
  }),
};

function readingTimeMinutes(body) {
  const wordCount = String(body ?? '').trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}
