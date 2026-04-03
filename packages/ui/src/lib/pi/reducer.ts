import type {
  PiAgentEventPayload,
  PiAssistantStreamEvent,
  PiContentBlock,
  PiInteractiveRequestViewState,
  PiMessageViewState,
  PiNormalizedMessage,
  PiServerEvent,
  PiSessionViewState,
  PiStatusEntry,
  PiToolExecutionViewState,
  PiWidgetEntry,
} from './types';
import { getPiInteractiveRequestIdentity } from './types';

export interface PiClientSessionState extends PiSessionViewState {
  sequence: number;
  messages: Array<PiMessageViewState & { id: string }>;
  runtime: {
    nextMessageOrdinal: number;
    activeAssistantMessageId: string | null;
    seenEventIds: Set<string>;
  };
}

export interface PiClientState {
  sessions: Record<string, PiClientSessionState>;
  currentSessionId: string | null;
}

type PiClientAction =
  | { type: 'bootstrap_sessions'; sessions: PiSessionViewState[] }
  | { type: 'upsert_session'; session: PiSessionViewState; select?: boolean }
  | { type: 'set_current_session'; sessionId: string | null }
  | { type: 'append_optimistic_user_message'; sessionId: string; text: string }
  | { type: 'apply_event'; event: PiServerEvent };

const asTimestamp = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : Date.now());

const createMessageId = (session: PiClientSessionState, prefix: string) => {
  const id = `${session.id}-${prefix}-${session.runtime.nextMessageOrdinal}`;
  session.runtime.nextMessageOrdinal += 1;
  return id;
};

const isSameInteractiveRequest = (
  left: Pick<PiInteractiveRequestViewState, 'sessionId' | 'id'>,
  right: Pick<PiInteractiveRequestViewState, 'sessionId' | 'id'>,
) => getPiInteractiveRequestIdentity(left) === getPiInteractiveRequestIdentity(right);

const isTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => (
  block.type === 'text' && 'text' in block
);

const isThinkingBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => (
  block.type === 'thinking' && 'thinking' in block
);

const isMessagePayload = (payload: PiAgentEventPayload): payload is Extract<PiAgentEventPayload, { channel: 'message' }> => (
  payload.channel === 'message' && (payload.eventType === 'message_start' || payload.eventType === 'message_update' || payload.eventType === 'message_end')
);

const isToolPayload = (payload: PiAgentEventPayload): payload is Extract<PiAgentEventPayload, { channel: 'tool' }> => (
  payload.channel === 'tool' && (payload.eventType === 'tool_execution_start' || payload.eventType === 'tool_execution_update' || payload.eventType === 'tool_execution_end')
);

const isTurnEndPayload = (payload: PiAgentEventPayload): payload is Extract<PiAgentEventPayload, { eventType: 'turn_end' }> => (
  payload.eventType === 'turn_end' && payload.channel === 'turn' && Array.isArray((payload as { toolResults?: unknown }).toolResults)
);

const isAgentEndPayload = (payload: PiAgentEventPayload): payload is Extract<PiAgentEventPayload, { eventType: 'agent_end' }> => (
  payload.eventType === 'agent_end' && payload.channel === 'agent' && Array.isArray((payload as { messages?: unknown }).messages)
);

const toBlockText = (block: PiContentBlock): string => {
  if (isTextBlock(block)) return block.text;
  if (isThinkingBlock(block)) return block.thinking;
  return '';
};

