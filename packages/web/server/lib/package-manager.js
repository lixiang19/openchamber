import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_NAME = '@ridge/web';
let cachedDetectedPm = null;

function getSpawnSyncBaseOptions() {
  return process.platform === 'win32' ? { windowsHide: true } : {};
}

function getRidgeConfigDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'ridge');
  }

  return path.join(os.homedir(), '.config', 'ridge');
}

function markUpdatesDisabled(scope = 'web') {
  const configDir = getRidgeConfigDir();
  const markerPath = path.join(configDir, `updates-disabled-${scope}`);
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(markerPath, 'updates disabled\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Best-effort marker only.
  }
}

export function detectPackageManager() {
  if (cachedDetectedPm) {
    return cachedDetectedPm;
  }

  const forcedPm = process.env.RIDGE_PACKAGE_MANAGER?.trim();
  if (forcedPm && ['npm', 'pnpm', 'yarn', 'bun'].includes(forcedPm)) {
    cachedDetectedPm = forcedPm;
    return cachedDetectedPm;
  }

  const userAgent = process.env.npm_config_user_agent || '';
  if (userAgent.startsWith('pnpm')) cachedDetectedPm = 'pnpm';
  else if (userAgent.startsWith('yarn')) cachedDetectedPm = 'yarn';
  else if (userAgent.startsWith('bun')) cachedDetectedPm = 'bun';
  else if (userAgent.startsWith('npm')) cachedDetectedPm = 'npm';
  else cachedDetectedPm = 'npm';

  return cachedDetectedPm;
}

export function getUpdateCommand() {
  return 'Updates are disabled in Ridge';
}

export function getCurrentVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getLatestVersion() {
  return null;
}

export async function fetchChangelogNotes() {
  return undefined;
}

export async function checkForUpdates(options = {}) {
  const currentVersion = options.currentVersion || getCurrentVersion();
  const pm = detectPackageManager();
  const scope = typeof options.appType === 'string' && options.appType.trim().length > 0 ? options.appType.trim() : 'web';
  markUpdatesDisabled(scope);

  return {
    available: false,
    currentVersion,
    version: null,
    body: 'Updates are disabled in Ridge.',
    packageManager: pm,
    updateCommand: 'Updates are disabled in Ridge',
    nextSuggestedCheckInSec: undefined,
  };
}

export function executeUpdate(pm = detectPackageManager(), options = {}) {
  const command = getUpdateCommand(pm);
  if (!options?.silent) {
    console.log(`Skipping update for ${PACKAGE_NAME}.`);
    console.log(command);
  }

  return {
    success: false,
    exitCode: 1,
    skipped: true,
  };
}

export function isPackageInstalledWith(pm) {
  try {
    const args = pm === 'yarn' ? ['global', 'list', '--depth=0'] : ['list', '-g', '--depth=0', PACKAGE_NAME];
    const result = spawnSync(pm, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      ...getSpawnSyncBaseOptions(),
    });
    return result.status === 0 && result.stdout.includes(PACKAGE_NAME);
  } catch {
    return false;
  }
}
