/** Complexity ordering for the examples browser, simplest first. */
export const LEVEL_ORDER = ['starter', 'core', 'production', 'pattern'];

export const LEVEL_LABELS = {
  starter: 'Starter',
  core: 'Core',
  production: 'Production',
  pattern: 'Patterns',
};

export const LEVEL_BLURBS = {
  starter: 'First contact: one data folder, sync, serve, and the smallest schema upgrades.',
  core: 'Everyday features: relations, clients, diagnostics, computed fields, content folders, and manifests.',
  production: 'Production boundaries: registered operations, route lockdown, and app-owned auth.',
  pattern: 'App-owned workflows built on forks, branches, snapshots, and source-file stores.',
};

export const TEASER_EXAMPLE_ID = 'data-first';

/** Files shown per example in the IDE view. */
export const EXPLORER_FILE_CAP = 10;
