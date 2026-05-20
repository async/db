import { renderJsonViewer } from '../web/json-viewer.js';

const BUILT_IN_FORMATS = {
  json: {
    mediaTypes: ['application/json'],
    contentType: 'application/json; charset=utf-8',
    renderResource: ({ data }) => `${JSON.stringify(data, null, 2)}\n`,
    renderManifest: ({ data }) => `${JSON.stringify(data, null, 2)}\n`,
  },
  html: {
    mediaTypes: ['text/html'],
    contentType: 'text/html; charset=utf-8',
    renderResource: ({ data, url }) => renderJsonViewer(data, { title: jsonViewerTitle(url) }),
    renderManifest: ({ data }) => renderJsonViewer(data, { title: 'db viewer manifest' }),
  },
  md: {
    mediaTypes: ['text/markdown'],
    contentType: 'text/markdown; charset=utf-8',
    renderResource: ({ resource, data }) => renderMarkdownJson(resource.name, data, [
      ['Resource', resource.name],
      ['Kind', resource.kind],
      ['Route', resource.routePath],
    ]),
    renderManifest: ({ data, routes }) => renderMarkdownJson('db viewer manifest', data, [
      ['Kind', 'db.viewerManifest'],
      ['JSON', routes?.manifestJsonPath ?? manifestPathForFormat(routes, 'json')],
    ]),
  },
};

export function normalizeRestFormatRegistry(config = {}) {
  const configuredFormats = config.rest?.formats ?? {};
  const keys = new Set([
    ...Object.keys(BUILT_IN_FORMATS),
    ...Object.keys(configuredFormats).filter((key) => key !== 'default'),
  ]);
  const registry = {};

  for (const key of keys) {
    registry[key] = normalizeFormatDefinition(key, configuredFormats[key], BUILT_IN_FORMATS[key]);
  }

  return registry;
}

export function negotiateRestFormat(config, request, target = 'resource') {
  const accept = headerValue(request, 'accept');
  const fallback = defaultFormatKey(config, target);
  if (!accept) {
    return fallback;
  }

  const preferences = parseAcceptHeader(accept);
  if (preferences.length === 0) {
    return fallback;
  }

  const registry = normalizeRestFormatRegistry(config);
  let bestFormat = null;
  let bestScore = {
    quality: 0,
    specificity: -1,
    index: Number.MAX_SAFE_INTEGER,
  };

  for (const [format, definition] of Object.entries(registry)) {
    if (!rendererForTarget(definition, target)) {
      continue;
    }

    for (const mediaType of definition.mediaTypes ?? []) {
      const score = acceptedMediaScore(preferences, mediaType);
      if (compareAcceptScores(score, bestScore) > 0) {
        bestFormat = format;
        bestScore = score;
      }
    }
  }

  return bestScore.quality > 0 ? bestFormat : fallback;
}

export function resolveRestFormat(config, format, target = 'resource') {
  const registry = normalizeRestFormatRegistry(config);
  const key = format ?? defaultFormatKey(config, target);
  return resolveRestFormatFromRegistry(config, registry, key, target);
}

export function availableRestFormats(config = {}, target = null) {
  const registry = normalizeRestFormatRegistry(config);
  return Object.keys(registry)
    .filter((format) => !target || resolveRestFormat(config, format, target)?.renderer)
    .sort();
}

export function restFormatMetadata(config = {}, routes = {}) {
  const registry = normalizeRestFormatRegistry(config);
  return Object.fromEntries(availableRestFormats(config).map((format) => {
    const definition = registry[format];
    return [format, {
      extension: `.${format}`,
      mediaTypes: definition.mediaTypes ?? [],
      contentType: definition.contentType ?? contentTypeForMediaTypes(definition.mediaTypes),
      manifestPath: manifestPathForFormat(routes, format),
    }];
  }));
}

export function manifestPathForFormat(routes = {}, format) {
  if (format === 'json' && routes.manifestJsonPath) {
    return routes.manifestJsonPath;
  }

  if (format === 'html' && routes.manifestHtmlPath) {
    return routes.manifestHtmlPath;
  }

  if (format === 'md' && routes.manifestMarkdownPath) {
    return routes.manifestMarkdownPath;
  }

  return `${routes.manifestPath ?? '/__db/manifest'}.${format}`;
}

export function renderMarkdownJson(title, value, metadata = []) {
  return [
    `# ${title}`,
    '',
    ...metadata.map(([label, detail]) => `- ${label}: \`${escapeMarkdownInline(detail)}\``),
    '',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
    '',
  ].join('\n');
}

