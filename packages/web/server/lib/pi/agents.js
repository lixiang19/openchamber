import fs from 'fs/promises';
import path from 'path';
import { parse as yamlParse } from 'yaml';

/**
 * Parses markdown with frontmatter
 * @param {string} content 
 * @returns {{ data: any, content: string }}
 */
function parseFrontmatter(content) {
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match) {
    try {
      return {
        data: yamlParse(match[1]),
        content: match[2],
      };
    } catch (e) {
      console.error('Failed to parse agent frontmatter:', e);
    }
  }
  return { data: {}, content };
}

/**
 * Discovers agents in .pi/agents directory inside cwd
 * @param {string} cwd 
 * @returns {Promise<Array<{ name: string, mode: 'primary'|'subagent'|'all', description: string, systemPrompt: string, source: string }>>}
 */
export async function discoverAgents(cwd) {
  const agentsDir = path.join(cwd, '.pi', 'agents');
  const agents = [];

  try {
    const files = await fs.readdir(agentsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const filePath = path.join(agentsDir, file);
      const rawContent = await fs.readFile(filePath, 'utf-8');
      const { data, content } = parseFrontmatter(rawContent);
      
      const name = data.name || file.replace(/\.md$/, '');
      const mode = data.mode && ['primary', 'subagent', 'all'].includes(data.mode) ? data.mode : 'all';
      const description = data.description || '';
      
      agents.push({
        name,
        mode,
        description,
        systemPrompt: content.trim(),
        source: filePath,
      });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('Error reading .pi/agents:', err);
    }
  }

  return agents;
}
