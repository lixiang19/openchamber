import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createManagedProjectFromTemplate } from './template.js';

const tempDirs = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ridge-template-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('createManagedProjectFromTemplate', () => {
  it('renders template variables and generates project-level pi settings', async () => {
    const targetDirectory = createTempDir();
    const projectPath = path.join(targetDirectory, 'assistant-project');

    await createManagedProjectFromTemplate(projectPath, {
      templateId: 'general-assistant',
      projectName: '我的助理空间',
      variables: {
        AI_NAME: '小岭',
        USER_NAME: '阿想',
      },
    });

    const soul = fs.readFileSync(path.join(projectPath, 'SOUL.md'), 'utf8');
    const identity = fs.readFileSync(path.join(projectPath, 'IDENTITY.md'), 'utf8');
    const user = fs.readFileSync(path.join(projectPath, 'USER.md'), 'utf8');
    const piSettings = JSON.parse(fs.readFileSync(path.join(projectPath, '.ridge', 'pi-settings.json'), 'utf8'));

    expect(soul).toContain('# 小岭 的灵魂');
    expect(identity).toContain('服务对象**: 阿想');
    expect(user).toContain('**称呼**: 阿想');
    expect(user).toContain('**项目名**: 我的助理空间');
    expect(piSettings).toMatchObject({
      instructions: {
        enabled: true,
        files: ['SOUL.md', 'IDENTITY.md', 'USER.md'],
      },
    });
  });
});
