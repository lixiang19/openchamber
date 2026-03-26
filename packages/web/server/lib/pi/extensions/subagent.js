/**
 * Built-in subagent extension for Pi Web runtime.
 *
 * Registers a "subagent" tool that delegates tasks to specialized agents
 * defined in .pi/agents/*.md files with mode: "subagent" | "all".
 *
 * Supports three invocation modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

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
      'Reads agents from .pi/agents/ directory. Each agent has a mode: primary, subagent, or all.',
      'Only agents with mode "subagent" or "all" can be invoked as subagents.',
    ].join(' '),
    promptSnippet: 'subagent: Delegate tasks to specialized subagents defined in .pi/agents/',
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
              cwd: { type: 'string', description: 'Working directory for the agent process' },
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
              cwd: { type: 'string', description: 'Working directory for the agent process' },
            },
            required: ['agent', 'task'],
          },
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the agent process (single mode)',
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

      // --- Chain mode ---
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

      // --- Parallel mode ---
      if (hasTasks) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [{ type: 'text', text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
            isError: true,
          };
        }

        const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t) => {
          return runSingleAgent(cwd, callableAgents, t.agent, t.task, t.cwd, signal);
        });

        const successCount = results.filter((r) => !r.isError).length;
        const summaries = results.map((r) => {
          const preview = (r.output || '').slice(0, 200) + ((r.output || '').length > 200 ? '...' : '');
          return `[${r.agent}] ${r.isError ? 'failed' : 'completed'}: ${preview || '(no output)'}`;
        });
        return {
          content: [{ type: 'text', text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join('\n\n')}` }],
        };
      }

      // --- Single mode ---
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
  const entries = (result.toolCalls || []).map((tc, i) => ({
    id: `tc-${i}`,
    tool: tc.name,
    state: {
      status: tc.isError ? 'error' : 'completed',
      title: tc.name,
      input: tc.args,
    },
  }));

  const metadata = {
    sessionId: result.sessionId || undefined,
    summary: entries,
  };

  return `<task_metadata>\n${JSON.stringify(metadata)}\n</task_metadata>`;
}

/**
 * Run a single subagent by spawning a pi subprocess.
 */
async function runSingleAgent(defaultCwd, agents, agentName, task, cwdOverride, signal, onPartialUpdate) {
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(', ') || 'none';
    return {
      agent: agentName,
      output: '',
      isError: true,
      errorMessage: `Unknown agent: "${agentName}". Available subagents: ${available}.`,
      toolCalls: [],
      sessionId: null,
    };
  }

  const effectiveCwd = cwdOverride || defaultCwd;
  const args = ['--mode', 'json', '-p', '--no-session'];

  if (agent.model) {
    args.push('--model', agent.model);
  }
  if (agent.tools && agent.tools.length > 0) {
    args.push('--tools', agent.tools.join(','));
  }

  let tmpPromptDir = null;
  let tmpPromptPath = null;

  const result = {
    agent: agentName,
    output: '',
    isError: false,
    errorMessage: null,
    toolCalls: [],
    sessionId: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };

  try {
    if (agent.systemPrompt && agent.systemPrompt.trim()) {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-subagent-'));
      const safeName = agentName.replace(/[^\w.-]+/g, '_');
      tmpPromptPath = path.join(tmpDir, `prompt-${safeName}.md`);
      tmpPromptDir = tmpDir;
      await fs.promises.writeFile(tmpPromptPath, agent.systemPrompt, { encoding: 'utf-8', mode: 0o600 });
      args.push('--append-system-prompt', tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    let wasAborted = false;
    const exitCode = await new Promise((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: effectiveCwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buffer = '';

      const processLine = (line) => {
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === 'message_end' && event.message) {
          const msg = event.message;
          if (msg.role === 'assistant') {
            result.usage.turns++;
            const usage = msg.usage;
            if (usage) {
              result.usage.input += usage.input || 0;
              result.usage.output += usage.output || 0;
              result.usage.cacheRead += usage.cacheRead || 0;
              result.usage.cacheWrite += usage.cacheWrite || 0;
              result.usage.cost += usage.cost?.total || 0;
            }
            if (msg.stopReason) result.stopReason = msg.stopReason;
            if (msg.errorMessage) result.errorMessage = msg.errorMessage;

            // Extract final text
            for (const part of msg.content || []) {
              if (part.type === 'text') {
                result.output = part.text;
              }
            }

            // Extract tool calls
            for (const part of msg.content || []) {
              if (part.type === 'toolCall') {
                result.toolCalls.push({
                  name: part.name,
                  args: part.arguments || {},
                  isError: false,
                });
              }
            }

            if (onPartialUpdate) {
              onPartialUpdate({ text: result.output || '(running...)' });
            }
          }
        }

        if (event.type === 'tool_result_end' && event.message) {
          // Track tool results for error status
          const toolResults = event.message;
          if (toolResults && toolResults.content) {
            for (const tc of result.toolCalls) {
              if (toolResults.isError) {
                tc.isError = true;
              }
            }
          }
        }
      };

      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      });

      proc.stderr.on('data', (data) => {
        result.stderr = (result.stderr || '') + data.toString();
      });

      proc.on('close', (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on('error', () => {
        resolve(1);
      });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener('abort', killProc, { once: true });
      }
    });

    result.exitCode = exitCode;
    if (wasAborted) {
      result.isError = true;
      result.errorMessage = 'Subagent was aborted';
    } else if (exitCode !== 0) {
      result.isError = true;
      if (!result.errorMessage) {
        result.errorMessage = result.stderr || `Process exited with code ${exitCode}`;
      }
    }

    return result;
  } finally {
    if (tmpPromptPath) {
      try { fs.unlinkSync(tmpPromptPath); } catch { /* ignore */ }
    }
    if (tmpPromptDir) {
      try { fs.rmdirSync(tmpPromptDir); } catch { /* ignore */ }
    }
  }
}

/**
 * Resolve the pi CLI invocation command.
 */
function getPiInvocation(args) {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: 'pi', args };
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
