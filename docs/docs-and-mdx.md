# Docs Sites And MDX

Async DB treats documentation as a content collection: markdown/MDX files are born canonical, git is their write-ahead log, and the JSON contract is frontmatter fields plus the body. See [shape-is-the-contract.md](./shape-is-the-contract.md) for the model; this page is the how-to, including the three tiers of MDX support.

Start a docs project with `async-db init --template content`, or add `db/docs/index.schema.js` to an existing one. Content can live outside `db/` (for example a repo-level `docs/` folder); `serve` watches those roots and hot-reloads edits.

## Tier 1 — Raw body (built in, zero dependencies)

`files()` with `read: 'frontmatter'` parses frontmatter into fields and keeps the raw markdown/MDX body as a string field:

```js
// db/docs/index.schema.js
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('../../docs/**/*.mdx', { read: 'frontmatter' }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true, description: 'Raw MDX. Rendering and compilation are app-owned.' }),
  },
});
```

The framework compiles MDX at render time. Async DB never imports a compiler — at the boundary a page is `{ id, title, body }` JSON like any other resource, with types, REST routes, ETags/304s, and the viewer for free.

## Tier 2 — JSX as JSON: app-compiled AST fields

An MDX AST is already JSON: `<Callout level="warn">` is `{ "type": "mdxJsxFlowElement", "name": "Callout", "attributes": [...], "children": [...] }` in mdast. When the frontend wants a pre-compiled tree instead of a raw string, compile it in trusted local schema code — schema files execute locally, so the MDX dependency stays app-owned and Async DB stays dependency-light:

```js
// db/docs/index.schema.js — app brings remark/@mdx-js, async-db stores the JSON
import { collection, field, files } from '@async/db/schema';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';

export default collection({
  source: files('../../docs/**/*.mdx', { read: 'frontmatter' }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
    ast: field.computed((record) => fromMarkdown(String(record.body), {
      extensions: [mdxjs()],
      mdastExtensions: [mdxFromMarkdown()],
    }), { type: 'object', description: 'mdast tree; JSX nodes are plain JSON the renderer maps to components.' }),
  },
});
```

Custom `sources.readers` work the same way for full control of record construction. Compilation runs at sync against source hashes, so the JSON state store doubles as the compile cache — files recompile only when they change. Clients keep wire payloads lean with `GET /db/docs/getting-started?select=id,title,ast`.

The renderer's job is a lookup table: node `name` → component. Unknown names are a rendering decision, not a database one — which is exactly what Tier 3 makes checkable earlier.

## Tier 3 — Component usage as contract

`read: 'mdx'` extends the contract to JSX usage without compiling anything. It parses frontmatter exactly like `read: 'frontmatter'`, then a dependency-free scan of the body emits three extra string-array fields on every record: `components` (capitalized JSX tags as written, like `Callout` or `Tabs.Item`), `imports` (module specifiers from MDX ESM), and `exports` (top-level exported names). Schemas that declare fields get these three declared automatically, so they flow into generated types, `?select=`, and the viewer's schema panel with no extra wiring.

```js
// db/docs/index.schema.js
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('../../docs/**/*.mdx', {
    read: 'mdx',
    components: ['Callout', 'CodeTabs'], // the renderer's registry, as schema
  }),
  idField: 'id',
  fields: {
    id: field.string({ required: true }),
    title: field.string({ required: true }),
    body: field.string({ required: true }),
  },
});
```

Declaring `components` turns the scan into validation: a doc using `<Marquee>` when only `Callout` and `CodeTabs` are registered fails sync with `CONTENT_COMPONENT_NOT_ALLOWED`, naming the file, the offending tags, and the allowed set — a renamed component becomes a sync-time diagnostic across every page instead of a runtime surprise. `async-db doctor` surfaces the same finding, and the viewer shows it in the diagnostics panel alongside each page's `components` field. Components a doc imports or exports itself are allowed automatically (`import Chart from './chart.js'` makes `<Chart />` legal), and allowing a root name like `Tabs` permits member tags like `<Tabs.Item />`. Omit the `components` list and the scan is inventory-only — useful for auditing an existing docs folder before deciding what the registry should be. A `components` list on a non-mdx read warns `CONTENT_COMPONENTS_IGNORED` so the option never silently does nothing.

The scan follows MDX semantics rather than guessing: fenced code blocks, inline code spans, and HTML/MDX comments never count; indented lines do count (MDX disables indented code blocks); literal tags inside attribute strings (`title="<Fake>"`) are consumed with their tag, while components inside attribute expressions (`icon={<Star />}`) and export declarations (`export const banner = <Warn />`) are reported. No MDX dependency is involved at any point — the scanner is a small state machine, the body stays a raw string, and rendering stays app-owned.

The renderer's lookup table and the schema's `components` list are the same set written twice — which is the point: the schema copy is the one that gets checked on every sync, in CI, before a rename ships.

The stance across all three tiers in one line: **body is a string, the AST is an optional app-compiled JSON field, and component usage is schema-checked metadata — Async DB never imports a compiler.**
