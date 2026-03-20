import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const fsPromises = fs.promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_STARTER_PROJECT_NAME = 'OpenAurora Home';
export const STARTER_PROJECT_TEMPLATE_VERSION = 1;
export const BUNDLED_PROJECT_TEMPLATE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'project-template',
  'openaurora-home'
);

function createProjectTemplateError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

async function safeRm(targetPath) {
  try {
    await fsPromises.rm(targetPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

async function assertDirectory(directoryPath, label) {
  if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
    throw createProjectTemplateError(`${label} is required`);
  }

  const resolvedPath = path.resolve(directoryPath.trim());
  let stat;
  try {
    stat = await fsPromises.lstat(resolvedPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw createProjectTemplateError(`${label} does not exist`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw createProjectTemplateError(`${label} cannot be a symlink`);
  }

  if (!stat.isDirectory()) {
    throw createProjectTemplateError(`${label} must be a directory`);
  }

  return resolvedPath;
}

async function assertBundledTemplateDirectory() {
  return await assertDirectory(BUNDLED_PROJECT_TEMPLATE_DIR, 'Bundled project template directory');
}

async function copyDirectoryNoSymlinks(srcDir, dstDir) {
  const srcReal = await fsPromises.realpath(srcDir);
  await ensureDir(dstDir);

  const stats = { files: 0, directories: 0 };

  const walk = async (currentSrc, currentDst) => {
    const entries = await fsPromises.readdir(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      const nextSrc = path.join(currentSrc, entry.name);
      const nextDst = path.join(currentDst, entry.name);
      const entryStat = await fsPromises.lstat(nextSrc);

      if (entryStat.isSymbolicLink()) {
        throw createProjectTemplateError('Symlinks are not supported in project templates');
      }

      const nextRealParent = await fsPromises.realpath(path.dirname(nextSrc));
      if (!nextRealParent.startsWith(srcReal)) {
        throw createProjectTemplateError('Invalid project template path traversal detected');
      }

      if (entryStat.isDirectory()) {
        await ensureDir(nextDst);
        stats.directories += 1;
        await walk(nextSrc, nextDst);
        continue;
      }

      if (entryStat.isFile()) {
        await ensureDir(path.dirname(nextDst));
        await fsPromises.copyFile(nextSrc, nextDst);
        try {
          await fsPromises.chmod(nextDst, entryStat.mode & 0o777);
        } catch {
          // best-effort mode preservation
        }
        stats.files += 1;
      }
    }
  };

  await walk(srcDir, dstDir);
  return stats;
}

async function readDirectoryEntries(targetPath) {
  try {
    return await fsPromises.readdir(targetPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function getDefaultStarterProjectPath(homeDirectory = os.homedir()) {
  return path.join(path.resolve(homeDirectory), 'OpenAurora', DEFAULT_STARTER_PROJECT_NAME);
}

export function normalizeProjectTemplateName(value) {
  if (typeof value !== 'string') {
    throw createProjectTemplateError('Project name is required');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw createProjectTemplateError('Project name is required');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw createProjectTemplateError('Project name is not allowed');
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw createProjectTemplateError('Project name cannot contain path separators');
  }
  if (trimmed.length > 80) {
    throw createProjectTemplateError('Project name is too long');
  }

  return trimmed;
}

export async function createBundledProjectFromTemplate(targetDirectory) {
  if (typeof targetDirectory !== 'string' || !targetDirectory.trim()) {
    throw createProjectTemplateError('Target directory is required');
  }

  const templateDir = await assertBundledTemplateDirectory();
  const resolvedTargetDirectory = path.resolve(targetDirectory.trim());
  const parentDirectory = path.dirname(resolvedTargetDirectory);
  if (await pathExists(parentDirectory)) {
    await assertDirectory(parentDirectory, 'Target parent directory');
  } else {
    await ensureDir(parentDirectory);
  }

  const existingEntries = await readDirectoryEntries(resolvedTargetDirectory);
  const targetExists = Array.isArray(existingEntries);
  if (targetExists && existingEntries.length > 0) {
    throw createProjectTemplateError('Target directory already exists and is not empty');
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stagingDirectory = path.join(parentDirectory, `.openaurora-project-staging-${stamp}`);

  try {
    const stats = await copyDirectoryNoSymlinks(templateDir, stagingDirectory);

    if (targetExists) {
      await fsPromises.rmdir(resolvedTargetDirectory);
    }

    await fsPromises.rename(stagingDirectory, resolvedTargetDirectory);

    return {
      targetDirectory: resolvedTargetDirectory,
      stats,
      templateVersion: STARTER_PROJECT_TEMPLATE_VERSION,
    };
  } catch (error) {
    await safeRm(stagingDirectory);
    throw error;
  }
}
