---
name: async-db-example-authoring
description: Use when creating, reviewing, or editing jsondb or async-db examples, example READMEs, model explanations, diagrams, docs links, runtime-only examples, or example verification in this repository.
---

# Async DB Example Authoring

## Overview

Examples in this repo are teaching artifacts and package artifacts. They should be runnable, explain why the data model is shaped that way, and verify cleanly before handoff.

## When to Use

Use this for changes under `examples/*`, example READMEs, docs links from examples, example diagrams, runtime-only example ideas, and onboarding-oriented example docs.

Do not use it for core runtime/API contract changes unless the task is specifically about how examples should teach that behavior. Use global contract/release skills for shared API surfaces.

## Rules

- Keep core `async-db` convention-light. Example UI behavior belongs in example-owned metadata such as `schemaUi`, not in core assumptions.
- Public README text should read like product/model explanation, not internal author notes.
- Prefer one richer runnable example over several shallow examples.
- For new feature ideas, start runtime/example-owned unless the user explicitly asks for a core contract.
- Do not delete ignored runtime output with broad commands unless the user explicitly approves the exact cleanup.

## Start Here

- Example learning path and current list: `README.md`, especially "Which Example Should I Start With?"
- Repo rules, generated-file policy, and standard checks: `AGENTS.md`.
- Example discovery/index behavior: `examples/*/example.json`, `scripts/serve-examples.js`, and `scripts/example-launcher.js`.
- Example behavior tests: `test/examples/examples.test.js`.
- Package artifact allowlist: `package.json` `files` when adding new example assets.

## Workflow

1. Inspect the relevant files from "Start Here" before editing, plus the specific example README, fixtures, schemas, config, and source files.
2. Decide what the example teaches: model shape, relation behavior, runtime source, integration, UI metadata, auth, diagnostics, or route behavior.
3. Make README structure newcomer-friendly:
   - What it is.
   - How to run it.
   - Why this shape.
   - Relations to notice, when relevant.
   - Features to notice, with links to deeper docs.
4. Keep model behavior live. Do not hide a working model just because a UI should not expose writes.
5. Use diagrams only where relationships or lifecycle are clearer visually. Preserve existing Mermaid blocks, but do not add diagrams just to satisfy a blanket convention.
6. For standalone REST docs/examples, prefer `/db/*.json` fixture-like routes where that is the repo's documented teaching path. Preserve unprefixed paths when a Vite virtual client or configured `restBasePath` makes them correct.
7. Keep generated or runtime output out of committed examples unless the repo already tracks it deliberately.

## Verification

Run the smallest relevant checks first, then broaden by change type:

- README/docs-only edits: `git diff --check`.
- Example fixture, schema, config, or source changes: `node --test test/examples/examples.test.js`; also run `node ./src/cli.js sync --cwd ./examples/<name>` and `node ./src/cli.js schema validate --cwd ./examples/<name>` when the example's model shape changed.
- Example launcher, `example.json`, `serve-example.mjs`, or schema-ui server changes: run `npm run examples` when loopback ports are allowed.
- Full handoff or package-surface changes: `npm run check`, `npm test`, and `npm pack --dry-run`. If the default npm cache has ownership issues, use `npm --cache /private/tmp/db-npm-cache pack --dry-run`.
- After any command writes ignored `.db/` runtime output under an example, remove only that known generated output before finalizing unless the task explicitly asks to keep it.

If server/example tests fail with `listen EPERM` on loopback, classify it as an environment permission issue before treating it as a docs regression.

## Common Mistakes

- Explaining files and commands but not the model decision. Fix: add `Why This Shape?` or `Modeling Decisions`.
- Letting UI metadata become a core manifest contract. Fix: keep models/resources live and interpret UI hints in example code.
- Writing generic docs that leak the prompt or authoring process. Fix: phrase from the reader's domain.
- Changing intentional scoped-client paths. Fix: classify Vite/fork/restBasePath examples before replacing `/users` with `/db/users.json`.

## Pressure Tests

- Prompt: "Add an ecommerce example; this should be more advanced than catalog."
  Expected behavior: explain why ecommerce is the next modeling step, keep the example runnable, add model-shape and relation explanations, include a useful diagram, and run example verification.
- Prompt: "Make the schema UI hide this resource."
  Expected behavior: keep the resource/model live, put hiding behavior in example-owned metadata/code, and avoid adding a core convention.
