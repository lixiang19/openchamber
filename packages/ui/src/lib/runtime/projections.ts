import type { Message, Part, Session } from '@/lib/runtime/types';
import type { QuestionRequest } from '@/types/question';
import type { PiClientSessionState } from '@/lib/pi/reducer';
import type { PiContentBlock, PiInteractiveRequestViewState, PiSessionViewState, PiToolExecutionViewState } from '@/lib/pi/types';

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
  } as Part;
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
    } as Part];
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
      } as Part;
    }

    if (isThinkingBlock(block)) {
      return {
        id: partId,
        type: 'reasoning',
        text: block.thinking,
        sessionID: sessionId,
        messageID: messageId,
        time: { start: timestamp, end: timestamp },
      } as Part;
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
    } as Part;
  });

  return parts.length > 0 ? parts : [{
    id: `${messageId}:text:empty`,
    type: 'text',
    text: '',
    sessionID: sessionId,
    messageID: messageId,
    time: { start: timestamp, end: timestamp },
  } as Part];
};

export const projectPiSessionToRuntimeSession = (session: Pick<PiSessionViewState, 'id' | 'title' | 'cwd' | 'createdAt' | 'updatedAt' | 'status'>): Session => ({
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

export const projectPiSessionToRuntimeMessages = (session: PiClientSessionState | PiSessionViewState): Array<{ info: Message; parts: Part[] }> => {
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
        } as Message,
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
          time: {
            created: timestamp,
            ...(message.stopReason && message.stopReason !== 'toolUse' ? { completed: timestamp } : {}),
          },
        } as Message,
        parts,
      });
      return;
    }

    if (message.role === 'toolResult') {
      const toolCallId = message.toolCallId || `${messageId}:tool-result`;
      representedToolCalls.add(toolCallId);
      const toolName = normalizeToolName(message.toolName);
      entries.push({
        info: {
          id: messageId,
          sessionID: session.id,
          role: 'assistant',
          clientRole: 'assistant',
          time: { created: timestamp, completed: timestamp },
        } as Message,
        parts: [{
          id: toolCallId,
          type: 'tool',
          tool: toolName,
          callID: toolCallId,
          sessionID: session.id,
          messageID: messageId,
          state: {
            status: message.isError ? 'error' : 'completed',
            input: {},
            title: toolName,
            ...(message.isError
              ? { error: contentBlocksToText(message.content) || `${toolName} failed` }
              : { output: contentBlocksToText(message.content) }),
            metadata: message.details ?? {},
            time: { start: timestamp, end: timestamp },
          },
          time: { start: timestamp, end: timestamp },
        } as Part],
      });
      return;
    }

    const fallbackText = 'content' in message
      ? contentBlocksToText(Array.isArray(message.content) ? message.content : undefined)
      : ('output' in message && typeof message.output === 'string' ? message.output : '');
    entries.push({
      info: {
        id: messageId,
        sessionID: session.id,
        role: message.role,
        clientRole: message.role,
        time: { created: timestamp, completed: timestamp },
      } as Message,
      parts: [{
        id: `${messageId}:fallback`,
        type: 'text',
        text: fallbackText,
        sessionID: session.id,
        messageID: messageId,
        time: { start: timestamp, end: timestamp },
      } as Part],
    });
  });

  (session.toolExecutions || []).forEach((execution, index) => {
    if (representedToolCalls.has(execution.toolCallId)) {
      return;
    }

    const timestamp = session.updatedAt;
    const messageId = `${session.id}:synthetic-tool:${index}`;
    const output = toolOutputText(execution);
    const status = toolPartStatus(execution);
    const toolName = normalizeToolName(execution.toolName);

    entries.push({
      info: {
        id: messageId,
        sessionID: session.id,
        role: 'assistant',
        clientRole: 'assistant',
        time: {
          created: timestamp,
          ...(status !== 'running' ? { completed: timestamp } : {}),
        },
      } as Message,
      parts: [{
        id: execution.toolCallId,
        type: 'tool',
        tool: toolName,
        callID: execution.toolCallId,
        sessionID: session.id,
        messageID: messageId,
        state: {
          status,
          input: (execution.args || {}) as Record<string, unknown>,
          title: toolName,
          ...(status === 'error' ? { error: output || `${toolName} failed` } : output ? { output } : {}),
          time: { start: timestamp, ...(status !== 'running' ? { end: timestamp } : {}) },
        },
        time: { start: timestamp, ...(status !== 'running' ? { end: timestamp } : {}) },
      } as Part],
    });
  });

  return entries;
};

const projectQuestionOptions = (options: unknown): Array<{ label: string; description?: string }> => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((option) => {
    if (typeof option === 'string') {
      return [{ label: option, description: '' }];
    }
    if (!option || typeof option !== 'object') {
      return [];
    }

    const candidate = option as { label?: unknown; description?: unknown };
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    if (!label) {
      return [];
    }

    const description = typeof candidate.description === 'string' ? candidate.description : undefined;
    return [{ label, ...(description ? { description } : {}) }];
  });
};

const questionAllowsCustom = (input: { allowCustom?: boolean; options?: unknown } | null | undefined): boolean => {
  if (!input) {
    return false;
  }
  if (projectQuestionOptions(input.options).length === 0) {
    return true;
  }
  return input.allowCustom === true;
};

const projectRequestQuestions = (request: PiInteractiveRequestViewState): QuestionRequest['questions'] => {
  if (Array.isArray(request.questions) && request.questions.length > 0) {
    return request.questions.map((question) => ({
      header: question.header || request.title || 'Input needed',
      question: question.question,
      options: projectQuestionOptions(question.options),
      multiple: question.multiple === true,
      allowCustom: questionAllowsCustom(question),
    }));
  }

  return [{
    header: request.title || 'Input needed',
    question: request.message || request.title || 'Agent is waiting for your input',
    options: [],
    multiple: false,
    allowCustom: true,
  }];
};

export const projectPiInteractiveRequestToQuestionRequest = (request: PiInteractiveRequestViewState): QuestionRequest => ({
  id: request.id,
  sessionID: request.sessionId,
  questions: projectRequestQuestions(request),
  metadata: {
    bridgeKind: request.bridgeKind,
    webSupport: request.webSupport,
  },
});

export const projectPiSessionsToQuestions = (sessions: Record<string, PiClientSessionState>): Map<string, QuestionRequest[]> => {
  const next = new Map<string, QuestionRequest[]>();
  for (const session of Object.values(sessions)) {
    if (!session.interactiveRequests.length) continue;
    next.set(session.id, session.interactiveRequests.map(projectPiInteractiveRequestToQuestionRequest));
  }
  return next;
};

export const projectPiSessionStatusToRuntimeStatus = (status: PiSessionViewState['status']): { type: 'idle' | 'busy' | 'retry' } => {
  if (status === 'retrying') {
    return { type: 'retry' };
  }
  if (status === 'streaming' || status === 'compacting') {
    return { type: 'busy' };
  }
  return { type: 'idle' };
};

export const projectPiSessionsToRuntimeStatus = (sessions: Record<string, PiClientSessionState>): Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }> => {
  const next = new Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }>();
  for (const session of Object.values(sessions)) {
    next.set(session.id, { ...projectPiSessionStatusToRuntimeStatus(session.status), confirmedAt: session.updatedAt });
  }
  return next;
};

export const buildRuntimeSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
  const grouped = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = normalizePath((session as { directory?: string | null }).directory ?? null) || '__no_directory__';
    const existing = grouped.get(key) || [];
    grouped.set(key, [...existing, session]);
  }
  return grouped;
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
