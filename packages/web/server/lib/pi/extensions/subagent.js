/**
 * Built-in subagent extension for Pi Web runtime.
 *
 * Registers a "subagent" tool that delegates tasks to specialized agents
 * discovered from ~/.pi/agent/agents and the nearest .pi/agents directory,
 * using agents with mode: "subagent" | "all".
 *
 * Supports three invocation modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 */

import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@mariozechner/pi-coding-agent';

import { compileAgentPermission, createPermissionGateExtension } from '../permissions.js';

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

const TOOL_FACTORIES = {
  read: createReadTool,
  bash: createBashTool,
  edit: createEditTool,
  write: createWriteTool,
  grep: createGrepTool,
  find: createFindTool,
  ls: createLsTool,
};

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
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

const createUnsupportedUiError = (method) =>
  new Error(`Subagent interactive UI is not supported for method: ${method}`);

const createSubagentUiContext = (onPartialUpdate) => {
  const emitText = (text) => {
    const normalized = normalizeString(text);
    if (normalized && onPartialUpdate) {
      onPartialUpdate({ text: normalized });
    }
  };

  return {
    async select() {
      throw createUnsupportedUiError('select');
    },
    async confirm() {
      throw createUnsupportedUiError('confirm');
    },
    async input() {
      throw createUnsupportedUiError('input');
    },
    async editor() {
      throw createUnsupportedUiError('editor');
    },
    notify(message, type = 'info') {
      emitText(type === 'info' ? message : `[${type}] ${message}`);
    },
    onTerminalInput() {
      return () => {};
    },
    setStatus(_key, text) {
      emitText(text);
    },
    setWorkingMessage(message) {
      emitText(message);
    },
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() {
      throw createUnsupportedUiError('custom');
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return '';
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
      return { success: false, error: 'Theme switching is not implemented for subagent sessions' };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
};

const extractAssistantText = (content) => {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
};

const normalizeThinkingLevel = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized)
    ? normalized
    : undefined;
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
  return undefined;
};

const resolveSubagentTools = (cwd, toolNames) => {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return undefined;
  }

  const allowed = toolNames
    .map((toolName) => normalizeString(toolName).toLowerCase())
    .filter((toolName) => Object.prototype.hasOwnProperty.call(TOOL_FACTORIES, toolName));

  return allowed.map((toolName) => TOOL_FACTORIES[toolName](cwd));
};

const buildSubagentPrompt = (agent) => {
  const sections = [];
  const prompt = normalizeString(agent?.systemPrompt);
  if (prompt) {
    sections.push(prompt);
  }

  const steps = normalizePositiveInteger(agent?.steps);
  if (steps) {
    sections.push([
      `Turn budget: ${steps}.`,
      'You may use at most this many internal turns for the current task.',
      'Before you would exceed the limit, stop calling tools and answer with the best summary or result you can produce from completed work.',
    ].join(' '));
  }

  return sections.join('\n\n');
};

const resolveSubagentModel = async (modelRegistry, modelSpec) => {
  const normalizedSpec = normalizeString(modelSpec);
  if (!normalizedSpec) {
    return null;
  }

  await Promise.resolve(modelRegistry.refresh());
  const availableModels = await Promise.resolve(modelRegistry.getAvailable());

  if (normalizedSpec.includes('/')) {
    const [providerID, modelID, ...rest] = normalizedSpec.split('/');
    if (!providerID || !modelID || rest.length > 0) {
      throw new Error(`Invalid subagent model: ${normalizedSpec}`);
    }
    const exact = availableModels.find((model) => model.provider === providerID && model.id === modelID);
    if (!exact) {
      throw new Error(`Subagent model not available: ${normalizedSpec}`);
    }
    return exact;
  }

  const matches = availableModels.filter((model) => model.id === normalizedSpec);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    const options = matches.map((model) => `${model.provider}/${model.id}`).join(', ');
    throw new Error(`Ambiguous subagent model "${normalizedSpec}". Use one of: ${options}`);
  }

  throw new Error(`Subagent model not available: ${normalizedSpec}`);
};

/**
 * @param {import('./agents.js').discoverAgents} discoverAgentsFn
 * @param {string} cwd
 * @returns {import('@mariozechner/pi-coding-agent').ToolDefinition}
 */
