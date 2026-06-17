export function readNodeEnv(): string | undefined {
  try {
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}

export function isProductionEnv(): boolean {
  return readNodeEnv() === 'production';
}
