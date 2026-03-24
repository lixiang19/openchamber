const PI_AGENT_EVENT_TYPES = Object.freeze([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
]);

const PI_ASSISTANT_STREAM_EVENT_TYPES = Object.freeze([
  'start',
  'text_start',
  'text_delta',
  'text_end',
  'thinking_start',
  'thinking_delta',
  'thinking_end',
  'toolcall_start',
  'toolcall_delta',
  'toolcall_end',
  'done',
  'error',
]);

const PI_MESSAGE_ROLE_CATALOG = Object.freeze({
  core: Object.freeze(['user', 'assistant', 'toolResult']),
  custom: Object.freeze(['custom', 'bashExecution', 'branchSummary', 'compactionSummary']),
});

const PI_EXTENSION_UI_REQUEST_CATALOG = Object.freeze({
  input: Object.freeze({
    bridgeKind: 'question',
    expectedReply: 'value',
    webSupport: 'priority',
    milestone: 'm3',
  }),
  select: Object.freeze({
    bridgeKind: 'question',
    expectedReply: 'value',
    webSupport: 'priority',
    milestone: 'm3',
  }),
  confirm: Object.freeze({
    bridgeKind: 'question',
    expectedReply: 'confirmed',
    webSupport: 'priority',
    milestone: 'm3',
  }),
  editor: Object.freeze({
    bridgeKind: 'editor',
    expectedReply: 'value',
    webSupport: 'deferred',
    milestone: null,
  }),
  notify: Object.freeze({
    bridgeKind: 'notification',
    expectedReply: 'none',
    webSupport: 'passive',
    milestone: 'm2',
  }),
  setStatus: Object.freeze({
    bridgeKind: 'status',
    expectedReply: 'none',
    webSupport: 'deferred',
    milestone: 'm3',
  }),
  setWidget: Object.freeze({
    bridgeKind: 'widget',
    expectedReply: 'none',
    webSupport: 'deferred',
    milestone: 'm3',
  }),
  setTitle: Object.freeze({
    bridgeKind: 'title',
    expectedReply: 'none',
    webSupport: 'unsupported',
    milestone: null,
  }),
  set_editor_text: Object.freeze({
    bridgeKind: 'editor-text',
    expectedReply: 'none',
    webSupport: 'unsupported',
    milestone: null,
  }),
});

export const PI_BRIDGE_EVENT_CATALOG = Object.freeze({
  rpc: Object.freeze({
    commandResponse: 'response',
    agentEvents: PI_AGENT_EVENT_TYPES,
    assistantStreamEvents: PI_ASSISTANT_STREAM_EVENT_TYPES,
    extensionUiRequests: Object.freeze(Object.keys(PI_EXTENSION_UI_REQUEST_CATALOG)),
  }),
  messages: PI_MESSAGE_ROLE_CATALOG,
  extensionUi: PI_EXTENSION_UI_REQUEST_CATALOG,
});

const PI_AGENT_EVENT_TYPE_SET = new Set(PI_AGENT_EVENT_TYPES);

const normalizeNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeNumber = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const normalizeObject = (value) => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNonEmptyString(entry))
    .filter(Boolean);
};

const normalizePiContentBlock = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const type = normalizeNonEmptyString(record.type);
  if (!type) {
    return null;
  }

  if (type === 'text') {
    return {
      type,
      text: typeof record.text === 'string' ? record.text : '',
      textSignature: normalizeNonEmptyString(record.textSignature),
    };
  }

  if (type === 'thinking') {
    return {
      type,
      thinking: typeof record.thinking === 'string' ? record.thinking : '',
      thinkingSignature: normalizeNonEmptyString(record.thinkingSignature),
      redacted: record.redacted === true,
    };
  }

  if (type === 'image') {
    return {
      type,
      data: typeof record.data === 'string' ? record.data : '',
      mimeType: normalizeNonEmptyString(record.mimeType),
    };
  }

  if (type === 'toolCall') {
    return {
      type,
      id: normalizeNonEmptyString(record.id),
      name: normalizeNonEmptyString(record.name),
      arguments: normalizeObject(record.arguments),
      thoughtSignature: normalizeNonEmptyString(record.thoughtSignature),
    };
  }

  return {
    type,
    raw: record,
  };
};

const normalizePiContent = (value) => {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value, textSignature: null }];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizePiContentBlock(entry))
    .filter(Boolean);
};

const normalizePiUsage = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const cost = normalizeObject(record.cost);

  return {
    input: normalizeNumber(record.input),
    output: normalizeNumber(record.output),
    cacheRead: normalizeNumber(record.cacheRead),
    cacheWrite: normalizeNumber(record.cacheWrite),
    totalTokens: normalizeNumber(record.totalTokens),
    cost: cost
      ? {
          input: normalizeNumber(cost.input),
          output: normalizeNumber(cost.output),
          cacheRead: normalizeNumber(cost.cacheRead),
          cacheWrite: normalizeNumber(cost.cacheWrite),
          total: normalizeNumber(cost.total),
        }
      : null,
  };
};

