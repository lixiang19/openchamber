import { describe, expect, it } from 'bun:test';

import { parseProviderModelSpec } from './model-spec.js';

describe('parseProviderModelSpec', () => {
  it('parses provider/model strings by the first slash only', () => {
    expect(parseProviderModelSpec('fireworks/accounts/fireworks/routers/kimi-k2p5-turbo')).toEqual({
      providerID: 'fireworks',
      modelID: 'accounts/fireworks/routers/kimi-k2p5-turbo',
    });
  });

  it('rejects missing provider or model id', () => {
    expect(parseProviderModelSpec('')).toBeNull();
    expect(parseProviderModelSpec('fireworks')).toBeNull();
    expect(parseProviderModelSpec('/kimi-k2p5-turbo')).toBeNull();
    expect(parseProviderModelSpec('fireworks/')).toBeNull();
  });
});
