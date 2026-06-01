import { generateHonoStarter } from '../../generate/hono.js';
import { valueAfter } from '../../cli/args.js';

type GeneratorConfig = Record<string, unknown>;

type Generator = {
  name: string;
  usage: string;
  run: (config: GeneratorConfig, args: string[]) => Promise<unknown>;
};

type GeneratorRegistry = {
  names: () => string[];
  get: (name: string) => Generator | undefined;
  usage: () => string;
};

export function defaultGeneratorRegistry(): GeneratorRegistry {
  return createGeneratorRegistry([
    honoGenerator(),
  ]);
}

export function createGeneratorRegistry(generators: Generator[]): GeneratorRegistry {
  const byName = new Map(generators.map((generator) => [generator.name, generator]));

  return {
    names() {
      return [...byName.keys()];
    },
    get(name) {
      return byName.get(name);
    },
    usage() {
      return generators.map((generator) => generator.usage).join('\n');
    },
  };
}

function honoGenerator(): Generator {
  return {
    name: 'hono',
    usage: 'async-db generate hono [--out <dir>] [--api <rest|graphql|rest,graphql|none>] [--db sqlite] [--app <standalone|module>] [--seed fixtures] [--allow-warnings]',
    async run(config, args) {
      return generateHonoStarter(config, {
        outDir: valueAfter(args, '--out'),
        api: valueAfter(args, '--api'),
        db: valueAfter(args, '--db'),
        app: valueAfter(args, '--app'),
        seed: valueAfter(args, '--seed'),
        allowWarnings: args.includes('--allow-warnings') ? true : undefined,
      });
    },
  };
}
