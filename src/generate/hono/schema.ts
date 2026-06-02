import { generatedHeader } from './header.js';

type HonoSchemaResource = {
  name: string;
  seed?: unknown;
};

type HonoSchemaProject = {
  schema: {
    resources: unknown;
  };
  resources: HonoSchemaResource[];
};

export function renderGeneratedSchema(project: HonoSchemaProject): string {
  return [
    generatedHeader(),
    `export const resources = ${JSON.stringify(project.schema.resources, null, 2)} as const;`,
    '',
    `export const seedData = ${JSON.stringify(Object.fromEntries(project.resources.map((resource) => [resource.name, resource.seed])), null, 2)} as const;`,
    '',
    'export type ResourceName = keyof typeof resources;',
  ].join('\n');
}

export function renderSeedModule(): string {
  return `${generatedHeader()}
export { seedData } from './schema.js';
`;
}
