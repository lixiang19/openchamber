import crypto from 'crypto';

import { DefaultResourceLoader, SessionManager, SettingsManager, createAgentSession } from '@mariozechner/pi-coding-agent';

import { discoverAgents } from './agents.js';
import { normalizePiRpcEnvelope } from './bridge-schema.js';
import { createTaskToolDefinition } from './extensions/task.js';
import { buildProjectInstructionsContext } from './instructions.js';
import { createQuestionToolDefinition } from './extensions/question.js';
import { compileAgentPermission, createPermissionGateExtension, normalizeAgentPermission } from './permissions.js';
import { listTaskRelations, setTaskRelation } from './task-relations.js';

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

const normalizeSingleLineText = (value) => normalizeString(value).replace(/\s+/g, ' ');

const deriveSessionTitleFromPrompt = (value) => {
  const normalized = normalizeSingleLineText(value);
  if (!normalized) {
    return '';
  }
  return Array.from(normalized).slice(0, 10).join('').trim();
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

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const getCallableTaskAgents = (agents) => {
  if (!Array.isArray(agents)) {
    return [];
  }
  return agents
    .filter((agent) => agent && agent.enabled !== false && (agent.mode === 'task' || agent.mode === 'all'))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const buildAvailableTaskAgentsXml = (agents) => {
  const callableAgents = getCallableTaskAgents(agents);
  if (callableAgents.length === 0) {
    return [
      '<available_task_agents>',
      '  <summary>No task agents are currently available.</summary>',
      '</available_task_agents>',
    ].join('\n');
  }

  const body = callableAgents.map((agent) => {
    const parts = [`  <agent name="${escapeXml(agent.name)}">`];
    if (normalizeString(agent.description)) {
      parts.push(`    <description>${escapeXml(agent.description)}</description>`);
    }
    parts.push('  </agent>');
    return parts.join('\n');
  });

  return [
    '<available_task_agents>',
    '  <summary>Use the exact agent name when calling the task tool.</summary>',
    ...body,
    '</available_task_agents>',
  ].join('\n');
};

const getAvailableTaskAgentsSignature = (agents) => JSON.stringify(
  getCallableTaskAgents(agents).map((agent) => ({
    name: agent.name,
    description: agent.description || '',
    enabled: agent.enabled !== false,
  })),
);

const buildAgentPromptAppend = (agent, availableAgents) => {
  const sections = [];

  const prompt = normalizeString(agent?.systemPrompt);
  if (prompt) {
    sections.push(prompt);
  }

  sections.push(buildAvailableTaskAgentsXml(availableAgents));

  const steps = normalizePositiveInteger(agent?.steps);
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
    permission: normalizeAgentPermission(agent.permission) || {},
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

const normalizeQuestionOptions = (options) => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((option) => {
    if (typeof option === 'string') {
      const label = option.trim();
      return label ? [{ label, description: '' }] : [];
    }
    if (!option || typeof option !== 'object') {
      return [];
    }

    const candidate = option;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    if (!label) {
      return [];
    }

    const description = typeof candidate.description === 'string' ? candidate.description : undefined;
    return [{ label, ...(description ? { description } : {}) }];
  });
};

const normalizeInteractiveQuestion = (question, fallbackHeader) => {
  if (!question || typeof question !== 'object') {
    return null;
  }

  const prompt = typeof question.question === 'string' ? question.question.trim() : '';
  if (!prompt) {
    return null;
  }

  const options = normalizeQuestionOptions(question.options);
  return {
    ...(typeof question.header === 'string' && question.header.trim()
      ? { header: question.header.trim() }
      : fallbackHeader
        ? { header: fallbackHeader }
        : {}),
    question: prompt,
    options,
    multiple: question.multiple === true,
    allowCustom: options.length === 0 ? true : question.allowCustom === true,
  };
};

const createQuestionRequest = (record, payload) => {
  const id = `pi-ui-${crypto.randomUUID()}`;
  const title = normalizeString(payload?.title) || createRequestLabel('question');
  const normalizedQuestions = Array.isArray(payload?.questions)
    ? payload.questions
        .map((question) => normalizeInteractiveQuestion(question, title || 'Input required'))
        .filter(Boolean)
    : [];

  const questions = normalizedQuestions.length > 0
    ? normalizedQuestions
    : [{
        ...(title ? { header: title } : {}),
        question: normalizeString(payload?.message) || title || 'Provide a response',
        options: normalizeQuestionOptions(payload?.options),
        multiple: false,
        allowCustom: normalizeQuestionOptions(payload?.options).length === 0,
      }];

  return {
    id,
    sessionId: record.id,
    method: 'question',
    title: title || createRequestLabel('question'),
    message: typeof payload?.message === 'string' ? payload.message : questions[0]?.question || '',
    questions,
    bridgeKind: 'question',
    webSupport: 'supported',
    createdAt: Date.now(),
  };
};

const normalizeInteractiveResponse = (response) => {
  if (Array.isArray(response) && Array.isArray(response[0])) {
    return response.map((group) => Array.isArray(group) ? group.filter((value) => typeof value === 'string') : []);
  }
  if (Array.isArray(response)) {
    return [response.filter((value) => typeof value === 'string')];
  }
  if (typeof response === 'string') {
    return [[response]];
  }
  return [];
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
  const persistedSessionIndex = new Map();
  const sessionLoadInFlight = new Map();

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
    parentID: record.parentID ?? null,
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

  const updateRecordSessionName = (record, title, source) => {
    const nextTitle = normalizeSingleLineText(title);
    if (!nextTitle) {
      return false;
    }
    record.title = nextTitle;
    record.titleSource = source;
    record.session.setSessionName(nextTitle);
    emitEventEnvelope(record, 'pi_ui_event', {
      kind: 'title',
      title: nextTitle,
    });
    return true;
  };

  const updateRecordThinkingLevel = (record, thinkingLevel) => {
    const nextThinkingLevel = normalizeThinkingLevel(thinkingLevel);
    if (!nextThinkingLevel) {
      throw new Error('Invalid thinking level');
    }
    if (record.session.thinkingLevel === nextThinkingLevel) {
      return false;
    }
    record.session.setThinkingLevel(nextThinkingLevel);
    record.updatedAt = Date.now();
    return true;
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

  const createInteractiveRequest = (record, method, payload) => new Promise((resolve) => {
    if (method !== 'question') {
      throw new Error(`Unsupported interactive method in web host: ${method}`);
    }

    const request = createQuestionRequest(record, payload);
    record.interactiveRequests.set(request.id, request);
    interactiveRequestIndex.set(request.id, { record, resolve, request });
    emitEventEnvelope(record, 'pi_ui_event', {
      kind: 'interactive_request',
      request,
    });
  });

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
    async select() {
      throw new Error('ctx.ui.select() is not supported in the web host. Use the custom question tool instead.');
    },
    async confirm() {
      throw new Error('ctx.ui.confirm() is not supported in the web host. Use the custom question tool instead.');
    },
    async input() {
      throw new Error('ctx.ui.input() is not supported in the web host. Use the custom question tool instead.');
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
    async editor() {
      throw new Error('ctx.ui.editor() is not supported in the web host. Use the custom question tool instead.');
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
    const nextAvailableAgentsSignature = getAvailableTaskAgentsSignature(agents);
    record.availableAgents = agents;

    const agent = nextAgentName
      ? agents.find((candidate) => candidate.name === nextAgentName)
      : null;

    if (nextAgentName && !agent) {
      const available = agents
        .filter((candidate) => candidate.mode !== 'task')
        .map((candidate) => candidate.name)
        .join(', ') || 'none';
      throw new Error(`Unknown Pi agent: ${nextAgentName}. Available agents: ${available}`);
    }

    const nextAgentSignature = getAgentConfigSignature(agent);
    const shouldReload = nextAgentSignature !== (record.selectedAgentSignature || '')
      || nextAvailableAgentsSignature !== (record.availableAgentsSignature || '');

    record.selectedAgentName = agent?.name || null;
    record.selectedAgentConfig = agent || null;
    record.selectedAgentSignature = nextAgentSignature;
    record.availableAgentsSignature = nextAvailableAgentsSignature;

    if (shouldReload) {
      await record.session.reload();
    }

    const permissionPolicy = compileAgentPermission(record.cwd, agent?.permission, record.defaultToolNames);
    record.selectedPermissionPolicy = permissionPolicy;
    record.session.setActiveToolsByName(permissionPolicy.activeToolNames);
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

  const toTimestamp = (value) => {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Date.now();
  };

  const createSessionRecord = ({ session, cwd, title, createdAt, updatedAt, titleSource, parentID = null, availableAgents = [] }) => ({
    id: session.sessionId,
    title: normalizeSingleLineText(title) || session.sessionName || `Session ${sessions.size + 1}`,
    titleSource,
    cwd,
    parentID,
    createdAt,
    updatedAt,
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
    selectedPermissionPolicy: compileAgentPermission(cwd, undefined, session.getActiveToolNames()),
    availableAgents,
    availableAgentsSignature: getAvailableTaskAgentsSignature(availableAgents),
    turnBudget: { maxTurns: null, usedTurns: 0, exhausted: false },
    externalAbortListeners: new Set(),
  });

  const buildPersistedSessionSnapshot = (info) => ({
    id: info.id,
    title: normalizeString(info.name) || normalizeString(info.firstMessage) || 'Pi Session',
    cwd: normalizeString(info.cwd) || process.cwd(),
    parentID: normalizeString(info.parentID) || null,
    createdAt: toTimestamp(info.created),
    updatedAt: toTimestamp(info.modified),
    status: 'idle',
    lastError: null,
    model: null,
    thinkingLevel: 'medium',
    isStreaming: false,
    messages: [],
    toolExecutions: [],
    interactiveRequests: [],
    statusEntries: [],
    widgets: [],
    workingMessage: null,
    sequence: 0,
  });

  const refreshPersistedSessionIndex = async () => {
    const [listed, taskRelations] = await Promise.all([
      SessionManager.listAll(),
      listTaskRelations(),
    ]);
    const normalizedListed = [];
    persistedSessionIndex.clear();
    for (const info of listed) {
      if (!info || typeof info.id !== 'string' || info.id.trim().length === 0) {
        continue;
      }
      const relation = taskRelations.get(info.id) ?? null;
      const nextInfo = relation
        ? { ...info, parentID: relation.parentID }
        : info;
      persistedSessionIndex.set(info.id, nextInfo);
      normalizedListed.push(nextInfo);
    }
    return normalizedListed;
  };

  const getPersistedSessionInfo = async (sessionId) => {
    const cached = persistedSessionIndex.get(sessionId);
    if (cached) {
      return cached;
    }
    await refreshPersistedSessionIndex();
    return persistedSessionIndex.get(sessionId) || null;
  };

  const registerExternalSession = async ({ session, cwd, title, titleSource = 'provided', parentID = null, createdAt, updatedAt, persistTitle = false, availableAgents = [] }) => {
    const normalizedCwd = normalizeString(cwd) || process.cwd();
    const normalizedParentId = normalizeString(parentID) || null;
    const existing = sessions.get(session.sessionId);
    if (existing) {
      if (normalizedParentId && existing.parentID !== normalizedParentId) {
        existing.parentID = normalizedParentId;
        await setTaskRelation(existing.id, { parentID: normalizedParentId, createdAt: existing.createdAt });
      }
      if (Array.isArray(availableAgents) && availableAgents.length > 0) {
        existing.availableAgents = availableAgents;
        existing.availableAgentsSignature = getAvailableTaskAgentsSignature(availableAgents);
      }
      return existing;
    }
    const record = createSessionRecord({
      session,
      cwd: normalizedCwd,
      title,
      titleSource,
      parentID: normalizedParentId,
      createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
      updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
      availableAgents,
    });

    if (persistTitle && record.title) {
      session.setSessionName(record.title);
    }

    sessions.set(record.id, record);

    if (normalizedParentId) {
      await setTaskRelation(record.id, { parentID: normalizedParentId, createdAt: record.createdAt });
    }

    await attachSession(record);
    return record;
  };

  const createManagedSessionRecord = async ({ cwd, title, titleSource, sessionManager, createdAt, updatedAt, persistTitle = false, parentID = null }) => {
    const normalizedCwd = normalizeString(cwd) || process.cwd();
    const preloadedAgents = await discoverAgents(normalizedCwd);
    const instructionsContext = await buildProjectInstructionsContext(normalizedCwd);

    const recordRef = { current: null };
    const taskTool = createTaskToolDefinition(
      () => discoverAgents(normalizedCwd),
      normalizedCwd,
      {
        getParentSessionId: () => recordRef.current?.id ?? null,
        registerSession: async (sessionInfo) => registerExternalSession({
          ...sessionInfo,
          titleSource: 'provided',
          persistTitle: true,
          availableAgents: preloadedAgents,
        }),
      },
    );

    const questionTool = createQuestionToolDefinition((method, payload) => {
      if (!recordRef.current) throw new Error('Session record not initialized');
      return createInteractiveRequest(recordRef.current, method, payload);
    });

    const settingsManager = SettingsManager.create(normalizedCwd);
    const resourceLoader = new DefaultResourceLoader({
      cwd: normalizedCwd,
      settingsManager,
      extensionFactories: [
        createPermissionGateExtension(() => recordRef.current?.selectedPermissionPolicy || null),
      ],
      appendSystemPromptOverride: (base) => {
        const agent = recordRef.current?.selectedAgentConfig;
        const availableAgents = recordRef.current?.availableAgents ?? preloadedAgents;
        const promptSections = [];
        if (instructionsContext.content) {
          promptSections.push(instructionsContext.content);
        }
        promptSections.push(...buildAgentPromptAppend(agent, availableAgents));
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
      customTools: [taskTool, questionTool],
      sessionManager,
    });

    const record = await registerExternalSession({
      session,
      cwd: normalizedCwd,
      title,
      titleSource,
      parentID,
      createdAt,
      updatedAt,
      persistTitle,
      availableAgents: preloadedAgents,
    });

    recordRef.current = record;
    return record;
  };

  const ensureSessionLoaded = async (sessionId) => {
    const loaded = sessions.get(sessionId);
    if (loaded) {
      return loaded;
    }

    const existingTask = sessionLoadInFlight.get(sessionId);
    if (existingTask) {
      return existingTask;
    }

    const task = (async () => {
      const info = await getPersistedSessionInfo(sessionId);
      if (!info) {
        throw new Error(`Unknown Pi session: ${sessionId}`);
      }

      const persistedTitle = normalizeString(info.name);
      const firstMessageTitle = normalizeString(info.firstMessage);

      return createManagedSessionRecord({
        cwd: normalizeString(info.cwd) || process.cwd(),
        title: persistedTitle || firstMessageTitle || 'Pi Session',
        titleSource: persistedTitle ? 'provided' : (firstMessageTitle ? 'derived' : 'generated'),
        sessionManager: SessionManager.open(info.path),
        createdAt: toTimestamp(info.created),
        updatedAt: toTimestamp(info.modified),
        persistTitle: false,
        parentID: normalizeString(info.parentID) || null,
      });
    })();

    sessionLoadInFlight.set(sessionId, task);
    try {
      return await task;
    } finally {
      if (sessionLoadInFlight.get(sessionId) === task) {
        sessionLoadInFlight.delete(sessionId);
      }
    }
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
    async createSession({ cwd, title, parentID, thinkingLevel } = {}) {
      const normalizedCwd = normalizeString(cwd) || process.cwd();
      const record = await createManagedSessionRecord({
        cwd: normalizedCwd,
        title,
        titleSource: normalizeString(title) ? 'provided' : 'generated',
        parentID: normalizeString(parentID) || null,
        sessionManager: SessionManager.create(normalizedCwd),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        persistTitle: true,
      });
      if (thinkingLevel !== undefined) {
        updateRecordThinkingLevel(record, thinkingLevel);
      }
      emitEventEnvelope(record, 'pi_system', {
        kind: 'session_created',
        title: record.title,
      });
      return buildSessionSnapshot(record);
    },
    async listSessions() {
      const listed = await refreshPersistedSessionIndex();
      const merged = listed.map((info) => {
        const loaded = sessions.get(info.id);
        return loaded ? buildSessionSnapshot(loaded) : buildPersistedSessionSnapshot(info);
      });

      for (const [id, record] of sessions.entries()) {
        if (!persistedSessionIndex.has(id)) {
          merged.push(buildSessionSnapshot(record));
        }
      }

      return merged.sort((a, b) => b.updatedAt - a.updatedAt);
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
    async getSession(sessionId) {
      const record = await ensureSessionLoaded(sessionId);
      return buildSessionSnapshot(record);
    },
    async updateSession(sessionId, { title, thinkingLevel } = {}) {
      const record = await ensureSessionLoaded(sessionId);
      let updated = false;

      if (title !== undefined) {
        const nextTitle = normalizeString(title);
        if (!nextTitle) {
          throw new Error('Session title is required');
        }
        updated = updateRecordSessionName(record, nextTitle, 'provided') || updated;
      }

      if (thinkingLevel !== undefined) {
        updated = updateRecordThinkingLevel(record, thinkingLevel) || updated;
      }

      if (!updated) {
        throw new Error('No session fields to update');
      }

      return buildSessionSnapshot(record);
    },
    async prompt(sessionId, { text, model, agent, images } = {}) {
      const record = await ensureSessionLoaded(sessionId);
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
        if (record.titleSource === 'generated' && record.session.messages.length === 0) {
          const derivedTitle = deriveSessionTitleFromPrompt(promptText);
          if (derivedTitle) {
            updateRecordSessionName(record, derivedTitle, 'derived');
          }
        }
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
      const record = await ensureSessionLoaded(sessionId);
      if (record.externalAbortListeners instanceof Set) {
        for (const listener of record.externalAbortListeners) {
          try {
            listener();
          } catch {
          }
        }
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

      resolve(normalizeInteractiveResponse(response));

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
      persistedSessionIndex.clear();
      sessionLoadInFlight.clear();
    },
  };
};
