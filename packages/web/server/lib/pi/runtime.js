import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { normalizePiMessage, normalizePiRpcEnvelope } from './bridge-schema.js';

export const AGENT_RUNTIME_PI = 'pi';

const DEFAULT_AGENT_NAME = 'pi';
const DEFAULT_PROVIDER_ID = 'pi';
const DEFAULT_MODEL_ID = 'pi-default';

const normalizeNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const decodeDataUrl = (url) => {
  if (typeof url !== 'string' || !url.startsWith('data:')) {
    return null;
  }

  const commaIndex = url.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }

  const meta = url.slice(5, commaIndex);
  const body = url.slice(commaIndex + 1);
  const isBase64 = /;base64(?:;|$)/i.test(meta);
  const mime = meta.split(';')[0] || 'application/octet-stream';

  try {
    const buffer = isBase64
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'utf8');
    return { mime, buffer };
  } catch {
    return null;
  }
};

const isTextLikeMime = (mime) => typeof mime === 'string' && (
  mime.startsWith('text/')
  || mime === 'application/json'
  || mime === 'application/xml'
  || mime === 'application/javascript'
  || mime === 'application/typescript'
);

const isImageMime = (mime) => typeof mime === 'string' && mime.startsWith('image/');

const readAttachmentFromPath = (filePath) => {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return null;
  }

  try {
    const resolved = path.resolve(filePath);
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || stats.size > 256 * 1024) {
      return null;
    }
    return {
      path: resolved,
      buffer: fs.readFileSync(resolved),
    };
  } catch {
    return null;
  }
};

const readAttachmentFromFileUrl = (url) => {
  if (typeof url !== 'string' || !url.startsWith('file://')) {
    return null;
  }

  try {
    return readAttachmentFromPath(fileURLToPath(url));
  } catch {
    return null;
  }
};

const buildPromptInputFromParts = (parts) => {
  if (!Array.isArray(parts)) {
    return { message: '', images: [] };
  }

  const lines = [];
  const images = [];

  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
      lines.push(part.text.trim());
      continue;
    }

    if (part.type === 'agent' && typeof part.name === 'string' && part.name.trim().length > 0) {
      lines.push(`@${part.name.trim()}`);
      continue;
    }

    if (part.type === 'file') {
      const sourcePath = typeof part.source?.path === 'string' ? part.source.path.trim() : '';
      const filename = typeof part.filename === 'string' ? part.filename.trim() : '';
      const url = typeof part.url === 'string' ? part.url.trim() : '';
      const label = sourcePath || filename || url || 'attachment';
      const decoded = decodeDataUrl(url);
      const sourceFile = !decoded
        ? (readAttachmentFromPath(sourcePath) || readAttachmentFromFileUrl(url))
        : null;
      const effectiveMime = decoded?.mime || (typeof part.mime === 'string' ? part.mime : null);

      if (decoded && isImageMime(decoded.mime)) {
        images.push({ data: decoded.buffer.toString('base64'), mimeType: decoded.mime });
        lines.push(`[image] ${label}`);
        continue;
      }

      if (decoded && isTextLikeMime(decoded.mime)) {
        lines.push(`Attached file: ${label}\n\n<attached_file>\n${decoded.buffer.toString('utf8')}\n</attached_file>`);
        continue;
      }

      if (sourceFile && isTextLikeMime(effectiveMime || 'text/plain')) {
        lines.push(`Attached file: ${label}\n\n<attached_file>\n${sourceFile.buffer.toString('utf8')}\n</attached_file>`);
        continue;
      }

      lines.push(`[file] ${label}`);
    }
  }

  return {
    message: lines.join('\n\n').trim(),
    images,
  };
};

const buildPromptTextFromParts = (parts) => buildPromptInputFromParts(parts).message;

const flattenPiContentToText = (content) => {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') {
        return '';
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return block.thinking;
      }
      if (block.type === 'image') {
        return `[image:${block.mimeType || 'unknown'}]`;
      }
      if (block.type === 'toolCall') {
        return `[tool:${block.name || 'unknown'}]`;
      }
      return '';
    })
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n')
    .trim();
};

