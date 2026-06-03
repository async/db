# Product

## Register

brand

## Users

Frontend and full-stack developers use Async DB while a product's data contract is still forming. They are usually moving from seed fixtures to a local API, generated TypeScript, and eventually production-facing persistence without wanting to rebuild the app's data access layer.

## Product Purpose

Async DB gives projects a file-backed JSON database workflow from zero to prod. It starts with editable `db/` fixtures, infers useful contracts, generates schema metadata and TypeScript types, serves local REST and viewer routes, and lets individual resources graduate to JSON file state, SQLite, Postgres, KV/Redis-like stores, or custom stores as their operational needs change.

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
