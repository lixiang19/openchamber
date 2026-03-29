import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  INSTRUCTIONS_ERROR_CODE,
  buildProjectInstructionsContext,
  getProjectPiSettingsPath,
} from './instructions.js';

const tempDirs = [];

const createTempProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ridge-instructions-'));
  tempDirs.push(dir);
  return dir;
};

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('buildProjectInstructionsContext', () => {
  it('reads configured files in order and exposes metadata', async () => {
    const projectRoot = createTempProject();
    writeJson(getProjectPiSettingsPath(projectRoot), {
      instructions: {
        enabled: true,
        files: ['SOUL.md', 'docs/USER.md'],
      },
    });
    writeText(path.join(projectRoot, 'SOUL.md'), '# Soul\nkeep answers concise');
    writeText(path.join(projectRoot, 'docs', 'USER.md'), '# User\nlikes tables');

    const result = await buildProjectInstructionsContext(projectRoot, { includeContentPreview: true });

    expect(result.enabled).toBe(true);
    expect(result.loadedFiles).toEqual(['SOUL.md', 'docs/USER.md']);
    expect(result.skippedFiles).toEqual([]);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.content).toContain('<!-- From: SOUL.md -->');
    expect(result.content).toContain('<!-- From: docs/USER.md -->');
    expect(result.contentHash).toMatch(/^sha256:/);
    expect(result.contentPreview).toContain('keep answers concise');
  });

  it('skips missing files only for ENOENT', async () => {
    const projectRoot = createTempProject();
    writeJson(getProjectPiSettingsPath(projectRoot), {
      instructions: {
        enabled: true,
        files: ['SOUL.md', 'missing.md'],
      },
    });
    writeText(path.join(projectRoot, 'SOUL.md'), 'hello');

    const result = await buildProjectInstructionsContext(projectRoot);

    expect(result.loadedFiles).toEqual(['SOUL.md']);
    expect(result.skippedFiles).toEqual(['missing.md']);
  });

  it('rejects path traversal attempts', async () => {
    const projectRoot = createTempProject();
    writeJson(getProjectPiSettingsPath(projectRoot), {
      instructions: {
        enabled: true,
        files: ['../secret.md'],
      },
    });

    await expect(buildProjectInstructionsContext(projectRoot)).rejects.toMatchObject({
      code: INSTRUCTIONS_ERROR_CODE.PATH_TRAVERSAL,
    });
  });

  it('rejects symlink escape', async () => {
    const projectRoot = createTempProject();
    const outside = createTempProject();
    writeText(path.join(outside, 'external.md'), 'secret');
    fs.symlinkSync(path.join(outside, 'external.md'), path.join(projectRoot, 'linked.md'));
    writeJson(getProjectPiSettingsPath(projectRoot), {
      instructions: {
        enabled: true,
        files: ['linked.md'],
      },
    });

    await expect(buildProjectInstructionsContext(projectRoot)).rejects.toMatchObject({
      code: INSTRUCTIONS_ERROR_CODE.SYMLINK_ESCAPE,
    });
  });

  it('reads all files regardless of total size', async () => {
    const projectRoot = createTempProject();
    writeJson(getProjectPiSettingsPath(projectRoot), {
      instructions: {
        enabled: true,
        files: ['a.md', 'b.md'],
      },
    });
    writeText(path.join(projectRoot, 'a.md'), '123456');
    writeText(path.join(projectRoot, 'b.md'), '78901');

    const result = await buildProjectInstructionsContext(projectRoot);

    expect(result.loadedFiles).toEqual(['a.md', 'b.md']);
    expect(result.totalBytes).toBe(11);
    expect(result.content).toContain('123456');
    expect(result.content).toContain('78901');
  });
});
