import type { DbOptions } from './index.d.ts';

export type {
  DbSourceReader,
  DbSourceReaderContext,
  DbSourceReaderResult,
  DbSourceReaderDataResult,
  DbSourceReaderSchemaResult,
  DbSourcesOptions,
  DbCustomStore,
  DbCustomStoreFactory,
  DbStoreName,
  DbStoreOptions,
  DbStoresOptions,
} from './index.d.ts';

/**
 * db project configuration.
 *
 * Use with `// @ts-check` in `db.config.js` for editor autocomplete:
 *
 * ```js
 * import { defineConfig } from '@async/db/config';
 *
 * export default defineConfig({
 *   dbDir: './db',
 * });
 * ```
 */
export type DbConfig = DbOptions;

/**
 * Type-only helper for authoring `db.config.js`.
 *
 * It returns the config unchanged at runtime and exists so JavaScript config
 * files get autocomplete, literal value checking, and inline JSDoc.
 */
export function defineConfig<Config extends DbConfig>(config: Config): Config;

/** Deep-merge JSON-serializable manifest patches without mutating inputs. */
export function mergeManifest<Base, Patch>(base: Base, patch: Patch): Base & Patch;

/** Derive a resource name from a fixture path using db naming strategies. */
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
