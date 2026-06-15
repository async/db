import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { openDb } from '../index.js';
import { makeProject, writeConfig, writeFixture } from '../../tests/helpers.js';
import { handleRestRequest as typedHandleRestRequest } from './handler.js';

const handleRestRequest = async (...args: any[]): Promise<void> => typedHandleRestRequest(args[0], args[1], args[2], args[3], args[4]);

test('REST handler resolves generated kebab-case collection routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.json', JSON.stringify([
    {
      id: 'evt_1',
      type: 'created',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/audit-events'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [
    {
      id: 'evt_1',
      type: 'created',
    },
  ]);

  const camelResponse = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET'),
    camelResponse,
    new URL('http://db.local/auditEvents'),
  );

  assert.equal(camelResponse.status, 200);
  assert.deepEqual(camelResponse.json(), response.json());
});

test('REST unknown resource errors include normalized name attempts', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chart-mappings.json', JSON.stringify([
    {
      id: 'mapping_1',
      chartId: 'chart_1',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/chart-mappingz'),
  );

  assert.equal(response.status, 404);
  assert.equal(response.json().error.code, 'REST_UNKNOWN_RESOURCE');
  assert.deepEqual(response.json().error.details.normalizedCandidates, ['chart-mappingz', 'chartMappingz']);
  assert.deepEqual(response.json().error.details.availableResources, ['chartMappings']);
});

test('REST handler serves the built-in db viewer', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/__db'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /db viewer/);
  assert.match(response.body, /REST Specs/);
  assert.match(response.body, /GraphQL Examples/);
});

test('REST root returns JSON discovery links by default', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.json(), {
    resources: ['users'],
    viewer: '/__db',
    viewers: [{
      label: 'Data Viewer',
      href: '/__db',
      source: 'built-in',
    }],
    formats: builtInFormatMetadata('/__db'),
    manifest: '/__db/manifest',
    manifestJson: '/__db/manifest.json',
    manifestHtml: '/__db/manifest.html',
    manifestMarkdown: '/__db/manifest.md',
    schema: '/__db/schema',
    graphql: null,
    falcor: null,
    batchAliases: ['/__db/batch'],
    resourceBasePath: '/resources',
    links: {
      viewer: '/__db',
      viewers: [{
        label: 'Data Viewer',
        href: '/__db',
        source: 'built-in',
      }],
      formats: builtInFormatMetadata('/__db'),
      manifest: '/__db/manifest',
      manifestJson: '/__db/manifest.json',
      manifestHtml: '/__db/manifest.html',
      manifestMarkdown: '/__db/manifest.md',
      schema: '/__db/schema',
      graphql: null,
      falcor: null,
      batchAliases: ['/__db/batch'],
      resourceBasePath: '/resources',
      resources: {
        users: '/users',
      },
      resourceAliases: {
        users: '/resources/users',
      },
    },
  });
});

test('REST root discovery links use configured server apiBase', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    server: {
      apiBase: '/_db',
    },
  });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    resources: ['users'],
    viewer: '/_db',
    viewers: [{
      label: 'Data Viewer',
      href: '/_db',
      source: 'built-in',
    }],
    formats: builtInFormatMetadata('/_db'),
    manifest: '/_db/manifest',
    manifestJson: '/_db/manifest.json',
    manifestHtml: '/_db/manifest.html',
    manifestMarkdown: '/_db/manifest.md',
    schema: '/_db/schema',
    graphql: null,
    falcor: null,
    batchAliases: ['/_db/batch'],
    resourceBasePath: '/resources',
    links: {
      viewer: '/_db',
      viewers: [{
        label: 'Data Viewer',
        href: '/_db',
        source: 'built-in',
      }],
      formats: builtInFormatMetadata('/_db'),
      manifest: '/_db/manifest',
      manifestJson: '/_db/manifest.json',
      manifestHtml: '/_db/manifest.html',
      manifestMarkdown: '/_db/manifest.md',
      schema: '/_db/schema',
      graphql: null,
      falcor: null,
      batchAliases: ['/_db/batch'],
      resourceBasePath: '/resources',
      resources: {
        users: '/users',
      },
      resourceAliases: {
        users: '/resources/users',
      },
    },
  });
});

test('REST root returns HTML discovery links for browser requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'chartMappings.json', JSON.stringify([
    {
      id: 'mapping_1',
      chartId: 'chart_1',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    response,
    new URL('http://db.local/'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /db/);
  assert.match(response.body, /Data Viewer/);
  assert.match(response.body, /href="\/__db"/);
  assert.match(response.body, /Viewer Manifest/);
  assert.match(response.body, /href="\/__db\/manifest"/);
  assert.match(response.body, /Schema/);
  assert.match(response.body, /href="\/__db\/schema"/);
  assert.doesNotMatch(response.body, /href="\/graphql"/);
  assert.match(response.body, /chartMappings/);
  assert.match(response.body, /href="\/chart-mappings"/);
});