export const normalizePiMessage = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const role = normalizeNonEmptyString(record.role);
  if (!role) {
    return null;
  }

  const timestamp = normalizeNumber(record.timestamp);

  if (role === 'user') {
    return {
      role,
      messageKind: 'user-message',
      timestamp,
      content: normalizePiContent(record.content),
    };
  }

  if (role === 'assistant') {
    return {
      role,
      messageKind: 'assistant-message',
      timestamp,
      content: normalizePiContent(record.content),
      api: normalizeNonEmptyString(record.api),
      provider: normalizeNonEmptyString(record.provider),
      model: normalizeNonEmptyString(record.model),
      responseId: normalizeNonEmptyString(record.responseId),
      stopReason: normalizeNonEmptyString(record.stopReason),
      errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : null,
      usage: normalizePiUsage(record.usage),
    };
  }

  if (role === 'toolResult') {
    return {
      role,
      messageKind: 'tool-result',
      timestamp,
      toolCallId: normalizeNonEmptyString(record.toolCallId),
      toolName: normalizeNonEmptyString(record.toolName),
      content: normalizePiContent(record.content),
      details: normalizeObject(record.details) ?? record.details ?? null,
      isError: record.isError === true,
    };
  }

  if (role === 'custom') {
    return {
      role,
      messageKind: 'custom-message',
      timestamp,
      customType: normalizeNonEmptyString(record.customType),
      content: normalizePiContent(record.content),
      display: record.display !== false,
      details: normalizeObject(record.details) ?? record.details ?? null,
      payload: normalizeObject(record.payload) ?? record.payload ?? null,
    };
  }

  if (role === 'bashExecution') {
    return {
      role,
      messageKind: 'bash-execution',
      timestamp,
      command: typeof record.command === 'string' ? record.command : '',
      output: typeof record.output === 'string' ? record.output : '',
      exitCode: normalizeNumber(record.exitCode),
      cancelled: record.cancelled === true,
      truncated: record.truncated === true,
      fullOutputPath: normalizeNonEmptyString(record.fullOutputPath),
      excludeFromContext: record.excludeFromContext === true,
    };
  }

  if (role === 'branchSummary') {
    return {
      role,
      messageKind: 'branch-summary',
      timestamp,
      summary: typeof record.summary === 'string' ? record.summary : '',
      fromId: normalizeNonEmptyString(record.fromId),
    };
  }

  if (role === 'compactionSummary') {
    return {
      role,
      messageKind: 'compaction-summary',
      timestamp,
      summary: typeof record.summary === 'string' ? record.summary : '',
      tokensBefore: normalizeNumber(record.tokensBefore),
    };
  }

  return {
    role,
    messageKind: 'unknown-message',
    timestamp,
    raw: record,
  };
};

const normalizePiAssistantStreamEvent = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const type = normalizeNonEmptyString(record.type);
  if (!type) {
    return null;
  }

  if (!PI_ASSISTANT_STREAM_EVENT_TYPES.includes(type)) {
    return {
      type,
      raw: record,
    };
  }

  return {
    type,
    contentIndex: normalizeNumber(record.contentIndex),
    delta: typeof record.delta === 'string' ? record.delta : null,
    content: typeof record.content === 'string' ? record.content : null,
    reason: normalizeNonEmptyString(record.reason),
    toolCall: normalizePiContentBlock(record.toolCall),
    partial: normalizePiMessage(record.partial),
    message: normalizePiMessage(record.message),
    error: normalizePiMessage(record.error),
  };
};

const normalizePiToolExecutionPayload = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  return {
    content: normalizePiContent(record.content),
    details: normalizeObject(record.details) ?? record.details ?? null,
  };
};