export function createSubagentToolDefinition(discoverAgentsFn, cwd) {
  return {
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Delegate tasks to specialized subagents with isolated context.',
      'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
      'Reads agents from ~/.pi/agent/agents and the nearest .pi/agents directory. Each agent has a mode: primary, subagent, or all.',
      'Only agents with mode "subagent" or "all" can be invoked as subagents.',
    ].join(' '),
    promptSnippet: 'subagent: Delegate tasks to specialized subagents discovered from user and project agent directories',
    promptGuidelines: [
      'Use the subagent tool to delegate complex or specialized tasks to purpose-built agents.',
      'Each subagent runs in an isolated context with its own system prompt.',
      'For sequential workflows where each step depends on the previous, use chain mode with {previous} placeholder.',
      'For independent tasks that can run concurrently, use parallel mode.',
    ],
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Name of the agent to invoke (for single mode)',
        },
        task: {
          type: 'string',
          description: 'Task to delegate (for single mode)',
        },
        tasks: {
          type: 'array',
          description: 'Array of {agent, task} for parallel execution',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Name of the agent to invoke' },
              task: { type: 'string', description: 'Task to delegate to the agent' },
              cwd: { type: 'string', description: 'Working directory for the agent session' },
            },
            required: ['agent', 'task'],
          },
        },
        chain: {
          type: 'array',
          description: 'Array of {agent, task} for sequential execution with {previous} placeholder',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Name of the agent to invoke' },
              task: { type: 'string', description: 'Task with optional {previous} placeholder for prior output' },
              cwd: { type: 'string', description: 'Working directory for the agent session' },
            },
            required: ['agent', 'task'],
          },
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the agent session (single mode)',
        },
      },
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const agents = await discoverAgentsFn(cwd);
      const callableAgents = agents.filter((a) => a.mode === 'subagent' || a.mode === 'all');

      const hasChain = Array.isArray(params.chain) && params.chain.length > 0;
      const hasTasks = Array.isArray(params.tasks) && params.tasks.length > 0;
      const hasSingle = Boolean(params.agent && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

      if (modeCount !== 1) {
        const available = callableAgents.map((a) => `${a.name}: ${a.description || '(no description)'}`).join(', ') || 'none';
        return {
          content: [{ type: 'text', text: `Invalid parameters. Provide exactly one mode (single, parallel, or chain).\nAvailable subagents: ${available}` }],
          isError: true,
        };
      }

      if (hasChain) {
        const results = [];
        let previousOutput = '';

        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];
          const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

          const result = await runSingleAgent(
            cwd,
            callableAgents,
            step.agent,
            taskWithContext,
            step.cwd,
            signal,
            (partial) => {
              if (onUpdate) {
                onUpdate({
                  content: [{ type: 'text', text: partial.text || `Chain step ${i + 1}/${params.chain.length}: running...` }],
                });
              }
            },
          );
          results.push(result);

          if (result.isError) {
            const errorText = result.errorMessage || result.output || '(no output)';
            return {
              content: [{ type: 'text', text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorText}` }],
              isError: true,
            };
          }
          previousOutput = result.output;
        }

        const last = results[results.length - 1];
        const metadata = buildTaskMetadata(last);
        return {
          content: [{ type: 'text', text: `${last.output || '(no output)'}\n${metadata}` }],
        };
      }

      if (hasTasks) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [{ type: 'text', text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
            isError: true,
          };
        }

        const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (taskItem) => {
          return runSingleAgent(cwd, callableAgents, taskItem.agent, taskItem.task, taskItem.cwd, signal);
        });

        const successCount = results.filter((result) => !result.isError).length;
        const summaries = results.map((result) => {
          const preview = (result.output || '').slice(0, 200) + ((result.output || '').length > 200 ? '...' : '');
          return `[${result.agent}] ${result.isError ? 'failed' : 'completed'}: ${preview || '(no output)'}`;
        });
        return {
          content: [{ type: 'text', text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n')}` }],
        };
      }

      if (hasSingle) {
        const result = await runSingleAgent(
          cwd,
          callableAgents,
          params.agent,
          params.task,
          params.cwd,
          signal,
          (partial) => {
            if (onUpdate) {
              onUpdate({
                content: [{ type: 'text', text: partial.text || 'Running subagent...' }],
              });
            }
          },
        );

        if (result.isError) {
          const errorText = result.errorMessage || result.output || '(no output)';
          return {
            content: [{ type: 'text', text: `Agent ${result.agent} failed: ${errorText}` }],
            isError: true,
          };
        }

        const metadata = buildTaskMetadata(result);
        return {
          content: [{ type: 'text', text: `${result.output || '(no output)'}\n${metadata}` }],
        };
      }

      return {
        content: [{ type: 'text', text: 'Invalid parameters.' }],
        isError: true,
      };
    },
  };
}

/**
 * Build a <task_metadata> block that the frontend ToolPart.tsx can parse.
 * This is the key contract between backend extension and frontend UI.
 */
function buildTaskMetadata(result) {
  const entries = (result.toolCalls || []).map((toolCall, index) => ({
    id: toolCall.id || `tc-${index}`,
    tool: toolCall.name,
    state: {
      status: toolCall.isError ? 'error' : 'completed',
      title: toolCall.name,
      input: toolCall.args,
    },
  }));

  const metadata = {
    sessionId: result.sessionId || undefined,
    summary: entries,
  };

  return `<task_metadata>\n${JSON.stringify(metadata)}\n</task_metadata>`;
}