const toRenderableMessage = (
  session: PiClientSessionState,
  message: PiNormalizedMessage,
  preferredId?: string,
): (PiMessageViewState & { id: string }) | null => {
  const id = preferredId || createMessageId(session, 'message');
  const timestamp = asTimestamp(message.timestamp);

  switch (message.messageKind) {
    case 'user-message':
      return {
        id,
        role: 'user',
        content: message.content,
        timestamp,
      };
    case 'assistant-message':
      return {
        id,
        role: 'assistant',
        content: message.content,
        api: message.api ?? undefined,
        provider: message.provider ?? undefined,
        model: message.model ?? undefined,
        responseId: message.responseId ?? undefined,
        stopReason: message.stopReason ?? undefined,
        errorMessage: message.errorMessage ?? undefined,
        usage: message.usage ?? undefined,
        timestamp,
      };
    case 'tool-result':
      return {
        id,
        role: 'toolResult',
        toolCallId: message.toolCallId || id,
        toolName: message.toolName || 'tool',
        content: message.content,
        details: message.details ?? undefined,
        isError: message.isError,
        timestamp,
      };
    case 'custom-message':
      return {
        id,
        role: 'custom',
        customType: message.customType || 'pi.custom',
        content: message.content,
        display: message.display,
        details: message.details ?? undefined,
        timestamp,
      };
    case 'bash-execution':
      return {
        id,
        role: 'bashExecution',
        command: message.command,
        output: message.output,
        exitCode: message.exitCode ?? undefined,
        cancelled: message.cancelled,
        truncated: message.truncated,
        timestamp,
      };
    case 'branch-summary':
      return {
        id,
        role: 'custom',
        customType: 'pi.branch.summary',
        content: message.summary,
        timestamp,
      };
    case 'compaction-summary':
      return {
        id,
        role: 'custom',
        customType: 'pi.compaction.summary',
        content: message.summary,
        details: { tokensBefore: message.tokensBefore },
        timestamp,
      };
    default:
      return null;
  }
};

const hydrateMessage = (
  session: PiClientSessionState,
  message: PiMessageViewState,
  index: number,
): PiMessageViewState & { id: string } => ({
  ...message,
  id: message.id || `${session.id}-bootstrap-${index}`,
});

const createSessionState = (snapshot: PiSessionViewState): PiClientSessionState => {
  const base: PiClientSessionState = {
    ...snapshot,
    sequence: snapshot.sequence ?? 0,
    messages: [] as Array<PiMessageViewState & { id: string }>,
    runtime: {
      nextMessageOrdinal: Math.max(snapshot.messages.length + 1, 1),
      activeAssistantMessageId: null,
      seenEventIds: new Set<string>(),
    },
  };

  base.messages = snapshot.messages.map((message, index) => hydrateMessage(base, message, index));

  if (base.status === 'streaming') {
    const activeAssistant = [...base.messages].reverse().find((message) => message.role === 'assistant');
    base.runtime.activeAssistantMessageId = activeAssistant?.id || null;
  }

  return base;
};

const upsertStatusEntry = (entries: PiStatusEntry[], key: string, text: string | null) => {
  const next = entries.filter((entry) => entry.key !== key);
  if (text) {
    next.push({ key, text });
  }
  return next;
};

const upsertWidget = (
  widgets: PiWidgetEntry[],
  key: string,
  content: string[] | null,
  placement: string | null,
  bordered: boolean,
) => {
  const next = widgets.filter((widget) => widget.key !== key);
  if (content) {
    next.push({
      key,
      content,
      placement: placement || 'above-editor',
      bordered,
    });
  }
  return next;
};

const upsertToolExecution = (
  executions: PiToolExecutionViewState[],
  nextEntry: PiToolExecutionViewState,
) => {
  const index = executions.findIndex((entry) => entry.toolCallId === nextEntry.toolCallId);
  if (index === -1) {
    return [...executions, nextEntry];
  }
  return executions.map((entry, currentIndex) => (currentIndex === index ? nextEntry : entry));
};

const updateToolExecution = (
  executions: PiToolExecutionViewState[],
  toolCallId: string,
  patch: Partial<PiToolExecutionViewState>,
) => {
  const existing = executions.find((entry) => entry.toolCallId === toolCallId) || {
    toolCallId,
    toolName: patch.toolName || 'tool',
    args: patch.args ?? null,
    status: 'running' as const,
    partialResult: null,
    result: null,
    isError: false,
  };

  return upsertToolExecution(executions, {
    ...existing,
    ...patch,
    toolCallId,
  });
};

const getAssistantMessageById = (
  session: PiClientSessionState,
  messageId: string | null | undefined,
) => {
  if (!messageId) {
    return null;
  }
  return session.messages.find((message) => message.id === messageId && message.role === 'assistant') || null;
};

const getLatestAssistantMessage = (session: PiClientSessionState) => {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role === 'assistant') {
      return message;
    }
  }
  return null;
};

