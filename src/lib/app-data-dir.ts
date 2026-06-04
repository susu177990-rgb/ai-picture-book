import path from 'path';

export function getAppDataDir(): string {
  return path.join(process.cwd(), 'data');
}

export function getAppDataPath(...segments: string[]): string {
  return path.join(getAppDataDir(), ...segments);
}
