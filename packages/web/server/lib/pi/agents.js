import fs from 'fs/promises';
import path from 'path';
import { getAgentDir, parseFrontmatter } from '@mariozechner/pi-coding-agent';

const AGENT_MODES = new Set(['primary', 'subagent', 'all']);
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const PERMISSION_ACTIONS = new Set(['allow', 'deny']);

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const normalizeBoolean = (value, fallback = true) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
};

const normalizeInteger = (value) => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return undefined;
};

const normalizeThinking = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return THINKING_LEVELS.has(normalized) ? normalized : undefined;
};

const normalizePermission = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .map(([toolName, action]) => [normalizeString(toolName).toLowerCase(), normalizeString(action).toLowerCase()])
      .filter(([toolName, action]) => toolName && PERMISSION_ACTIONS.has(action))
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const isDirectory = async (targetPath) => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const findNearestProjectAgentsDir = async (cwd) => {
  let currentDir = path.resolve(cwd);

  while (true) {
    const candidate = path.join(currentDir, '.pi', 'agents');
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

const loadAgentsFromDir = async (dirPath, sourceScope) => {
  const agents = [];

  let files = [];
  try {
    files = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Error reading agent directory ${dirPath}:`, error);
    }
    return agents;
  }

  for (const entry of files) {
    if (!entry.name.endsWith('.md')) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dirPath, entry.name);
    let rawContent = '';
    try {
      rawContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.warn(`Failed to read agent definition ${filePath}:`, error);
      continue;
    }

    const parsed = parseFrontmatter(rawContent);
    const data = parsed?.frontmatter && typeof parsed.frontmatter === 'object' ? parsed.frontmatter : {};
    const content = typeof parsed?.body === 'string' ? parsed.body : rawContent;

    const enabled = normalizeBoolean(data.enabled, true);
    if (!enabled) {
      continue;
    }

    const name = normalizeString(data.name) || entry.name.replace(/\.md$/, '');
    if (!name) {
      continue;
    }

    const mode = AGENT_MODES.has(data.mode) ? data.mode : 'all';
    const description = normalizeString(data.description);
    const displayName = normalizeString(data.display_name) || undefined;
    const model = normalizeString(data.model) || undefined;
    const thinking = normalizeThinking(data.thinking);
    const steps = normalizeInteger(data.steps);
    const permission = normalizePermission(data.permission);

    agents.push({
      name,
      mode,
      description,
      displayName,
      systemPrompt: content.trim(),
      source: filePath,
      sourceScope,
      enabled,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(steps ? { steps } : {}),
      ...(permission ? { permission } : {}),
    });
  }

  return agents;
};

/**
 * Discovers agents from user scope (`~/.pi/agent/agents`) and the nearest
 * project scope (`.pi/agents`). Project agents override user agents with the
 * same name.
 *
 * @param {string} cwd
 * @param {{ userAgentsDir?: string, projectAgentsDir?: string | null }} [options]
 * @returns {Promise<Array<{
 *   name: string,
 *   mode: 'primary'|'subagent'|'all',
 *   description: string,
 *   displayName?: string,
 *   systemPrompt: string,
 *   source: string,
 *   sourceScope: 'user'|'project',
 *   enabled: boolean,
 *   model?: string,
 *   thinking?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh',
 *   steps?: number,
 *   permission?: Record<string, 'allow'|'deny'>,
 * }>>}
 */
export async function discoverAgents(cwd, options = {}) {
  const userAgentsDir = options.userAgentsDir || path.join(getAgentDir(), 'agents');
  const projectAgentsDir = options.projectAgentsDir === undefined
    ? await findNearestProjectAgentsDir(cwd)
    : options.projectAgentsDir;

  const [userAgents, projectAgents] = await Promise.all([
    loadAgentsFromDir(userAgentsDir, 'user'),
    projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, 'project') : Promise.resolve([]),
  ]);

  const mergedAgents = new Map();
  for (const agent of userAgents) {
    mergedAgents.set(agent.name, agent);
  }
  for (const agent of projectAgents) {
    mergedAgents.set(agent.name, agent);
  }

  return Array.from(mergedAgents.values()).sort((left, right) => left.name.localeCompare(right.name));
}