const createSessionModelInfo = (sessionRecord) => ({
  providerID: sessionRecord.lastModel?.providerID || DEFAULT_PROVIDER_ID,
  modelID: sessionRecord.lastModel?.modelID || DEFAULT_MODEL_ID,
});

const createSessionSummaryText = (normalizedMessage) => {
  if (normalizedMessage.role === 'custom') {
    const text = flattenPiContentToText(normalizedMessage.content);
    return text || `[custom:${normalizedMessage.customType || 'unknown'}]`;
  }

  if (normalizedMessage.role === 'bashExecution') {
    return `$ ${normalizedMessage.command}\n${normalizedMessage.output}`.trim();
  }

  if (normalizedMessage.role === 'branchSummary' || normalizedMessage.role === 'compactionSummary') {
    return normalizedMessage.summary || '';
  }

  return flattenPiContentToText(normalizedMessage.content);
};

const createOpenCodeMessageInfo = (sessionRecord, messageId, role, timestamp, extra = {}) => {
  const time = role === 'assistant'
    ? { created: timestamp, completed: timestamp }
    : { created: timestamp };

  if (role === 'user') {
    return {
      id: messageId,
      sessionID: sessionRecord.session.id,
      role: 'user',
      time,
      agent: sessionRecord.lastAgent || DEFAULT_AGENT_NAME,
      model: createSessionModelInfo(sessionRecord),
      ...extra,
    };
  }

  const model = createSessionModelInfo(sessionRecord);
  return {
    id: messageId,
    sessionID: sessionRecord.session.id,
    role: 'assistant',
    time,
    parentID: extra.parentID || sessionRecord.lastUserMessageId || '',
    modelID: model.modelID,
    providerID: model.providerID,
    mode: AGENT_RUNTIME_PI,
    agent: sessionRecord.lastAgent || DEFAULT_AGENT_NAME,
    path: {
      cwd: sessionRecord.session.directory,
      root: sessionRecord.session.directory,
    },
    cost: extra.cost ?? 0,
    tokens: extra.tokens ?? {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    finish: extra.finish,
    variant: sessionRecord.lastVariant || undefined,
    error: extra.error,
  };
};

const makeTextPart = (sessionId, messageId, partId, text, metadata) => ({
  id: partId,
  sessionID: sessionId,
  messageID: messageId,
  type: 'text',
  text,
  synthetic: true,
  ...(metadata ? { metadata } : {}),
  time: {
    start: Date.now(),
    end: Date.now(),
  },
});

const createPiSyntheticMessageId = (sessionId, normalizedMessage, index = 0) => {
  const role = normalizeNonEmptyString(normalizedMessage?.role) || 'message';
  const timestamp = typeof normalizedMessage?.timestamp === 'number' && Number.isFinite(normalizedMessage.timestamp)
    ? Math.trunc(normalizedMessage.timestamp)
    : null;
  if (timestamp !== null) {
    return `pi-${sessionId}-${role}-${timestamp}`;
  }
  return `pi-${sessionId}-${role}-${index}`;
};

const normalizeToolArgs = (value) => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
};

const normalizePiToolAlias = (toolName) => {
  const normalized = normalizeNonEmptyString(toolName)?.toLowerCase();
  if (normalized === 'subagent' || normalized === 'subagent_status') {
    return 'task';
  }
  return normalized || 'tool';
};

