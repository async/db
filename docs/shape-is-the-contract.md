# The Shape Is The Contract

Every web app's data becomes JSON at the boundary. Whatever lives in Postgres, Stripe, or a legacy API, the frontend consumes a JSON shape — so the shape is the only stable layer of the stack. Async DB is built around that observation: define the shape you wish your backend had, then choose where its truth lives.

## Two layers

`@async/db/json` is the **engine** — a durable embedded JSON database with no opinions about your workflow. Its primitives stand alone:

| Primitive | Guarantee |
| --- | --- |
| Write-ahead log (`durability: 'wal'`) | A write is acknowledged only after its delta is appended to a hidden JSONL log. `fsync: 'always'` loses nothing on power loss; `'everysec'` loses at most ~1 second; `'no'` defers to the OS |
| Atomic checkpoints | The pretty, human-readable JSON file is rewritten via temp + fsync + rename shortly after each write (debounced ~250ms) — never torn, always `git diff`-able |
| Crash recovery | Boot (and every read) replays the log tail onto the checkpoint; torn final lines are dropped; corrupt files are quarantined, never deleted |
| Hand edits win | Each log generation is bound to its checkpoint's content hash. Edit the file in your editor and stale machinery yields to what you can see |
| Version history | Checkpoints keep pruned snapshots; `async-db restore` rolls back, and restores are themselves undoable |
| Cross-process safety | Advisory per-resource locks; ETag/If-Match preconditions; If-None-Match conditional reads |
| Operations | Health probe, authorize hook, JSONL audit trails, AES-256-GCM encryption at rest, one-file backups |

`@async/db` is the **platform** — schemas inferred from data, generated types, REST/GraphQL routes, the viewer, contracts, and the lifecycle story below. The platform never implements durability; it selects engine primitives per phase and narrates what that means.

## The lifecycle: draft → production

Every resource is born a **draft**: the `db/users.json` file is the live database. You watch records appear in the file you created, hand-edit it, commit it — lowdb's feel with the engine's guarantees underneath (WAL acknowledgment, atomic rewrites, recovery).

When a shape is ready, one ceremony moves it to **production**:

```bash
async-db promote users                      # → production (json), wal everysec
async-db promote users --fsync always      # → lose nothing on power loss
async-db promote users --store file        # → the file stays canonical (lower prod tier)
async-db promote orders --store postgres   # → registered store; promote and graduate in one step
```

Promotion freezes the accumulated draft data as the seed (its hash is pinned), captures the inferred schema if none is written, and records everything in `db.lifecycle.jsonc` — machine-managed, committed, reviewable in the PR. From then on the seed file only teaches shape and hydrates fresh environments: editing it never silently resets production state (`DOCTOR_SEED_DRIFT` warns; `async-db reseed --force` is the deliberate path).

Production is one phase with interchangeable engines — `production (file)`, `production (json)`, `production (postgres)` are peers. Staying JSON is choosing, not settling: flags, settings, templates, and content can live in `production (json)` forever. `async-db status` shows each resource's derived phase and its next verb; `doctor --production` refuses only drafts.

Resources born knowing their engine skip the ceremony entirely: register a store in `db.config.js` and the `db/` file is seed-and-schema from day one.

## Content collections: files that are born canonical

Markdown and MDX content is the role where the file never retires. A folder becomes a resource by carrying an `index.schema.js`:

```js
// db/docs/index.schema.js
import { collection, field, files } from '@async/db/schema';

export default collection({
  source: files('./**/*.mdx', { read: 'frontmatter' }),
  fields: { id: field.string({ required: true }), title: field.string({ required: true }), body: field.string({ required: true }) },
});
```

The content itself does not have to live in `db/` — `files('../docs/**/*.md')` sources a repo-level `/docs` folder, which is where writers naturally keep it. `db/` then holds only the *contract registry*: small schema files that teach the shape, while the canonical bytes live wherever humans edit them. At the boundary the thesis holds unchanged — a doc page is JSON (`{ id, title, section, order, body }`) with frontmatter as its fields and the body as one of them, served through the same routes, types, ETags, and viewer as every other resource.

MDX support is tiered — raw body, app-compiled JSON ASTs via trusted schema code, and schema-checked component usage (`read: 'mdx'` scans capitalized JSX tags and validates them against the schema's `components` list at sync); see [docs-and-mdx.md](./docs-and-mdx.md). Content collections sit outside the draft → production ladder because their answer to durability is different: the files are simultaneously seed, live data, and contract; runtime writes are disabled (`store: 'static'`); and **git is their write-ahead log** — history, blame, review, and rollback come from version control, not from the engine. `async-db status` shows them as `content (files)` with no promotion nudge. Their "promote" is a publish workflow (branch → review → merge), which the fork/branch primitives already model.

## When the shape can't live here

Sometimes data can't move — it belongs to Postgres, a vendor API, or a system that predates the app. The contract still holds: the planned **cache role** lets a resource declare a refresh source and TTL, and the JSON database materializes the contract shape from upstream — same routes, same types, same ETags and 304s. A BFF stops being a service you build and becomes a resource you declare.

That completes the scaling story honestly: the JSON database scales like a control/content plane (per-resource collections to low tens of thousands of records, WAL-absorbed write bursts, one writer per host). Past that envelope, the *contract* scales even when the file doesn't — graduate the engine or front the upstream, and the frontend never notices.