const assistantMessageMatchesNormalized = (
  message: PiMessageViewState & { id: string },
  normalized: Extract<PiNormalizedMessage, { messageKind: 'assistant-message' }>,
): boolean => {
  if (message.role !== 'assistant') {
    return false;
  }

  if (normalized.responseId && message.responseId && normalized.responseId === message.responseId) {
    return true;
  }

  return message.timestamp === asTimestamp(normalized.timestamp)
    && (normalized.provider ?? undefined) === (message.provider ?? undefined)
    && (normalized.model ?? undefined) === (message.model ?? undefined);
};

const getActiveAssistantMessage = (session: PiClientSessionState) => {
  return getAssistantMessageById(session, session.runtime.activeAssistantMessageId);
};

const upsertRenderableMessage = (
  session: PiClientSessionState,
  message: PiMessageViewState & { id: string },
) => {
  const index = session.messages.findIndex((entry) => entry.id === message.id);
  if (index === -1) {
    session.messages = [...session.messages, message];
    return;
  }
  session.messages = session.messages.map((entry, currentIndex) => (currentIndex === index ? message : entry));
};

const ensureActiveAssistantMessage = (session: PiClientSessionState) => {
  const existing = getActiveAssistantMessage(session);
  if (existing) {
    return existing;
  }

  const nextMessage: PiMessageViewState & { id: string } = {
    id: createMessageId(session, 'assistant'),
    role: 'assistant',
    content: [],
    timestamp: Date.now(),
  };
  session.runtime.activeAssistantMessageId = nextMessage.id;
  upsertRenderableMessage(session, nextMessage);
  return nextMessage;
};

const replaceAssistantFromNormalized = (
  session: PiClientSessionState,
  normalized: Extract<PiNormalizedMessage, { messageKind: 'assistant-message' }>,
  status: PiSessionViewState['status'],
  options?: { preferredMessageId?: string | null },
) => {
  let existing = getAssistantMessageById(session, options?.preferredMessageId ?? null);
  if (!existing) {
    existing = getActiveAssistantMessage(session);
  }
  if (!existing) {
    const latest = getLatestAssistantMessage(session);
    if (latest && assistantMessageMatchesNormalized(latest, normalized)) {
      existing = latest;
      session.runtime.activeAssistantMessageId = latest.id;
    }
  }
  if (!existing) {
    existing = ensureActiveAssistantMessage(session);
  }
  const next: PiMessageViewState & { id: string } = {
    ...existing,
    role: 'assistant',
    content: normalized.content,
    api: normalized.api ?? undefined,
    provider: normalized.provider ?? undefined,
    model: normalized.model ?? undefined,
    responseId: normalized.responseId ?? undefined,
    stopReason: normalized.stopReason ?? undefined,
    errorMessage: normalized.errorMessage ?? undefined,
    usage: normalized.usage ?? undefined,
    timestamp: asTimestamp(normalized.timestamp),
  };
  upsertRenderableMessage(session, next);
  session.status = status;
  session.isStreaming = status === 'streaming';
  session.model = normalized.provider && normalized.model
    ? {
        provider: normalized.provider,
        id: normalized.model,
        reasoning: Boolean(session.model?.reasoning),
        name: session.model?.name ?? normalized.model,
      }
    : session.model;
  return next;
};

const findLastBlockIndex = (
  blocks: PiContentBlock[],
  predicate: (block: PiContentBlock) => boolean,
): number => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (predicate(blocks[index])) {
      return index;
    }
  }
  return -1;
};

const resolveStreamContentIndex = (
  blocks: PiContentBlock[],
  stream: PiAssistantStreamEvent,
): number => {
  if (typeof stream.contentIndex === 'number' && Number.isFinite(stream.contentIndex)) {
    return stream.contentIndex;
  }

  if (stream.type === 'text_start' || stream.type === 'thinking_start' || stream.type === 'toolcall_start') {
    return blocks.length;
  }

  if (stream.type === 'text_delta' || stream.type === 'text_end') {
    const existingIndex = findLastBlockIndex(blocks, isTextBlock);
    return existingIndex >= 0 ? existingIndex : blocks.length;
  }

  if (stream.type === 'thinking_delta' || stream.type === 'thinking_end') {
    const existingIndex = findLastBlockIndex(blocks, isThinkingBlock);
    return existingIndex >= 0 ? existingIndex : blocks.length;
  }

  if (stream.type === 'toolcall_delta' || stream.type === 'toolcall_end') {
    const existingIndex = findLastBlockIndex(blocks, (block) => block.type === 'toolCall');
    return existingIndex >= 0 ? existingIndex : blocks.length;
  }

  return blocks.length;
};