export const normalizePiExtensionUiRequest = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const id = normalizeNonEmptyString(record.id);
  const method = normalizeNonEmptyString(record.method);
  if (!id || !method) {
    return null;
  }

  const base = PI_EXTENSION_UI_REQUEST_CATALOG[method] ?? {
    bridgeKind: 'unsupported',
    expectedReply: 'none',
    webSupport: 'unsupported',
    milestone: null,
  };

  const normalized = {
    id,
    method,
    bridgeKind: base.bridgeKind,
    expectedReply: base.expectedReply,
    webSupport: base.webSupport,
    milestone: base.milestone,
  };

  if (method === 'input') {
    return {
      ...normalized,
      title: typeof record.title === 'string' ? record.title : '',
      placeholder: normalizeNonEmptyString(record.placeholder),
      timeout: normalizeNumber(record.timeout),
    };
  }

  if (method === 'select') {
    return {
      ...normalized,
      title: typeof record.title === 'string' ? record.title : '',
      options: normalizeStringArray(record.options),
      timeout: normalizeNumber(record.timeout),
    };
  }

  if (method === 'confirm') {
    return {
      ...normalized,
      title: typeof record.title === 'string' ? record.title : '',
      message: typeof record.message === 'string' ? record.message : '',
      timeout: normalizeNumber(record.timeout),
    };
  }

  if (method === 'editor') {
    return {
      ...normalized,
      title: typeof record.title === 'string' ? record.title : '',
      prefill: typeof record.prefill === 'string' ? record.prefill : '',
    };
  }

  if (method === 'notify') {
    return {
      ...normalized,
      message: typeof record.message === 'string' ? record.message : '',
      notifyType: normalizeNonEmptyString(record.notifyType) ?? 'info',
    };
  }

  if (method === 'setStatus') {
    return {
      ...normalized,
      statusKey: typeof record.statusKey === 'string' ? record.statusKey : '',
      statusText: typeof record.statusText === 'string' ? record.statusText : null,
    };
  }

  if (method === 'setWidget') {
    return {
      ...normalized,
      widgetKey: typeof record.widgetKey === 'string' ? record.widgetKey : '',
      widgetLines: normalizeStringArray(record.widgetLines),
      widgetPlacement: normalizeNonEmptyString(record.widgetPlacement),
    };
  }

  if (method === 'setTitle') {
    return {
      ...normalized,
      title: typeof record.title === 'string' ? record.title : '',
    };
  }

  if (method === 'set_editor_text') {
    return {
      ...normalized,
      text: typeof record.text === 'string' ? record.text : '',
    };
  }

  return {
    ...normalized,
    raw: record,
  };
};

const normalizePiCommandResponse = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  return {
    source: 'pi',
    envelope: 'command-response',
    eventType: 'response',
    id: normalizeNonEmptyString(record.id),
    command: normalizeNonEmptyString(record.command),
    success: record.success === true,
    data: record.data ?? null,
    error: typeof record.error === 'string' ? record.error : null,
  };
};

export const normalizePiRpcEnvelope = (value) => {
  const record = normalizeObject(value);
  if (!record) {
    return null;
  }

  const type = normalizeNonEmptyString(record.type);
  if (!type) {
    return null;
  }

  if (type === 'response') {
    return normalizePiCommandResponse(record);
  }

  if (type === 'extension_ui_request') {
    return {
      source: 'pi',
      envelope: 'extension-ui-request',
      eventType: type,
      request: normalizePiExtensionUiRequest(record),
    };
  }

  if (!PI_AGENT_EVENT_TYPE_SET.has(type)) {
    return {
      source: 'pi',
      envelope: 'unknown',
      eventType: type,
      raw: record,
    };
  }

  if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
    return {
      source: 'pi',
      envelope: 'agent-event',
      eventType: type,
      channel: 'message',
      phase: type.replace('message_', ''),
      message: normalizePiMessage(record.message),
      assistantStream: type === 'message_update'
        ? normalizePiAssistantStreamEvent(record.assistantMessageEvent)
        : null,
    };
  }

  if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
    return {
      source: 'pi',
      envelope: 'agent-event',
      eventType: type,
      channel: 'tool',
      phase: type.replace('tool_execution_', ''),
      toolCallId: normalizeNonEmptyString(record.toolCallId),
      toolName: normalizeNonEmptyString(record.toolName),
      args: normalizeObject(record.args),
      partialResult: type === 'tool_execution_update'
        ? normalizePiToolExecutionPayload(record.partialResult)
        : null,
      result: type === 'tool_execution_end'
        ? normalizePiToolExecutionPayload(record.result)
        : null,
      isError: typeof record.isError === 'boolean' ? record.isError : null,
    };
  }

  if (type === 'turn_end') {
    return {
      source: 'pi',
      envelope: 'agent-event',
      eventType: type,
      channel: 'turn',
      phase: 'end',
      message: normalizePiMessage(record.message),
      toolResults: Array.isArray(record.toolResults)
        ? record.toolResults.map((item) => normalizePiMessage(item)).filter(Boolean)
        : [],
    };
  }

  if (type === 'agent_end') {
    return {
      source: 'pi',
      envelope: 'agent-event',
      eventType: type,
      channel: 'agent',
      phase: 'end',
      messages: Array.isArray(record.messages)
        ? record.messages.map((item) => normalizePiMessage(item)).filter(Boolean)
        : [],
    };
  }

  return {
    source: 'pi',
    envelope: 'agent-event',
    eventType: type,
    channel: type.startsWith('turn_') ? 'turn' : 'agent',
    phase: type.endsWith('_start') ? 'start' : 'end',
  };
};
