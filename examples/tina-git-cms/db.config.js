import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';
import { sqliteMirror } from '@async/db/sqlite';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/marketing-content',
        branch: 'main',
        mode: 'token',
        snapshot: [
          {
            path: 'content/pages/home.mdx',
            content: '---\ntitle: "Home"\nstatus: published\n---\n# Welcome\n\nThis page is backed by Git.',
          },
          {
            path: 'content/pages/about.mdx',
            content: '---\ntitle: "About"\nstatus: draft\n---\n# About\n\nDraft about page.',
          },
          {
            path: 'content/authors/ada.json',
            content: '{"name":"Ada Lovelace","role":"Editor"}',
          },
          {
            path: 'content/site.json',
            content: '{"title":"Acme Marketing","theme":"light"}',
          },
        ],
      }),
    },
    mirror: sqliteMirror({
      file: './.db/git-mirror.sqlite',
      writes: 'through',
    }),
  },
  outputs: {
    schemaManifest: './src/generated/db.schema.json',
    committedTypes: './src/generated/db.types.d.ts',
  },
  graphql: { enabled: true },
});
