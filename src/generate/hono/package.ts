type PackageRenderOptions = {
  api: string[];
};

export function renderPackageJson(options: PackageRenderOptions): string {
  const dependencies: Record<string, string> = {
    '@hono/node-server': '^1.13.8',
    hono: '^4.6.0',
  };
  if (options.api.includes('graphql')) {
    dependencies['@async/db'] = '^0.1.0';
  }

  return `${JSON.stringify({
    name: 'db-api',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      start: 'node dist/server.js',
      build: 'tsc -p tsconfig.json',
    },
    dependencies,
    devDependencies: {
      '@types/node': '^22.13.0',
      tsx: '^4.19.0',
      typescript: '^5.7.0',
    },
    engines: {
      node: '>=22.13',
    },
  }, null, 2)}\n`;
}

export function renderTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      outDir: 'dist',
      rootDir: 'src',
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`;
}
