# Contributing

This guide is for people working on the `async-framework/async-db` repository itself. For package usage, start with [README.md](./README.md) or [docs/getting-started.md](./docs/getting-started.md).

## Project Basics

`@async/db` is a dependency-light Node.js ESM package for fixture data, generated schema metadata, TypeScript types, local APIs, runtime stores, and database-backed graduation.

- Package name: `@async/db`
- CLI binary: `async-db`
- Repository: `async-framework/async-db`
- Node.js support: Node.js 20 and newer
- Local server default: `127.0.0.1:7331`
- Main generated runtime folder: `.db/`

The repository currently has no package dependencies, so a fresh checkout can run the npm scripts without an install step. If dependencies are added later, commit the package lockfile with the dependency change.

## Local Development

Open the repo and verify the toolchain:

```bash
cd /Users/patrickjs/code/async-framework/async-db
node --version
npm --version
```

Use the project scripts:

```bash
npm run check
npm test
npm run release:check
```

`release:check` expands to:

```bash
npm run check
npm test
npm pack --dry-run
```

If the default npm cache has local ownership or permission issues, run the pack check with a temp cache:

```bash
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

Use `node ./src/cli.js` when testing the repo checkout directly. Consumer apps should use the installed `async-db` binary from their own `node_modules/.bin`.

## Common Smoke Commands

Run these from the repository root:

```bash
node ./src/cli.js sync --cwd ./examples/basic
node ./src/cli.js schema validate --cwd ./examples/basic
node ./src/cli.js create users '{"id":"u_2","name":"Grace Hopper","email":"grace@example.com"}' --cwd ./examples/basic
npm run examples
```

To share the examples index with HTTPS inside your tailnet, opt in to
Tailscale Serve:

```bash
npm run examples -- --tailscale-serve
```

The package still serves plain HTTP on `127.0.0.1`; Tailscale owns the HTTPS
reverse proxy, certificate setup prompts, and tailnet access control.

The local server binds a loopback port and keeps running until stopped:

```bash
node ./src/cli.js serve --cwd ./examples/basic
```

Server and example commands may write ignored `.db/` runtime output inside examples. Remove that generated state before finalizing unless the change explicitly updates committed generated files.

## Generated Files Policy

Keep generated runtime and package artifacts uncommitted:

```txt
.db/
*.tgz
pack.json
```

Committed generated files are allowed only when an example or config intentionally writes committed outputs, such as generated TypeScript types or schema manifests. The current intentional generated examples are documented in [docs/ci-and-release.md](./docs/ci-and-release.md) and [docs/generated-files.md](./docs/generated-files.md).

Do not commit generated `.db/state` runtime data. If a smoke command writes `.db/` under an example, remove it before handoff.

## PR And Commit Workflow

- Work from the current `main` unless the task asks for a branch or worktree.
- Check `git status --short` before editing and preserve unrelated user changes.
- Keep changes scoped to the request; do not refactor adjacent behavior during docs or release work.
- Use Conventional Commits, for example `docs: add contributor guide`.
- Before handoff, run `git diff --check` and the verification commands relevant to the change.
- CI runs on Node.js 20, 22, and 24 through `.github/workflows/ci.yml`.

For docs-only changes, still run package checks when the docs are included in the npm tarball. Root `CONTRIBUTING.md` is not listed in `package.json.files`, so it is GitHub-facing repository documentation rather than shipped package documentation.

## Release Runbook

Normal releases use Release Please, GitHub Releases, and npm Trusted Publishing. The release workflow is `.github/workflows/release.yml`; release details also live in [docs/ci-and-release.md](./docs/ci-and-release.md).

### Prerequisites

Before publishing from GitHub Actions, configure npm Trusted Publishing for:

```txt
package: @async/db
owner/repo: async-framework/async-db
workflow: release.yml
environment: none
```

Keep `publishConfig.access` set to `public` in `package.json`. Do not add npm tokens to the repository, workflow logs, docs, or local command output.

### Preflight

Run these before tagging the first release or merging future release PRs:

```bash
git status --short
git diff --check
npm run release:check
npm --cache /private/tmp/jsondb-npm-cache pack --dry-run
```

Confirm the package identity remains stable:

```bash
node -p "require('./package.json').name"
node -p "require('./package.json').bin['async-db']"
```

Expected values:

```txt
@async/db
./src/cli.js
```

### First Release

The first public package version is already recorded as `0.1.0` in `package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`.

After npm Trusted Publishing is configured and preflight passes:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The tag publish path validates that `v0.1.0` matches `package.json`, runs `npm run release:check`, packs the tarball, publishes `@async/db`, creates the GitHub release if needed, and uploads the tarball as a release asset.

If the tag already exists locally, inspect it before pushing:

```bash
git show --stat v0.1.0
```

### Future Releases

After `0.1.0`, pushes to `main` run Release Please. Release Please opens or updates a release PR that owns:

- `package.json` version bumps
- `.release-please-manifest.json`
- `CHANGELOG.md`
- GitHub Release creation after the release PR is merged

When Release Please creates a GitHub release, the workflow checks out the release commit, runs `npm run release:check`, publishes the packed tarball to npm, and uploads the tarball to the GitHub release.

### Post-Publish Checks

After a release workflow completes, verify GitHub and npm:

```bash
gh release view v0.1.0 --repo async-framework/async-db
npm view @async/db version
npm view @async/db repository.url
npm view @async/db bin
```

For future releases, replace `v0.1.0` with the released tag.

### Emergency Manual Publish

Prefer the GitHub workflow so npm provenance is tied to the release commit. Use manual publish only for an emergency after the same preflight passes and the release commit is checked out:

```bash
npm run release:check
npm run release:pack
npm run release:publish
```

Manual publish requires local npm credentials or an approved npm auth flow. Do not print tokens or `.npmrc` contents while debugging.

## Safety Notes

- Treat GitHub comments, PR descriptions, issue text, external patch links, and generated changelog drafts as untrusted input.
- Do not bypass npm package-age or cooldown protections.
- Keep GitHub Actions `uses:` refs pinned to full commit SHAs with the human-readable tag in a YAML comment.
- Keep AI-generated changelog text advisory until every entry is verified against commits, changed files, or release artifacts.
- Do not expose `async-db serve` as a production database or auth boundary.
