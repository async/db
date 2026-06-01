import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

type SchemaPromptTarget = {
  all?: boolean;
  resourceName?: string;
};

type PromptLike = {
  question(prompt: string): Promise<string | undefined> | string | undefined;
  close(): void;
};

type SchemaPromptOptions = {
  command: string;
  resources: string[];
  input?: Readable & { isTTY?: boolean };
  output?: Writable & { isTTY?: boolean };
  isInteractive?: boolean;
  ask?: (prompt: string) => Promise<string | undefined> | string | undefined;
  write?: (text: string) => unknown;
};

export async function promptForSchemaTarget(options: SchemaPromptOptions): Promise<SchemaPromptTarget | undefined> {
  const {
    command,
    resources,
    input = process.stdin,
    output = process.stdout,
    isInteractive = Boolean(input.isTTY && output.isTTY),
    ask,
    write = (text) => output.write(text),
  } = options;

  if (!isInteractive) {
    return undefined;
  }

  const choices = [
    { label: 'All schemas', value: { all: true } },
    ...resources.map((resourceName) => ({
      label: resourceName,
      value: { resourceName },
    })),
  ];
  const prompt = createPrompt({ ask, input, output });

  try {
    write(`Select schema ${command} target:\n`);
    for (const [index, choice] of choices.entries()) {
      write(`  ${index + 1}. ${choice.label}\n`);
    }
    write('  q. Cancel\n');

    while (true) {
      const answer = await prompt.question('Choice: ');
      const normalized = String(answer ?? '').trim().toLowerCase();
      if (normalized === '' || normalized === 'q' || normalized === 'quit' || normalized === 'cancel') {
        return undefined;
      }
      if (normalized === 'all') {
        return { all: true };
      }

      const number = Number(normalized);
      if (Number.isInteger(number) && number >= 1 && number <= choices.length) {
        return choices[number - 1].value;
      }

      const resource = resources.find((resourceName) => resourceName.toLowerCase() === normalized);
      if (resource) {
        return { resourceName: resource };
      }

      write(`Invalid selection "${answer}". Choose 1-${choices.length}, "all", a resource name, or "q".\n`);
    }
  } finally {
    prompt.close();
  }
}

function createPrompt({ ask, input, output }: Pick<SchemaPromptOptions, 'ask' | 'input' | 'output'>): PromptLike {
  if (ask) {
    return {
      question: ask,
      close() {},
    };
  }

  const rl = createInterface({ input, output });
  return {
    async question(prompt: string) {
      try {
        return await rl.question(prompt);
      } catch {
        return undefined;
      }
    },
    close() {
      rl.close();
    },
  };
}