const createPiTaskInput = (toolName, input) => {
  const sourceInput = normalizeToolArgs(input);
  if (normalizePiToolAlias(toolName) !== 'task') {
    return sourceInput;
  }

  const agent = normalizeNonEmptyString(sourceInput.agent) || normalizeNonEmptyString(sourceInput.subagent_type);
  const task = normalizeNonEmptyString(sourceInput.task);
  const action = normalizeNonEmptyString(sourceInput.action);
  const chain = Array.isArray(sourceInput.chain) ? sourceInput.chain : [];
  const tasks = Array.isArray(sourceInput.tasks) ? sourceInput.tasks : [];

  let description = task;
  if (!description && action) {
    description = `Subagent ${action}`;
  }
  if (!description && chain.length > 0) {
    description = `Run ${chain.length} chained subagents`;
  }
  if (!description && tasks.length > 0) {
    description = `Run ${tasks.length} parallel subagents`;
  }
  if (!description && agent) {
    description = `Run ${agent}`;
  }
  if (!description) {
    description = 'Run subagent';
  }

  return {
    ...sourceInput,
    description,
    prompt: task || description,
    subagent_type: agent || (tasks.length > 0 ? 'parallel' : chain.length > 0 ? 'chain' : 'subagent'),
  };
};

const createTaskSummaryTitle = (normalizedMessage) => {
  const text = createSessionSummaryText(normalizedMessage);
  if (!text) {
    return normalizedMessage.toolName || 'Tool result';
  }
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine || normalizedMessage.toolName || 'Tool result';
};

const extractTaskSummaryEntriesFromPiMessages = (messages) => {
  const entries = [];
  const byCallId = new Map();
  const normalizedMessages = Array.isArray(messages)
    ? messages.map((message) => normalizePiMessage(message)).filter(Boolean)
    : [];

  for (const normalizedMessage of normalizedMessages) {
    if (normalizedMessage.role === 'assistant') {
      const content = Array.isArray(normalizedMessage.content) ? normalizedMessage.content : [];
      for (let index = 0; index < content.length; index += 1) {
        const block = content[index];
        if (!block || block.type !== 'toolCall') {
          continue;
        }
        const callId = block.id || `call-${entries.length}-${index}`;
        const entry = {
          id: callId,
          tool: normalizePiToolAlias(block.name),
          state: {
            status: 'pending',
            input: createPiTaskInput(block.name, block.arguments),
          },
        };
        byCallId.set(callId, entry);
        entries.push(entry);
      }
      continue;
    }

    if (normalizedMessage.role === 'toolResult') {
      const callId = normalizeNonEmptyString(normalizedMessage.toolCallId);
      const entry = callId ? byCallId.get(callId) : null;
      const nextState = {
        status: normalizedMessage.isError ? 'error' : 'completed',
        title: createTaskSummaryTitle(normalizedMessage),
        input: createPiTaskInput(normalizedMessage.toolName, entry?.state?.input),
      };

      if (entry) {
        entry.state = nextState;
        continue;
      }

      entries.push({
        id: callId || `result-${entries.length}`,
        tool: normalizePiToolAlias(normalizedMessage.toolName),
        state: nextState,
      });
    }
  }

  return entries.filter((entry) => entry.tool !== 'task');
};

const extractPiTaskMetadata = (details) => {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  const detailRecord = details;
  const results = Array.isArray(detailRecord.results) ? detailRecord.results : [];
  const summary = [];

  for (const result of results) {
    if (!result || typeof result !== 'object') {
      continue;
    }

    const resultEntries = extractTaskSummaryEntriesFromPiMessages(result.messages);
    summary.push(...resultEntries);
  }

  const sessionId = normalizeNonEmptyString(detailRecord.sessionId)
    || normalizeNonEmptyString(detailRecord.sessionID)
    || normalizeNonEmptyString(results[0]?.sessionId)
    || normalizeNonEmptyString(results[0]?.sessionID)
    || null;

  const sessionFile = normalizeNonEmptyString(results[0]?.sessionFile) || null;

  return {
    mode: normalizeNonEmptyString(detailRecord.mode),
    context: normalizeNonEmptyString(detailRecord.context),
    summary,
    sessionId,
    sessionFile,
    resultCount: results.length,
    results,
  };
};

