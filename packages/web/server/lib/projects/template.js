import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANAGED_PROJECT_TEMPLATE_VERSION = 1;
export const DEFAULT_MANAGED_PROJECT_NAME = '默认项目';
export const DEFAULT_MANAGED_PROJECT_TEMPLATE_ID = 'blank-node';
export const DEFAULT_MANAGED_PROJECT_DIRECTORY_NAME = 'default-project';
export const MANAGED_PROJECTS_ROOT_SEGMENTS = ['ridge', 'projects'];

const PROJECT_NAME_FALLBACK = DEFAULT_MANAGED_PROJECT_NAME;
const PROJECT_NAME_MAX_LENGTH = 64;
const DIRECTORY_NAME_MAX_LENGTH = 64;
const DIRECTORY_NAME_FALLBACK = 'project';
const TEMPLATE_MANIFEST_FILENAME = 'template.json';
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_ROOT_DIRECTORY = path.join(__dirname, 'templates');

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

const sanitizeDirectoryName = (value) => {
  const displayName = sanitizeDisplayName(value);
  const normalized = displayName
    .replace(/\s+/g, '-')
    .replace(/\.+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return normalized.slice(0, DIRECTORY_NAME_MAX_LENGTH).trim() || DIRECTORY_NAME_FALLBACK;
};

const toPackageName = (projectName) => {
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'ridge-project';
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

const sanitizeRenderFiles = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const normalized = entry.replace(/\\/g, '/').trim().replace(/^\.\//, '');
    if (!normalized || normalized.includes('..') || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const ensureTemplateDirectory = async () => {
  const stat = await fs.stat(TEMPLATES_ROOT_DIRECTORY).catch(() => null);
  if (!stat?.isDirectory()) {
    throw createTemplateError('Templates directory is missing', 500);
  }
  return TEMPLATES_ROOT_DIRECTORY;
};

const readTemplateManifest = async (templateDirectory) => {
  const manifestPath = path.join(templateDirectory, TEMPLATE_MANIFEST_FILENAME);
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw createTemplateError(`Template manifest is missing: ${manifestPath}`, 500);
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createTemplateError(`Template manifest is invalid JSON: ${manifestPath}`, 500);
  }

  const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
  const label = typeof parsed?.label === 'string' ? parsed.label.trim() : '';
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  if (!id || !label || !description) {
    throw createTemplateError(`Template manifest is incomplete: ${manifestPath}`, 500);
  }

  return {
    id,
    label,
    description,
    renderFiles: sanitizeRenderFiles(parsed.renderFiles),
    directory: templateDirectory,
    manifestPath,
  };
};

const listTemplateDirectories = async () => {
  const rootDirectory = await ensureTemplateDirectory();
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDirectory, entry.name));
};

const loadTemplateIndex = async () => {
  const directories = await listTemplateDirectories();
  const templates = await Promise.all(directories.map((directory) => readTemplateManifest(directory)));
  return templates.sort((left, right) => left.label.localeCompare(right.label, 'en'));
};

const resolveTemplate = async (templateId) => {
  const normalizedTemplateId = typeof templateId === 'string' ? templateId.trim() : '';
  if (!normalizedTemplateId) {
    throw createTemplateError('Template id is required', 400);
  }

  const templates = await loadTemplateIndex();
  const template = templates.find((entry) => entry.id === normalizedTemplateId) || null;
  if (!template) {
    throw createTemplateError('Template not found', 400);
  }
  return template;
};

const renderTemplateContent = (content, variables) => {
  return content.replace(TEMPLATE_TOKEN_PATTERN, (_match, key) => variables[key] ?? '');
};

const renderVariablesForProject = (projectName) => ({
  PROJECT_NAME: projectName,
  PACKAGE_NAME: toPackageName(projectName),
});

const copyTemplateDirectory = async ({ template, targetDirectory, variables }) => {
  const renderFileSet = new Set(template.renderFiles);
  const templateRootReal = await fs.realpath(template.directory);
  let filesCreated = 0;
  let bytesWritten = 0;
  const directoriesCreated = new Set([targetDirectory]);

  const walk = async (currentSource, currentTarget) => {
    const entries = await fs.readdir(currentSource, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === TEMPLATE_MANIFEST_FILENAME) {
        continue;
      }

      const nextSource = path.join(currentSource, entry.name);
      const nextTarget = path.join(currentTarget, entry.name);
      const stat = await fs.lstat(nextSource);

      if (stat.isSymbolicLink()) {
        throw createTemplateError('Template symlinks are not supported', 500);
      }

      const nextRealParent = await fs.realpath(path.dirname(nextSource));
      if (!nextRealParent.startsWith(templateRootReal)) {
        throw createTemplateError('Invalid template path traversal detected', 500);
      }

      if (stat.isDirectory()) {
        directoriesCreated.add(nextTarget);
        await fs.mkdir(nextTarget, { recursive: true });
        await walk(nextSource, nextTarget);
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      await fs.mkdir(path.dirname(nextTarget), { recursive: true });
      directoriesCreated.add(path.dirname(nextTarget));
      const relativePath = path.relative(template.directory, nextSource).replace(/\\/g, '/');

      if (renderFileSet.has(relativePath)) {
        const rawContent = await fs.readFile(nextSource, 'utf8');
        const renderedContent = renderTemplateContent(rawContent, variables);
        await fs.writeFile(nextTarget, renderedContent, 'utf8');
        bytesWritten += Buffer.byteLength(renderedContent, 'utf8');
      } else {
        await fs.copyFile(nextSource, nextTarget);
        bytesWritten += stat.size;
      }

      try {
        await fs.chmod(nextTarget, stat.mode & 0o777);
      } catch {
        // best effort only
      }

      filesCreated += 1;
    }
  };

  await walk(template.directory, targetDirectory);

  return {
    filesCreated,
    directoriesCreated: directoriesCreated.size,
    bytesWritten,
  };
};

export const normalizeProjectTemplateName = (value) => sanitizeDisplayName(value);

export const normalizeManagedProjectDirectoryName = (value) => sanitizeDirectoryName(value);

export const listManagedProjectTemplates = async () => {
  const templates = await loadTemplateIndex();
  return templates.map(({ id, label, description }) => ({ id, label, description }));
};

export const getManagedProjectsRootPath = (homeDirectory = os.homedir()) => {
  return path.join(path.resolve(homeDirectory), ...MANAGED_PROJECTS_ROOT_SEGMENTS);
};

export const getDefaultManagedProjectPath = (homeDirectory = os.homedir()) => {
  return path.join(getManagedProjectsRootPath(homeDirectory), DEFAULT_MANAGED_PROJECT_DIRECTORY_NAME);
};

export const createManagedProjectFromTemplate = async (targetDirectory, options = {}) => {
  const resolvedDirectory = ensureAbsoluteDirectory(targetDirectory);
  const template = await resolveTemplate(options.templateId ?? DEFAULT_MANAGED_PROJECT_TEMPLATE_ID);
  const projectName = normalizeProjectTemplateName(options.projectName ?? path.basename(resolvedDirectory));

  await ensureTargetDirectoryAvailable(resolvedDirectory);

  const stats = await copyTemplateDirectory({
    template,
    targetDirectory: resolvedDirectory,
    variables: renderVariablesForProject(projectName),
  });

  return {
    targetDirectory: resolvedDirectory,
    projectName,
    templateId: template.id,
    stats: {
      ...stats,
      templateVersion: MANAGED_PROJECT_TEMPLATE_VERSION,
    },
  };
};