const applyStreamDelta = (
  message: PiMessageViewState & { id: string },
  stream: PiAssistantStreamEvent,
): PiMessageViewState & { id: string } => {
  if (message.role !== 'assistant') {
    return message;
  }

  const nextBlocks = [...message.content];
  const contentIndex = resolveStreamContentIndex(nextBlocks, stream);
  const existingBlock = nextBlocks[contentIndex];

  if (stream.type === 'text_delta' || stream.type === 'text_start' || stream.type === 'text_end') {
    const currentText = existingBlock && isTextBlock(existingBlock) ? existingBlock.text : '';
    nextBlocks[contentIndex] = {
      type: 'text',
      text: stream.content ?? `${currentText}${stream.delta ?? ''}`,
    };
  } else if (stream.type === 'thinking_delta' || stream.type === 'thinking_start' || stream.type === 'thinking_end') {
    const currentThinking = existingBlock && isThinkingBlock(existingBlock) ? existingBlock.thinking : '';
    nextBlocks[contentIndex] = {
      type: 'thinking',
      thinking: stream.content ?? `${currentThinking}${stream.delta ?? ''}`,
      redacted: existingBlock && isThinkingBlock(existingBlock) ? existingBlock.redacted : false,
    };
  } else if ((stream.type === 'toolcall_start' || stream.type === 'toolcall_delta' || stream.type === 'toolcall_end') && stream.toolCall) {
    nextBlocks[contentIndex] = {
      ...stream.toolCall,
      type: 'toolCall',
    };
  }

  return {
    ...message,
    content: nextBlocks.filter(Boolean),
  };
};

const stableSignature = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const getPreferredIdForNormalizedMessage = (normalized: PiNormalizedMessage): string | undefined => {
  const timestamp = asTimestamp(normalized.timestamp);
  if (normalized.messageKind === 'user-message') {
    const text = normalized.content.map(toBlockText).join('\n');
    return `user-${timestamp}-${stableSignature(text)}`;
  }
  if (normalized.messageKind === 'tool-result' && normalized.toolCallId) {
    return `tool-result-${normalized.toolCallId}`;
  }
  return undefined;
};

const appendMessageIfMissing = (
  session: PiClientSessionState,
  normalized: PiNormalizedMessage,
  preferredId?: string,
) => {
  const resolvedPreferredId = preferredId || getPreferredIdForNormalizedMessage(normalized);

  if (normalized.messageKind === 'tool-result') {
    const toolCallId = normalized.toolCallId || resolvedPreferredId;
    if (toolCallId && session.messages.some((message) => message.role === 'toolResult' && message.toolCallId === toolCallId)) {
      return;
    }
  }

  const next = toRenderableMessage(session, normalized, resolvedPreferredId);
  if (!next) {
    return;
  }
  upsertRenderableMessage(session, next);
};

const applyMessageEvent = (
  session: PiClientSessionState,
  payload: Extract<PiAgentEventPayload, { channel: 'message' }>,
) => {
  if (payload.message?.messageKind === 'user-message') {
    session.runtime.activeAssistantMessageId = null;
    appendMessageIfMissing(session, payload.message);
    if (payload.phase === 'end') {
      session.status = session.lastError ? 'error' : 'idle';
      session.isStreaming = false;
    }
    return;
  }

  if (payload.message?.messageKind === 'assistant-message') {
    replaceAssistantFromNormalized(session, payload.message, payload.phase === 'end' ? 'idle' : 'streaming');
  } else if (payload.phase === 'start') {
    ensureActiveAssistantMessage(session);
    session.status = 'streaming';
    session.isStreaming = true;
  }

  if (payload.assistantStream?.partial?.messageKind === 'assistant-message') {
    replaceAssistantFromNormalized(session, payload.assistantStream.partial, 'streaming');
  } else if (payload.assistantStream) {
    const active = ensureActiveAssistantMessage(session);
    upsertRenderableMessage(session, applyStreamDelta(active, payload.assistantStream));
    session.status = 'streaming';
    session.isStreaming = true;
  }

  if (payload.phase === 'end') {
    session.runtime.activeAssistantMessageId = null;
    session.status = session.lastError ? 'error' : 'idle';
    session.isStreaming = false;
  }
};

