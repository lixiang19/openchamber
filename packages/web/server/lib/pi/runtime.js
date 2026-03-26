import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { normalizePiMessage, normalizePiRpcEnvelope } from './bridge-schema.js';

export const AGENT_RUNTIME_OPENCODE = 'opencode';
export const AGENT_RUNTIME_PI = 'pi';

const DEFAULT_PI_BIN = 'pi';
const DEFAULT_PI_ARGS = ['--mode', 'rpc'];
const PROCESS_START_TIMEOUT_MS = 10_000;
const RPC_COMMAND_TIMEOUT_MS = 30_000;
const MAX_EVENT_LOG = 500;
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

const normalizeDirectory = (value) => {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return process.cwd();
  }
  return path.resolve(normalized);
};

const slugify = (value, fallback) => {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return fallback;
  }
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
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

export const mapPiUiRequestToQuestionRequest = (sessionRecord, request) => {
  if (!request || typeof request !== 'object') {
    return null;
  }

  const base = {
    id: request.id,
    sessionID: sessionRecord.session.id,
  };

  if (request.method === 'question') {
    return {
      ...base,
      questions: Array.isArray(request.questions) ? request.questions : [{
        header: request.title || 'Input needed',
        question: request.message || request.title || 'Provide a response',
        options: Array.isArray(request.options) ? request.options.map(o => ({ label: o, description: '' })) : [],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'question',
        bridgeKind: request.bridgeKind || 'question',
        webSupport: request.webSupport || 'supported',
      },
    };
  }

  if (request.method === 'input') {
    return {
      ...base,
      questions: [{
        header: request.title || 'Input needed',
        question: request.placeholder || request.title || 'Provide a response',
        options: [],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'input',
        bridgeKind: request.bridgeKind,
        webSupport: request.webSupport,
      },
    };
  }

  if (request.method === 'select') {
    return {
      ...base,
      questions: [{
        header: request.title || 'Select an option',
        question: request.title || 'Select an option',
        options: Array.isArray(request.options)
          ? request.options.map((option) => ({ label: option, description: '' }))
          : [],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'select',
        bridgeKind: request.bridgeKind,
        webSupport: request.webSupport,
      },
    };
  }

  if (request.method === 'confirm') {
    return {
      ...base,
      questions: [{
        header: request.title || 'Confirmation needed',
        question: request.message || request.title || 'Confirm to continue',
        options: [{ label: 'Confirm', description: '' }],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'confirm',
        bridgeKind: request.bridgeKind,
        webSupport: request.webSupport,
      },
    };
  }

  if (request.method === 'editor') {
    return {
      ...base,
      questions: [{
        header: 'Unsupported Pi UI request',
        question: `${request.title || 'Editor input'} is not supported in Web yet. Submit or dismiss to cancel this request explicitly.`,
        options: [{ label: 'Dismiss request', description: 'Send a cancel response back to Pi' }],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'editor',
        bridgeKind: request.bridgeKind,
        webSupport: 'unsupported',
        downgrade: true,
      },
    };
  }

  return null;
};

const createSessionRecord = (session) => ({
  session,
  process: null,
  processStartPromise: null,
  processReady: false,
  stdoutBuffer: '',
  stderrBuffer: '',
  pendingRequests: new Map(),
  pendingUiRequests: new Map(),
  nextRequestId: 0,
  commandQueue: Promise.resolve(),
  lastModel: null,
  lastAgent: DEFAULT_AGENT_NAME,
  lastVariant: null,
  messages: [],
  rawMessages: [],
  status: { type: 'idle' },
  eventLog: [],
  subscribers: new Set(),
  lastUserMessageId: null,
});

const rejectPendingRequests = (sessionRecord, error) => {
  for (const pending of sessionRecord.pendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  sessionRecord.pendingRequests.clear();
};

export const resolveAgentRuntimeMode = (value) => {
  const normalized = normalizeNonEmptyString(value)?.toLowerCase();
  return normalized === AGENT_RUNTIME_PI ? AGENT_RUNTIME_PI : AGENT_RUNTIME_OPENCODE;
};

export const createPiRuntime = (options = {}) => {
  const cliPath = normalizeNonEmptyString(options.cliPath) || process.env.OPENAURORA_PI_BIN || process.env.PI_CLI_BIN || DEFAULT_PI_BIN;
  const cliArgs = Array.isArray(options.cliArgs) && options.cliArgs.length > 0 ? options.cliArgs : DEFAULT_PI_ARGS;
  const sessions = new Map();
  const globalSubscribers = new Set();
  const questionRequestIndex = new Map();

  const emitEnvelope = (sessionRecord, envelope) => {
    if (!envelope) {
      return;
    }

    sessionRecord.eventLog.push({
      at: Date.now(),
      envelope,
    });
    if (sessionRecord.eventLog.length > MAX_EVENT_LOG) {
      sessionRecord.eventLog.splice(0, sessionRecord.eventLog.length - MAX_EVENT_LOG);
    }

    for (const listener of globalSubscribers) {
      listener({ session: sessionRecord.session, envelope });
    }
    for (const listener of sessionRecord.subscribers) {
      listener(envelope);
    }
  };

  const queueCommand = async (sessionRecord, executor) => {
    const previous = sessionRecord.commandQueue.catch(() => undefined);
    const current = previous.then(executor);
    sessionRecord.commandQueue = current.then(() => undefined, () => undefined);
    return current;
  };

  const handleRpcLine = (sessionRecord, line) => {
    if (!line) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload && payload.type === 'response' && typeof payload.id === 'string' && sessionRecord.pendingRequests.has(payload.id)) {
      const pending = sessionRecord.pendingRequests.get(payload.id);
      sessionRecord.pendingRequests.delete(payload.id);
      clearTimeout(pending.timeout);
      pending.resolve(payload);
      return;
    }

    const normalized = normalizePiRpcEnvelope(payload);

    if (normalized?.envelope === 'extension-ui-request' && normalized.request?.id) {
      sessionRecord.pendingUiRequests.set(normalized.request.id, normalized.request);
      const questionRequest = mapPiUiRequestToQuestionRequest(sessionRecord, normalized.request);
      if (questionRequest) {
        questionRequestIndex.set(normalized.request.id, {
          sessionId: sessionRecord.session.id,
          request: normalized.request,
          question: questionRequest,
        });
      }
    }

    emitEnvelope(sessionRecord, normalized);

    if (normalized?.envelope === 'agent-event') {
      if (normalized.eventType === 'agent_start') {
        sessionRecord.status = { type: 'busy' };
      }
      if (normalized.eventType === 'agent_end') {
        sessionRecord.status = { type: 'idle' };
        void refreshMessages(sessionRecord.session.id).catch(() => {});
      }
    }
  };

  const attachProcess = (sessionRecord, child) => {
    child.stdout.on('data', (chunk) => {
      sessionRecord.stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      let newlineIndex = sessionRecord.stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = sessionRecord.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
        sessionRecord.stdoutBuffer = sessionRecord.stdoutBuffer.slice(newlineIndex + 1);
        handleRpcLine(sessionRecord, line.trim());
        newlineIndex = sessionRecord.stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk) => {
      sessionRecord.stderrBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    });

    child.once('exit', (code, signal) => {
      sessionRecord.process = null;
      sessionRecord.processReady = false;
      sessionRecord.processStartPromise = null;
      sessionRecord.status = { type: 'idle' };
      for (const requestId of sessionRecord.pendingUiRequests.keys()) {
        questionRequestIndex.delete(requestId);
      }
      sessionRecord.pendingUiRequests.clear();
      rejectPendingRequests(
        sessionRecord,
        new Error(`Pi RPC process exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`),
      );
    });
  };

  const ensureProcess = async (sessionRecord) => {
    if (sessionRecord.process && sessionRecord.processReady) {
      return sessionRecord.process;
    }

    if (sessionRecord.processStartPromise) {
      return sessionRecord.processStartPromise;
    }

    sessionRecord.processStartPromise = new Promise((resolve, reject) => {
      const child = spawn(cliPath, cliArgs, {
        cwd: sessionRecord.session.directory,
        env: {
          ...process.env,
          ...(options.env && typeof options.env === 'object' ? options.env : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        reject(new Error(`Timed out starting Pi RPC process (${cliPath})`));
      }, PROCESS_START_TIMEOUT_MS);

      child.once('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        sessionRecord.process = null;
        sessionRecord.processReady = false;
        sessionRecord.processStartPromise = null;
        reject(new Error(`Failed to start Pi runtime (${cliPath}): ${error.message}`));
      });

      child.once('spawn', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        sessionRecord.process = child;
        sessionRecord.processReady = true;
        attachProcess(sessionRecord, child);
        resolve(child);
      });
    }).finally(() => {
      sessionRecord.processStartPromise = null;
    });

    return sessionRecord.processStartPromise;
  };

  const writeRpcPayload = async (sessionRecord, payload) => {
    const child = await ensureProcess(sessionRecord);
    if (!child.stdin) {
      throw new Error('Pi runtime stdin is unavailable');
    }
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const sendCommand = async (sessionRecord, command) => {
    const id = `pi-${sessionRecord.session.id}-${++sessionRecord.nextRequestId}`;
    const payload = { ...command, id };

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        sessionRecord.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Pi RPC response to ${command.type}`));
      }, RPC_COMMAND_TIMEOUT_MS);

      sessionRecord.pendingRequests.set(id, { resolve, reject, timeout });
      try {
        await writeRpcPayload(sessionRecord, payload);
      } catch (error) {
        clearTimeout(timeout);
        sessionRecord.pendingRequests.delete(id);
        reject(error);
      }
    }).then((response) => {
      if (!response || response.success !== true) {
        const message = response && typeof response.error === 'string'
          ? response.error
          : `Pi RPC command failed: ${command.type}`;
        throw new Error(message);
      }
      return response;
    });
  };

  const refreshMessages = async (sessionId) => {
    const sessionRecord = sessions.get(sessionId);
    if (!sessionRecord) {
      throw new Error(`Unknown Pi session: ${sessionId}`);
    }

    return queueCommand(sessionRecord, async () => {
      const response = await sendCommand(sessionRecord, { type: 'get_messages' });
      const piMessages = Array.isArray(response?.data?.messages) ? response.data.messages : [];
      const normalizedMessages = piMessages
        .map((message) => normalizePiMessage(message))
        .filter(Boolean);
      sessionRecord.rawMessages = piMessages.slice();
      sessionRecord.messages = translatePiMessagesToOpenCodeMessages(sessionRecord, normalizedMessages);
      sessionRecord.lastUserMessageId = sessionRecord.messages
        .filter((entry) => entry.info.role === 'user')
        .map((entry) => entry.info.id)
        .pop() || sessionRecord.lastUserMessageId;
      sessionRecord.session.time.updated = Date.now();
      return sessionRecord.messages;
    });
  };

  const getSessionRecord = (sessionId) => {
    const sessionRecord = sessions.get(sessionId);
    if (!sessionRecord) {
      throw new Error(`Unknown Pi session: ${sessionId}`);
    }
    return sessionRecord;
  };

  const createSession = ({ directory, title, parentID } = {}) => {
    const createdAt = Date.now();
    const id = `pi-${crypto.randomUUID()}`;
    const normalizedDirectory = normalizeDirectory(directory);
    const session = {
      id,
      slug: slugify(title, id),
      projectID: AGENT_RUNTIME_PI,
      directory: normalizedDirectory,
      parentID: normalizeNonEmptyString(parentID) || undefined,
      title: normalizeNonEmptyString(title) || 'New session',
      version: 'pi-runtime-bridge',
      time: {
        created: createdAt,
        updated: createdAt,
      },
    };

    sessions.set(id, createSessionRecord(session));
    return session;
  };

  const listSessions = ({ directory, limit, search } = {}) => {
    const requestedDirectory = normalizeNonEmptyString(directory);
    const requestedSearch = normalizeNonEmptyString(search)?.toLowerCase() || null;

    const filtered = Array.from(sessions.values())
      .map((entry) => entry.session)
      .filter((session) => {
        if (requestedDirectory) {
          const exact = session.directory === requestedDirectory;
          const prefix = session.directory.startsWith(`${requestedDirectory}${path.sep}`);
          if (!exact && !prefix) {
            return false;
          }
        }

        if (requestedSearch) {
          const haystack = `${session.title} ${session.id}`.toLowerCase();
          if (!haystack.includes(requestedSearch)) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));

    return typeof limit === 'number' && Number.isFinite(limit)
      ? filtered.slice(0, Math.max(0, limit))
      : filtered;
  };

  const promptAsync = async (sessionId, body = {}) => {
    const sessionRecord = getSessionRecord(sessionId);
    const promptInput = buildPromptInputFromParts(body.parts);
    const promptText = promptInput.message;
    if (!promptText && promptInput.images.length === 0) {
      throw new Error('Pi prompt requires at least one text, agent mention, or file part');
    }

    const providerID = normalizeNonEmptyString(body.model?.providerID);
    const modelID = normalizeNonEmptyString(body.model?.modelID);
    const agent = normalizeNonEmptyString(body.agent);
    const variant = normalizeNonEmptyString(body.variant);

    if (providerID && modelID) {
      sessionRecord.lastModel = { providerID, modelID };
    }
    if (agent) {
      sessionRecord.lastAgent = agent;
    }
    if (variant) {
      sessionRecord.lastVariant = variant;
    }

    sessionRecord.status = { type: 'busy' };
    sessionRecord.session.time.updated = Date.now();

    try {
      await queueCommand(sessionRecord, async () => {
        if (sessionRecord.lastModel) {
          await sendCommand(sessionRecord, {
            type: 'set_model',
            provider: sessionRecord.lastModel.providerID,
            modelId: sessionRecord.lastModel.modelID,
          });
        }

        await sendCommand(sessionRecord, {
          type: 'prompt',
          message: promptText,
          ...(promptInput.images.length > 0 ? { images: promptInput.images } : {}),
        });
      });
    } catch (error) {
      sessionRecord.status = { type: 'idle' };
      sessionRecord.session.time.updated = Date.now();
      throw error;
    }
  };

  const abortPrompt = async (sessionId) => {
    const sessionRecord = getSessionRecord(sessionId);
    await queueCommand(sessionRecord, async () => {
      await sendCommand(sessionRecord, { type: 'abort' });
      sessionRecord.status = { type: 'idle' };
      sessionRecord.session.time.updated = Date.now();
    });
    return true;
  };

  const getMessages = async (sessionId, limit) => {
    const sessionRecord = getSessionRecord(sessionId);
    if (sessionRecord.process && sessionRecord.messages.length === 0) {
      await refreshMessages(sessionId).catch(() => {});
    }
    return typeof limit === 'number' && Number.isFinite(limit)
      ? sessionRecord.messages.slice(-limit)
      : sessionRecord.messages;
  };

  const listPendingQuestions = ({ directory } = {}) => {
    const requestedDirectory = normalizeNonEmptyString(directory);
    const pending = [];
    for (const entry of questionRequestIndex.values()) {
      if (!entry?.question || !entry.sessionId) {
        continue;
      }
      const sessionRecord = sessions.get(entry.sessionId);
      const sessionDirectory = sessionRecord?.session?.directory || null;
      if (requestedDirectory && sessionDirectory && sessionDirectory !== requestedDirectory && !sessionDirectory.startsWith(`${requestedDirectory}${path.sep}`)) {
        continue;
      }
      pending.push(entry.question);
    }
    return pending;
  };

  const respondToQuestion = async (requestId, answers) => {
    const indexed = questionRequestIndex.get(requestId);
    if (!indexed) {
      throw new Error(`Unknown Pi question request: ${requestId}`);
    }

    const sessionRecord = getSessionRecord(indexed.sessionId);
    const question = indexed.question;
    const request = indexed.request;
    const normalizedAnswers = Array.isArray(answers) ? answers : [];
    const firstAnswer = Array.isArray(normalizedAnswers[0]) ? normalizedAnswers[0][0] : normalizedAnswers[0];
    const firstValue = typeof firstAnswer === 'string' ? firstAnswer.trim() : '';

    let responsePayload;
    if (request.method === 'confirm') {
      if (firstValue !== 'Confirm') {
        throw new Error('Invalid Pi confirm response');
      }
      responsePayload = {
        type: 'extension_ui_response',
        id: request.id,
        confirmed: true,
      };
    } else if (request.method === 'select') {
      const options = Array.isArray(request.options) ? request.options : [];
      if (!firstValue || !options.includes(firstValue)) {
        throw new Error('Invalid Pi select response');
      }
      responsePayload = {
        type: 'extension_ui_response',
        id: request.id,
        value: firstValue,
      };
    } else if (request.method === 'editor' && question?.metadata?.downgrade) {
      if (firstValue !== 'Dismiss request') {
        throw new Error('Invalid Pi downgrade response');
      }
      responsePayload = {
        type: 'extension_ui_response',
        id: request.id,
        cancelled: true,
      };
    } else {
      responsePayload = {
        type: 'extension_ui_response',
        id: request.id,
        value: firstValue,
      };
    }

    await queueCommand(sessionRecord, async () => {
      await writeRpcPayload(sessionRecord, responsePayload);
      sessionRecord.pendingUiRequests.delete(request.id);
      questionRequestIndex.delete(request.id);
    });
    return true;
  };

  const rejectQuestion = async (requestId) => {
    const indexed = questionRequestIndex.get(requestId);
    if (!indexed) {
      throw new Error(`Unknown Pi question request: ${requestId}`);
    }

    const sessionRecord = getSessionRecord(indexed.sessionId);
    await queueCommand(sessionRecord, async () => {
      await writeRpcPayload(sessionRecord, {
        type: 'extension_ui_response',
        id: requestId,
        cancelled: true,
      });
      sessionRecord.pendingUiRequests.delete(requestId);
      questionRequestIndex.delete(requestId);
    });
    return true;
  };

  return {
    cliPath,
    cliArgs: [...cliArgs],
    subscribe(listener) {
      globalSubscribers.add(listener);
      return () => globalSubscribers.delete(listener);
    },
    createSession,
    listSessions,
    getSession(sessionId) {
      return getSessionRecord(sessionId).session;
    },
    getSessionStatus() {
      const status = {};
      for (const [sessionId, sessionRecord] of sessions.entries()) {
        status[sessionId] = sessionRecord.status;
      }
      return status;
    },
    async getMessages(sessionId, limit) {
      return getMessages(sessionId, limit);
    },
    listPendingQuestions(options) {
      return listPendingQuestions(options);
    },
    listPendingPermissions() {
      return [];
    },
    async replyToQuestion(requestId, answers) {
      return respondToQuestion(requestId, answers);
    },
    async rejectQuestion(requestId) {
      return rejectQuestion(requestId);
    },
    async replyToPermission() {
      return false;
    },
    async promptAsync(sessionId, body) {
      await promptAsync(sessionId, body);
    },
    async abort(sessionId) {
      return abortPrompt(sessionId);
    },
    async refreshMessages(sessionId) {
      return refreshMessages(sessionId);
    },
    getEventLog(sessionId) {
      return getSessionRecord(sessionId).eventLog.slice();
    },
  };
};

export { buildPromptTextFromParts };