export const translatePiMessagesToOpenCodeMessages = (sessionRecord, piMessages) => {
  const records = [];
  const toolPartsByCallId = new Map();
  const sessionId = sessionRecord.session.id;
  const baseTimestamp = Date.now();
  let lastUserMessageId = null;

  const pushAssistantSummaryMessage = (normalizedMessage, index, metadata = {}) => {
    const text = createSessionSummaryText(normalizedMessage);
    if (!text) {
      return;
    }

    const messageId = createPiSyntheticMessageId(sessionId, normalizedMessage, index);
    const info = createOpenCodeMessageInfo(
      sessionRecord,
      messageId,
      'assistant',
      normalizedMessage.timestamp ?? baseTimestamp + index,
      {
        parentID: lastUserMessageId || '',
        finish: normalizedMessage.messageKind,
      },
    );

    records.push({
      info,
      parts: [
        makeTextPart(sessionId, messageId, `${messageId}-text-0`, text, {
          pi: {
            role: normalizedMessage.role,
            messageKind: normalizedMessage.messageKind,
            ...metadata,
          },
        }),
      ],
    });
  };

  for (let index = 0; index < piMessages.length; index += 1) {
    const normalizedMessage = piMessages[index];
    if (!normalizedMessage || typeof normalizedMessage !== 'object') {
      continue;
    }

    const timestamp = normalizedMessage.timestamp ?? baseTimestamp + index;

    if (normalizedMessage.role === 'user') {
      const messageId = createPiSyntheticMessageId(sessionId, normalizedMessage, index);
      const info = createOpenCodeMessageInfo(sessionRecord, messageId, 'user', timestamp);
      const parts = [];
      const content = Array.isArray(normalizedMessage.content) ? normalizedMessage.content : [];

      for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
        const block = content[partIndex];
        if (!block || typeof block !== 'object') {
          continue;
        }
        if (block.type === 'text') {
          parts.push({
            id: `${messageId}-text-${partIndex}`,
            sessionID: sessionId,
            messageID: messageId,
            type: 'text',
            text: typeof block.text === 'string' ? block.text : '',
            time: {
              start: timestamp,
              end: timestamp,
            },
          });
        }
      }

      records.push({ info, parts });
      lastUserMessageId = messageId;
      continue;
    }

    if (normalizedMessage.role === 'assistant') {
      const usage = normalizedMessage.usage;
      const messageId = createPiSyntheticMessageId(sessionId, normalizedMessage, index);
      const info = createOpenCodeMessageInfo(sessionRecord, messageId, 'assistant', timestamp, {
        parentID: lastUserMessageId || '',
        finish: normalizedMessage.stopReason || undefined,
        cost: usage?.cost?.total ?? 0,
        tokens: {
          total: usage?.totalTokens ?? undefined,
          input: usage?.input ?? 0,
          output: usage?.output ?? 0,
          reasoning: 0,
          cache: {
            read: usage?.cacheRead ?? 0,
            write: usage?.cacheWrite ?? 0,
          },
        },
      });
      const parts = [];
      const content = Array.isArray(normalizedMessage.content) ? normalizedMessage.content : [];

      for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
        const block = content[partIndex];
        if (!block || typeof block !== 'object') {
          continue;
        }

        if (block.type === 'text') {
          parts.push({
            id: `${messageId}-text-${partIndex}`,
            sessionID: sessionId,
            messageID: messageId,
            type: 'text',
            text: typeof block.text === 'string' ? block.text : '',
            time: {
              start: timestamp,
              end: timestamp,
            },
          });
          continue;
        }

        if (block.type === 'thinking') {
          parts.push({
            id: `${messageId}-reasoning-${partIndex}`,
            sessionID: sessionId,
            messageID: messageId,
            type: 'reasoning',
            text: typeof block.thinking === 'string' ? block.thinking : '',
            metadata: {
              pi: {
                redacted: block.redacted === true,
                thinkingSignature: block.thinkingSignature || null,
              },
            },
            time: {
              start: timestamp,
              end: timestamp,
            },
          });
          continue;
        }

        if (block.type === 'toolCall') {
          const toolName = block.name || 'tool';
          const mappedToolName = normalizePiToolAlias(toolName);
          const mappedInput = createPiTaskInput(toolName, block.arguments);
          const part = {
            id: `${messageId}-tool-${partIndex}`,
            sessionID: sessionId,
            messageID: messageId,
            type: 'tool',
            callID: block.id || `${messageId}-call-${partIndex}`,
            tool: mappedToolName,
            state: {
              status: 'pending',
              input: mappedInput,
              raw: JSON.stringify(block.arguments || {}),
            },
            metadata: {
              pi: {
                sourceTool: toolName,
                sourceInput: normalizeToolArgs(block.arguments),
                thoughtSignature: block.thoughtSignature || null,
              },
            },
          };
          toolPartsByCallId.set(part.callID, part);
          parts.push(part);
        }
      }

      if (parts.length === 0 && typeof normalizedMessage.errorMessage === 'string' && normalizedMessage.errorMessage.trim().length > 0) {
        parts.push(makeTextPart(sessionId, messageId, `${messageId}-text-empty`, normalizedMessage.errorMessage.trim()));
      }

      records.push({ info, parts });
      continue;
    }

    if (normalizedMessage.role === 'toolResult') {
      const callId = normalizeNonEmptyString(normalizedMessage.toolCallId);
      const linkedPart = callId ? toolPartsByCallId.get(callId) : null;
      const sourceToolName = linkedPart?.metadata?.pi?.sourceTool || normalizedMessage.toolName || linkedPart?.tool || 'tool';
      const mappedToolName = normalizePiToolAlias(sourceToolName);
      const output = createSessionSummaryText(normalizedMessage);
      const taskMetadata = extractPiTaskMetadata(normalizedMessage.details);
      const metadata = {
        ...(taskMetadata?.summary?.length ? { summary: taskMetadata.summary } : {}),
        ...(taskMetadata?.sessionId ? { sessionId: taskMetadata.sessionId } : {}),
        ...(taskMetadata?.sessionFile ? { sessionFile: taskMetadata.sessionFile } : {}),
        pi: {
          role: normalizedMessage.role,
          sourceTool: sourceToolName,
          details: normalizedMessage.details ?? null,
          task: taskMetadata,
        },
      };

      if (linkedPart) {
        linkedPart.tool = mappedToolName;
        linkedPart.state = normalizedMessage.isError
          ? {
              status: 'error',
              input: createPiTaskInput(sourceToolName, linkedPart.state.input || {}),
              error: output || 'Pi tool execution failed',
              metadata,
              time: {
                start: timestamp,
                end: timestamp,
              },
            }
          : {
              status: 'completed',
              input: createPiTaskInput(sourceToolName, linkedPart.state.input || {}),
              output,
              title: mappedToolName === 'task' ? 'Agent Task' : linkedPart.tool,
              metadata,
              time: {
                start: timestamp,
                end: timestamp,
              },
            };
        continue;
      }

      const syntheticMessageId = createPiSyntheticMessageId(sessionId, normalizedMessage, index);
      records.push({
        info: createOpenCodeMessageInfo(sessionRecord, syntheticMessageId, 'assistant', timestamp, {
          parentID: lastUserMessageId || '',
          finish: normalizedMessage.isError ? 'error' : 'tool',
        }),
        parts: [{
          id: `${syntheticMessageId}-tool-0`,
          sessionID: sessionId,
          messageID: syntheticMessageId,
          type: 'tool',
          callID: callId || `${syntheticMessageId}-call-0`,
          tool: mappedToolName,
          state: normalizedMessage.isError
            ? {
                status: 'error',
                input: createPiTaskInput(sourceToolName, {}),
                error: output || 'Pi tool execution failed',
                metadata,
                time: {
                  start: timestamp,
                  end: timestamp,
                },
              }
            : {
                status: 'completed',
                input: createPiTaskInput(sourceToolName, {}),
                output,
                title: mappedToolName === 'task' ? 'Agent Task' : sourceToolName,
                metadata,
                time: {
                  start: timestamp,
                  end: timestamp,
                },
              },
        }],
      });
      continue;
    }

    if (normalizedMessage.role === 'custom') {
      pushAssistantSummaryMessage(normalizedMessage, index, {
        customType: normalizedMessage.customType || null,
        details: normalizedMessage.details ?? null,
        payload: normalizedMessage.payload ?? null,
        display: normalizedMessage.display !== false,
      });
      continue;
    }

    if (normalizedMessage.role === 'bashExecution') {
      pushAssistantSummaryMessage(normalizedMessage, index, {
        command: normalizedMessage.command,
        exitCode: normalizedMessage.exitCode,
        truncated: normalizedMessage.truncated === true,
      });
      continue;
    }

    if (normalizedMessage.role === 'branchSummary' || normalizedMessage.role === 'compactionSummary') {
      pushAssistantSummaryMessage(normalizedMessage, index, {});
      continue;
    }
  }

  return records;
};