test('REST root discovery marks GraphQL unavailable when disabled', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    graphql: {
      enabled: false
    }
  };`);
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const json = makeResponse();
  const html = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), json, new URL('http://db.local/'));
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    html,
    new URL('http://db.local/'),
  );

  assert.equal(json.status, 200);
  assert.equal(json.json().graphql, null);
  assert.equal(json.json().links.graphql, null);
  assert.deepEqual(json.json().links.resources, {
    users: '/users',
  });
  assert.equal(html.status, 200);
  assert.doesNotMatch(html.body, /GraphQL/);
  assert.doesNotMatch(html.body, /href="\/graphql"/);
});

test('REST discovery and viewer manifest include configured custom viewer links', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    server: {
      viewerLinks: [
        { label: 'Custom Viewer', href: 'http://127.0.0.1:5173/db' },
      ],
    },
  });
  const root = makeResponse();
  const manifest = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), root, new URL('http://db.local/'));
  await handleRestRequest(db, makeRequest('GET'), manifest, new URL('http://db.local/__db/manifest.json'));

  assert.deepEqual(root.json().links.viewers, [
    {
      label: 'Data Viewer',
      href: '/__db',
      source: 'built-in',
    },
    {
      label: 'Custom Viewer',
      href: 'http://127.0.0.1:5173/db',
      source: 'custom',
    },
  ]);
  assert.deepEqual(manifest.json().api.viewers, root.json().links.viewers);
});

test('REST root discovery includes registered response format metadata', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml', 'text/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data }) {
            return JSON.stringify(data);
          },
        },
      },
    },
  });
  const response = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), response, new URL('http://db.local/'));

  assert.deepEqual(response.json().formats.yaml, {
    extension: '.yaml',
    mediaTypes: ['application/yaml', 'text/yaml'],
    contentType: 'application/yaml; charset=utf-8',
    manifestPath: '/__db/manifest.yaml',
  });
});

test('REST explicit .json routes keep raw JSON even for browser requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const manifest = makeResponse();
  const users = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    manifest,
    new URL('http://db.local/__db/manifest.json'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }),
    users,
    new URL('http://db.local/users.json'),
  );

  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /application\/json/);
  assert.equal(manifest.json().kind, 'db.viewerManifest');
  assert.equal(users.status, 200);
  assert.match(users.headers['content-type'], /application\/json/);
  assert.deepEqual(users.json(), [{ id: 'u_1', name: 'Ada Lovelace' }]);
});

test('REST explicit .html routes render the formatted JSON viewer', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const manifest = makeResponse();
  const users = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    manifest,
    new URL('http://db.local/__db/manifest.html'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET'),
    users,
    new URL('http://db.local/users.html'),
  );

  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /text\/html/);
  assert.match(manifest.body, /cdn\.tailwindcss\.com/);
  assert.match(manifest.body, /<html lang="en" data-theme-mode="dark"/);
  assert.doesNotMatch(manifest.body, /<style>/);
  assert.match(manifest.body, /data-theme-mode="dark"/);
  assert.match(manifest.body, /data-theme-choice="system"/);
  assert.match(manifest.body, /data-format-choice="pretty" aria-pressed="true"/);
  assert.match(manifest.body, /data-format-choice="raw"/);
  assert.match(manifest.body, /id="copy-json"/);
  assert.match(manifest.body, /&quot;kind&quot;: &quot;db\.viewerManifest&quot;/);
  assert.match(manifest.body, /&quot;api&quot;: \{/);
  assert.equal(users.status, 200);
  assert.match(users.headers['content-type'], /text\/html/);
  assert.match(users.body, /&quot;id&quot;: &quot;u_1&quot;/);
  assert.match(users.body, /&quot;name&quot;: &quot;Ada Lovelace&quot;/);
});

test('REST explicit .md routes render AI-friendly markdown', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'dark',
    locale: 'en-US',
  }));

  const db = await openDb({ cwd });
  const manifest = makeResponse();
  const settings = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    manifest,
    new URL('http://db.local/__db/manifest.md'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET'),
    settings,
    new URL('http://db.local/settings.md'),
  );

  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /text\/markdown/);
  assert.match(manifest.body, /^# db viewer manifest/m);
  assert.match(manifest.body, /```json/);
  assert.match(manifest.body, /"kind": "db\.viewerManifest"/);
  assert.equal(settings.status, 200);
  assert.match(settings.headers['content-type'], /text\/markdown/);
  assert.match(settings.body, /^# settings/m);
  assert.match(settings.body, /- Kind: `document`/);
  assert.match(settings.body, /"theme": "dark"/);
});

test('REST extensionless manifest and resource routes negotiate HTML or JSON', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const manifestHtml = makeResponse();
  const usersHtml = makeResponse();
  const manifestJson = makeResponse();
  const usersJson = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.5,*/*;q=0.1',
    }),
    manifestHtml,
    new URL('http://db.local/__db/manifest'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.5,*/*;q=0.1',
    }),
    usersHtml,
    new URL('http://db.local/users'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/json',
    }),
    manifestJson,
    new URL('http://db.local/__db/manifest'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/json',
    }),
    usersJson,
    new URL('http://db.local/users'),
  );

  assert.match(manifestHtml.headers['content-type'], /text\/html/);
  assert.match(manifestHtml.body, /db viewer manifest/);
  assert.match(usersHtml.headers['content-type'], /text\/html/);
  assert.match(usersHtml.body, /&quot;name&quot;: &quot;Ada Lovelace&quot;/);
  assert.match(manifestJson.headers['content-type'], /application\/json/);
  assert.equal(manifestJson.json().kind, 'db.viewerManifest');
  assert.match(usersJson.headers['content-type'], /application\/json/);
  assert.deepEqual(usersJson.json(), [{ id: 'u_1', name: 'Ada Lovelace' }]);
});

