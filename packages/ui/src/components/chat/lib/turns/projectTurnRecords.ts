import type { PiContentBlock, PiMessageViewState, PiSessionViewState, PiToolExecutionViewState } from '@/lib/pi/types';
import type { Message, Part } from '@/lib/runtime/types';
import { projectTurnActivity } from './projectTurnActivity';
import { projectTurnIndexes } from './projectTurnIndexes';
import { buildPiAssistantTextById, projectTurnDiffStats, projectTurnSummary } from './projectTurnSummary';
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
    toolExecutionsById: Map<string, PiToolExecutionViewState>,
    toolResultsByCallId: Map<string, Extract<PiMessageViewState, { role: 'toolResult' }>>,
): ChatMessageEntry => {
    const messageId = message.id || `${sessionId}:msg:${Date.now()}`;
    const timestamp = message.timestamp ?? Date.now();
    const rawParentId = (message as { parentId?: unknown }).parentId;
    const parentId = typeof rawParentId === 'string' && rawParentId.trim().length > 0
        ? rawParentId.trim()
        : undefined;

    // DEBUG: Log Pi message structure
    if (message.role === 'assistant' && Array.isArray(message.content)) {
        console.log('[DEBUG buildMinimalMessageEntryFromPi] Pi message blocks order:', 
            message.content.map((b, i) => `${i}:${b.type}`).join(', '));
    }

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
                const toolCallId = block.id || `${messageId}:tool:${partIndex}`;
                let execution: PiToolExecutionViewState | undefined;
                if (block.id) {
                    execution = toolExecutionsById.get(block.id);
                    if (execution) {
                        claimedExecutionIds.add(block.id);
                    }
                }
                if (!execution) {
                    // Fallback: match by tool name when block.id is null
                    const blockName = (block.name || '').trim().toLowerCase();
                    for (const [execId, exec] of toolExecutionsById) {
                        if (!claimedExecutionIds.has(execId) && exec.toolName.trim().toLowerCase() === blockName) {
                            execution = exec;
                            claimedExecutionIds.add(execId);
                            break;
                        }
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

        // DEBUG: Log parts order
        console.log('[DEBUG buildMinimalMessageEntryFromPi] Built parts order:', 
            parts.map((p, i) => `${i}:${p.type}${p.type === 'tool' ? `(${p.tool})` : ''}`).join(', '));

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
    options?: Partial<ProjectTurnRecordsOptions>,
): TurnProjectionResult => {
    const toolExecutionsById = new Map((session.toolExecutions ?? []).map(e => [e.toolCallId, e]));
    const toolResultsByCallId = new Map(
        (session.messages ?? [])
            .filter((message): message is Extract<PiMessageViewState, { role: 'toolResult' }> => message.role === 'toolResult' && typeof message.toolCallId === 'string' && message.toolCallId.length > 0)
            .map((message) => [message.toolCallId, message])
    );
    const messages = (session.messages ?? []).map(m => buildMinimalMessageEntryFromPi(m, session.id, toolExecutionsById, toolResultsByCallId));

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
    const piRole = piMessageById?.get(message.info.id)?.role;
    if (typeof piRole === 'string' && piRole.length > 0) {
        return piRole;
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

const isPiThinkingBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => block.type === 'thinking';

const getMessageFinish = (
    message: ChatMessageEntry,
    piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): string | undefined => {
    const piMessage = piAssistantById?.get(message.info.id);
    if (piMessage?.stopReason === 'stop' || piMessage?.stopReason === 'endTurn') {
        return 'stop';
    }
    if (piMessage?.stopReason === 'toolUse') {
        return 'tool';
    }
    const finish = (message.info as { finish?: unknown }).finish;
    return typeof finish === 'string' ? finish : undefined;
};

const getMessageStatus = (
    message: ChatMessageEntry,
    piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): string | undefined => {
    const piMessage = piAssistantById?.get(message.info.id);
    if (piMessage) {
        return piMessage.stopReason && piMessage.stopReason !== 'toolUse' ? 'completed' : 'streaming';
    }
    const status = (message.info as { status?: unknown }).status;
    return typeof status === 'string' ? status : undefined;
};

const getPartText = (part: ChatMessageEntry['parts'][number]): string | undefined => {
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string') {
        return text;
    }
    const content = (part as { content?: unknown }).content;
    return typeof content === 'string' ? content : undefined;
};

const arePartsEquivalentForReuse = (
    previousPart: ChatMessageEntry['parts'][number],
    nextPart: ChatMessageEntry['parts'][number],
    previousPiAssistant?: Extract<PiMessageViewState, { role: 'assistant' }> | null,
    nextPiAssistant?: Extract<PiMessageViewState, { role: 'assistant' }> | null,
): boolean => {
    if (previousPart === nextPart) {
        return true;
    }

    if (previousPart.type !== nextPart.type) {
        return false;
    }

    if (previousPart.id && nextPart.id && previousPart.id !== nextPart.id) {
        return false;
    }

    if (previousPart.type === 'text' || previousPart.type === 'reasoning') {
        return getPartText(previousPart) === getPartText(nextPart);
    }

    if (previousPart.type === 'tool') {
        if (previousPiAssistant && nextPiAssistant) {
            const previousToolBlocks = previousPiAssistant.content.filter((block) => block.type === 'toolCall');
            const nextToolBlocks = nextPiAssistant.content.filter((block) => block.type === 'toolCall');
            if (previousToolBlocks.length !== nextToolBlocks.length) {
                return false;
            }
        }
        const previousTool = previousPart as {
            tool?: unknown;
            callID?: unknown;
            state?: { status?: unknown };
        };
        const nextTool = nextPart as {
            tool?: unknown;
            callID?: unknown;
            state?: { status?: unknown };
        };

        return previousTool.tool === nextTool.tool
            && previousTool.callID === nextTool.callID
            && previousTool.state?.status === nextTool.state?.status;
    }

    return true;
};

const areMessagesEquivalentForReuse = (
    previousMessage: ChatMessageEntry,
    nextMessage: ChatMessageEntry,
    previousPiMessageById?: Map<string, PiMessageViewState>,
    nextPiMessageById?: Map<string, PiMessageViewState>,
    previousPiAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
    nextPiAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): boolean => {
    if (previousMessage === nextMessage) {
        return true;
    }

    if (previousMessage.info.id !== nextMessage.info.id) {
        return false;
    }

    if (getMessageCompletedAt(previousMessage) !== getMessageCompletedAt(nextMessage)) {
        return false;
    }

    if (resolveMessageRole(previousMessage, previousPiMessageById) !== resolveMessageRole(nextMessage, nextPiMessageById)) {
        return false;
    }

    if (getMessageFinish(previousMessage, previousPiAssistantById) !== getMessageFinish(nextMessage, nextPiAssistantById)) {
        return false;
    }

    if (getMessageStatus(previousMessage, previousPiAssistantById) !== getMessageStatus(nextMessage, nextPiAssistantById)) {
        return false;
    }

    const previousPiAssistant = previousPiAssistantById?.get(previousMessage.info.id) ?? null;
    const nextPiAssistant = nextPiAssistantById?.get(nextMessage.info.id) ?? null;
    if (previousPiAssistant && nextPiAssistant) {
        if (previousPiAssistant.content.length !== nextPiAssistant.content.length) {
            return false;
        }
    } else if (previousMessage.parts.length !== nextMessage.parts.length) {
        return false;
    }

    for (let index = 0; index < previousMessage.parts.length; index += 1) {
        if (!arePartsEquivalentForReuse(
            previousMessage.parts[index],
            nextMessage.parts[index],
            previousPiAssistant,
            nextPiAssistant,
        )) {
            return false;
        }
    }

    return true;
};

const getUserSummaryBody = (message: ChatMessageEntry): string | undefined => {
    const summaryBody = (message.info as { summary?: { body?: unknown } | null | undefined })?.summary?.body;
    if (typeof summaryBody !== 'string') {
        return undefined;
    }

    const trimmed = summaryBody.trim();
    return trimmed.length > 0 ? summaryBody : undefined;
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

const mergeAssistantMessageChain = (
    turnId: string,
    assistantMessages: ChatMessageEntry[],
    piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): ChatMessageEntry => {
    if (assistantMessages.length <= 1) {
        return assistantMessages[0];
    }

    const firstMessage = assistantMessages[0];
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    const createdAt = assistantMessages
        .map((message) => getMessageCreatedAt(message))
        .find((value): value is number => typeof value === 'number');
    const completedAt = [...assistantMessages]
        .reverse()
        .map((message) => getMessageCompletedAt(message))
        .find((value): value is number => typeof value === 'number');
    const finish = getMessageFinish(lastMessage, piAssistantById);
    const status = getMessageStatus(lastMessage, piAssistantById);
    const sessionID = (firstMessage.info as { sessionID?: unknown }).sessionID
        ?? (lastMessage.info as { sessionID?: unknown }).sessionID;
    const mergedMessageId = `${turnId}:assistant:${firstMessage.info.id}:${lastMessage.info.id}`;

    return {
        info: {
            ...firstMessage.info,
            ...lastMessage.info,
            id: mergedMessageId,
            sessionID,
            role: 'assistant',
            clientRole: 'assistant',
            piMergedAssistant: true,
            sourceMessageIds: assistantMessages.map((message) => message.info.id),
            ...(finish ? { finish } : {}),
            ...(status ? { status } : {}),
            time: {
                ...(typeof createdAt === 'number' ? { created: createdAt } : {}),
                ...(typeof completedAt === 'number' ? { completed: completedAt } : {}),
            },
        } as Message,
        parts: assistantMessages.flatMap((message) => message.parts),
    };
};

const collapseAssistantMessageChains = (
    turnId: string,
    assistantMessages: ChatMessageEntry[],
    piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>>,
): ChatMessageEntry[] => {
    if (assistantMessages.length <= 1) {
        return assistantMessages;
    }

    const collapsed: ChatMessageEntry[] = [];
    let currentChain: ChatMessageEntry[] = [];

    assistantMessages.forEach((message, index) => {
        currentChain.push(message);
        const finish = getMessageFinish(message, piAssistantById);
        const isLastMessage = index === assistantMessages.length - 1;
        if (finish === 'tool' && !isLastMessage) {
            return;
        }

        collapsed.push(mergeAssistantMessageChain(turnId, currentChain, piAssistantById));
        currentChain = [];
    });

    return collapsed;
};

interface ProjectTurnRecordsOptions {
    previousProjection?: TurnProjectionResult | null;
    showTextJustificationActivity: boolean;
    piSession?: PiSessionViewState | null;
}

const DEFAULT_OPTIONS: ProjectTurnRecordsOptions = {
    previousProjection: null,
    showTextJustificationActivity: false,
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
    const piAssistantMetaById = new Map(
        Array.from(piAssistantById.entries()).map(([messageId, message]) => [messageId, {
            hasToolCall: message.content.some((block) => block.type === 'toolCall'),
            hasReasoning: message.content.some((block) => isPiThinkingBlock(block) && block.thinking.trim().length > 0),
        }])
    );

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
                activityParts: [],
                activitySegments: [],
                summary: {},
                summaryText: undefined,
                hasTools: false,
                hasReasoning: false,
                diffStats: undefined,
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
        turn.assistantMessages = collapseAssistantMessageChains(turn.turnId, turn.assistantMessages, piAssistantById);
        turn.assistantMessageIds = turn.assistantMessages.map((message) => message.info.id);
        turn.headerMessageId = turn.assistantMessages[0]?.info.id;
        turn.messages = [
            createTurnMessageRecord(turn.userMessage, 0, piMessageById),
            ...turn.assistantMessages.map((message, index) => createTurnMessageRecord(message, index + 1, piMessageById)),
        ];

        const previousTurn = previousTurnsById.get(turn.turnId);
        const canReuseComputed = (() => {
            if (!previousTurn) {
                return false;
            }
            if (previousTurn.stream.isStreaming) {
                return false;
            }
            if (!areMessagesEquivalentForReuse(
                previousTurn.userMessage,
                turn.userMessage,
                piMessageById,
                piMessageById,
                piAssistantById,
                piAssistantById,
            )) {
                return false;
            }
            if (previousTurn.assistantMessages.length !== turn.assistantMessages.length) {
                return false;
            }
            for (let index = 0; index < turn.assistantMessages.length; index += 1) {
                if (!areMessagesEquivalentForReuse(
                    previousTurn.assistantMessages[index],
                    turn.assistantMessages[index],
                    piMessageById,
                    piMessageById,
                    piAssistantById,
                    piAssistantById,
                )) {
                    return false;
                }
            }
            return true;
        })();

        if (canReuseComputed && previousTurn) {
            turn.summary = previousTurn.summary;
            turn.summaryText = previousTurn.summaryText;
            turn.diffStats = previousTurn.diffStats;
            turn.activityParts = previousTurn.activityParts;
            turn.activitySegments = previousTurn.activitySegments;
            turn.hasTools = previousTurn.hasTools;
            turn.hasReasoning = previousTurn.hasReasoning;
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
        turn.diffStats = projectTurnDiffStats(turn.userMessage);

        const activity = projectTurnActivity({
            turnId: turn.turnId,
            assistantMessages: turn.assistantMessages,
            summarySourceMessageId: turn.summary.sourceMessageId,
            showTextJustificationActivity: effectiveOptions.showTextJustificationActivity,
            piAssistantMetaById,
            piAssistantById,
        });
        turn.activityParts = activity.activityParts;
        turn.activitySegments = activity.activitySegments;
        turn.hasTools = activity.hasTools;
        turn.hasReasoning = activity.hasReasoning;

        turn.stream = buildTurnStreamState(turn.userMessage, turn.assistantMessages, piAssistantById);
        turn.startedAt = turn.stream.startedAt;
        turn.completedAt = turn.stream.completedAt;
        turn.durationMs = turn.stream.durationMs;
    });

    const projection = projectTurnIndexes(turns);
    const ungroupedMessageIds = new Set<string>();
    messages.forEach((message) => {
        if (!groupedMessageIds.has(message.info.id)) {
            ungroupedMessageIds.add(message.info.id);
        }
    });

    return {
        ...projection,
        ungroupedMessageIds,
        piMessages: piMessageById.size > 0 ? piMessageById : undefined,
    };
};
