import path from 'path';

const APP_DATA_DIR_ENV = 'APP_DATA_DIR';

export function getAppDataDir(): string {
  const configuredDir = process.env[APP_DATA_DIR_ENV]?.trim();
  if (configuredDir) {
    return configuredDir;
  }

  return path.join(process.cwd(), 'data');
}

export function getAppDataPath(...segments: string[]): string {
  return path.join(getAppDataDir(), ...segments);
}
