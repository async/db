# Tina-Style Git CMS

CMS-style Git content setup with a SQLite mirror. The schema manifest can drive an editor UI, while reads come from the local mirror after sync.

The example uses inline GitHub snapshots so it runs without credentials. In production, keep the same `gitFiles()`, `gitFile()`, and `gitCollectionFile()` schema mappings and wire the remote through `@async/github-app`.
