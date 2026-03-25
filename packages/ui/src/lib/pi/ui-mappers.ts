import type { Message, Part, Session } from '@opencode-ai/sdk/v2/client';

import type { QuestionRequest } from '@/types/question';
import type { PiClientSessionState } from './reducer';
import type { PiContentBlock, PiInteractiveRequestViewState, PiSessionViewState, PiToolExecutionViewState } from './types';

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

const asTimestamp = (value: number | null | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const joinNonEmpty = (parts: Array<string | null | undefined>, separator = '\n\n'): string => (
  parts.map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean).join(separator)
);

const normalizeToolName = (value: string | null | undefined): string => {
  if (typeof value !== 'string') return 'tool';
  const trimmed = value.trim();
  if (!trimmed) return 'tool';
  const withoutNamespace = trimmed.includes('.') ? trimmed.split('.').pop() || trimmed : trimmed;
  return withoutNamespace.replace(/^functions\./, '') || 'tool';
};

const isTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => (
  block.type === 'text' && 'text' in block
);

const isThinkingBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => (
  block.type === 'thinking' && 'thinking' in block
);

const isToolCallBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'toolCall' }> => (
  block.type === 'toolCall' && 'name' in block && 'arguments' in block
);

const isImageBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'image' }> => (
  block.type === 'image' && 'data' in block
);

const getBlockFallbackText = (block: PiContentBlock): string => {
  if ('raw' in block) {
    return stringify(block.raw ?? { type: block.type });
  }
  return stringify({ type: block.type });
};

const contentBlocksToText = (blocks: PiContentBlock[] | undefined): string => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }

  return blocks.map((block) => {
    if (isTextBlock(block)) return block.text;
    if (isThinkingBlock(block)) return block.thinking;
    if (isToolCallBlock(block)) {
      return joinNonEmpty([
        `Tool call: ${normalizeToolName(block.name)}`,
        block.arguments ? stringify(block.arguments) : '',
      ]);
    }
    if (isImageBlock(block)) {
      return `[Image${block.mimeType ? ` ${block.mimeType}` : ''}]`;
    }
    return getBlockFallbackText(block);
  }).filter(Boolean).join('\n\n');
};

const toolOutputText = (execution: PiToolExecutionViewState): string => {
  return joinNonEmpty([
    typeof execution.partialResult === 'undefined' || execution.partialResult === null ? '' : stringify(execution.partialResult),
    typeof execution.result === 'undefined' || execution.result === null ? '' : stringify(execution.result),
  ]);
};

const toolPartStatus = (execution: PiToolExecutionViewState | null | undefined): string => {
  if (!execution) return 'running';
  if (execution.status === 'running') return 'running';
  return execution.isError ? 'error' : 'completed';
};

const toToolPart = (
  sessionId: string,
  messageId: string,
  block: Extract<PiContentBlock, { type: 'toolCall' }>,
  timestamp: number,
  execution: PiToolExecutionViewState | null | undefined,
  index: number,
): Part => {
  const partId = block.id || `${messageId}:tool:${index}`;
  const toolName = normalizeToolName(execution?.toolName || block.name);
  const status = toolPartStatus(execution);
  const output = execution ? toolOutputText(execution) : '';

  return {
    id: partId,
    type: 'tool',
    tool: toolName,
    callID: partId,
    sessionID: sessionId,
    messageID: messageId,
    state: {
      status,
      input: (execution?.args ?? block.arguments ?? {}) as Record<string, unknown>,
      ...(output ? { output } : {}),
      ...(status === 'error' ? { error: output || `${toolName} failed` } : {}),
      time: {
        start: timestamp,
        ...(status !== 'running' ? { end: timestamp } : {}),
      },
      metadata: {
        pi: {
          toolName: execution?.toolName || block.name || toolName,
        },
      },
    },
    time: {
      start: timestamp,
      ...(status !== 'running' ? { end: timestamp } : {}),
    },
  } as unknown as Part;
};

