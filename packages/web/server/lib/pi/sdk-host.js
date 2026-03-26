import crypto from 'crypto';

import { DefaultResourceLoader, SessionManager, SettingsManager, createAgentSession } from '@mariozechner/pi-coding-agent';

import { discoverAgents } from './agents.js';
import { normalizePiRpcEnvelope } from './bridge-schema.js';
import { createSubagentToolDefinition } from './extensions/subagent.js';
import { createQuestionToolDefinition } from './extensions/question.js';

const EVENT_HISTORY_LIMIT = 200;
const COMMAND_CATALOG_CACHE_TTL_MS = 5000;

const cloneJson = (value) => {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeThinkingLevel = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized)
    ? normalized
    : null;
};

const normalizePositiveInteger = (value) => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return null;
};

const normalizePermissionConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .map(([toolName, action]) => [normalizeString(toolName).toLowerCase(), normalizeString(action).toLowerCase()])
      .filter(([toolName, action]) => toolName && (action === 'allow' || action === 'deny'))
  );

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const applyAgentPermissionFilter = (toolNames, permission) => {
  const normalizedPermission = normalizePermissionConfig(permission);
  if (!normalizedPermission) {
    return [...toolNames];
  }

  return toolNames.filter((toolName) => normalizedPermission[normalizeString(toolName).toLowerCase()] !== 'deny');
};

const buildAgentPromptAppend = (agent) => {
  if (!agent) {
    return [];
  }

  const sections = [];
  const prompt = normalizeString(agent.systemPrompt);
  if (prompt) {
    sections.push(prompt);
  }

  const steps = normalizePositiveInteger(agent.steps);
  if (steps) {
    sections.push([
      `Turn budget: ${steps}.`,
      'You may use at most this many internal turns for the current task.',
      'Before you would exceed the limit, stop calling tools and respond with your best final answer based on the work completed so far.',
    ].join(' '));
  }

  return sections;
};

const getAgentConfigSignature = (agent) => {
  if (!agent) {
    return '';
  }

  return JSON.stringify({
    name: agent.name,
    mode: agent.mode,
    source: agent.source,
    sourceScope: agent.sourceScope,
    systemPrompt: agent.systemPrompt,
    model: agent.model || '',
    thinking: agent.thinking || '',
    steps: normalizePositiveInteger(agent.steps) || 0,
    permission: normalizePermissionConfig(agent.permission) || {},
    enabled: agent.enabled !== false,
    displayName: agent.displayName || '',
  });
};

const createRequestLabel = (method) => {
  switch (method) {
    case 'select':
      return 'Select an option';
    case 'confirm':
      return 'Confirmation required';
    case 'editor':
      return 'Editor input required';
    default:
      return 'Input required';
  }
};

const serializeToolExecutions = (toolExecutions) => Array.from(toolExecutions.values()).map((entry) => ({ ...entry }));
const serializeInteractiveRequests = (interactiveRequests) => Array.from(interactiveRequests.values()).map((entry) => ({ ...entry }));
const serializeStatusEntries = (statusEntries) => Array.from(statusEntries.entries()).map(([key, text]) => ({ key, text }));
const serializeWidgets = (widgets) => Array.from(widgets.entries()).map(([key, value]) => ({ key, ...value }));
const serializeSlashCommands = (commands) => Array.isArray(commands)
  ? commands.map((cmd) => ({
      name: cmd.name,
      description: typeof cmd.description === 'string' ? cmd.description : '',
      source: cmd.source,
      sourceInfo: cmd.sourceInfo,
    }))
  : [];