const applyToolEvent = (
  session: PiClientSessionState,
  payload: Extract<PiAgentEventPayload, { channel: 'tool' }>,
  eventId: string,
) => {
  const toolCallId = payload.toolCallId || eventId;
  session.toolExecutions = updateToolExecution(session.toolExecutions, toolCallId, {
    toolCallId,
    toolName: payload.toolName || 'tool',
    args: payload.args ?? null,
    status: payload.phase === 'end' ? (payload.isError ? 'error' : 'completed') : 'running',
    partialResult: payload.partialResult ?? null,
    result: payload.result ?? null,
    isError: payload.isError === true,
  });

  if (payload.phase === 'end' && payload.result?.content?.length) {
    appendMessageIfMissing(session, {
      role: 'toolResult',
      messageKind: 'tool-result',
      timestamp: Date.now(),
      toolCallId,
      toolName: payload.toolName,
      content: payload.result.content,
      details: payload.result.details,
      isError: payload.isError === true,
    }, `tool-result-${toolCallId}`);
  }
};

const applyTurnEndEvent = (
  session: PiClientSessionState,
  payload: Extract<PiAgentEventPayload, { eventType: 'turn_end' }>,
) => {
  if (payload.message && payload.message.messageKind === 'assistant-message') {
    const latestAssistant = getLatestAssistantMessage(session);
    replaceAssistantFromNormalized(session, payload.message, 'idle', {
      preferredMessageId: latestAssistant?.id ?? null,
    });
    session.runtime.activeAssistantMessageId = null;
  }

  for (const toolResult of payload.toolResults) {
    appendMessageIfMissing(session, toolResult, toolResult.messageKind === 'tool-result' && toolResult.toolCallId ? `tool-result-${toolResult.toolCallId}` : undefined);
  }

  session.status = session.lastError ? 'error' : 'idle';
  session.isStreaming = false;
};

const applyAgentEndEvent = (
  session: PiClientSessionState,
  payload: Extract<PiAgentEventPayload, { eventType: 'agent_end' }>,
) => {
  for (const message of payload.messages) {
    if (message.messageKind === 'custom-message' || message.messageKind === 'bash-execution' || message.messageKind === 'branch-summary' || message.messageKind === 'compaction-summary') {
      appendMessageIfMissing(session, message);
    }
  }
  session.status = session.lastError ? 'error' : 'idle';
  session.isStreaming = false;
  session.runtime.activeAssistantMessageId = null;
};

const applyUiEvent = (session: PiClientSessionState, event: Extract<PiServerEvent, { type: 'pi_ui_event' }>) => {
  const payload = event.payload;
  switch (payload.kind) {
    case 'interactive_request':
      session.interactiveRequests = [
        ...session.interactiveRequests.filter((request) => !isSameInteractiveRequest(request, payload.request)),
        payload.request,
      ].sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'interactive_request_resolved':
      session.interactiveRequests = session.interactiveRequests.filter((request) => (
        !isSameInteractiveRequest(request, { sessionId: event.sessionId, id: payload.requestId })
      ));
      break;
    case 'status':
      session.statusEntries = upsertStatusEntry(session.statusEntries, payload.key, payload.text);
      break;
    case 'working_message':
      session.workingMessage = payload.message;
      break;
    case 'widget':
      session.widgets = upsertWidget(session.widgets, payload.key, payload.content, payload.placement, payload.bordered);
      break;
    case 'title':
      session.title = payload.title;
      break;
    case 'editor_text':
      break;
    default:
      break;
  }
};

