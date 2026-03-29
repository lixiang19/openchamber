import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const INSTRUCTIONS_SETTINGS_DIRECTORY = '.ridge';
export const INSTRUCTIONS_SETTINGS_FILENAME = 'pi-settings.json';

export const DEFAULT_INSTRUCTIONS_CONFIG = Object.freeze({
  enabled: false,
  files: [],
  maxFileBytes: 8192,
  maxTotalBytes: 32768,
  onMissingFile: 'warn',
});

export const INSTRUCTIONS_ERROR_CODE = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  SYMLINK_ESCAPE: 'SYMLINK_ESCAPE',
  NOT_REGULAR_FILE: 'NOT_REGULAR_FILE',
  INVALID_EXTENSION: 'INVALID_EXTENSION',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  TOTAL_TOO_LARGE: 'TOTAL_TOO_LARGE',
  NOT_UTF8: 'NOT_UTF8',
});

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.mdx']);
const VALID_MISSING_FILE_BEHAVIORS = new Set(['ignore', 'warn', 'error']);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizePositiveInteger = (value, fallback) => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return fallback;
};

const createInstructionsError = (code, message, options = {}) => {
  const error = new Error(message, options.cause ? { cause: options.cause } : undefined);
  error.name = 'ProjectInstructionsError';
  error.code = code;
  if (options.file) {
    error.file = options.file;
  }
  return error;
};

const normalizeInstructionPath = (value) => {
  const normalized = normalizeString(value).replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized;
};

const sanitizeInstructionFiles = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const files = [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeInstructionPath(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    files.push(normalized);
  }
  return files;
};

const normalizeMissingFileBehavior = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return VALID_MISSING_FILE_BEHAVIORS.has(normalized)
    ? normalized
    : DEFAULT_INSTRUCTIONS_CONFIG.onMissingFile;
};

const normalizeInstructionsConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_INSTRUCTIONS_CONFIG };
  }

  return {
    enabled: value.enabled === true,
    files: sanitizeInstructionFiles(value.files),
    maxFileBytes: normalizePositiveInteger(value.maxFileBytes, DEFAULT_INSTRUCTIONS_CONFIG.maxFileBytes),
    maxTotalBytes: normalizePositiveInteger(value.maxTotalBytes, DEFAULT_INSTRUCTIONS_CONFIG.maxTotalBytes),
    onMissingFile: normalizeMissingFileBehavior(value.onMissingFile),
  };
};

const decodeUtf8 = (buffer, filePath) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.NOT_UTF8,
      `Instructions file is not valid UTF-8: ${filePath}`,
      { file: filePath, cause: error },
    );
  }
};

const assertRelativeInstructionPath = (relativePath) => {
  if (!relativePath) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.INVALID_CONFIG,
      'Instructions file path cannot be empty',
    );
  }

  if (path.isAbsolute(relativePath) || relativePath.startsWith('~')) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.PATH_TRAVERSAL,
      `Absolute or home-relative paths are not allowed: ${relativePath}`,
      { file: relativePath },
    );
  }

  const segments = relativePath.split('/');
  if (segments.includes('..')) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.PATH_TRAVERSAL,
      `Path traversal is not allowed: ${relativePath}`,
      { file: relativePath },
    );
  }
};

const isOutsideRoot = (rootPath, candidatePath) => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.startsWith('..') || path.isAbsolute(relative);
};

