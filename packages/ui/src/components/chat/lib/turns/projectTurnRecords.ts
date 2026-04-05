import type { PiContentBlock, PiMessageViewState, PiSessionViewState, PiToolExecutionViewState } from '@/lib/pi/types';
import type { Message, Part } from '@/lib/runtime/types';
import { projectTurnIndexes } from './projectTurnIndexes';
import { buildPiAssistantTextById, projectTurnSummary } from './projectTurnSummary';
import type {
    ChatMessageEntry,
    TurnMessageRecord,
    TurnProjectionResult,
    TurnRecord,
    TurnStreamState,
} from './types';

const isPiTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => (
    block.type === 'text' && 'text' in block
);

const isPiThinkingContentBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => (
    block.type === 'thinking' && 'thinking' in block
);

const isPiToolCallBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'toolCall' }> => (
    block.type === 'toolCall' && 'id' in block && 'name' in block && 'arguments' in block
);

const isPiImageBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'image' }> => (
    block.type === 'image' && 'data' in block
);

const imageExtensionByMimeType = (mimeType: string): string => {
    switch (mimeType.toLowerCase()) {
        case 'image/jpeg':
            return 'jpg';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        case 'image/svg+xml':
            return 'svg';
        case 'image/bmp':
            return 'bmp';
        case 'image/x-icon':
            return 'ico';
        default:
            return 'png';
    }
};

const buildPiUserMessageParts = (
    content: string | PiContentBlock[],
    sessionId: string,
    messageId: string,
    timestamp: number,
): Part[] => {
    if (typeof content === 'string') {
        if (!content) {
            return [];
        }
        return [{
            id: `${messageId}:text:0`,
            type: 'text',
            text: content,
            sessionID: sessionId,
            messageID: messageId,
            time: { start: timestamp, end: timestamp },
        } as Part];
    }

    const parts: Part[] = [];
    let partIndex = 0;
    let imageIndex = 0;

    for (const block of content) {
        if (isPiTextBlock(block)) {
            if (!block.text) {
                continue;
            }
            parts.push({
                id: `${messageId}:text:${partIndex++}`,
                type: 'text',
                text: block.text,
                sessionID: sessionId,
                messageID: messageId,
                time: { start: timestamp, end: timestamp },
            } as Part);
            continue;
        }

        if (!isPiImageBlock(block) || !block.data) {
            continue;
        }

        imageIndex += 1;
        const mimeType = typeof block.mimeType === 'string' && block.mimeType.trim().length > 0
            ? block.mimeType.trim()
            : 'image/png';
        const extension = imageExtensionByMimeType(mimeType);
        parts.push({
            id: `${messageId}:file:${partIndex++}`,
            type: 'file',
            mime: mimeType,
            url: `data:${mimeType};base64,${block.data}`,
            filename: `image-${imageIndex}.${extension}`,
            sessionID: sessionId,
            messageID: messageId,
            time: { start: timestamp, end: timestamp },
        } as Part);
    }

    return parts;
};

