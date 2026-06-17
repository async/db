# GitHub Content

Minimal Git-backed content setup. `db.config.js` defines one GitHub remote and the `posts` schema maps one MDX file per record with `gitFiles()`.

The example uses an inline snapshot so it runs without GitHub credentials. Replace the `snapshot` block with your `@async/github-app` app/client wiring or token-mode GitHub access in a real project.
