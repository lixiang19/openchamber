import { describe, expect, it } from 'bun:test';

import {
  compileAgentPermission,
  matchPermissionRule,
  normalizeAgentPermission,
  normalizePathRelativeToCwd,
} from './permissions.js';

describe('normalizeAgentPermission', () => {
  it('normalizes OpenCode-style edit rules', () => {
    expect(normalizeAgentPermission({
      bash: 'deny',
      edit: {
        '*': 'deny',
        '**/*.md': 'allow',
      },
    })).toEqual({
      bash: 'deny',
      edit: {
        '*': 'deny',
        '**/*.md': 'allow',
      },
    });
  });

  it('collapses legacy write deny into logical edit permission', () => {
    expect(normalizeAgentPermission({ write: 'deny' })).toEqual({ edit: 'deny' });
  });

  it('rejects edit rules without a fallback', () => {
    expect(() => normalizeAgentPermission({
      edit: {
        '**/*.md': 'allow',
      },
    })).toThrow('Permission "edit" must define a "*" fallback rule.');
  });
});

describe('compileAgentPermission', () => {
  it('removes edit and write tools when edit is denied', () => {
    const policy = compileAgentPermission('/repo', { edit: 'deny' }, ['read', 'edit', 'write', 'bash']);
    expect(policy.activeToolNames).toEqual(['read', 'bash']);
    expect(policy.editRules).toEqual([{ pattern: '*', action: 'deny' }]);
  });

  it('keeps edit tools for allowlist rules', () => {
    const policy = compileAgentPermission('/repo', {
      bash: 'deny',
      edit: {
        '*': 'deny',
        '**/*.md': 'allow',
      },
    }, ['read', 'edit', 'write', 'bash']);

    expect(policy.activeToolNames).toEqual(['read', 'edit', 'write']);
    expect(matchPermissionRule('docs/readme.md', policy.editRules)).toBe('allow');
    expect(matchPermissionRule('src/index.ts', policy.editRules)).toBe('deny');
  });
});

describe('normalizePathRelativeToCwd', () => {
  it('normalizes workspace-relative edit targets', () => {
    expect(normalizePathRelativeToCwd('/repo', 'docs/readme.md')).toBe('docs/readme.md');
    expect(normalizePathRelativeToCwd('/repo', './docs/readme.md')).toBe('docs/readme.md');
  });

  it('rejects workspace escapes', () => {
    expect(normalizePathRelativeToCwd('/repo', '../secrets.txt')).toBeNull();
    expect(normalizePathRelativeToCwd('/repo', '/tmp/test.md')).toBeNull();
  });
});
