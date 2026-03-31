const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

export const parseProviderModelSpec = (value) => {
  const normalized = normalizeString(value);
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
