import { defineConfig } from '@async/db/config';
import { githubRemote } from '@async/db/git';

export default defineConfig({
  git: {
    remotes: {
      content: githubRemote({
        repo: 'acme/site-content',
        branch: 'main',
        mode: 'token',
        snapshot: [
          {
            path: 'content/posts/launch.mdx',
            content: '---\ntitle: "Launch Notes"\nstatus: published\n---\nHello from Git-backed content.',
          },
          {
            path: 'content/posts/roadmap.mdx',
            content: '---\ntitle: "Roadmap"\nstatus: draft\n---\nDraft roadmap body.',
          },
        ],
      }),
    },
  },
  outputs: {
    schemaManifest: './src/generated/db.schema.json',
    committedTypes: './src/generated/db.types.d.ts',
  },
  graphql: { enabled: true },
});
