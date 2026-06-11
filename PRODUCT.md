# Product

## Register

brand

## Users

Frontend and full-stack developers use Async DB while a product's data contract is still forming. They are usually moving from seed fixtures to a local API, generated TypeScript, and eventually production-facing persistence without wanting to rebuild the app's data access layer.

## Product Purpose

Async DB gives projects a file-backed JSON database workflow from zero to prod: drop a JSON file, it's your database; when it's time to ship, promote it — the file retires into seed data and the database it taught becomes production.

The thesis: every web app's data becomes JSON at the boundary, so the JSON shape is the real contract and storage engines are implementation details behind it. Async DB lets teams define that shape first (with editable `db/` files that infer contracts, generate types, and serve local REST/viewer routes), then choose where each shape's truth lives.

Two layers carry this. `@async/db/json` is the engine: a durable embedded JSON database with real primitives — write-ahead logging with tunable fsync, atomic versioned checkpoints, cross-process locks, crash recovery, ETags, encryption at rest, backups, audit trails. `@async/db` is the platform: schemas, types, routes, contracts, and the lifecycle verbs (promote, status, reseed, graduate) that the engine's guarantees make possible. Promotion is the platform's story, not a database feature.

Every resource is born a draft (the file is the live database). Promoting it picks where production data lives: the file itself (the lower production tier — single-instance tools and local-first apps), the managed JSON state store, a registered SQLite/Postgres/custom store, or eventually a cache that materializes the contract shape from upstream systems. Staying JSON in production is choosing, not settling.

Success looks like a developer understanding the progression quickly: fixture files become contracts, local APIs, viewer metadata, and production-ready route boundaries without adding mandatory runtime dependencies.

## Brand Personality

Precise, calm, pragmatic.

The brand should feel like a technical atlas for a local data workflow: structured, exact, readable under pressure, and confident about the file-backed JSON core. It should not posture as a hosted database platform or a broad ORM.

## Anti-references

Avoid generic purple-blue SaaS gradients, terminal cosplay, glassmorphism, nested cards, repeated identical feature-card grids, decorative blobs, and marketing language that hides the concrete fixture-to-contract workflow.

Avoid positioning external databases as equal product centers. SQLite, Postgres, KV, Redis-like stores, and custom stores are integrations and escape hatches around the file-backed JSON database promise.

## Design Principles

- Show the workflow as an artifact: fixtures, generated schema, routes, viewer state, and production boundaries should appear as concrete panels and diagrams.
- Keep the docs useful at scan speed: every section should answer what changes, where the files live, and what the app can call.
- Make the file-backed JSON core unmistakable, then show graduation paths as controlled resource-level choices.
- Use visual polish to clarify contracts, not to decorate around vague claims.
- Keep dependency-light and local-first behavior visible in the interface language.

## Accessibility & Inclusion

Target WCAG AA contrast. Dark surfaces must keep body text readable, muted labels legible, and focus states obvious. Motion should be subtle, state-based, and disabled or simplified for `prefers-reduced-motion`. Code and data examples should wrap or scroll predictably on narrow screens without losing labels.
