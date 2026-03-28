import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { discoverAgents } from './agents.js';

const tempDirs = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agents-'));
  tempDirs.push(dir);
  return dir;
};

const writeAgent = (dir, fileName, content) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content, 'utf8');
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('discoverAgents', () => {
  it('merges user and nearest project agents, with project overriding user', async () => {
    const rootDir = createTempDir();
    const userAgentsDir = path.join(rootDir, 'user-agents');
    const projectRoot = path.join(rootDir, 'workspace');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const projectAgentsDir = path.join(projectRoot, '.pi', 'agents');

    fs.mkdirSync(nestedCwd, { recursive: true });

    writeAgent(userAgentsDir, 'explore.md', `---
description: user explorer
mode: primary
permission:
  bash: deny
steps: 5
---
User prompt
`);
    writeAgent(userAgentsDir, 'shared.md', `---
description: user shared
mode: all
---
User shared prompt
`);
    writeAgent(userAgentsDir, 'disabled.md', `---
description: hidden
enabled: false
---
Hidden prompt
`);

    writeAgent(projectAgentsDir, 'shared.md', `---
description: project shared
mode: task
model: anthropic/claude-sonnet-4-5
thinking: high
steps: 12
permission:
  bash: deny
  edit:
    "*": deny
    "**/*.md": allow
---
Project shared prompt
`);

    const agents = await discoverAgents(nestedCwd, { userAgentsDir });

    expect(agents.map((agent) => agent.name)).toEqual(['explore', 'shared']);
    expect(agents[0]).toMatchObject({
      name: 'explore',
      sourceScope: 'user',
      mode: 'primary',
      steps: 5,
      permission: { bash: 'deny' },
    });
    expect(agents[1]).toMatchObject({
      name: 'shared',
      description: 'project shared',
      sourceScope: 'project',
      mode: 'task',
      model: 'anthropic/claude-sonnet-4-5',
      thinking: 'high',
      steps: 12,
      permission: {
        bash: 'deny',
        edit: {
          '*': 'deny',
          '**/*.md': 'allow',
        },
      },
    });
    expect(agents[1].source).toBe(path.join(projectAgentsDir, 'shared.md'));
  });

  it('returns only user agents when no project directory exists', async () => {
    const rootDir = createTempDir();
    const userAgentsDir = path.join(rootDir, 'user-agents');
    const cwd = path.join(rootDir, 'workspace', 'no-project-agents');

    fs.mkdirSync(cwd, { recursive: true });
    writeAgent(userAgentsDir, 'plan.md', `---
description: planner
thinking: medium
---
Plan prompt
`);

    const agents = await discoverAgents(cwd, { userAgentsDir });

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'plan',
      sourceScope: 'user',
      thinking: 'medium',
      systemPrompt: 'Plan prompt',
    });
  });
});