test('REST extensionless manifest and resource routes negotiate markdown', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const manifest = makeResponse();
  const users = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/markdown,application/json;q=0.5,*/*;q=0.1',
    }),
    manifest,
    new URL('http://db.local/__db/manifest'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'text/markdown,application/json;q=0.5,*/*;q=0.1',
    }),
    users,
    new URL('http://db.local/users'),
  );

  assert.match(manifest.headers['content-type'], /text\/markdown/);
  assert.match(manifest.body, /^# db viewer manifest/m);
  assert.match(users.headers['content-type'], /text\/markdown/);
  assert.match(users.body, /^# users/m);
  assert.match(users.body, /- Kind: `collection`/);
});

test('REST format registry renders object formats for resource and manifest routes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml', 'text/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data, format }) {
            return `format: ${format}\njson: ${JSON.stringify(data)}\n`;
          },
          renderManifest({ data, format }) {
            return `format: ${format}\nkind: ${data.kind}\n`;
          },
        },
      },
    },
  });
  const users = makeResponse();
  const manifest = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), users, new URL('http://db.local/users.yaml'));
  await handleRestRequest(db, makeRequest('GET'), manifest, new URL('http://db.local/__db/manifest.yaml'));

  assert.equal(users.status, 200);
  assert.match(users.headers['content-type'], /application\/yaml/);
  assert.match(users.body, /format: yaml/);
  assert.match(users.body, /Ada Lovelace/);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /application\/yaml/);
  assert.match(manifest.body, /format: yaml/);
  assert.match(manifest.body, /kind: db\.viewerManifest/);
});

test('REST format registry negotiates custom media types and falls back to default', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml', 'text/yaml'],
          contentType: 'application/yaml; charset=utf-8',
          render({ data }) {
            return `yaml: ${JSON.stringify(data)}\n`;
          },
        },
      },
    },
  });
  const yamlUsers = makeResponse();
  const yamlManifest = makeResponse();
  const fallbackUsers = makeResponse();
  const fallbackManifest = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/json;q=0.4,application/yaml;q=0.9,text/html;q=0.2',
    }),
    yamlUsers,
    new URL('http://db.local/users'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/json;q=0.4,application/yaml;q=0.9,text/html;q=0.2',
    }),
    yamlManifest,
    new URL('http://db.local/__db/manifest'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/xml',
    }),
    fallbackUsers,
    new URL('http://db.local/users'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, {
      accept: 'application/xml',
    }),
    fallbackManifest,
    new URL('http://db.local/__db/manifest'),
  );

  assert.match(yamlUsers.headers['content-type'], /application\/yaml/);
  assert.match(yamlUsers.body, /Ada Lovelace/);
  assert.match(yamlManifest.headers['content-type'], /application\/yaml/);
  assert.match(yamlManifest.body, /db\.viewerManifest/);
  assert.match(fallbackUsers.headers['content-type'], /application\/json/);
  assert.deepEqual(fallbackUsers.json(), [{ id: 'u_1', name: 'Ada Lovelace' }]);
  assert.match(fallbackManifest.headers['content-type'], /application\/json/);
  assert.equal(fallbackManifest.json().kind, 'db.viewerManifest');
});

test('REST format registry lets object entries override built-in JSON and markdown', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'dark',
  }));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        json: {
          mediaTypes: ['application/vnd.custom+json', 'application/json'],
          contentType: 'application/vnd.custom+json; charset=utf-8',
          render({ data }) {
            return JSON.stringify({ wrapped: data });
          },
        },
        md: {
          mediaTypes: ['text/markdown'],
          renderResource({ resourceName, data }) {
            return {
              body: `# custom ${resourceName}\n${JSON.stringify(data)}\n`,
              contentType: 'text/markdown; charset=utf-8',
            };
          },
          renderManifest({ data }) {
            return {
              body: `# custom manifest\n${data.kind}\n`,
              contentType: 'text/markdown; charset=utf-8',
            };
          },
        },
      },
    },
  });
  const settingsJson = makeResponse();
  const manifestJson = makeResponse();
  const settingsMarkdown = makeResponse();
  const manifestMarkdown = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), settingsJson, new URL('http://db.local/settings.json'));
  await handleRestRequest(db, makeRequest('GET'), manifestJson, new URL('http://db.local/__db/manifest.json'));
  await handleRestRequest(db, makeRequest('GET'), settingsMarkdown, new URL('http://db.local/settings.md'));
  await handleRestRequest(db, makeRequest('GET'), manifestMarkdown, new URL('http://db.local/__db/manifest.md'));

  assert.match(settingsJson.headers['content-type'], /application\/vnd\.custom\+json/);
  assert.deepEqual(JSON.parse(settingsJson.body), { wrapped: { theme: 'dark' } });
  assert.match(manifestJson.headers['content-type'], /application\/vnd\.custom\+json/);
  assert.equal(JSON.parse(manifestJson.body).wrapped.kind, 'db.viewerManifest');
  assert.equal(settingsMarkdown.body, '# custom settings\n{"theme":"dark"}\n');
  assert.equal(manifestMarkdown.body, '# custom manifest\ndb.viewerManifest\n');
});