const toMessageParts = (
  sessionId: string,
  messageId: string,
  content: string | PiContentBlock[],
  timestamp: number,
  toolExecutionsById: Map<string, PiToolExecutionViewState>,
): Part[] => {
  if (typeof content === 'string') {
    return [{
      id: `${messageId}:text:0`,
      type: 'text',
      text: content,
      sessionID: sessionId,
      messageID: messageId,
      time: { start: timestamp, end: timestamp },
    } as unknown as Part];
  }

  const parts = content.map((block, index) => {
    const partId = `${messageId}:part:${index}`;
    if (isTextBlock(block)) {
      return {
        id: partId,
        type: 'text',
        text: block.text,
        sessionID: sessionId,
        messageID: messageId,
        time: { start: timestamp, end: timestamp },
      } as unknown as Part;
    }

    if (isThinkingBlock(block)) {
      return {
        id: partId,
        type: 'reasoning',
        text: block.thinking,
        sessionID: sessionId,
        messageID: messageId,
        time: { start: timestamp, end: timestamp },
      } as unknown as Part;
    }

    if (isToolCallBlock(block)) {
      const execution = block.id ? toolExecutionsById.get(block.id) : undefined;
      return toToolPart(sessionId, messageId, block, timestamp, execution, index);
    }

    return {
      id: partId,
      type: 'text',
      text: isImageBlock(block) ? `[Image${block.mimeType ? ` ${block.mimeType}` : ''}]` : getBlockFallbackText(block),
      sessionID: sessionId,
      messageID: messageId,
      time: { start: timestamp, end: timestamp },
    } as unknown as Part;
  });

  return parts.length > 0 ? parts : [{
    id: `${messageId}:text:empty`,
    type: 'text',
    text: '',
    sessionID: sessionId,
    messageID: messageId,
    time: { start: timestamp, end: timestamp },
  } as unknown as Part];
};

export const toUiSession = (session: Pick<PiSessionViewState, 'id' | 'title' | 'cwd' | 'createdAt' | 'updatedAt' | 'status'>): Session => ({
  id: session.id,
  title: session.title || 'Pi Session',
  directory: normalizePath(session.cwd),
  version: 'pi',
  projectID: '',
  time: {
    created: session.createdAt,
    updated: session.updatedAt,
    ...(session.status === 'compacting' ? { compacting: session.updatedAt } : {}),
  },
  summary: undefined,
  share: undefined,
} as Session);

export const toUiMessageEntries = (session: PiClientSessionState | PiSessionViewState): Array<{ info: Message; parts: Part[] }> => {
  const toolExecutionsById = new Map((session.toolExecutions || []).map((entry) => [entry.toolCallId, entry]));
  const entries: Array<{ info: Message; parts: Part[] }> = [];
  const representedToolCalls = new Set<string>();

  (session.messages || []).forEach((message, index) => {
    const messageId = (message as { id?: string }).id || `${session.id}:message:${index}`;
    const timestamp = asTimestamp(message.timestamp, session.updatedAt);

    if (message.role === 'user') {
      entries.push({
        info: {
          id: messageId,
          sessionID: session.id,
          role: 'user',
          clientRole: 'user',
          userMessageMarker: true,
          time: { created: timestamp, completed: timestamp },
        } as unknown as Message,
        parts: toMessageParts(session.id, messageId, message.content, timestamp, toolExecutionsById),
      });
      return;
    }

    if (message.role === 'assistant') {
      const parts = toMessageParts(session.id, messageId, message.content, timestamp, toolExecutionsById);
      parts.forEach((part) => {
        if (part.type === 'tool' && typeof part.id === 'string') {
          representedToolCalls.add(part.id);
        }
      });
      entries.push({
        info: {
          id: messageId,
          sessionID: session.id,
          role: 'assistant',
          clientRole: 'assistant',
          ...(message.provider ? { providerID: message.provider } : {}),
          ...(message.model ? { modelID: message.model } : {}),
          ...(message.errorMessage ? { error: message.errorMessage, finish: 'error', status: 'error' } : { finish: 'stop', status: 'completed' }),
          time: { created: timestamp, completed: timestamp },
        } as unknown as Message,
        parts,
      });
      return;
    }

    if (message.role === 'toolResult') {
      if (representedToolCalls.has(message.toolCallId)) {
        return;
      }
      entries.push({
        info: {
          id: messageId,
          sessionID: session.id,
          role: 'assistant',
          clientRole: 'assistant',
          finish: message.isError ? 'error' : 'stop',
          status: 'completed',
          time: { created: timestamp, completed: timestamp },
        } as unknown as Message,
        parts: [{
          id: message.toolCallId || `${messageId}:tool-result`,
          type: 'tool',
          tool: normalizeToolName(message.toolName),
          callID: message.toolCallId || `${messageId}:tool-result`,
          sessionID: session.id,
          messageID: messageId,
          state: {
            status: message.isError ? 'error' : 'completed',
            output: joinNonEmpty([contentBlocksToText(message.content), stringify(message.details)]),
            ...(message.isError ? { error: joinNonEmpty([contentBlocksToText(message.content), stringify(message.details)]) || 'Tool failed' } : {}),
            time: { start: timestamp, end: timestamp },
          },
          time: { start: timestamp, end: timestamp },
        } as unknown as Part],
      });
      return;
    }

    const textContent = message.role === 'custom'
      ? (typeof message.content === 'string' ? message.content : contentBlocksToText(message.content))
      : joinNonEmpty([message.command, message.output], '\n');
    entries.push({
      info: {
        id: messageId,
        sessionID: session.id,
        role: 'assistant',
        clientRole: 'assistant',
        finish: 'stop',
        status: 'completed',
        time: { created: timestamp, completed: timestamp },
      } as unknown as Message,
      parts: [{
        id: `${messageId}:text`,
        type: 'text',
        text: textContent || (message.role === 'custom' ? stringify(message.details ?? '') : ''),
        sessionID: session.id,
        messageID: messageId,
        time: { start: timestamp, end: timestamp },
      } as unknown as Part],
    });
  });

  return entries;
};