const applySystemEvent = (session: PiClientSessionState, event: Extract<PiServerEvent, { type: 'pi_system' }>) => {
  const payload = event.payload;
  if (payload.kind === 'session_error') {
    session.lastError = payload.message;
    session.status = 'error';
    session.isStreaming = false;
    session.runtime.activeAssistantMessageId = null;
    return;
  }

  if (payload.kind === 'session_aborted') {
    session.status = 'idle';
    session.isStreaming = false;
    session.workingMessage = null;
    session.runtime.activeAssistantMessageId = null;
    return;
  }

  if (payload.kind === 'status') {
    session.status = payload.status;
    session.isStreaming = payload.status === 'streaming' || payload.status === 'retrying' || payload.status === 'compacting';
    // 只有在流真正结束时才清空 activeAssistantMessageId
    // retrying/compacting 期间流尚未真正结束，不能清空，否则后续 delta 会接到新 assistant 上
    const isStreamingFinished = payload.status === 'idle' || payload.status === 'error';
    if (isStreamingFinished) {
      session.runtime.activeAssistantMessageId = payload.status === 'error' ? session.runtime.activeAssistantMessageId : null;
    }
  }
};

const applyPiEvent = (session: PiClientSessionState, event: Extract<PiServerEvent, { type: 'pi_event' }>) => {
  const payload = event.payload;
  if (isMessagePayload(payload)) {
    applyMessageEvent(session, payload);
    return;
  }
  if (isToolPayload(payload)) {
    applyToolEvent(session, payload, event.eventId);
    return;
  }
  if (isTurnEndPayload(payload)) {
    applyTurnEndEvent(session, payload);
    return;
  }
  if (isAgentEndPayload(payload)) {
    applyAgentEndEvent(session, payload);
    return;
  }

  if (payload.eventType.endsWith('_start') || payload.eventType.endsWith('_update')) {
    session.status = 'streaming';
    session.isStreaming = true;
  }
};

const applyServerEvent = (state: PiClientState, event: PiServerEvent): PiClientState => {
  if (event.type === 'heartbeat' || event.type === 'notification') {
    return state;
  }

  const existing = state.sessions[event.sessionId];
  if (!existing) {
    return state;
  }

  // Ignore late SSE envelopes that were already captured by a fresher session snapshot.
  if (typeof event.sequence === 'number' && event.sequence <= existing.sequence) {
    return state;
  }

  if (existing.runtime.seenEventIds.has(event.eventId)) {
    return state;
  }

  const session: PiClientSessionState = {
    ...existing,
    messages: [...existing.messages],
    toolExecutions: [...existing.toolExecutions],
    interactiveRequests: [...existing.interactiveRequests],
    statusEntries: [...existing.statusEntries],
    widgets: [...existing.widgets],
    runtime: {
      ...existing.runtime,
      seenEventIds: new Set(existing.runtime.seenEventIds),
    },
  };

  session.runtime.seenEventIds.add(event.eventId);
  session.sequence = event.sequence;
  session.updatedAt = event.emittedAt;

  if (event.type === 'pi_event') {
    applyPiEvent(session, event);
  } else if (event.type === 'pi_ui_event') {
    applyUiEvent(session, event);
  } else if (event.type === 'pi_system') {
    applySystemEvent(session, event);
  }

  return {
    ...state,
    sessions: {
      ...state.sessions,
      [session.id]: session,
    },
  };
};

export const createInitialPiClientState = (): PiClientState => ({
  sessions: {},
  currentSessionId: null,
});

const shouldPreserveExistingSnapshot = (
  existing: PiClientSessionState | undefined,
  incoming: PiClientSessionState,
): boolean => {
  if (!existing) {
    return false;
  }

  const incomingHasNoMessages = incoming.messages.length === 0;
  const existingHasMessages = existing.messages.length > 0;
  if (incomingHasNoMessages && existingHasMessages) {
    return true;
  }

  return existing.sequence >= incoming.sequence;
};