test('REST unknown format errors list registered custom formats', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        yaml: {
          mediaTypes: ['application/yaml'],
          render({ data }) {
            return JSON.stringify(data);
          },
        },
      },
    },
  });
  const response = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), response, new URL('http://db.local/users.xml'));

  assert.equal(response.status, 404);
  assert.equal(response.json().error.code, 'REST_UNKNOWN_FORMAT');
  assert.deepEqual(response.json().error.details.availableFormats, ['html', 'json', 'md', 'yaml']);
  assert.match(response.json().error.hint, /\.yaml/);
});

test('REST schema endpoint exposes route paths for the viewer', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'auditEvents.json', JSON.stringify([
    {
      id: 'evt_1',
      type: 'created',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/__db/schema'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json().resources.auditEvents.routePath, '/audit-events');
});

test('REST collection reads support select offset and limit', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'posts.json', JSON.stringify([
    {
      id: 'p_1',
      title: 'First',
      body: 'Draft',
    },
    {
      id: 'p_2',
      title: 'Second',
      body: 'Published',
    },
    {
      id: 'p_3',
      title: 'Third',
      body: 'Archived',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/posts?select=id,title&offset=1&limit=1'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [
    {
      id: 'p_2',
      title: 'Second',
    },
  ]);
});

test('REST resource .json extension uses the JSON format', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/users.json'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.json(), [
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]);
});

test('REST collection .json route can read one record by id query param', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    {
      id: 'u_2',
      name: 'Grace Hopper',
      email: 'grace@example.com',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/users.json?id=u_2&select=id,name'),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.json(), {
    id: 'u_2',
    name: 'Grace Hopper',
  });
});

test('REST extensionless collection route rejects id query param', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/users?id=u_1'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'REST_ID_QUERY_REQUIRES_JSON_ROUTE');
  assert.equal(response.json().error.details.resource, 'users');
  assert.equal(response.json().error.details.id, 'u_1');
  assert.match(response.json().error.hint, /\/users\.json\?id=u_1/);
  assert.match(response.json().error.hint, /\/users\/u_1/);
});

test('REST formats can override default and json resource rendering', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        default({ resource, data }) {
          return {
            body: `# ${resource.name}\n${data.length} records\n`,
            contentType: 'text/markdown; charset=utf-8',
          };
        },
        json({ data }) {
          return {
            body: JSON.stringify({ data }),
            contentType: 'application/vnd.custom+json',
          };
        },
      },
    },
  });
  const defaultResponse = makeResponse();
  const jsonResponse = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), defaultResponse, new URL('http://db.local/users'));
  await handleRestRequest(db, makeRequest('GET'), jsonResponse, new URL('http://db.local/users.json'));

  assert.equal(defaultResponse.body, '# users\n1 records\n');
  assert.match(defaultResponse.headers['content-type'], /text\/markdown/);
  assert.deepEqual(JSON.parse(jsonResponse.body), { data: [{ id: 'u_1', name: 'Ada Lovelace' }] });
  assert.match(jsonResponse.headers['content-type'], /application\/vnd\.custom\+json/);
});

test('REST formats can render user-defined markdown and html extensions', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({
    cwd,
    rest: {
      formats: {
        md({ resource, data }) {
          return {
            body: `# ${resource.name}\n${data[0].name}\n`,
            contentType: 'text/markdown; charset=utf-8',
          };
        },
        html({ data }) {
          return {
            body: `<!doctype html><p>${data.name}</p>`,
            contentType: 'text/html; charset=utf-8',
          };
        },
      },
    },
  });
  const markdownResponse = makeResponse();
  const htmlResponse = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), markdownResponse, new URL('http://db.local/users.md'));
  await handleRestRequest(db, makeRequest('GET'), htmlResponse, new URL('http://db.local/users/u_1.html'));

  assert.equal(markdownResponse.body, '# users\nAda Lovelace\n');
  assert.match(markdownResponse.headers['content-type'], /text\/markdown/);
  assert.equal(htmlResponse.body, '<!doctype html><p>Ada Lovelace</p>');
  assert.match(htmlResponse.headers['content-type'], /text\/html/);
});

test('REST resource requests reject unknown format extensions', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(db, makeRequest('GET'), response, new URL('http://db.local/users.xml'));

  assert.equal(response.status, 404);
  assert.equal(response.json().error.code, 'REST_UNKNOWN_FORMAT');
  assert.match(response.json().error.hint, /json/);
});

test('REST single record reads support select', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'posts.json', JSON.stringify([
    {
      id: 'p_1',
      title: 'Intro',
      body: 'Long body',
    },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/posts/p_1?select=id,title'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    id: 'p_1',
    title: 'Intro',
  });
});