const validateAndReadFile = async (projectRoot, relativePath, maxFileBytes) => {
  const extension = path.extname(relativePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.INVALID_EXTENSION,
      `Instructions file extension is not allowed: ${relativePath}`,
      { file: relativePath },
    );
  }

  assertRelativeInstructionPath(relativePath);

  const rootRealPath = await fs.realpath(projectRoot);
  const absolutePath = path.resolve(rootRealPath, relativePath);

  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const fileRealPath = await fs.realpath(absolutePath);
    if (isOutsideRoot(rootRealPath, fileRealPath)) {
      throw createInstructionsError(
        INSTRUCTIONS_ERROR_CODE.SYMLINK_ESCAPE,
        `Instructions symlink points outside project root: ${relativePath}`,
        { file: relativePath },
      );
    }

    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.NOT_REGULAR_FILE,
      `Instructions path must be a regular file: ${relativePath}`,
      { file: relativePath },
    );
  }

  if (!stat.isFile()) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.NOT_REGULAR_FILE,
      `Instructions path must be a regular file: ${relativePath}`,
      { file: relativePath },
    );
  }

  const fileRealPath = await fs.realpath(absolutePath);
  if (isOutsideRoot(rootRealPath, fileRealPath)) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.SYMLINK_ESCAPE,
      `Instructions file resolves outside project root: ${relativePath}`,
      { file: relativePath },
    );
  }

  if (stat.size > maxFileBytes) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.FILE_TOO_LARGE,
      `Instructions file exceeds maxFileBytes: ${relativePath}`,
      { file: relativePath },
    );
  }

  const buffer = await fs.readFile(absolutePath);
  const content = decodeUtf8(buffer, relativePath);

  return {
    content,
    bytes: buffer.length,
  };
};

const buildContentHash = (content) => {
  if (!content) {
    return null;
  }
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
};

export const getProjectPiSettingsPath = (projectRoot) => {
  const resolvedRoot = typeof projectRoot === 'string' && projectRoot.trim().length > 0
    ? path.resolve(projectRoot)
    : process.cwd();
  return path.join(resolvedRoot, INSTRUCTIONS_SETTINGS_DIRECTORY, INSTRUCTIONS_SETTINGS_FILENAME);
};

export const readProjectInstructionsSettings = async (projectRoot) => {
  const settingsPath = getProjectPiSettingsPath(projectRoot);
  let raw;
  try {
    raw = await fs.readFile(settingsPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        exists: false,
        settingsPath,
        instructions: { ...DEFAULT_INSTRUCTIONS_CONFIG },
      };
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createInstructionsError(
      INSTRUCTIONS_ERROR_CODE.INVALID_CONFIG,
      `Invalid instructions settings JSON: ${settingsPath}`,
      { cause: error },
    );
  }

  return {
    exists: true,
    settingsPath,
    instructions: normalizeInstructionsConfig(parsed?.instructions),
  };
};

export const buildProjectInstructionsContext = async (projectRoot, options = {}) => {
  const settings = await readProjectInstructionsSettings(projectRoot);
  const config = settings.instructions;
  const info = {
    exists: settings.exists,
    settingsPath: settings.settingsPath,
    enabled: config.enabled,
    files: [...config.files],
    maxFileBytes: config.maxFileBytes,
    maxTotalBytes: config.maxTotalBytes,
    onMissingFile: config.onMissingFile,
    loadedFiles: [],
    skippedFiles: [],
    totalBytes: 0,
    content: '',
    contentHash: null,
  };

  if (!config.enabled || config.files.length === 0) {
    return info;
  }

  const sections = [];
  for (const file of config.files) {
    try {
      const { content, bytes } = await validateAndReadFile(projectRoot, file, config.maxFileBytes);
      if (info.totalBytes + bytes > config.maxTotalBytes) {
        throw createInstructionsError(
          INSTRUCTIONS_ERROR_CODE.TOTAL_TOO_LARGE,
          `Instructions content exceeds maxTotalBytes after reading: ${file}`,
          { file },
        );
      }

      info.totalBytes += bytes;
      info.loadedFiles.push(file);
      sections.push(`<!-- From: ${file} -->\n\n${content}`);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        if (config.onMissingFile === 'error') {
          throw error;
        }
        info.skippedFiles.push(file);
        continue;
      }
      throw error;
    }
  }

  info.content = sections.join('\n\n---\n\n');
  info.contentHash = buildContentHash(info.content);

  if (options.includeContentPreview === true && info.content) {
    info.contentPreview = info.content.slice(0, 500);
  }

  return info;
};