function normalizeFormatDefinition(key, configured, fallback) {
  const base = fallback ?? {};

  if (typeof configured === 'string') {
    return {
      key,
      alias: configured,
      mediaTypes: normalizeMediaTypes(base.mediaTypes),
      contentType: base.contentType ?? contentTypeForMediaTypes(base.mediaTypes),
    };
  }

  if (typeof configured === 'function') {
    return {
      key,
      mediaTypes: normalizeMediaTypes(base.mediaTypes),
      contentType: base.contentType ?? contentTypeForMediaTypes(base.mediaTypes),
      renderResource: configured,
      renderManifest: base.renderManifest,
    };
  }

  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    const mediaTypes = normalizeMediaTypes(configured.mediaTypes ?? base.mediaTypes);
    const genericRenderer = typeof configured.render === 'function'
      ? configured.render
      : null;
    return {
      key,
      mediaTypes,
      contentType: configured.contentType ?? base.contentType ?? contentTypeForMediaTypes(mediaTypes),
      renderResource: typeof configured.renderResource === 'function'
        ? configured.renderResource
        : genericRenderer ?? base.renderResource,
      renderManifest: typeof configured.renderManifest === 'function'
        ? configured.renderManifest
        : genericRenderer ?? base.renderManifest,
    };
  }

  return {
    key,
    mediaTypes: normalizeMediaTypes(base.mediaTypes),
    contentType: base.contentType ?? contentTypeForMediaTypes(base.mediaTypes),
    renderResource: base.renderResource,
    renderManifest: base.renderManifest,
  };
}

function resolveRestFormatFromRegistry(config, registry, key, target, seen = new Set()) {
  const normalizedKey = normalizeFormatKey(key);
  if (!normalizedKey) {
    return null;
  }

  if (seen.has(normalizedKey)) {
    return null;
  }
  seen.add(normalizedKey);

  if (normalizedKey === 'default') {
    const configured = config.rest?.formats?.default;
    if (typeof configured === 'string') {
      return resolveRestFormatFromRegistry(config, registry, configured, target, seen);
    }

    if (typeof configured === 'function') {
      return target === 'resource'
        ? {
          key: 'default',
          contentType: 'text/plain; charset=utf-8',
          renderer: configured,
        }
        : resolveRestFormatFromRegistry(config, registry, 'json', target, seen);
    }

    if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
      const definition = normalizeFormatDefinition('default', configured, null);
      const renderer = rendererForTarget(definition, target);
      if (renderer) {
        return {
          key: 'default',
          contentType: definition.contentType,
          renderer,
        };
      }
    }

    return resolveRestFormatFromRegistry(config, registry, 'json', target, seen);
  }

  const definition = registry[normalizedKey];
  if (!definition) {
    return null;
  }

  if (definition.alias) {
    return resolveRestFormatFromRegistry(config, registry, definition.alias, target, seen);
  }

  const renderer = rendererForTarget(definition, target);
  if (!renderer) {
    return null;
  }

  return {
    key: normalizedKey,
    contentType: definition.contentType ?? contentTypeForMediaTypes(definition.mediaTypes),
    renderer,
  };
}

function defaultFormatKey(config, target) {
  const configured = config.rest?.formats?.default;
  if (typeof configured === 'string') {
    return configured;
  }

  if (target === 'resource' && (typeof configured === 'function' || configured)) {
    return 'default';
  }

  return 'json';
}

function rendererForTarget(definition, target) {
  return target === 'manifest' ? definition.renderManifest : definition.renderResource;
}

function normalizeFormatKey(value) {
  return String(value ?? '').replace(/^\./, '').trim();
}

function normalizeMediaTypes(value) {
  if (!value) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().toLowerCase());
}

function contentTypeForMediaTypes(mediaTypes = []) {
  return mediaTypes[0] ? `${mediaTypes[0]}; charset=utf-8` : 'text/plain; charset=utf-8';
}

function jsonViewerTitle(url) {
  if (!url?.pathname) {
    return 'db JSON';
  }

  return url.pathname.split('/').filter(Boolean).pop() ?? 'db JSON';
}

function escapeMarkdownInline(value) {
  return String(value).replaceAll('`', '\\`');
}

function headerValue(request, name) {
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name);
  }

  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
}

function parseAcceptHeader(value) {
  return String(value).split(',').map((entry, index) => {
    const [mediaRange, ...parameters] = entry.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const [name, rawValue] = parameter.trim().split('=');
      if (name?.toLowerCase() === 'q') {
        const parsed = Number(rawValue);
        quality = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
      }
    }

    return {
      index,
      mediaRange: mediaRange.toLowerCase(),
      quality,
    };
  }).filter((preference) => preference.mediaRange.includes('/'));
}

function acceptedMediaScore(preferences, mediaType) {
  const [wantedType, wantedSubtype] = mediaType.split('/');
  let best = {
    quality: 0,
    specificity: -1,
    index: Number.MAX_SAFE_INTEGER,
  };

  for (const preference of preferences) {
    const [type, subtype] = preference.mediaRange.split('/');
    if ((type !== '*' && type !== wantedType) || (subtype !== '*' && subtype !== wantedSubtype)) {
      continue;
    }

    const specificity = Number(type !== '*') + Number(subtype !== '*');
    const candidate = {
      quality: preference.quality,
      specificity,
      index: preference.index,
    };
    if (compareAcceptScores(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best;
}

function compareAcceptScores(left, right) {
  if (left.quality !== right.quality) {
    return left.quality - right.quality;
  }
  if (left.specificity !== right.specificity) {
    return left.specificity - right.specificity;
  }
  return right.index - left.index;
}
