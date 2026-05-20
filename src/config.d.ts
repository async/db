import type { JsonDbOptions } from './index.d.ts';

export type {
  JsonDbSourceReader,
  JsonDbSourceReaderContext,
  JsonDbSourceReaderResult,
  JsonDbSourceReaderDataResult,
  JsonDbSourceReaderSchemaResult,
  JsonDbSourcesOptions,
  JsonDbCustomStore,
  JsonDbCustomStoreFactory,
  JsonDbStoreName,
  JsonDbStoreOptions,
  JsonDbStoresOptions,
} from './index.d.ts';

/**
 * jsondb project configuration.
 *
 * Use with `// @ts-check` in `jsondb.config.mjs` for editor autocomplete:
 *
 * ```js
 * import { defineConfig } from 'jsondb/config';
 *
 * export default defineConfig({
 *   dbDir: './db',
 * });
 * ```
 */
export type JsonDbConfig = JsonDbOptions;

/**
 * Type-only helper for authoring `jsondb.config.mjs`.
 *
 * It returns the config unchanged at runtime and exists so JavaScript config
 * files get autocomplete, literal value checking, and inline JSDoc.
 */
export function defineConfig<Config extends JsonDbConfig>(config: Config): Config;

/** Deep-merge JSON-serializable manifest patches without mutating inputs. */
export function mergeManifest<Base, Patch>(base: Base, patch: Patch): Base & Patch;

/** Derive a resource name from a fixture path using jsondb naming strategies. */
export function resourceNameFromPath(file: string, options?: { strategy?: 'basename' | 'folder-prefixed' | 'path' }): string;

/** Parse a fixture path into folder, basename, filename, and extension metadata. */
export function parseFixturePath(file: string): {
  file: string;
  folders: string[];
  folder: string | null;
  filename: string;
  basename: string;
  extension: string;
};
