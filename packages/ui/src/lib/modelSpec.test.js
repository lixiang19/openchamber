import { describe, expect, it } from 'bun:test';

import { parseProviderModelSpec } from './modelSpec.ts';

describe('parseProviderModelSpec', () => {
  it('keeps everything after the first slash as model id', () => {
    expect(parseProviderModelSpec('fireworks/accounts/fireworks/routers/kimi-k2p5-turbo')).toEqual({
      providerID: 'fireworks',
      modelID: 'accounts/fireworks/routers/kimi-k2p5-turbo',
    });
  });

  it('rejects invalid values', () => {
    expect(parseProviderModelSpec(null)).toBeNull();
    expect(parseProviderModelSpec('fireworks')).toBeNull();
    expect(parseProviderModelSpec('/kimi-k2p5-turbo')).toBeNull();
    expect(parseProviderModelSpec('fireworks/')).toBeNull();
  });
});
