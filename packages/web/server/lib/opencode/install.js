import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { OPENCODE_CONFIG_DIR } from './shared.js';

const fsPromises = fs.promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLED_OPENCODE_TEMPLATE_DIR = path.resolve(__dirname, '..', '..', 'opencode-template');

function createInstallError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeUploadRelativePath(relativePath) {
  if (typeof relativePath !== 'string') {
    throw createInstallError('Invalid uploaded file path');
  }

  const normalized = relativePath.replace(/\\+/g, '/').trim();
  if (!normalized) {
    throw createInstallError('Uploaded file path is required');
  }

  const safePath = path.posix.normalize(normalized);
  if (
    safePath === '.' ||
    safePath.startsWith('../') ||
    safePath.includes('/../') ||
    safePath.startsWith('/')
  ) {
    throw createInstallError('Uploaded file path is not allowed');
  }

  return safePath;
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

async function assertSourceDirectory(directoryPath, label) {
  if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
    throw createInstallError(`${label} is required`);
  }

  const resolvedPath = path.resolve(directoryPath.trim());
  let stat;
  try {
    stat = await fsPromises.lstat(resolvedPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw createInstallError(`${label} does not exist`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw createInstallError(`${label} cannot be a symlink`);
  }

  if (!stat.isDirectory()) {
    throw createInstallError(`${label} must be a directory`);
  }

  return resolvedPath;
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
        throw createInstallError('Symlinks are not supported in imported configuration directories');
      }

      const nextRealParent = await fsPromises.realpath(path.dirname(nextSrc));
      if (!nextRealParent.startsWith(srcReal)) {
        throw createInstallError('Invalid source path traversal detected');
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

async function writeUploadedFiles(uploadedFiles, dstDir) {
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    throw createInstallError('Uploaded files are required');
  }

  const stats = { files: 0, directories: 0 };
  const createdDirectories = new Set();

  for (const file of uploadedFiles) {
    if (!file || typeof file !== 'object') {
      throw createInstallError('Invalid uploaded file entry');
    }

    const relativePath = normalizeUploadRelativePath(file.relativePath);
    if (typeof file.contentBase64 !== 'string') {
      throw createInstallError(`Uploaded file ${relativePath} is missing content`);
    }

    const targetPath = path.join(dstDir, ...relativePath.split('/'));
    const targetDirectory = path.dirname(targetPath);
    const relativeDirectory = path.relative(dstDir, targetDirectory);
    if (relativeDirectory && !createdDirectories.has(relativeDirectory)) {
      createdDirectories.add(relativeDirectory);
      stats.directories += 1;
    }

    await ensureDir(targetDirectory);
    await fsPromises.writeFile(targetPath, Buffer.from(file.contentBase64, 'base64'));
    stats.files += 1;
  }

  return stats;
}

async function replaceOpencodeConfigDirectory(buildStagingDirectory) {
  const parentDir = path.dirname(OPENCODE_CONFIG_DIR);
  await ensureDir(parentDir);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stagingDir = path.join(parentDir, `.opencode-staging-${stamp}`);
  const backupDir = path.join(parentDir, `.opencode-backup-${stamp}`);

  let targetMoved = false;
  try {
    const stats = await buildStagingDirectory(stagingDir);
    const targetExists = await pathExists(OPENCODE_CONFIG_DIR);

    if (targetExists) {
      await fsPromises.rename(OPENCODE_CONFIG_DIR, backupDir);
      targetMoved = true;
    }

    await fsPromises.rename(stagingDir, OPENCODE_CONFIG_DIR);

    if (targetMoved) {
      await safeRm(backupDir);
    }

    return stats;
  } catch (error) {
    if (targetMoved && !(await pathExists(OPENCODE_CONFIG_DIR)) && await pathExists(backupDir)) {
      try {
        await fsPromises.rename(backupDir, OPENCODE_CONFIG_DIR);
      } catch {
        // keep original error
      }
    }

    await safeRm(stagingDir);
    if (await pathExists(backupDir)) {
      await safeRm(backupDir);
    }
    throw error;
  }
}

export async function installBundledOpencodeConfig() {
  const templateDir = await assertSourceDirectory(BUNDLED_OPENCODE_TEMPLATE_DIR, 'Bundled OpenCode template directory');
  const stats = await replaceOpencodeConfigDirectory(async (stagingDir) => {
    return await copyDirectoryNoSymlinks(templateDir, stagingDir);
  });

  return {
    installedFrom: 'template',
    targetDir: OPENCODE_CONFIG_DIR,
    stats,
  };
}

export async function installOpencodeConfigFromDirectory(sourceDirectory) {
  const sourceDir = await assertSourceDirectory(sourceDirectory, 'Source directory');
  const stats = await replaceOpencodeConfigDirectory(async (stagingDir) => {
    return await copyDirectoryNoSymlinks(sourceDir, stagingDir);
  });

  return {
    installedFrom: 'directory',
    sourceDir,
    targetDir: OPENCODE_CONFIG_DIR,
    stats,
  };
}

export async function installOpencodeConfigFromUpload(uploadedFiles) {
  const stats = await replaceOpencodeConfigDirectory(async (stagingDir) => {
    await ensureDir(stagingDir);
    return await writeUploadedFiles(uploadedFiles, stagingDir);
  });

  return {
    installedFrom: 'upload',
    targetDir: OPENCODE_CONFIG_DIR,
    stats,
  };
}

export { BUNDLED_OPENCODE_TEMPLATE_DIR, OPENCODE_CONFIG_DIR };
