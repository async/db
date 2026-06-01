type GlobalOptions = {
  cwd: string;
  configPath?: string;
};

export function parseGlobalOptions(args: string[]): GlobalOptions {
  return {
    cwd: valueAfter(args, '--cwd') ?? process.cwd(),
    configPath: valueAfter(args, '--config'),
  };
}

export function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

export function isHelpRequested(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}
