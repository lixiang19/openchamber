import { AuthStorage, ModelRegistry, SettingsManager } from '@mariozechner/pi-coding-agent';

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const PROVIDER_DISPLAY_NAMES = {
  anthropic: 'Anthropic',
  azure: 'Azure',
  bedrock: 'Bedrock',
  google: 'Google',
  groq: 'Groq',
  'github-copilot': 'GitHub Copilot',
  lmstudio: 'LM Studio',
  mistral: 'Mistral',
  ollama: 'Ollama',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  openrouter: 'OpenRouter',
  together: 'Together',
  vertex: 'Vertex AI',
  vllm: 'vLLM',
  xai: 'xAI',
};

const getProviderDisplayName = (providerId) => {
  const normalized = normalizeString(providerId);
  if (!normalized) {
    return 'Unknown';
  }

  if (PROVIDER_DISPLAY_NAMES[normalized]) {
    return PROVIDER_DISPLAY_NAMES[normalized];
  }

  return normalized
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((segment) => {
      if (segment.length <= 3) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
};

const sortModels = (left, right) => {
  const leftName = normalizeString(left?.name) || normalizeString(left?.id);
  const rightName = normalizeString(right?.name) || normalizeString(right?.id);
  return leftName.localeCompare(rightName);
};

const toModelPayload = (model) => {
  const cost = model?.cost && typeof model.cost === 'object' ? model.cost : {};

  return {
    id: model.id,
    name: normalizeString(model?.name) || model.id,
    reasoning: model?.reasoning === true,
    input: Array.isArray(model?.input) && model.input.length > 0 ? model.input : ['text'],
    cost: {
      input: Number.isFinite(cost.input) ? cost.input : 0,
      output: Number.isFinite(cost.output) ? cost.output : 0,
      cache_read: Number.isFinite(cost.cacheRead) ? cost.cacheRead : 0,
      cache_write: Number.isFinite(cost.cacheWrite) ? cost.cacheWrite : 0,
    },
    limit: {
      context: Number.isFinite(model?.contextWindow) ? model.contextWindow : 0,
      output: Number.isFinite(model?.maxTokens) ? model.maxTokens : 0,
    },
  };
};

const groupModelsByProvider = (models) => {
  const groupedProviders = new Map();

  for (const model of [...models].sort(sortModels)) {
    const providerId = normalizeString(model?.provider);
    const modelId = normalizeString(model?.id);
    if (!providerId || !modelId) {
      continue;
    }

    let provider = groupedProviders.get(providerId);
    if (!provider) {
      provider = {
        id: providerId,
        name: getProviderDisplayName(providerId),
        env: [],
        npm: [],
        models: {},
      };
      groupedProviders.set(providerId, provider);
    }

    provider.models[modelId] = toModelPayload(model);
  }

  return Array.from(groupedProviders.values()).sort((left, right) => left.name.localeCompare(right.name));
};

const resolveDefaultChatModel = ({ cwd, modelRegistry, models }) => {
  const settingsManager = SettingsManager.create(cwd);
  const defaultProvider = normalizeString(settingsManager.getDefaultProvider());
  const defaultModelId = normalizeString(settingsManager.getDefaultModel());

  if (defaultProvider && defaultModelId) {
    const configuredModel = models.find((model) => model.provider === defaultProvider && model.id === defaultModelId);
    if (configuredModel) {
      return `${configuredModel.provider}/${configuredModel.id}`;
    }
  }

  const firstAvailableModel = models[0];
  if (firstAvailableModel) {
    return `${firstAvailableModel.provider}/${firstAvailableModel.id}`;
  }

  const fallbackModel = modelRegistry.getAll()[0];
  if (fallbackModel) {
    return `${fallbackModel.provider}/${fallbackModel.id}`;
  }

  return undefined;
};

export const createPiProvidersService = ({ authStorage, modelRegistry } = {}) => {
  const resolvedAuthStorage = authStorage ?? AuthStorage.create();
  const resolvedModelRegistry = modelRegistry ?? new ModelRegistry(resolvedAuthStorage);

  return {
    async getProviders(options = {}) {
      const cwd = normalizeString(options.cwd) || process.cwd();
      resolvedModelRegistry.refresh();

      const models = await Promise.resolve(resolvedModelRegistry.getAvailable());
      const providers = groupModelsByProvider(models);
      const defaultChatModel = resolveDefaultChatModel({
        cwd,
        modelRegistry: resolvedModelRegistry,
        models,
      });

      return {
        providers,
        default: defaultChatModel ? { chat: defaultChatModel } : {},
      };
    },
  };
};