export const translateOpenCodeMessagesToSseEvents = (sessionRecord, messageRecords, options = {}) => {
  const directory = options.directory || sessionRecord?.session?.directory || null;
  const status = options.status || null;
  const events = [];

  if (status && sessionRecord?.session?.id) {
    events.push({
      type: 'session.status',
      properties: {
        sessionID: sessionRecord.session.id,
        status,
        ...(directory ? { directory } : {}),
      },
    });
  }

  const records = Array.isArray(messageRecords) ? messageRecords : [];
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const info = record.info;
    const parts = Array.isArray(record.parts) ? record.parts : [];
    if (!info || typeof info !== 'object') {
      continue;
    }

    events.push({
      type: 'message.updated',
      properties: {
        info,
        parts,
        ...(directory ? { directory } : {}),
      },
    });

    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      events.push({
        type: 'message.part.updated',
        properties: {
          info,
          part,
          ...(directory ? { directory } : {}),
        },
      });
    }
  }

  return events;
};

export const translatePiEnvelopeToSseEvents = (sessionRecord, envelope, options = {}) => {
  const directory = options.directory || sessionRecord?.session?.directory || null;
  const events = [];

  if (!envelope || envelope.envelope !== 'agent-event') {
    return events;
  }

  if (envelope.eventType === 'message_update') {
    const partialMessage = envelope.assistantStream?.partial || envelope.message;
    if (partialMessage) {
      const records = translatePiMessagesToOpenCodeMessages(sessionRecord, [partialMessage]);
      return translateOpenCodeMessagesToSseEvents(sessionRecord, records, { directory, status: null });
    }
  }

  if (envelope.eventType === 'message_start') {
    const partialMessage = envelope.message;
    if (partialMessage) {
      const records = translatePiMessagesToOpenCodeMessages(sessionRecord, [partialMessage]);
      return translateOpenCodeMessagesToSseEvents(sessionRecord, records, { directory, status: null });
    }
  }

  return events;
};

const projectQuestionOptions = (options) => {
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

    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label) {
      return [];
    }

    const description = typeof option.description === 'string' ? option.description : undefined;
    return [{ label, ...(description ? { description } : {}) }];
  });
};

const questionAllowsCustom = (input) => {
  if (!input || typeof input !== 'object') {
    return false;
  }
  if (projectQuestionOptions(input.options).length === 0) {
    return true;
  }
  return input.allowCustom === true;
};

const projectRequestQuestions = (request) => {
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
    question: request.message || request.title || 'Provide a response',
    options: [],
    multiple: false,
    allowCustom: true,
  }];
};

export const mapPiUiRequestToQuestionRequest = (sessionRecord, request) => {
  if (!request || typeof request !== 'object' || request.method !== 'question') {
    return null;
  }

  return {
    id: request.id,
    sessionID: sessionRecord.session.id,
    questions: projectRequestQuestions(request),
    metadata: {
      bridgeKind: request.bridgeKind || 'question',
      webSupport: request.webSupport || 'supported',
    },
  };
};

export { buildPromptTextFromParts };

