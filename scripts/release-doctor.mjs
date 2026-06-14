#!/usr/bin/env node
// Release-state doctor for @async/db. A release is healthy when three facts
// agree for the version in package.json: the git tag vX.Y.Z exists (locally
// and on origin), npm has X.Y.Z, and the GitHub Release exists.
//
//   --check      diagnose only (default). Exit 0 healthy, 1 repairable,
//                2 cannot determine (network/tooling), 3 irreparable.
//   --repair     perform the safe convergences:
//                  - push a local-only tag / fetch a remote-only tag
//                  - publish to npm when the tag is checked out and npm
//                    is missing the version
//                  - create the missing tag only when the npm tarball
//                    shasum matches a local pack of HEAD
//                  - create the missing GitHub Release (gh + GH_TOKEN)
//   --supersede  when the state is irreparable (npm artifact cannot be
//                matched to any tree): bump the patch version, mark the
//                broken version in CHANGELOG.md, and stage a clean release.
//
// Anything not provably safe is reported with exact commands instead of
// guessed at. Publishing relies on npm auth (OIDC in CI, npm login locally).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.argv.includes("--supersede") ? "supersede"
  : process.argv.includes("--repair") ? "repair"
  : "check";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const name = pkg.name;
const version = pkg.version;
const tag = `v${version}`;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  return { code: result.status ?? 1, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

function fact(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

// --- Gather state ---------------------------------------------------------
const localTag = run("git", ["rev-parse", "--verify", `refs/tags/${tag}`]).code === 0;
const remoteProbe = run("git", ["ls-remote", "--tags", "origin", tag]);
const remoteKnown = remoteProbe.code === 0;
const remoteTag = remoteKnown && remoteProbe.stdout.includes(`refs/tags/${tag}`);

const npmProbe = run("npm", ["view", `${name}@${version}`, "dist.shasum", "--registry", "https://registry.npmjs.org/"]);
const npmMissing = npmProbe.code !== 0 && /E404|404 Not Found/i.test(npmProbe.stderr);
const npmKnown = npmProbe.code === 0 || npmMissing;
const npmShasum = npmProbe.code === 0 ? npmProbe.stdout : null;

const ghAvailable = run("gh", ["--version"]).code === 0;
const ghProbe = ghAvailable ? run("gh", ["release", "view", tag, "--json", "tagName"]) : null;
const ghRelease = ghProbe ? ghProbe.code === 0 : null;

const headCommit = run("git", ["rev-parse", "HEAD"]).stdout;
const tagCommit = localTag ? run("git", ["rev-parse", `${tag}^{commit}`]).stdout : null;

console.log(`Release doctor for ${name}@${version} (${mode})`);
fact("git tag (local)", localTag ? `present at ${tagCommit?.slice(0, 8)}` : "missing");
fact("git tag (origin)", remoteKnown ? (remoteTag ? "present" : "missing") : "unknown (cannot reach origin)");
fact("npm version", npmKnown ? (npmShasum ? `published (shasum ${npmShasum.slice(0, 12)})` : "missing") : "unknown (cannot reach registry)");
fact("github release", ghRelease === null ? "unknown (gh unavailable)" : ghRelease ? "present" : "missing");
fact("HEAD vs tag", localTag ? (headCommit === tagCommit ? "HEAD is the tagged commit" : "HEAD has moved past the tag") : "n/a");

if (!remoteKnown || !npmKnown) {
  console.error("\nCannot determine release state: origin or the npm registry is unreachable. Re-run where both are available.");
  process.exit(2);
}

// --- Local pack shasum, only when needed for evidence ----------------------
function localPackShasum() {
  const pack = run("npm", ["pack", "--dry-run", "--json"]);
  if (pack.code !== 0) return null;
  try {
    return JSON.parse(pack.stdout).at(0)?.shasum ?? null;
  } catch {
    return null;
  }
}

const actions = [];
const problems = [];

if (npmShasum && !localTag && !remoteTag) {
  // npm-only release: a tag can be created only with content evidence.
  const local = localPackShasum();
  if (local && local === npmShasum) {
    actions.push({
      describe: `create tag ${tag} at HEAD (npm tarball shasum matches a pack of HEAD) and push it`,
      apply: () => run("git", ["tag", tag]).code === 0 && run("git", ["push", "origin", tag]).code === 0
    });
  } else {
    problems.push(
      `npm has ${version} but no tag exists anywhere, and a pack of HEAD does not match the published shasum (local ${local ?? "unavailable"}, npm ${npmShasum}). ` +
      `The published artifact cannot be tied to a commit. Supersede it: node scripts/release-doctor.mjs --supersede`
    );
  }
}

if (localTag && !remoteTag) {
  actions.push({
    describe: `push existing local tag ${tag} to origin`,
    apply: () => run("git", ["push", "origin", tag]).code === 0
  });
}
if (!localTag && remoteTag) {
  actions.push({
    describe: `fetch tag ${tag} from origin`,
    apply: () => run("git", ["fetch", "origin", "tag", tag]).code === 0
  });
}

if (!npmShasum && (localTag || remoteTag)) {
  // tag-only release: publish, but only from the tagged tree.
  if (localTag && headCommit === tagCommit) {
    actions.push({
      describe: `publish ${name}@${version} to npm from the tagged commit`,
      apply: () => run("npm", ["publish", "--access", "public", "--registry", "https://registry.npmjs.org/"], { stdio: "inherit" }).code === 0
    });
  } else {
    problems.push(
      `Tag ${tag} exists but npm is missing ${version}, and HEAD is not the tagged commit. ` +
      `Publish from the tag instead: git checkout ${tag} && node scripts/release-doctor.mjs --repair ` +
      `(or dispatch the Release workflow with tag ${tag}).`
    );
  }
}

if (npmShasum && localTag && headCommit === tagCommit) {
  const local = localPackShasum();
  if (local && local !== npmShasum) {
    problems.push(
      `npm ${version} (shasum ${npmShasum}) does not match a pack of the tagged commit (${local}). ` +
      `The published artifact differs from the tag. Supersede it: node scripts/release-doctor.mjs --supersede`
    );
  }
}

if (ghRelease === false && (localTag || remoteTag) && npmShasum) {
  actions.push({
    describe: `create the missing GitHub Release for ${tag}`,
    apply: () => run("gh", ["release", "create", tag, "--verify-tag", "--generate-notes", "--title", tag]).code === 0
  });
}

// --- Supersede path ---------------------------------------------------------
if (mode === "supersede") {
  const [major, minor, patch] = version.split(".").map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  pkg.version = next;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  const date = new Date().toISOString().slice(0, 10);
  let changelog = readFileSync("CHANGELOG.md", "utf8");
  const oldHeading = changelog.match(new RegExp(`^## \\[?${version.replaceAll(".", "\\.")}.*$`, "m"))?.[0];
  if (oldHeading) {
    changelog = changelog.replace(oldHeading, `${oldHeading}\n\n> Release problem: this version's tag and npm artifact could not be reconciled; superseded by ${next}.`);
  }
  changelog = changelog.replace("## Unreleased", `## Unreleased\n\n## [${next}](https://github.com/async/db/releases/tag/v${next}) - ${date}\n\n### Fixed\n\n- Supersedes ${version}, whose published artifact and git tag could not be reconciled (see the note on that release).`);
  writeFileSync("CHANGELOG.md", changelog);

  console.log(`\nSuperseded ${version} -> ${next}:`);
  console.log(`  - package.json bumped to ${next}`);
  console.log(`  - CHANGELOG.md marks ${version} as problematic and adds the ${next} entry`);
  console.log(`Next: commit, then tag and release ${next} (git tag v${next} && git push origin main v${next}).`);
  process.exit(0);
}

// --- Report / apply ----------------------------------------------------------
if (actions.length === 0 && problems.length === 0) {
  console.log(`\nHealthy: tag, npm, and GitHub Release agree for ${version}.`);
  process.exit(0);
}

if (actions.length > 0) {
  console.log(`\n${mode === "repair" ? "Repairing" : "Repairable (run with --repair)"}:`);
  for (const action of actions) {
    if (mode === "repair") {
      const ok = action.apply();
      console.log(`  [${ok ? "done" : "FAILED"}] ${action.describe}`);
      if (!ok) problems.push(`Repair failed: ${action.describe}`);
    } else {
      console.log(`  - ${action.describe}`);
    }
  }
}

if (problems.length > 0) {
  console.error("\nNot safely repairable:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(3);
}
process.exit(mode === "repair" ? 0 : 1);
