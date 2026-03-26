import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_STARTER_PROJECT_NAME = 'OpenChamber Starter';
export const STARTER_PROJECT_TEMPLATE_VERSION = 1;

const DEFAULT_STARTER_ROOT_DIRECTORY = 'OpenChamber';
const PROJECT_NAME_FALLBACK = DEFAULT_STARTER_PROJECT_NAME;
const PROJECT_NAME_MAX_LENGTH = 64;

const TEMPLATE_FILES = (projectName) => ({
  '.gitignore': ['node_modules', 'dist', '.DS_Store', '.env', ''].join('\n'),
  'README.md': [`# ${projectName}`, '', 'Starter project for OpenChamber.', ''].join('\n'),
  'package.json': JSON.stringify({
    name: toPackageName(projectName),
    private: true,
    type: 'module',
    scripts: {
      start: 'node src/main.js',
    },
  }, null, 2) + '\n',
  'src/main.js': [
    "console.log('OpenChamber starter project is ready.');",
    '',
  ].join('\n'),
});

const createTemplateError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureAbsoluteDirectory = (targetDirectory) => {
  if (typeof targetDirectory !== 'string' || targetDirectory.trim().length === 0) {
    throw createTemplateError('Target directory is required');
  }

  const resolved = path.resolve(targetDirectory);
  if (!path.isAbsolute(resolved)) {
    throw createTemplateError('Target directory must be an absolute path');
  }

  return resolved;
};

const sanitizeDisplayName = (value) => {
  if (typeof value !== 'string') {
    return PROJECT_NAME_FALLBACK;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return PROJECT_NAME_FALLBACK;
  }

  const withoutInvalidChars = trimmed
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  if (!withoutInvalidChars) {
    return PROJECT_NAME_FALLBACK;
  }

  return withoutInvalidChars.slice(0, PROJECT_NAME_MAX_LENGTH).trim() || PROJECT_NAME_FALLBACK;
};

const toPackageName = (projectName) => {
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'openchamber-starter-project';
};

const ensureTargetDirectoryAvailable = async (targetDirectory) => {
  try {
    const existing = await fs.readdir(targetDirectory);
    if (existing.length > 0) {
      throw createTemplateError('Target directory already exists and is not empty', 409);
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      await fs.mkdir(targetDirectory, { recursive: true });
      return;
    }
    throw error;
  }
};

export const normalizeProjectTemplateName = (value) => sanitizeDisplayName(value);

export const getDefaultStarterProjectPath = () => {
  return path.join(os.homedir(), DEFAULT_STARTER_ROOT_DIRECTORY, DEFAULT_STARTER_PROJECT_NAME);
};

export const createBundledProjectFromTemplate = async (targetDirectory, options = {}) => {
  const resolvedDirectory = ensureAbsoluteDirectory(targetDirectory);
  const projectName = normalizeProjectTemplateName(options.projectName ?? path.basename(resolvedDirectory));

  await ensureTargetDirectoryAvailable(resolvedDirectory);
  await fs.mkdir(path.join(resolvedDirectory, 'src'), { recursive: true });

  const files = TEMPLATE_FILES(projectName);
  let bytesWritten = 0;
  let fileCount = 0;

  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const filePath = path.join(resolvedDirectory, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    bytesWritten += Buffer.byteLength(content, 'utf8');
    fileCount += 1;
  }));

  return {
    targetDirectory: resolvedDirectory,
    projectName,
    stats: {
      filesCreated: fileCount,
      directoriesCreated: 1,
      bytesWritten,
      templateVersion: STARTER_PROJECT_TEMPLATE_VERSION,
    },
  };
};