const normalizeTaskSessionId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const readTaskSessionIdFromText = (value: string): string | null => {
    const metadataMatch = value.match(/<task_metadata>\s*([\s\S]*?)\s*<\/task_metadata>/i);
    if (metadataMatch?.[1]) {
        try {
            const parsed = JSON.parse(metadataMatch[1]) as { sessionId?: unknown; sessionID?: unknown };
            const sessionId = normalizeTaskSessionId(parsed.sessionId) ?? normalizeTaskSessionId(parsed.sessionID);
            if (sessionId) {
                return sessionId;
            }
        } catch {
            // ignore malformed metadata block
        }
    }

    return normalizeTaskSessionId(
        value.match(/session[_\s-]?id\s*:\s*([^\s<"']+)/i)?.[1]
        ?? value.match(/task_id\s*:\s*([^\s<"']+)/i)?.[1]
    );
};

const readTaskSessionIdFromValue = (value: unknown): string | null => {
    if (typeof value === 'string') {
        return readTaskSessionIdFromText(value);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const sessionId = readTaskSessionIdFromValue(item);
            if (sessionId) {
                return sessionId;
            }
        }
        return null;
    }
    if (value && typeof value === 'object') {
        const record = value as { sessionId?: unknown; sessionID?: unknown; content?: unknown; text?: unknown };
        const directSessionId = normalizeTaskSessionId(record.sessionId) ?? normalizeTaskSessionId(record.sessionID);
        if (directSessionId) {
            return directSessionId;
        }
        const contentSessionId = readTaskSessionIdFromValue(record.content);
        if (contentSessionId) {
            return contentSessionId;
        }
        const textSessionId = readTaskSessionIdFromValue(record.text);
        if (textSessionId) {
            return textSessionId;
        }
    }
    return null;
};

const readTaskSessionIdFromExecution = (execution: PiToolExecutionViewState | null | undefined, args: Record<string, unknown> | null | undefined): string | null => {
    const fromArgs = normalizeTaskSessionId(args?.sessionId)
        ?? normalizeTaskSessionId(args?.taskSessionId);
    if (fromArgs) {
        return fromArgs;
    }

    return readTaskSessionIdFromValue(execution?.result)
        ?? readTaskSessionIdFromValue(execution?.partialResult);
};

const extractTextFromPiContentBlocks = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((block) => {
        if (!block || typeof block !== 'object') {
            return [];
        }
        const record = block as Record<string, unknown>;
        if (record.type === 'text' && typeof record.text === 'string') {
            return [record.text];
        }
        return [];
    });
};

const extractToolPayloadTextAndDetails = (value: unknown): { text: string; details?: Record<string, unknown> } => {
    if (typeof value === 'string') {
        return { text: value };
    }

    if (!value || typeof value !== 'object') {
        return { text: '' };
    }

    const record = value as Record<string, unknown>;
    const contentText = extractTextFromPiContentBlocks(record.content).join('\n');
    const directText = typeof record.text === 'string' ? record.text : '';
    const text = contentText || directText || JSON.stringify(value, null, 2);
    const details = record.details && typeof record.details === 'object'
        ? (record.details as Record<string, unknown>)
        : undefined;

    return { text, details };
};

/**
 * 从 Pi-native session 状态直接构建最小化的 ChatMessageEntry
 * 这是推进 Pi-native 化的过渡步骤：不再依赖 uiMessageProjection 的完整投影，
 * 而是直接从 Pi 原始数据构建 turn 记录所需的 minimal message 结构
 */
const buildMinimalMessageEntryFromPi = (
    message: PiMessageViewState,
    sessionId: string,
    fallbackTimestamp: number,
    toolExecutionsById: Map<string, PiToolExecutionViewState>,
    toolResultsByCallId: Map<string, Extract<PiMessageViewState, { role: 'toolResult' }>>,
): ChatMessageEntry => {
    const messageId = message.id || `${sessionId}:msg:${fallbackTimestamp}`;
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : fallbackTimestamp;
    const rawParentId = (message as { parentId?: unknown }).parentId;
    const parentId = typeof rawParentId === 'string' && rawParentId.trim().length > 0
        ? rawParentId.trim()
        : undefined;


    // 用户消息
    if (message.role === 'user') {
        return {
            info: {
                id: messageId,
                sessionID: sessionId,
                role: 'user',
                clientRole: 'user',
                userMessageMarker: true,
                ...(parentId ? { parentID: parentId } : {}),
                time: { created: timestamp, completed: timestamp },
            } as Message,
            parts: buildPiUserMessageParts(message.content, sessionId, messageId, timestamp),
        };
    }

    // Assistant 消息
    if (message.role === 'assistant') {
        const parts: Part[] = [];
        let partIndex = 0;
        const claimedExecutionIds = new Set<string>();

        // 保持原始 blocks 顺序，按顺序处理每个 block
        for (const block of message.content) {
            if (isPiTextBlock(block)) {
                parts.push({
                    id: `${messageId}:text:${partIndex++}`,
                    type: 'text',
                    text: block.text,
                    sessionID: sessionId,
                    messageID: messageId,
                    time: { start: timestamp, end: timestamp },
                } as Part);
            } else if (isPiThinkingContentBlock(block)) {
                parts.push({
                    id: `${messageId}:reasoning:${partIndex++}`,
                    type: 'reasoning',
                    text: block.thinking,
                    sessionID: sessionId,
                    messageID: messageId,
                    time: { start: timestamp, end: timestamp },
                } as Part);
            } else if (isPiToolCallBlock(block)) {
                // 生成稳定的 toolCallId：优先使用 block.id，否则基于 messageId + partIndex
                const toolCallId = block.id || `${messageId}:tool:${partIndex}`;
                let execution: PiToolExecutionViewState | undefined;
                
                // 策略1：精确匹配（block.id 存在时）
                if (block.id) {
                    execution = toolExecutionsById.get(block.id);
                    if (execution) {
                        claimedExecutionIds.add(block.id);
                    }
                }
                
                // 策略2：当 block.id 为空时，使用基于消息内位置的智能匹配
                // 不再简单按名称 fallback，而是结合消息顺序、参数 hash
                if (!execution && !block.id) {
                    const blockName = (block.name || '').trim().toLowerCase();
                    
                    // 在 message 的 content 中的位置（0-based）
                    const toolCallIndex = message.content
                        .slice(0, partIndex)
                        .filter((b): b is { type: 'toolCall' } & Record<string, unknown> => b.type === 'toolCall').length;
                    
                    // 查找同消息中相同位置、相同名称、未认领的 execution
                    const candidates = Array.from(toolExecutionsById.entries())
                        .filter(([execId, exec]) => {
                            if (claimedExecutionIds.has(execId)) return false;
                            if (exec.toolName.trim().toLowerCase() !== blockName) return false;
                            return true;
                        })
                        .sort((a, b) => {
                            // 按 toolCallId 排序以获得稳定的顺序
                            return a[0].localeCompare(b[0]);
                        });
                    
                    // 选择位置匹配的候选
                    const matched = candidates[toolCallIndex] ?? candidates[0];
                    if (matched) {
                        execution = matched[1];
                        claimedExecutionIds.add(matched[0]);
                    }
                }
                
                const toolName = execution?.toolName || block.name || 'tool';
                const normalizedToolName = typeof toolName === 'string'
                    ? (() => {
                        const trimmed = toolName.trim().toLowerCase();
                        if (!trimmed) {
                            return 'tool';
                        }
                        if (trimmed.includes('.')) {
                            const parts = trimmed.split('.').filter(Boolean);
                            return parts[parts.length - 1] ?? trimmed;
                        }
                        return trimmed;
                    })()
                    : 'tool';
                const status = execution?.status === 'running' ? 'running' : execution?.isError ? 'error' : 'completed';
                const toolArgs = (execution?.args ?? block.arguments ?? {}) as Record<string, unknown>;

                const partialPayload = extractToolPayloadTextAndDetails(execution?.partialResult);
                const resultPayload = extractToolPayloadTextAndDetails(execution?.result);
                const toolResultMessage = toolResultsByCallId.get(toolCallId);
                const toolResultPayload = toolResultMessage
                    ? extractToolPayloadTextAndDetails({
                        content: toolResultMessage.content,
                        details: toolResultMessage.details,
                    })
                    : { text: '', details: undefined };
                const outputChunks = [partialPayload.text, resultPayload.text, toolResultPayload.text].filter((value, index, array) => {
                    if (!value || value.trim().length === 0) {
                        return false;
                    }
                    return array.indexOf(value) === index;
                });
                const output = outputChunks.join('\n\n');
                const taskSessionID = normalizedToolName === 'task'
                    ? readTaskSessionIdFromExecution(execution, toolArgs)
                    : null;
                const executionDetails = toolResultPayload.details ?? resultPayload.details ?? partialPayload.details;
                const mcpMetadata = normalizedToolName === 'mcp'
                    ? {
                        server: typeof executionDetails?.server === 'string' ? executionDetails.server : undefined,
                        tool: typeof toolArgs.tool === 'string'
                            ? toolArgs.tool
                            : (typeof executionDetails?.tool === 'string' ? executionDetails.tool : undefined),
                        mode: typeof executionDetails?.mode === 'string' ? executionDetails.mode : undefined,
                    }
                    : undefined;

                parts.push({
                    id: toolCallId,
                    type: 'tool',
                    tool: toolName,
                    callID: toolCallId,
                    sessionID: sessionId,
                    messageID: messageId,
                    state: {
                        status,
                        input: toolArgs,
                        ...(output ? { output } : {}),
                        ...(status === 'error' ? { error: output || `${toolName} failed` } : {}),
                        time: {
                            start: timestamp,
                            ...(status !== 'running' ? { end: timestamp } : {}),
                        },
                        metadata: {
                            ...(taskSessionID ? { sessionId: taskSessionID } : {}),
                            ...(executionDetails ? { details: executionDetails } : {}),
                            ...(mcpMetadata ? { mcp: mcpMetadata } : {}),
                            pi: {
                                toolName,
                                executionId: execution?.toolCallId,
                            },
                        },
                    },
                    time: {
                        start: timestamp,
                        ...(status !== 'running' ? { end: timestamp } : {}),
                    },
                } as Part);
            }
        }

        // Assistant metadata
        const finish = message.stopReason === 'stop' || message.stopReason === 'endTurn'
            ? 'stop'
            : message.stopReason === 'toolUse' ? 'tool' : undefined;

        return {
            info: {
                id: messageId,
                sessionID: sessionId,
                role: 'assistant',
                clientRole: 'assistant',
                ...(message.provider ? { providerID: message.provider } : {}),
                ...(message.model ? { modelID: message.model } : {}),
                ...(parentId ? { parentID: parentId } : {}),
                ...(finish ? { finish } : {}),
                status: message.stopReason && message.stopReason !== 'toolUse' ? 'completed' : undefined,
                time: { created: timestamp, completed: finish ? timestamp : undefined },
            } as Message,
            parts,
        };
    }

    // Tool result / bash execution / custom - 对于 MCP 工具结果，转换为 tool part 以显示更多信息
    if (message.role === 'toolResult') {
        const toolName = message.toolName || 'tool';
        const isMcpTool = toolName.toLowerCase() === 'mcp';
        
        // 提取 MCP 工具的详细信息
        let mcpServer: string | undefined;
        let mcpTool: string | undefined;
        let mcpMode: string | undefined;
        
        if (isMcpTool && message.details && typeof message.details === 'object') {
            const details = message.details as Record<string, unknown>;
            mcpMode = typeof details.mode === 'string' ? details.mode : undefined;
            
            // status 模式: 显示服务器列表
            if (mcpMode === 'status' && Array.isArray(details.servers)) {
                const servers = details.servers as Array<{ name: string; toolCount: number; status: string }>;
                mcpServer = servers.map(s => `${s.name} (${s.toolCount} tools)`).join(', ');
            }
            // call 模式: 显示具体调用的服务器和工具
            else if (mcpMode === 'call') {
                mcpServer = typeof details.server === 'string' ? details.server : undefined;
                mcpTool = typeof details.tool === 'string' ? details.tool : undefined;
            }
        }
        
        // 构建输出文本
        let outputText: string;
        if (typeof message.content === 'string') {
            outputText = message.content;
        } else if (Array.isArray(message.content)) {
            // 从 content blocks 提取文本
            outputText = message.content
                .filter((block): block is { type: 'text'; text: string } => 
                    block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string'
                )
                .map(block => block.text)
                .join('\n');
        } else {
            outputText = JSON.stringify(message.content);
        }
        
        // 对于 MCP 工具，创建 tool part 以支持更好的渲染
        if (isMcpTool) {
            return {
                info: {
                    id: messageId,
                    sessionID: sessionId,
                    role: 'toolResult',
                    clientRole: 'toolResult',
                    ...(parentId ? { parentID: parentId } : {}),
                    time: { created: timestamp, completed: timestamp },
                } as Message,
                parts: [{
                    id: `${messageId}:tool:0`,
                    type: 'tool',
                    tool: 'mcp',
                    callID: message.toolCallId || messageId,
                    sessionID: sessionId,
                    messageID: messageId,
                    state: {
                        status: message.isError ? 'error' : 'completed',
                        input: {},
                        output: outputText,
                        time: { start: timestamp, end: timestamp },
                        metadata: {
                            mcp: {
                                server: mcpServer,
                                tool: mcpTool,
                                mode: mcpMode,
                            },
                            ...(message.details ? { details: message.details } : {}),
                        },
                    },
                    time: { start: timestamp, end: timestamp },
                } as Part],
            };
        }
        
        // 非 MCP 工具保持原样作为文本
        return {
            info: {
                id: messageId,
                sessionID: sessionId,
                role: 'toolResult',
                clientRole: 'toolResult',
                ...(parentId ? { parentID: parentId } : {}),
                time: { created: timestamp, completed: timestamp },
            } as Message,
            parts: outputText ? [{
                id: `${messageId}:text:0`,
                type: 'text',
                text: outputText,
                sessionID: sessionId,
                messageID: messageId,
                time: { start: timestamp, end: timestamp },
            } as Part] : [],
        };
    }
    
    // bash execution / custom - 简化为文本
    const contentStr = message.role === 'bashExecution'
        ? message.output
        : JSON.stringify(message);

    return {
        info: {
            id: messageId,
            sessionID: sessionId,
            role: message.role,
            clientRole: message.role,
            ...(parentId ? { parentID: parentId } : {}),
            time: { created: timestamp, completed: timestamp },
        } as Message,
        parts: contentStr ? [{
            id: `${messageId}:text:0`,
            type: 'text',
            text: contentStr,
            sessionID: sessionId,
            messageID: messageId,
            time: { start: timestamp, end: timestamp },
        } as Part] : [],
    };
};

/**
 * 从 Pi-native session 直接构建 turn 记录
 * 这是 Pi-native 化的主要入口：跳过 uiMessageProjection 的完整投影，
 * 直接从 Pi 原始数据构建 turn 记录
 */
export const projectPiSessionToTurnRecords = (
    session: PiSessionViewState,
    options?: Partial<ProjectTurnRecordsOptions> & { toolExecutionsById?: Map<string, PiToolExecutionViewState> },
): TurnProjectionResult => {
    const sourceMessages = session.messages ?? [];
    const toolExecutionsById = options?.toolExecutionsById ?? new Map((session.toolExecutions ?? []).map(e => [e.toolCallId, e]));
    const toolResultsByCallId = new Map(
        sourceMessages
            .filter((message): message is Extract<PiMessageViewState, { role: 'toolResult' }> => message.role === 'toolResult' && typeof message.toolCallId === 'string' && message.toolCallId.length > 0)
            .map((message) => [message.toolCallId, message])
    );
    const messages = sourceMessages.map((m, index) => buildMinimalMessageEntryFromPi(
        m,
        session.id,
        (typeof session.createdAt === 'number' ? session.createdAt : 0) + index,
        toolExecutionsById,
        toolResultsByCallId,
    ));

    const result = projectTurnRecords(messages, {
        ...options,
        piSession: session,
    });

    // 确保 piMessages 包含完整的 Pi-native 消息引用
    const piMessageById = new Map(
        (session.messages ?? [])
            .filter((message): message is PiMessageViewState & { id: string } => typeof message.id === 'string' && message.id.length > 0)
            .map((message) => [message.id, message])
    );

    return {
        ...result,
        piMessages: piMessageById,
    };
};

const resolveMessageRole = (
    message: ChatMessageEntry,
    piMessageById?: Map<string, PiMessageViewState>,
): string => {
    const piMessage = piMessageById?.get(message.info.id);
    if (typeof piMessage?.role === 'string' && piMessage.role.length > 0) {
        return piMessage.role;
    }
    const info = message.info as { userMessageMarker?: boolean | null; clientRole?: string | null; role?: string | null };
    if (info.userMessageMarker === true) {
        return 'user';
    }
    const role = info.clientRole ?? info.role;
    return typeof role === 'string' ? role : '';
};

const getMessageParentId = (message: ChatMessageEntry): string | undefined => {
    const parentId = (message.info as { parentID?: unknown }).parentID;
    if (typeof parentId !== 'string' || parentId.trim().length === 0) {
        return undefined;
    }
    return parentId;
};

const getMessageCreatedAt = (message: ChatMessageEntry): number | undefined => {
    const created = (message.info as { time?: { created?: unknown } }).time?.created;
    return typeof created === 'number' ? created : undefined;
};

const getMessageCompletedAt = (message: ChatMessageEntry): number | undefined => {
    const completed = (message.info as { time?: { completed?: unknown } }).time?.completed;
    return typeof completed === 'number' ? completed : undefined;
};

const getUserSummaryBody = (message: ChatMessageEntry): string | undefined => {
    const summaryBody = (message.info as { summary?: { body?: unknown } | null | undefined })?.summary?.body;
    if (typeof summaryBody !== 'string') {
        return undefined;
    }

    const trimmed = summaryBody.trim();
    return trimmed.length > 0 ? summaryBody : undefined;
};

const computeTurnSignature = (
    assistantMessages: ChatMessageEntry[],
    piAssistantById: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
    toolExecutionsById: Map<string, PiToolExecutionViewState>,
): string => {
    const parts: string[] = [];
    let toolCallIndex = 0;
    for (const message of assistantMessages) {
        const piMessage = piAssistantById.get(message.info.id);
        if (piMessage?.role === 'assistant') {
            // message id + stopReason
            parts.push(`${message.info.id}:${piMessage.stopReason ?? 'none'}`);
            // tool calls - 处理有 id 和无 id 的情况
            for (const block of piMessage.content) {
                if (isPiToolCallBlock(block)) {
                    const blockId = block.id ? block.id : null;
                    const blockName = block.name ? block.name : 'unknown';
                    
                    if (blockId) {
                        // 有 id 时，使用 id + execution 状态
                        const execution = toolExecutionsById.get(blockId);
                        parts.push(`tool:${blockId}:${execution?.status ?? 'unknown'}:${execution?.isError ? 'error' : 'ok'}`);
                    } else {
                        // 无 id 时，使用位置索引 + 工具名 + 参数 hash 生成稳定标识
                        const argsHash = JSON.stringify(block.arguments ?? {});
                        parts.push(`tool:noId:${toolCallIndex}:${blockName}:${argsHash}`);
                    }
                    toolCallIndex += 1;
                }
            }
        }
    }
    return parts.join('|');
};

const createTurnMessageRecord = (
    message: ChatMessageEntry,
    order: number,
    piMessageById?: Map<string, PiMessageViewState>,
): TurnMessageRecord => {
    const role = resolveMessageRole(message, piMessageById);
    return {
        messageId: message.info.id,
        role,
        parentMessageId: getMessageParentId(message),
        message,
        order,
    };
};

const buildTurnStreamState = (
    userMessage: ChatMessageEntry,
    assistantMessages: ChatMessageEntry[],
    piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): TurnStreamState => {
    const startedAt = getMessageCreatedAt(userMessage);
    let completedAt: number | undefined;
    let isStreaming = false;

    assistantMessages.forEach((message) => {
        const piMessage = piAssistantById?.get(message.info.id);
        const piCompleted = piMessage && piMessage.stopReason && piMessage.stopReason !== 'toolUse'
            ? piMessage.timestamp
            : undefined;
        const completed = piCompleted ?? getMessageCompletedAt(message);
        if (typeof completed === 'number') {
            completedAt = Math.max(completedAt ?? 0, completed);
        } else {
            isStreaming = true;
        }
    });

    const durationMs = typeof startedAt === 'number' && typeof completedAt === 'number' && completedAt >= startedAt
        ? completedAt - startedAt
        : undefined;

    return {
        isStreaming,
        isRetrying: assistantMessages.length > 1,
        startedAt,
        completedAt,
        durationMs,
    };
};

interface ProjectTurnRecordsOptions {
    previousProjection?: TurnProjectionResult | null;
    piSession?: PiSessionViewState | null;
    toolExecutionsById?: Map<string, PiToolExecutionViewState>;
}

const DEFAULT_OPTIONS: ProjectTurnRecordsOptions = {
    previousProjection: null,
};

export const projectTurnRecords = (
    messages: ChatMessageEntry[],
    options?: Partial<ProjectTurnRecordsOptions>,
): TurnProjectionResult => {
    const effectiveOptions: ProjectTurnRecordsOptions = {
        ...DEFAULT_OPTIONS,
        ...options,
    };
    const piAssistantTextById = buildPiAssistantTextById(effectiveOptions.piSession);
    const piMessageById = new Map(
        (effectiveOptions.piSession?.messages ?? [])
            .filter((message): message is PiMessageViewState & { id: string } => typeof message.id === 'string' && message.id.length > 0)
            .map((message) => [message.id, message])
    );
    const piAssistantById = new Map(
        (effectiveOptions.piSession?.messages ?? [])
            .filter((message): message is Extract<PiMessageViewState, { role: 'assistant' }> => message.role === 'assistant' && typeof message.id === 'string' && message.id.length > 0)
            .map((message) => [message.id as string, message])
    );
    const toolExecutionsById = new Map((effectiveOptions.piSession?.toolExecutions ?? []).map(e => [e.toolCallId, e]));

    const turns: TurnRecord[] = [];
    const turnByUserId = new Map<string, TurnRecord>();
    const previousTurnsById = new Map((effectiveOptions.previousProjection?.turns ?? []).map((turn) => [turn.turnId, turn]));
    const groupedMessageIds = new Set<string>();
    let currentTurn: TurnRecord | undefined;

    messages.forEach((message, index) => {
        const role = resolveMessageRole(message, piMessageById);
        if (role === 'user') {
            const turnId = message.info.id;
            const turn: TurnRecord = {
                turnId,
                userMessageId: message.info.id,
                userMessage: message,
                headerMessageId: undefined,
                messages: [createTurnMessageRecord(message, index, piMessageById)],
                assistantMessageIds: [],
                assistantMessages: [],
                summary: {},
                summaryText: undefined,
                stream: {
                    isStreaming: false,
                    isRetrying: false,
                },
            };
            turns.push(turn);
            turnByUserId.set(turn.userMessageId, turn);
            groupedMessageIds.add(message.info.id);
            currentTurn = turn;
            return;
        }

        if (role !== 'assistant') {
            return;
        }

        const parentId = getMessageParentId(message);
        const parentTurn = parentId ? turnByUserId.get(parentId) : undefined;
        const targetTurn = parentTurn ?? currentTurn;
        if (!targetTurn) {
            return;
        }

        targetTurn.assistantMessages.push(message);
        targetTurn.assistantMessageIds.push(message.info.id);
        targetTurn.messages.push(createTurnMessageRecord(message, index, piMessageById));
        if (!targetTurn.headerMessageId) {
            targetTurn.headerMessageId = message.info.id;
        }
        groupedMessageIds.add(message.info.id);

        if (!parentTurn) {
            currentTurn = targetTurn;
        }
    });

    turns.forEach((turn) => {
        turn.assistantMessageIds = turn.assistantMessages.map((message) => message.info.id);
        turn.headerMessageId = turn.assistantMessages[0]?.info.id;
        turn.messages = [
            createTurnMessageRecord(turn.userMessage, 0, piMessageById),
            ...turn.assistantMessages.map((message, index) => createTurnMessageRecord(message, index + 1, piMessageById)),
        ];

        const previousTurn = previousTurnsById.get(turn.turnId);
        // 使用完整的 turn signature 替代简单的 id 检查
        // signature 包含：userMessageId + assistantIds + toolCallIds + stopReasons + toolExecutionStates
        const canReuseComputed = (() => {
            if (!previousTurn) {
                return false;
            }
            // 流式中的 turn 不复用，确保实时更新
            if (previousTurn.stream.isStreaming || turn.stream.isStreaming) {
                return false;
            }
            // 检查 assistant 消息数量变化
            if (previousTurn.assistantMessages.length !== turn.assistantMessages.length) {
                return false;
            }
            // 检查消息 ID 是否一致
            if (previousTurn.userMessage.info.id !== turn.userMessage.info.id) {
                return false;
            }
            for (let index = 0; index < turn.assistantMessages.length; index += 1) {
                if (previousTurn.assistantMessages[index]?.info.id !== turn.assistantMessages[index]?.info.id) {
                    return false;
                }
            }
            // 使用真正的前后态 signature 比较实现增量复用
            // previousTurn.signature 是上一轮保存的签名，代表当时的完整状态
            // 如果 signature 不存在，说明是旧数据，不进行复用尝试
            if (!previousTurn.signature) {
                return false;
            }
            // 计算当前 turn 的 signature
            const currentSignature = computeTurnSignature(
                turn.assistantMessages,
                piAssistantById,
                toolExecutionsById,
            );
            // 真正的前后态比较：上一轮保存的 signature vs 当前计算的 signature
            return previousTurn.signature === currentSignature;
        })();

        if (canReuseComputed && previousTurn) {
            turn.summary = previousTurn.summary;
            turn.summaryText = previousTurn.summaryText;
            turn.stream = previousTurn.stream;
            turn.startedAt = previousTurn.startedAt;
            turn.completedAt = previousTurn.completedAt;
            turn.durationMs = previousTurn.durationMs;
            return;
        }

        turn.summary = projectTurnSummary(turn.assistantMessages, {
            piAssistantTextById,
            piAssistantById,
        });
        turn.summaryText = turn.summary.text ?? getUserSummaryBody(turn.userMessage);

        turn.stream = buildTurnStreamState(turn.userMessage, turn.assistantMessages, piAssistantById);
        turn.startedAt = turn.stream.startedAt;
        turn.completedAt = turn.stream.completedAt;
        turn.durationMs = turn.stream.durationMs;
        // 保存当前 turn 的 signature，用于下一轮增量复用比较
        turn.signature = computeTurnSignature(
            turn.assistantMessages,
            piAssistantById,
            toolExecutionsById,
        );
    });

    const projection = projectTurnIndexes(turns);
    const ungroupedMessageIds = new Set<string>();
    messages.forEach((message) => {
        // 跳过已经被分组的消息
        if (groupedMessageIds.has(message.info.id)) {
            return;
        }
        // 跳过 toolResult 消息 - 它们已经被合并到 assistant 的 tool part 中
        const role = resolveMessageRole(message, piMessageById);
        if (role === 'toolResult') {
            return;
        }
        ungroupedMessageIds.add(message.info.id);
    });

    return {
        ...projection,
        ungroupedMessageIds,
        piMessages: piMessageById.size > 0 ? piMessageById : undefined,
    };
};
