import { generateHonoStarter } from '../../generate/hono.js';
import { valueAfter } from '../../cli/args.js';

export function defaultGeneratorRegistry() {
  return createGeneratorRegistry([
    honoGenerator(),
  ]);
}

export function createGeneratorRegistry(generators) {
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

function honoGenerator() {
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
