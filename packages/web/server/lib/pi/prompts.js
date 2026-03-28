import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatter } from '@mariozechner/pi-coding-agent';

const isDirectory = async (targetPath) => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const findNearestProjectPromptsDir = async (cwd) => {
  let currentDir = path.resolve(cwd);

  while (true) {
    const candidate = path.join(currentDir, '.pi', 'prompts');
    if (await isDirectory(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

const loadPromptsFromDir = async (dirPath, sourceScope, { getPromptsDir }) => {
  const prompts = [];

  let files = [];
  try {
    files = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Error reading prompts directory ${dirPath}:`, error);
    }
    return prompts;
  }

  for (const entry of files) {
    if (!entry.name.endsWith('.md')) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dirPath, entry.name);
    let rawContent = '';
    try {
      rawContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.warn(`Failed to read prompt template ${filePath}:`, error);
      continue;
    }

    const parsed = parseFrontmatter(rawContent);
    const data = parsed?.frontmatter && typeof parsed.frontmatter === 'object' ? parsed.frontmatter : {};
    const content = typeof parsed?.body === 'string' ? parsed.body : rawContent;

    const name = data.name || entry.name.replace(/\.md$/, '');
    if (!name) {
      continue;
    }

    const description = typeof data.description === 'string' ? data.description.trim() : undefined;
    const enabled = data.enabled !== false;

    if (!enabled) {
      continue;
    }

    prompts.push({
      name,
      description,
      template: content.trim(),
      source: filePath,
      sourceScope,
    });
  }

  return prompts;
};

/**
 * Discovers prompt templates from user scope (`~/.pi/agent/prompts`) and the nearest
 * project scope (`.pi/prompts`). Project prompts override user prompts with the
 * same name.
 *
 * @param {string} cwd
 * @param {{ getPromptsDir: () => string, projectPromptsDir?: string | null }} [options]
 * @returns {Promise<Array<{
 *   name: string,
 *   description?: string,
 *   template: string,
 *   source: string,
 *   sourceScope: 'user'|'project',
 * }>>}
 */
export async function discoverPrompts(cwd, options = {}) {
  const { getPromptsDir } = options;
  const userPromptsDir = getPromptsDir ? getPromptsDir() : path.join(process.env.HOME || process.env.USERPROFILE || '', '.pi/agent/prompts');
  const projectPromptsDir = options.projectPromptsDir === undefined
    ? await findNearestProjectPromptsDir(cwd)
    : options.projectPromptsDir;

  const [userPrompts, projectPrompts] = await Promise.all([
    loadPromptsFromDir(userPromptsDir, 'user', { getPromptsDir }),
    projectPromptsDir ? loadPromptsFromDir(projectPromptsDir, 'project', { getPromptsDir }) : Promise.resolve([]),
  ]);

  const mergedPrompts = new Map();
  for (const prompt of userPrompts) {
    mergedPrompts.set(prompt.name, prompt);
  }
  for (const prompt of projectPrompts) {
    mergedPrompts.set(prompt.name, prompt);
  }

  return Array.from(mergedPrompts.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Saves a prompt template to the specified scope.
 *
 * @param {string} cwd - Current working directory (for project scope resolution)
 * @param {string} name - Prompt name
 * @param {Object} config - Prompt configuration
 * @param {string} config.template - The prompt template content
 * @param {string} [config.description] - Optional description
 * @param {'user'|'project'} config.scope - Target scope
 * @param {{ getPromptsDir: () => string }} [options]
 * @returns {Promise<{ success: boolean; filePath: string | null; error?: string }>}
 */
export async function savePrompt(cwd, name, config, options = {}) {
  const { getPromptsDir } = options;
  const { template, description, scope } = config;

  try {
    let targetDir;
    if (scope === 'project') {
      targetDir = await findNearestProjectPromptsDir(cwd);
      if (!targetDir) {
        // Create .pi/prompts directory if it doesn't exist
        const projectPiDir = path.join(cwd, '.pi');
        const projectPromptsDir = path.join(projectPiDir, 'prompts');
        await fs.mkdir(projectPiDir, { recursive: true });
        await fs.mkdir(projectPromptsDir, { recursive: true });
        targetDir = projectPromptsDir;
      }
    } else {
      targetDir = getPromptsDir ? getPromptsDir() : path.join(process.env.HOME || process.env.USERPROFILE || '', '.pi/agent/prompts');
      await fs.mkdir(targetDir, { recursive: true });
    }

    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const filePath = path.join(targetDir, `${sanitizedName}.md`);

    // Build frontmatter
    const frontmatterLines = ['---'];
    if (description?.trim()) {
      frontmatterLines.push(`description: ${description.trim()}`);
    }
    frontmatterLines.push('---');
    frontmatterLines.push('');

    const content = frontmatterLines.join('\n') + (template || '');

    await fs.writeFile(filePath, content, 'utf-8');

    return { success: true, filePath };
  } catch (error) {
    console.error('Failed to save prompt:', error);
    return { success: false, filePath: null, error: error?.message || 'Failed to save prompt' };
  }
}

/**
 * Deletes a prompt template.
 *
 * @param {string} filePath - Full path to the prompt file
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
export async function deletePrompt(filePath) {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete prompt:', error);
    return { success: false, error: error?.message || 'Failed to delete prompt' };
  }
}
