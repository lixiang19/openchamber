import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PI_GLOBAL_TEMPLATE_DIRECTORY = path.join(__dirname, 'templates', 'global-agent');

const readTemplateDirectory = async (rootDirectory) => {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await readTemplateDirectory(absolutePath);
      files.push(...nested);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(PI_GLOBAL_TEMPLATE_DIRECTORY, absolutePath).replace(/\\/g, '/');
    const content = await fs.readFile(absolutePath, 'utf8');
    files.push({
      path: relativePath,
      content,
    });
  }

  return files;
};

export const getPiGlobalAgentDirectory = (homeDirectory = os.homedir()) => {
  return path.join(path.resolve(homeDirectory), '.pi', 'agent');
};

export const readPiGlobalTemplateDirectory = async () => {
  const files = await readTemplateDirectory(PI_GLOBAL_TEMPLATE_DIRECTORY);
  return {
    targetDir: getPiGlobalAgentDirectory(),
    files,
  };
};

export const overwritePiGlobalAgentDirectory = async (options = {}) => {
  const targetDir = getPiGlobalAgentDirectory(options.homeDirectory);
  const parentDir = path.dirname(targetDir);

  await fs.mkdir(parentDir, { recursive: true });
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(PI_GLOBAL_TEMPLATE_DIRECTORY, targetDir, { recursive: true });

  return {
    targetDir,
    files: await readTemplateDirectory(PI_GLOBAL_TEMPLATE_DIRECTORY),
  };
};