/**
 * Run a single subagent through the Pi SDK.
 */
async function runSingleAgent(defaultCwd, agents, agentName, task, cwdOverride, signal, onPartialUpdate) {
  const agent = agents.find((candidate) => candidate.name === agentName);

  if (!agent) {
    const available = agents.map((candidate) => `"${candidate.name}"`).join(', ') || 'none';
    return {
      agent: agentName,
      output: '',
      isError: true,
      errorMessage: `Unknown agent: "${agentName}". Available subagents: ${available}.`,
      toolCalls: [],
      sessionId: null,
    };
  }

  const effectiveCwd = normalizeString(cwdOverride) || defaultCwd;
  const result = {
    agent: agentName,
    output: '',
    isError: false,
    errorMessage: null,
    toolCalls: [],
    sessionId: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };
  const maxTurns = normalizePositiveInteger(agent.steps);
  let usedTurns = 0;
  let turnBudgetExceeded = false;

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const settingsManager = SettingsManager.create(effectiveCwd);
  const appendedPrompt = buildSubagentPrompt(agent);
  const permissionPolicy = compileAgentPermission(effectiveCwd, agent.permission, Object.keys(TOOL_FACTORIES));
  const resourceLoader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    settingsManager,
    extensionFactories: [
      createPermissionGateExtension(permissionPolicy),
    ],
    ...(appendedPrompt
      ? { appendSystemPrompt: appendedPrompt }
      : {}),
  });
  await resourceLoader.reload();

  const tools = resolveSubagentTools(effectiveCwd, permissionPolicy.activeToolNames);
  const model = await resolveSubagentModel(modelRegistry, agent.model);
  const thinkingLevel = normalizeThinkingLevel(agent.thinking);
  const { session } = await createAgentSession({
    cwd: effectiveCwd,
    authStorage,
    modelRegistry,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    ...(tools ? { tools } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });

  result.sessionId = session.sessionId;

  const toolCallsById = new Map();
  const uiContext = createSubagentUiContext(onPartialUpdate);
  await session.bindExtensions({ uiContext });

  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'turn_start') {
      if (maxTurns && usedTurns >= maxTurns && !turnBudgetExceeded) {
        turnBudgetExceeded = true;
        void session.abort().catch(() => {});
      }
      return;
    }

    if (event.type === 'turn_end') {
      if (maxTurns) {
        usedTurns += 1;
      }
      return;
    }

    if (event.type === 'tool_execution_start') {
      const entry = {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args || {},
        isError: false,
      };
      toolCallsById.set(event.toolCallId, entry);
      result.toolCalls.push(entry);
      if (onPartialUpdate) {
        onPartialUpdate({ text: `Running ${event.toolName}...` });
      }
      return;
    }

    if (event.type === 'tool_execution_end') {
      const existing = toolCallsById.get(event.toolCallId);
      if (existing) {
        existing.isError = event.isError === true;
      }
      return;
    }

    if (event.type === 'message_update' && event.message?.role === 'assistant') {
      const partialText = extractAssistantText(event.message.content);
      if (partialText && onPartialUpdate) {
        onPartialUpdate({ text: partialText });
      }
      return;
    }

    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message;
      const usage = message.usage;
      result.usage.turns += 1;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
      }
      if (message.stopReason) {
        result.stopReason = message.stopReason;
      }
      if (message.errorMessage) {
        result.errorMessage = message.errorMessage;
      }

      const output = extractAssistantText(message.content);
      if (output) {
        result.output = output;
      }
    }
  });

  let abortHandler = null;
  let wasAborted = false;

  try {
    if (signal) {
      abortHandler = () => {
        wasAborted = true;
        void session.abort().catch(() => {});
      };
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    if (wasAborted) {
      result.isError = true;
      result.errorMessage = 'Subagent was aborted';
      return result;
    }

    await session.prompt(`Task: ${task}`, { source: 'interactive' });

    if (wasAborted || turnBudgetExceeded) {
      result.isError = true;
      result.errorMessage = turnBudgetExceeded ? 'Subagent turn budget exhausted' : 'Subagent was aborted';
      return result;
    }

    if (result.stopReason === 'error' && !result.errorMessage) {
      result.isError = true;
      result.errorMessage = 'Subagent execution failed';
    }

    return result;
  } catch (error) {
    result.isError = true;
    result.errorMessage = wasAborted
      ? 'Subagent was aborted'
      : error instanceof Error
        ? error.message
        : String(error);
    return result;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
    unsubscribe();
    session.dispose();
  }
}

/**
 * Run tasks with concurrency limit.
 */
async function mapWithConcurrencyLimit(items, concurrency, fn) {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}