export const createPiSdkHost = () => {
  const sessions = new Map();
  const subscribers = new Set();
  const interactiveRequestIndex = new Map();
  const commandCatalogCache = new Map();

  const emit = (payload) => {
    for (const listener of subscribers) {
      try {
        listener(payload);
      } catch {
      }
    }
  };

  const buildSessionSnapshot = (record) => ({
    id: record.id,
    title: record.title,
    cwd: record.cwd,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    lastError: record.lastError,
    model: record.session.model
      ? {
          provider: record.session.model.provider,
          id: record.session.model.id,
          reasoning: record.session.model.reasoning ?? false,
          name: record.session.model.name ?? null,
        }
      : null,
    thinkingLevel: record.session.thinkingLevel,
    isStreaming: record.session.isStreaming,
    messages: cloneJson(record.session.messages),
    toolExecutions: serializeToolExecutions(record.toolExecutions),
    interactiveRequests: serializeInteractiveRequests(record.interactiveRequests),
    statusEntries: serializeStatusEntries(record.statusEntries),
    widgets: serializeWidgets(record.widgets),
    workingMessage: record.workingMessage,
    sequence: record.sequence,
  });

  const rememberEnvelope = (record, envelope) => {
    record.eventHistory.push(envelope);
    if (record.eventHistory.length > EVENT_HISTORY_LIMIT) {
      record.eventHistory.splice(0, record.eventHistory.length - EVENT_HISTORY_LIMIT);
    }
  };

  const emitEventEnvelope = (record, type, payload) => {
    record.updatedAt = Date.now();
    record.sequence += 1;
    const envelope = {
      type,
      sessionId: record.id,
      eventId: `${record.id}:${record.sequence}`,
      sequence: record.sequence,
      emittedAt: record.updatedAt,
      payload,
    };
    rememberEnvelope(record, envelope);
    emit(envelope);
    return envelope;
  };

  const emitNotification = (record, level, message) => {
    emit({
      type: 'notification',
      sessionId: record.id,
      level,
      message,
    });
  };

  const emitSystemStatus = (record, status, message = null) => {
    emitEventEnvelope(record, 'pi_system', {
      kind: 'status',
      status,
      ...(message ? { message } : {}),
    });
  };

  const updateStatusFromSession = (record) => {
    if (record.session.isStreaming) {
      record.status = 'streaming';
      return;
    }
    if (record.lastError) {
      record.status = 'error';
      return;
    }
    record.status = 'idle';
  };

  const createInteractiveRequest = (record, method, payload) => {
    const id = `pi-ui-${crypto.randomUUID()}`;
    return new Promise((resolve) => {
      const request = {
        id,
        sessionId: record.id,
        method,
        title: normalizeString(payload?.title) || createRequestLabel(method),
        message: typeof payload?.message === 'string' ? payload.message : '',
        placeholder: typeof payload?.placeholder === 'string' ? payload.placeholder : '',
        options: Array.isArray(payload?.options) ? payload.options.filter((item) => typeof item === 'string') : [],
        prefill: typeof payload?.prefill === 'string' ? payload.prefill : '',
        questions: Array.isArray(payload?.questions) ? cloneJson(payload.questions) : [],
        bridgeKind: typeof payload?.bridgeKind === 'string' ? payload.bridgeKind : undefined,
        webSupport: typeof payload?.webSupport === 'string' ? payload.webSupport : undefined,
        createdAt: Date.now(),
      };
      record.interactiveRequests.set(id, request);
      interactiveRequestIndex.set(id, { record, resolve, request });
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'interactive_request',
        request,
      });
    });
  };

  const themeStub = new Proxy({}, {
    get() {
      return (...args) => {
        if (args.length === 0) {
          return (value) => value;
        }
        return args[args.length - 1];
      };
    },
  });

  const createExtensionUiContext = (record) => ({
    async select(title, options) {
      const result = await createInteractiveRequest(record, 'select', { title, options });
      return typeof result === 'string' ? result : undefined;
    },
    async confirm(title, message) {
      const result = await createInteractiveRequest(record, 'confirm', { title, message });
      return result === true;
    },
    async input(title, placeholder) {
      const result = await createInteractiveRequest(record, 'input', { title, placeholder });
      return typeof result === 'string' ? result : undefined;
    },
    notify(message, type = 'info') {
      emitNotification(record, type, message);
    },
    onTerminalInput() {
      return () => {};
    },
    setStatus(key, text) {
      if (!text) {
        record.statusEntries.delete(key);
      } else {
        record.statusEntries.set(key, text);
      }
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'status',
        key,
        text: text || null,
      });
    },
    setWorkingMessage(message) {
      record.workingMessage = typeof message === 'string' && message.trim().length > 0 ? message : null;
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'working_message',
        message: record.workingMessage,
      });
    },
    setWidget(key, content, options) {
      if (!content) {
        record.widgets.delete(key);
        emitEventEnvelope(record, 'pi_ui_event', {
          kind: 'widget',
          key,
          content: null,
          placement: null,
          bordered: false,
        });
        return;
      }

      if (Array.isArray(content)) {
        const nextWidget = {
          content,
          placement: options?.placement || 'above-editor',
          bordered: options?.bordered !== false,
        };
        record.widgets.set(key, nextWidget);
        emitEventEnvelope(record, 'pi_ui_event', {
          kind: 'widget',
          key,
          content,
          placement: nextWidget.placement,
          bordered: nextWidget.bordered,
        });
      }
    },
    setFooter() {},
    setHeader() {},
    setTitle(title) {
      if (typeof title === 'string' && title.trim().length > 0) {
        record.title = title.trim();
        emitEventEnvelope(record, 'pi_ui_event', {
          kind: 'title',
          title: record.title,
        });
      }
    },
    async custom() {
      throw new Error('Pi custom UI is not supported in the web host yet');
    },
    pasteToEditor() {},
    setEditorText(text) {
      record.editorText = typeof text === 'string' ? text : '';
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'editor_text',
        text: record.editorText,
      });
    },
    getEditorText() {
      return record.editorText || '';
    },
    async editor(title, prefill) {
      const result = await createInteractiveRequest(record, 'editor', { title, prefill });
      return typeof result === 'string' ? result : undefined;
    },
    setEditorComponent() {},
    get theme() {
      return themeStub;
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: 'Theme switching is not implemented in the web host' };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  });

  const resolveSessionModel = async (session, requestedModel) => {
    const providerID = normalizeString(requestedModel?.providerID);
    const modelID = normalizeString(requestedModel?.modelID);

    if (!providerID && !modelID) {
      return null;
    }
    if (!providerID || !modelID) {
      throw new Error('Pi model selection requires both providerID and modelID');
    }

    session.modelRegistry.refresh();
    const availableModels = await Promise.resolve(session.modelRegistry.getAvailable());
    const selectedModel = availableModels.find((model) => model.provider === providerID && model.id === modelID);
    if (!selectedModel) {
      throw new Error(`Pi model not available: ${providerID}/${modelID}`);
    }

    return selectedModel;
  };

  const resolveAgentFrontmatterModel = async (session, modelSpec) => {
    const normalizedSpec = normalizeString(modelSpec);
    if (!normalizedSpec) {
      return null;
    }

    session.modelRegistry.refresh();
    const availableModels = await Promise.resolve(session.modelRegistry.getAvailable());

    if (normalizedSpec.includes('/')) {
      const [providerID, modelID, ...rest] = normalizedSpec.split('/');
      if (!providerID || !modelID || rest.length > 0) {
        throw new Error(`Invalid Pi agent model: ${normalizedSpec}`);
      }
      const exact = availableModels.find((model) => model.provider === providerID && model.id === modelID);
      if (!exact) {
        throw new Error(`Pi agent model not available: ${normalizedSpec}`);
      }
      return exact;
    }

    const matches = availableModels.filter((model) => model.id === normalizedSpec);
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      const options = matches.map((model) => `${model.provider}/${model.id}`).join(', ');
      throw new Error(`Ambiguous Pi agent model "${normalizedSpec}". Use one of: ${options}`);
    }

    throw new Error(`Pi agent model not available: ${normalizedSpec}`);
  };

  const applySessionAgentSelection = async (record, requestedAgentName, requestedModel) => {
    const nextAgentName = normalizeString(requestedAgentName);
    const agents = await discoverAgents(record.cwd);
    record.availableAgents = agents;

    const agent = nextAgentName
      ? agents.find((candidate) => candidate.name === nextAgentName)
      : null;

    if (nextAgentName && !agent) {
      const available = agents
        .filter((candidate) => candidate.mode !== 'subagent')
        .map((candidate) => candidate.name)
        .join(', ') || 'none';
      throw new Error(`Unknown Pi agent: ${nextAgentName}. Available agents: ${available}`);
    }

    const nextAgentSignature = getAgentConfigSignature(agent);
    const shouldReload = nextAgentSignature !== (record.selectedAgentSignature || '');

    if (shouldReload) {
      record.selectedAgentName = agent?.name || null;
      record.selectedAgentConfig = agent || null;
      record.selectedAgentSignature = nextAgentSignature;
      await record.session.reload();
    } else {
      record.selectedAgentName = agent?.name || null;
      record.selectedAgentConfig = agent || null;
      record.selectedAgentSignature = nextAgentSignature;
    }

    const activeToolNames = applyAgentPermissionFilter(record.defaultToolNames, agent?.permission);
    record.session.setActiveToolsByName(activeToolNames);
    record.turnBudget = {
      maxTurns: normalizePositiveInteger(agent?.steps),
      usedTurns: 0,
      exhausted: false,
    };

    const selectedModel = await resolveSessionModel(record.session, requestedModel)
      || await resolveAgentFrontmatterModel(record.session, agent?.model);

    if (
      selectedModel
      && (!record.session.model
        || record.session.model.provider !== selectedModel.provider
        || record.session.model.id !== selectedModel.id)
    ) {
      await record.session.setModel(selectedModel);
    }

    const thinkingLevel = normalizeThinkingLevel(agent?.thinking);
    if (thinkingLevel && record.session.thinkingLevel !== thinkingLevel) {
      record.session.setThinkingLevel(thinkingLevel);
    }
  };

  const attachSession = async (record) => {
    await record.session.bindExtensions({
      uiContext: createExtensionUiContext(record),
      onError(error) {
        record.lastError = typeof error?.error === 'string' ? error.error : 'Extension error';
        record.status = 'error';
        emitEventEnvelope(record, 'pi_system', {
          kind: 'session_error',
          message: record.lastError,
        });
      },
    });

    record.unsubscribe = record.session.subscribe((event) => {
      switch (event.type) {
        case 'agent_start':
        case 'message_start':
        case 'message_update':
        case 'tool_execution_start':
        case 'tool_execution_update':
          record.lastError = null;
          record.status = 'streaming';
          break;
        case 'turn_start': {
          record.lastError = null;
          record.status = 'streaming';
          const maxTurns = normalizePositiveInteger(record.turnBudget?.maxTurns);
          if (maxTurns && record.turnBudget.usedTurns >= maxTurns && !record.turnBudget.exhausted) {
            record.turnBudget.exhausted = true;
            void record.session.abort().catch(() => {});
          }
          break;
        }
        case 'tool_execution_end': {
          const previous = record.toolExecutions.get(event.toolCallId) || {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: cloneJson(event.args),
            status: 'running',
            partialResult: null,
            result: null,
            isError: false,
          };
          record.toolExecutions.set(event.toolCallId, {
            ...previous,
            status: event.isError ? 'error' : 'completed',
            result: cloneJson(event.result),
            isError: event.isError,
          });
          break;
        }
        case 'message_end':
        case 'agent_end':
          record.lastError = null;
          updateStatusFromSession(record);
          break;
        case 'turn_end':
          if (normalizePositiveInteger(record.turnBudget?.maxTurns)) {
            record.turnBudget.usedTurns += 1;
          }
          record.lastError = null;
          updateStatusFromSession(record);
          break;
        case 'auto_retry_start':
          record.status = 'retrying';
          emitSystemStatus(record, 'retrying');
          return;
        case 'auto_retry_end':
          updateStatusFromSession(record);
          emitSystemStatus(record, record.status);
          return;
        case 'auto_compaction_start':
          record.status = 'compacting';
          emitSystemStatus(record, 'compacting');
          return;
        case 'auto_compaction_end':
          if (event.errorMessage) {
            record.lastError = event.errorMessage;
            record.status = 'error';
            emitEventEnvelope(record, 'pi_system', {
              kind: 'session_error',
              message: record.lastError,
            });
          } else {
            updateStatusFromSession(record);
            emitSystemStatus(record, record.status);
          }
          return;
        default:
          break;
      }

      if (event.type === 'tool_execution_start') {
        record.toolExecutions.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: cloneJson(event.args),
          status: 'running',
          partialResult: null,
          result: null,
          isError: false,
        });
      }

      if (event.type === 'tool_execution_update') {
        const previous = record.toolExecutions.get(event.toolCallId) || {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: cloneJson(event.args),
          status: 'running',
          partialResult: null,
          result: null,
          isError: false,
        };
        record.toolExecutions.set(event.toolCallId, {
          ...previous,
          status: 'running',
          partialResult: cloneJson(event.partialResult),
        });
      }

      const normalized = normalizePiRpcEnvelope(event);
      if (normalized?.envelope === 'agent-event') {
        emitEventEnvelope(record, 'pi_event', normalized);
        return;
      }

      emitEventEnvelope(record, 'pi_system', {
        kind: 'status',
        status: record.status,
      });
    });
  };

  const listCommandsForCwd = async (cwd) => {
    const normalizedCwd = normalizeString(cwd) || process.cwd();
    const cacheKey = normalizedCwd;
    const cached = commandCatalogCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.commands;
    }

    let getCommandsBridge;
    const settingsManager = SettingsManager.create(normalizedCwd);
    const resourceLoader = new DefaultResourceLoader({
      cwd: normalizedCwd,
      settingsManager,
      extensionFactories: [
        (pi) => {
          getCommandsBridge = () => pi.getCommands();
        },
      ],
    });

    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: normalizedCwd,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(normalizedCwd),
    });

    try {
      const commands = serializeSlashCommands(getCommandsBridge?.() ?? []);
      commandCatalogCache.set(cacheKey, {
        commands,
        expiresAt: now + COMMAND_CATALOG_CACHE_TTL_MS,
      });
      return commands;
    } finally {
      try {
        session.dispose();
      } catch {
      }
    }
  };

  return {
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async createSession({ cwd, title } = {}) {
      const normalizedCwd = normalizeString(cwd) || process.cwd();

      // Discover agents and build the subagent tool
      const subagentTool = createSubagentToolDefinition(
        () => discoverAgents(normalizedCwd),
        normalizedCwd,
      );

      const recordRef = { current: null };
      const questionTool = createQuestionToolDefinition((method, payload) => {
        if (!recordRef.current) throw new Error('Session record not initialized');
        return createInteractiveRequest(recordRef.current, method, payload);
      });

      const settingsManager = SettingsManager.create(normalizedCwd);
      const resourceLoader = new DefaultResourceLoader({
        cwd: normalizedCwd,
        settingsManager,
        appendSystemPromptOverride: (base) => {
          const agent = recordRef.current?.selectedAgentConfig;
          const promptSections = buildAgentPromptAppend(agent);
          if (promptSections.length === 0) {
            return base;
          }
          return [...base, ...promptSections];
        },
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd: normalizedCwd,
        settingsManager,
        resourceLoader,
        customTools: [subagentTool, questionTool],
      });
      const id = session.sessionId;
      const record = {
        id,
        title: normalizeString(title) || session.sessionName || `Session ${sessions.size + 1}`,
        cwd: normalizedCwd,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sequence: 0,
        session,
        status: 'idle',
        lastError: null,
        unsubscribe: null,
        toolExecutions: new Map(),
        interactiveRequests: new Map(),
        statusEntries: new Map(),
        widgets: new Map(),
        workingMessage: null,
        editorText: '',
        eventHistory: [],
        defaultToolNames: session.getActiveToolNames(),
        selectedAgentName: null,
        selectedAgentConfig: null,
        selectedAgentSignature: '',
        availableAgents: [],
        turnBudget: { maxTurns: null, usedTurns: 0, exhausted: false },
      };
      recordRef.current = record;
      if (record.title) {
        session.setSessionName(record.title);
      }
      sessions.set(id, record);
      await attachSession(record);
      emitEventEnvelope(record, 'pi_system', {
        kind: 'session_created',
        title: record.title,
      });
      return buildSessionSnapshot(record);
    },
    listSessions() {
      return Array.from(sessions.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((record) => buildSessionSnapshot(record));
    },
    async listAgents(cwd) {
      const normalizedCwd = normalizeString(cwd) || process.cwd();
      const agents = await discoverAgents(normalizedCwd);
      return agents.map(({ name, mode, description, displayName, source, sourceScope, model, thinking, steps, permission, enabled }) => ({
        name,
        mode,
        description,
        source,
        scope: sourceScope,
        ...(displayName ? { displayName } : {}),
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
        ...(steps ? { steps } : {}),
        ...(permission ? { permission } : {}),
        ...(enabled === false ? { enabled } : {}),
      }));
    },
    async listCommands(options = {}) {
      try {
        return await listCommandsForCwd(options.cwd);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to list Pi commands:', error);
        throw new Error('Failed to list Pi commands');
      }
    },
    getSession(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error(`Unknown Pi session: ${sessionId}`);
      }
      return buildSessionSnapshot(record);
    },
    renameSession(sessionId, { title } = {}) {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error(`Unknown Pi session: ${sessionId}`);
      }
      const nextTitle = normalizeString(title);
      if (!nextTitle) {
        throw new Error('Session title is required');
      }
      record.title = nextTitle;
      record.session.setSessionName(nextTitle);
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'title',
        title: nextTitle,
      });
      return buildSessionSnapshot(record);
    },
    async prompt(sessionId, { text, model, agent, images } = {}) {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error(`Unknown Pi session: ${sessionId}`);
      }
      const promptText = normalizeString(text);
      const promptImages = Array.isArray(images)
        ? images
            .filter((image) => image && image.type === 'image' && typeof image.data === 'string' && typeof image.mimeType === 'string')
            .map((image) => ({
              type: 'image',
              data: image.data,
              mimeType: image.mimeType,
            }))
        : [];
      if (!promptText) {
        throw new Error('Prompt text is required');
      }
      record.lastError = null;
      record.status = 'streaming';
      emitSystemStatus(record, 'streaming');
      try {
        await applySessionAgentSelection(record, agent ?? record.selectedAgentName, model);
        record.turnBudget = {
          maxTurns: normalizePositiveInteger(record.selectedAgentConfig?.steps),
          usedTurns: 0,
          exhausted: false,
        };
        await record.session.prompt(promptText, {
          source: 'interactive',
          ...(promptImages.length > 0 ? { images: promptImages } : {}),
        });
      } catch (error) {
        record.lastError = error instanceof Error ? error.message : String(error);
        record.status = 'error';
        emitEventEnvelope(record, 'pi_system', {
          kind: 'session_error',
          message: record.lastError,
        });
        throw error;
      }
    },
    async abort(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) {
        throw new Error(`Unknown Pi session: ${sessionId}`);
      }
      await record.session.abort();
      updateStatusFromSession(record);
      emitEventEnvelope(record, 'pi_system', {
        kind: 'session_aborted',
      });
      return true;
    },
    async respondToInteractiveRequest(requestId, response) {
      const indexed = interactiveRequestIndex.get(requestId);
      if (!indexed) {
        throw new Error(`Unknown interactive request: ${requestId}`);
      }
      const { record, resolve, request } = indexed;
      interactiveRequestIndex.delete(requestId);
      record.interactiveRequests.delete(requestId);
      if (request.method === 'confirm') {
        resolve(response === true);
      } else if (request.method === 'select') {
        resolve(typeof response === 'string' ? response : undefined);
      } else if (request.method === 'question') {
        // question answers can be array or string
        resolve(Array.isArray(response) ? response : (typeof response === 'string' ? response : undefined));
      } else {
        resolve(typeof response === 'string' ? response : undefined);
      }
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'interactive_request_resolved',
        requestId,
      });
      return true;
    },
    async rejectInteractiveRequest(requestId) {
      const indexed = interactiveRequestIndex.get(requestId);
      if (!indexed) {
        throw new Error(`Unknown interactive request: ${requestId}`);
      }
      const { record, resolve } = indexed;
      interactiveRequestIndex.delete(requestId);
      record.interactiveRequests.delete(requestId);
      resolve(undefined);
      emitEventEnvelope(record, 'pi_ui_event', {
        kind: 'interactive_request_resolved',
        requestId,
      });
      return true;
    },
    getHealth() {
      return {
        runtime: 'pi',
        sessionCount: sessions.size,
        ready: true,
      };
    },
    async dispose() {
      for (const record of sessions.values()) {
        try {
          record.unsubscribe?.();
        } catch {
        }
        try {
          record.session.dispose();
        } catch {
        }
      }
      sessions.clear();
      interactiveRequestIndex.clear();
    },
  };
};
