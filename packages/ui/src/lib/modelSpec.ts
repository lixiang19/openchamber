export const parseProviderModelSpec = (value: unknown): { providerID: string; modelID: string } | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return null;
  }

  return {
    providerID: normalized.slice(0, separatorIndex),
    modelID: normalized.slice(separatorIndex + 1),
  };
};