test('REST select and pagination errors are structured', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'posts.json', JSON.stringify([
    {
      id: 'p_1',
      title: 'Intro',
    },
  ]));

  const db = await openDb({ cwd });
  const selectResponse = makeResponse();
  const limitResponse = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    selectResponse,
    new URL('http://db.local/posts?select=id,badField'),
  );
  await handleRestRequest(
    db,
    makeRequest('GET'),
    limitResponse,
    new URL('http://db.local/posts?limit=0'),
  );

  assert.equal(selectResponse.status, 400);
  assert.equal(selectResponse.json().error.code, 'REST_SELECT_UNKNOWN_FIELD');
  assert.equal(selectResponse.json().error.details.field, 'badField');
  assert.match(selectResponse.json().error.hint, /Use one of/);
  assert.equal(limitResponse.status, 400);
  assert.equal(limitResponse.json().error.code, 'REST_INVALID_LIMIT');
  assert.equal(limitResponse.json().error.details.limit, '0');
});

test('REST reads can expand explicit to-one relations and project nested fields', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "email": { "type": "string" }
    },
    "seed": [
      { "id": "a_1", "name": "Ada Lovelace", "email": "ada@example.com" }
    ]
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "title": { "type": "string", "required": true },
      "authorId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "author",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "title": "Intro", "authorId": "a_1" }
    ]
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/posts/p_1?expand=author&select=id,title,author.name'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    id: 'p_1',
    title: 'Intro',
    author: {
      name: 'Ada Lovelace',
    },
  });
});

test('REST nested select requires explicit expand', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'authors.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true }
    },
    "seed": [
      { "id": "a_1", "name": "Ada Lovelace" }
    ]
  }`);
  await writeFixture(cwd, 'posts.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "authorId": {
        "type": "string",
        "required": true,
        "relation": {
          "name": "author",
          "to": "authors",
          "toField": "id",
          "cardinality": "one"
        }
      }
    },
    "seed": [
      { "id": "p_1", "authorId": "a_1" }
    ]
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/posts/p_1?select=id,author.name'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'REST_SELECT_REQUIRES_EXPAND');
  assert.match(response.json().error.hint, /expand=author/);
});

test('REST viewer import endpoint saves CSV fixtures and reloads resources', async () => {
  const cwd = await makeProject();
  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'User ID,Email,Active\nu_1,ada@example.com,true\n', {
      'x-db-file-name': 'Uploaded Users.csv',
    }),
    response,
    new URL('http://db.local/__db/import'),
  );

  assert.equal(response.status, 201);
  assert.equal(response.json().resource, 'uploadedUsers');
  assert.equal(response.json().dataPath, 'db/uploadedUsers.csv');
  assert.equal(db.resourceNames().includes('uploadedUsers'), true);
  assert.deepEqual(await db.collection('uploadedUsers').all(), [
    {
      userId: 'u_1',
      email: 'ada@example.com',
      active: true,
    },
  ]);
});

test('REST viewer import endpoint saves CSV fixtures to configured dbDir', async () => {
  const cwd = await makeProject();
  const db = await openDb({ cwd, dbDir: './db' });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'id,name\nu_1,Ada\n', {
      'x-db-file-name': 'Uploaded Users.csv',
    }),
    response,
    new URL('http://db.local/__db/import'),
  );

  assert.equal(response.status, 201);
  assert.equal(response.json().dataPath, 'db/uploadedUsers.csv');
  await access(path.join(cwd, 'db/uploadedUsers.csv'));
});

test('REST viewer import endpoint rejects invalid CSV without writing a fixture', async () => {
  const cwd = await makeProject();
  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRawRequest('POST', 'id,name\n"u_1,Ada\n', {
      'x-db-file-name': 'Bad Upload.csv',
    }),
    response,
    new URL('http://db.local/__db/import'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'CSV_UNTERMINATED_QUOTE');
  await assert.rejects(access(path.join(cwd, 'db', 'badUpload.csv')), {
    code: 'ENOENT',
  });
});

test('REST handler creates collection records and applies defaults', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      name: 'Ada Lovelace',
    }),
    response,
    new URL('http://db.local/users'),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(response.json(), {
    id: 'u_1',
    name: 'Ada Lovelace',
    role: 'user',
  });
});

test('REST handler updates do not backfill omitted schema defaults', async () => {
  const cwd = await makeProject();
  await writeConfig(cwd, `export default {
    defaults: {
      applyOnSafeMigration: false
    }
  };`);
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": [
      { "id": "u_1", "name": "Ada Lovelace" }
    ]
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('PATCH', {
      name: 'Ada Byron',
    }),
    response,
    new URL('http://db.local/users/u_1'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    id: 'u_1',
    name: 'Ada Byron',
  });
});

test('REST handler writes through the selected non-JSON store', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `export default {
    stores: {
      default: 'memory'
    }
  };`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_2',
      name: 'Grace Hopper',
    }),
    response,
    new URL('http://db.local/users'),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
  await assert.rejects(
    () => access(path.join(cwd, '.db/state/users.json')),
    { code: 'ENOENT' },
  );
});

test('REST handler writes through a SQLite store binding', async (t) => {
  try {
    await import('node:sqlite');
  } catch {
    t.skip('node:sqlite is not available in this Node.js runtime');
    return;
  }

  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeConfig(cwd, `import { sqliteStore } from '@async/db/sqlite';