export const piClientReducer = (state: PiClientState, action: PiClientAction): PiClientState => {
  switch (action.type) {
    case 'bootstrap_sessions': {
      const sessions = action.sessions.reduce<Record<string, PiClientSessionState>>((acc, snapshot) => {
        const hydrated = createSessionState(snapshot);
        const existing = state.sessions[snapshot.id];
        acc[snapshot.id] = shouldPreserveExistingSnapshot(existing, hydrated) ? existing : hydrated;
        return acc;
      }, {});

      for (const [sessionId, session] of Object.entries(state.sessions)) {
        if (!sessions[sessionId]) {
          sessions[sessionId] = session;
        }
      }

      const currentSessionId = state.currentSessionId || action.sessions[0]?.id || null;
      return { sessions, currentSessionId };
    }
    case 'upsert_session': {
      const incoming = createSessionState(action.session);
      const existing = state.sessions[incoming.id];
      const session = existing
        ? (() => {
            const preserveExisting = shouldPreserveExistingSnapshot(existing, incoming);
            const preserveLiveRuntime = preserveExisting || existing.sequence > incoming.sequence;
            return {
              ...(preserveExisting ? existing : incoming),
              ...(preserveExisting ? {
                title: incoming.title,
                cwd: incoming.cwd,
                parentID: incoming.parentID,
                createdAt: incoming.createdAt,
                model: incoming.model,
                thinkingLevel: incoming.thinkingLevel,
              } : {}),
              sequence: Math.max(existing.sequence, incoming.sequence),
              updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
              status: preserveLiveRuntime ? existing.status : incoming.status,
              isStreaming: preserveLiveRuntime ? existing.isStreaming : incoming.isStreaming,
              lastError: preserveLiveRuntime ? existing.lastError : incoming.lastError,
              toolExecutions: preserveLiveRuntime ? existing.toolExecutions : incoming.toolExecutions,
              interactiveRequests: preserveLiveRuntime ? existing.interactiveRequests : incoming.interactiveRequests,
              statusEntries: preserveLiveRuntime ? existing.statusEntries : incoming.statusEntries,
              widgets: preserveLiveRuntime ? existing.widgets : incoming.widgets,
              workingMessage: preserveLiveRuntime ? existing.workingMessage : incoming.workingMessage,
              runtime: {
                ...(preserveExisting ? existing.runtime : incoming.runtime),
                nextMessageOrdinal: Math.max(existing.runtime.nextMessageOrdinal, incoming.runtime.nextMessageOrdinal),
                activeAssistantMessageId: preserveLiveRuntime
                  ? ((existing.isStreaming || existing.status === 'streaming') ? existing.runtime.activeAssistantMessageId : null)
                  : (incoming.runtime.activeAssistantMessageId ?? (incoming.isStreaming ? existing.runtime.activeAssistantMessageId : null)),
                seenEventIds: new Set(existing.runtime.seenEventIds),
              },
            };
          })()
        : incoming;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [session.id]: session,
        },
        currentSessionId: action.select ? session.id : (state.currentSessionId || session.id),
      };
    }
    case 'set_current_session':
      return {
        ...state,
        currentSessionId: action.sessionId,
      };
    case 'append_optimistic_user_message': {
      const existing = state.sessions[action.sessionId];
      if (!existing) {
        return state;
      }
      const session: PiClientSessionState = {
        ...existing,
        messages: [...existing.messages],
        runtime: {
          ...existing.runtime,
          seenEventIds: new Set(existing.runtime.seenEventIds),
        },
      };
      session.messages.push({
        id: createMessageId(session, 'user'),
        role: 'user',
        content: action.text,
        timestamp: Date.now(),
      });
      session.updatedAt = Date.now();
      session.status = 'streaming';
      session.isStreaming = true;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [session.id]: session,
        },
      };
    }
    case 'apply_event':
      return applyServerEvent(state, action.event);
    default:
      return state;
  }
};

export const bootstrapSessionsAction = (sessions: PiSessionViewState[]): PiClientAction => ({
  type: 'bootstrap_sessions',
  sessions,
});

export const upsertSessionAction = (session: PiSessionViewState, select = false): PiClientAction => ({
  type: 'upsert_session',
  session,
  select,
});

export const setCurrentSessionAction = (sessionId: string | null): PiClientAction => ({
  type: 'set_current_session',
  sessionId,
});

export const appendOptimisticUserMessageAction = (sessionId: string, text: string): PiClientAction => ({
  type: 'append_optimistic_user_message',
  sessionId,
  text,
});

export const applyPiServerEventAction = (event: PiServerEvent): PiClientAction => ({
  type: 'apply_event',
  event,
});