export const toUiQuestionRequest = (request: PiInteractiveRequestViewState): QuestionRequest => ({
  id: request.id,
  sessionID: request.sessionId,
  questions: [{
    header: request.title || 'Input needed',
    question: request.message || request.placeholder || 'Agent is waiting for your input',
    options: request.method === 'confirm'
      ? [{ label: 'Confirm', description: 'Confirm and continue' }]
      : request.options.map((option) => ({ label: option, description: '' })),
    multiple: false,
  }],
  metadata: {
    bridgeMethod: request.method,
    placeholder: request.placeholder,
    prefill: request.prefill,
  },
});

export const extractPiQuestionResponseValue = (
  request: PiInteractiveRequestViewState,
  answers: string[] | string[][],
): string | boolean => {
  const normalized = Array.isArray(answers) && Array.isArray(answers[0])
    ? (answers as string[][])
    : [answers as string[]];
  const firstGroup = normalized[0] ?? [];
  const firstAnswer = typeof firstGroup[0] === 'string' ? firstGroup[0].trim() : '';

  if (request.method === 'confirm') {
    return firstAnswer.length === 0 || firstAnswer.toLowerCase() === 'confirm' || firstAnswer.toLowerCase() === 'yes';
  }

  return firstAnswer;
};

export const buildSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
  const grouped = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = normalizePath((session as { directory?: string | null }).directory ?? null) || '__no_directory__';
    const existing = grouped.get(key) || [];
    grouped.set(key, [...existing, session]);
  }
  return grouped;
};

export const projectPiStateToQuestions = (sessions: Record<string, PiClientSessionState>): Map<string, QuestionRequest[]> => {
  const next = new Map<string, QuestionRequest[]>();
  for (const session of Object.values(sessions)) {
    if (!session.interactiveRequests.length) continue;
    next.set(session.id, session.interactiveRequests.map(toUiQuestionRequest));
  }
  return next;
};

export const piSessionStatusToUiStatus = (status: PiSessionViewState['status']): { type: 'idle' | 'busy' | 'retry' } => {
  if (status === 'retrying') {
    return { type: 'retry' };
  }
  if (status === 'streaming' || status === 'compacting') {
    return { type: 'busy' };
  }
  return { type: 'idle' };
};

export const projectPiStateToStatus = (sessions: Record<string, PiClientSessionState>): Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }> => {
  const next = new Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }>();
  for (const session of Object.values(sessions)) {
    next.set(session.id, { ...piSessionStatusToUiStatus(session.status), confirmedAt: session.updatedAt });
  }
  return next;
};

export const getPiUiProviders = (): { providers: import('@opencode-ai/sdk/v2/client').Provider[]; default: Record<string, string> } => ({
  providers: [{
    id: 'pi',
    name: 'Pi Runtime',
    env: [],
    npm: [],
    models: {
      default: {
        id: 'default',
        name: 'Default',
      },
    },
  } as unknown as import('@opencode-ai/sdk/v2/client').Provider],
  default: {
    chat: 'pi/default',
  },
});

export const getPiUiAgents = (): import('@opencode-ai/sdk/v2/client').Agent[] => {
  const model = { providerID: 'pi', modelID: 'default' };
  return [
    {
      name: 'build',
      description: 'Pi build agent',
      mode: 'primary',
      model,
      permission: {},
    } as import('@opencode-ai/sdk/v2/client').Agent,
    {
      name: 'plan',
      description: 'Pi planning agent',
      mode: 'all',
      model,
      permission: {},
    } as import('@opencode-ai/sdk/v2/client').Agent,
  ];
};