export default {
  resources: {
    users: {
      store: 'sqlite'
    }
  },
  stores: {
    sqlite: sqliteStore()
  }
};`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_2',
      name: 'Grace Hopper',
    }),
    response,
    new URL('http://db.local/users'),
  );

  assert.equal(response.status, 201);
  await access(path.join(cwd, '.db/runtime.sqlite'));
  await assert.rejects(
    () => access(path.join(cwd, '.db/state/users.json')),
    { code: 'ENOENT' },
  );

  const reopened = await openDb({ cwd });
  assert.deepEqual(await reopened.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace' },
    { id: 'u_2', name: 'Grace Hopper' },
  ]);
});

test('REST handler rejects writes that do not match schema field types', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      email: 42,
      role: 'owner',
    }),
    response,
    new URL('http://db.local/users'),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.match(response.json().error.details.diagnostics[0].message, /email/);
});

test('REST handler updates singleton documents', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'light',
    locale: 'en-US',
  }));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('PATCH', {
      theme: 'dark',
    }),
    response,
    new URL('http://db.local/settings'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), {
    theme: 'dark',
    locale: 'en-US',
  });
});

test('REST batch is sequential and keeps earlier successful writes when a later item fails', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_1',
          email: 'ada@example.com',
          role: 'admin',
        },
      },
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_2',
          email: 'grace@example.com',
          role: 'owner',
        },
      },
    ]),
    response,
    new URL('http://db.local/__db/batch'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].status, 201);
  assert.equal(response.json()[1].status, 400);
  assert.equal(response.json()[1].body.error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.deepEqual(await db.collection('users').all(), [
    {
      id: 'u_1',
      email: 'ada@example.com',
      role: 'admin',
    },
  ]);
});

test('REST bulk create returns per-item results and keeps earlier successful writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "email": { "type": "string", "required": true },
      "role": { "type": "enum", "values": ["admin", "user"] }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      { id: 'u_1', email: 'ada@example.com', role: 'admin' },
      { id: 'u_2', email: 'grace@example.com', role: 'owner' },
    ]),
    response,
    new URL('http://db.local/resources/users'),
    { resourceBasePath: '/resources' },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(response.json().summary, { ok: 1, errors: 1 });
  assert.equal(response.json().results[0].status, 201);
  assert.equal(response.json().results[1].status, 400);
  assert.equal(response.json().results[1].body.error.code, 'DB_SCHEMA_VALIDATION_FAILED');
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', email: 'ada@example.com', role: 'admin' },
  ]);
});

test('REST bulk patch supports shared and per-record patch bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada', active: true },
    { id: 'u_2', name: 'Grace', active: true },
  ]));

  const db = await openDb({ cwd });
  const shared = makeResponse();
  const perRecord = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('PATCH', {
      ids: ['u_1', 'u_2'],
      patch: { active: false },
    }),
    shared,
    new URL('http://db.local/resources/users'),
    { resourceBasePath: '/resources' },
  );
  await handleRestRequest(
    db,
    makeRequest('PATCH', [
      { id: 'u_1', patch: { name: 'Ada Lovelace' } },
      { id: 'missing', patch: { name: 'Missing' } },
    ]),
    perRecord,
    new URL('http://db.local/resources/users'),
    { resourceBasePath: '/resources' },
  );

  assert.equal(shared.status, 200);
  assert.deepEqual(shared.json().summary, { ok: 2, errors: 0 });
  assert.equal(perRecord.status, 200);
  assert.deepEqual(perRecord.json().summary, { ok: 1, errors: 1 });
  assert.equal(perRecord.json().results[1].status, 404);
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace', active: false },
    { id: 'u_2', name: 'Grace', active: false },
  ]);
});

test('REST bulk replace preserves unlisted records', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada', active: true },
    { id: 'u_2', name: 'Grace', active: true },
  ]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('PUT', {
      records: [
        { id: 'u_1', name: 'Ada Lovelace', active: false },
      ],
    }),
    response,
    new URL('http://db.local/resources/users'),
    { resourceBasePath: '/resources' },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json().summary, { ok: 1, errors: 0 });
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_1', name: 'Ada Lovelace', active: false },
    { id: 'u_2', name: 'Grace', active: true },
  ]);
});

test('REST bulk delete supports repeated id query parameters and body ids', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada' },
    { id: 'u_2', name: 'Grace' },
    { id: 'u_3', name: 'Katherine' },
  ]));

  const db = await openDb({ cwd });
  const queryDelete = makeResponse();
  const bodyDelete = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('DELETE'),
    queryDelete,
    new URL('http://db.local/resources/users?id=u_1&id=missing'),
    { resourceBasePath: '/resources' },
  );
  await handleRestRequest(
    db,
    makeRequest('DELETE', { ids: ['u_2'] }),
    bodyDelete,
    new URL('http://db.local/resources/users'),
    { resourceBasePath: '/resources' },
  );

  assert.equal(queryDelete.status, 200);
  assert.deepEqual(queryDelete.json().summary, { ok: 1, errors: 1 });
  assert.equal(queryDelete.json().results[0].status, 204);
  assert.equal(queryDelete.json().results[1].status, 404);
  assert.equal(bodyDelete.status, 200);
  assert.deepEqual(bodyDelete.json().summary, { ok: 1, errors: 0 });
  assert.deepEqual(await db.collection('users').all(), [
    { id: 'u_3', name: 'Katherine' },
  ]);
});

test('REST handler supports batched requests', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.schema.jsonc', `{
    "kind": "collection",
    "idField": "id",
    "fields": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "role": {
        "type": "enum",
        "values": ["admin", "user"],
        "default": "user"
      }
    },
    "seed": []
  }`);

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/users',
        body: {
          id: 'u_1',
          name: 'Ada Lovelace',
        },
      },
      {
        method: 'GET',
        path: '/users/u_1',
      },
    ]),
    response,
    new URL('http://db.local/__db/batch'),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), [
    {
      index: 0,
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        id: 'u_1',
        name: 'Ada Lovelace',
        role: 'user',
      },
    },
    {
      index: 1,
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        id: 'u_1',
        name: 'Ada Lovelace',
        role: 'user',
      },
    },
  ]);
});

test('REST batch errors include code hint and item index', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'GET',
        path: 'users',
      },
    ]),
    response,
    new URL('http://db.local/__db/batch'),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].index, 0);
  assert.equal(response.json()[0].status, 400);
  assert.equal(response.json()[0].body.error.code, 'REST_BATCH_INVALID_PATH');
  assert.match(response.json()[0].body.error.hint, /absolute local paths/);
});

test('REST batch invalid body hint uses custom apiBase batch path', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      requests: 'nope',
    }),
    response,
    new URL('http://db.local/_db/batch'),
    { apiBase: '/_db' },
  );

  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'REST_BATCH_INVALID_BODY');
  assert.match(response.json().error.hint, /POST \/_db\/batch/);
});

test('REST batch rejects nested requests to a custom apiBase batch path', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/dev/db/batch',
        body: [],
      },
    ]),
    response,
    new URL('http://db.local/dev/db/batch'),
    { apiBase: '/dev/db' },
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].index, 0);
  assert.equal(response.json()[0].status, 400);
  assert.equal(response.json()[0].body.error.code, 'REST_BATCH_NESTED_UNSUPPORTED');
  assert.match(response.json()[0].body.error.hint, /Flatten the batch array/);
});

test('REST batch nested request detection uses the effective batch path only', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({ cwd });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', [
      {
        method: 'POST',
        path: '/__db/batch',
        body: [],
      },
    ]),
    response,
    new URL('http://db.local/_db/batch'),
    { apiBase: '/_db' },
  );

  assert.equal(response.status, 200);
  assert.equal(response.json()[0].index, 0);
  assert.equal(response.json()[0].status, 404);
  assert.equal(response.json()[0].body.error.code, 'REST_UNKNOWN_RESOURCE');
});

test('REST handler returns 413 for oversized JSON bodies', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([]));

  const db = await openDb({
    cwd,
    server: {
      maxBodyBytes: 12,
    },
  });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('POST', {
      id: 'u_1',
      name: 'payload is too large',
    }),
    response,
    new URL('http://db.local/users'),
  );

  assert.equal(response.status, 413);
  assert.equal(response.json().error.code, 'JSON_BODY_TOO_LARGE');
  assert.match(response.json().error.hint, /server\.maxBodyBytes/);
});

test('REST single-record reads expose an ETag and If-Match guards writes', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    {
      id: 'u_1',
      name: 'Ada Lovelace',
    },
  ]));

  const db = await openDb({ cwd });
  const read = makeResponse();
  await handleRestRequest(db, makeRequest('GET'), read, new URL('http://db.local/users/u_1'));
  assert.equal(read.status, 200);
  const etag = read.headers['etag'];
  assert.match(String(etag), /^".+"$/);

  const staleResponse = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PATCH', { name: 'Stale Writer' }, { 'if-match': '"not-the-current-tag"' }),
    staleResponse,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(staleResponse.status, 412);
  assert.equal(staleResponse.json().error.code, 'DB_PRECONDITION_FAILED');
  assert.match(staleResponse.json().error.hint, /If-Match/);
  assert.equal(staleResponse.json().error.details.currentEtag, etag);

  const freshResponse = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PATCH', { name: 'Ada King' }, { 'if-match': etag }),
    freshResponse,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(freshResponse.status, 200);
  assert.equal(freshResponse.json().name, 'Ada King');
  const nextEtag = freshResponse.headers['etag'];
  assert.match(String(nextEtag), /^".+"$/);
  assert.notEqual(nextEtag, etag);

  const staleDelete = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('DELETE', undefined, { 'if-match': etag }),
    staleDelete,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(staleDelete.status, 412);
  assert.equal(staleDelete.json().error.code, 'DB_PRECONDITION_FAILED');

  const freshDelete = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('DELETE', undefined, { 'if-match': nextEtag }),
    freshDelete,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(freshDelete.status, 204);
});

test('REST document writes honor If-Match preconditions', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'settings.json', JSON.stringify({
    theme: 'dark',
  }));

  const db = await openDb({ cwd });
  const read = makeResponse();
  await handleRestRequest(db, makeRequest('GET'), read, new URL('http://db.local/settings'));
  assert.equal(read.status, 200);
  const etag = read.headers['etag'];
  assert.match(String(etag), /^".+"$/);

  const stale = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PUT', { theme: 'light' }, { 'if-match': '"missing"' }),
    stale,
    new URL('http://db.local/settings'),
  );
  assert.equal(stale.status, 412);
  assert.equal(stale.json().error.code, 'DB_PRECONDITION_FAILED');

  const fresh = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PUT', { theme: 'light' }, { 'if-match': etag }),
    fresh,
    new URL('http://db.local/settings'),
  );
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json().theme, 'light');
  assert.notEqual(fresh.headers['etag'], etag);

  const patch = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('PATCH', { theme: 'dark' }, { 'if-match': fresh.headers['etag'] }),
    patch,
    new URL('http://db.local/settings'),
  );
  assert.equal(patch.status, 200);
  assert.equal(patch.json().theme, 'dark');
});

test('REST conditional GETs answer 304 when If-None-Match still matches', async () => {
  const cwd = await makeProject();
  await writeFixture(cwd, 'users.json', JSON.stringify([
    { id: 'u_1', name: 'Ada Lovelace' },
  ]));
  await writeFixture(cwd, 'settings.json', JSON.stringify({ theme: 'dark' }));

  const db = await openDb({ cwd });

  const list = makeResponse();
  await handleRestRequest(db, makeRequest('GET'), list, new URL('http://db.local/users'));
  assert.equal(list.status, 200);

  const item = makeResponse();
  await handleRestRequest(db, makeRequest('GET'), item, new URL('http://db.local/users/u_1'));
  const itemEtag = item.headers['etag'];

  const notModified = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, { 'if-none-match': itemEtag }),
    notModified,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body, '');
  assert.equal(notModified.headers['etag'], itemEtag);

  const changedAfterPatch = makeResponse();
  await handleRestRequest(db, makeRequest('PATCH', { name: 'Ada King' }), changedAfterPatch, new URL('http://db.local/users/u_1'));
  const refreshed = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, { 'if-none-match': itemEtag }),
    refreshed,
    new URL('http://db.local/users/u_1'),
  );
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.json().name, 'Ada King');

  const documentRead = makeResponse();
  await handleRestRequest(db, makeRequest('GET'), documentRead, new URL('http://db.local/settings'));
  const documentEtag = documentRead.headers['etag'];
  const documentNotModified = makeResponse();
  await handleRestRequest(
    db,
    makeRequest('GET', undefined, { 'if-none-match': documentEtag }),
    documentNotModified,
    new URL('http://db.local/settings'),
  );
  assert.equal(documentNotModified.status, 304);
});

function makeRequest(method, body = undefined, headers = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
}

function makeRawRequest(method, body, headers = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(body);
      }
    },
  };
}

function makeResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function builtInFormatMetadata(apiBase) {
  return {
    html: {
      extension: '.html',
      mediaTypes: ['text/html'],
      contentType: 'text/html; charset=utf-8',
      manifestPath: `${apiBase}/manifest.html`,
    },
    json: {
      extension: '.json',
      mediaTypes: ['application/json'],
      contentType: 'application/json; charset=utf-8',
      manifestPath: `${apiBase}/manifest.json`,
    },
    md: {
      extension: '.md',
      mediaTypes: ['text/markdown'],
      contentType: 'text/markdown; charset=utf-8',
      manifestPath: `${apiBase}/manifest.md`,
    },
  };
}

test('viewer schema payload carries mdx scan fields and component diagnostics', async () => {
  const cwd = await makeProject();
  await mkdir(path.join(cwd, 'db/docs'), { recursive: true });
  await writeFile(path.join(cwd, 'db/docs/index.schema.mjs'), `
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'mdx', components: ['Callout'] }),
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
`);
  await writeFile(path.join(cwd, 'db/docs/page.mdx'), [
    '---',
    'title: Page',
    '---',
    '<Callout>ok</Callout>',
    '<Marquee>not registered</Marquee>',
    '',
  ].join('\n'), 'utf8');

  const db = await openDb({ cwd, allowSourceErrors: true });
  const response = makeResponse();

  await handleRestRequest(
    db,
    makeRequest('GET'),
    response,
    new URL('http://db.local/__db/schema'),
  );

  assert.equal(response.status, 200);
  const payload = response.json();
  assert.equal(payload.resources.docs.fields.components.type, 'array');
  assert.equal(payload.resources.docs.fields.components.items.type, 'string');
  const diagnostic = (payload.diagnostics ?? []).find((entry) => entry.code === 'CONTENT_COMPONENT_NOT_ALLOWED');
  assert.ok(diagnostic, 'expected the component diagnostic in the viewer schema payload');
  assert.deepEqual(diagnostic.details.components, ['Marquee']);
});
