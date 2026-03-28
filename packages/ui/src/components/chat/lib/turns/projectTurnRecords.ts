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

/**
 * 从 Pi-native session 状态直接构建最小化的 ChatMessageEntry
 * 这是推进 Pi-native 化的过渡步骤：不再依赖 uiMessageProjection 的完整投影，
 * 而是直接从 Pi 原始数据构建 turn 记录所需的 minimal message 结构
 */
const buildMinimalMessageEntryFromPi = (
    message: PiMessageViewState,
    sessionId: string,
    toolExecutionsById: Map<string, PiToolExecutionViewState>,
): ChatMessageEntry => {
    const messageId = message.id || `${sessionId}:msg:${Date.now()}`;
    const timestamp = message.timestamp ?? Date.now();

    // 用户消息
    if (message.role === 'user') {
        const contentText = typeof message.content === 'string'
            ? message.content
            : message.content.filter((b): b is Extract<PiContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('');
        return {
            info: {
                id: messageId,
                sessionID: sessionId,
                role: 'user',
                clientRole: 'user',
                userMessageMarker: true,
                time: { created: timestamp, completed: timestamp },
            } as Message,
            parts: contentText ? [{
                id: `${messageId}:text:0`,
                type: 'text',
                text: contentText,
                sessionID: sessionId,
                messageID: messageId,
                time: { start: timestamp, end: timestamp },
            } as Part] : [],
        };
    }

    // Assistant 消息
    if (message.role === 'assistant') {
        const textBlocks = message.content.filter((b): b is Extract<PiContentBlock, { type: 'text' }> => b.type === 'text');
        const thinkingBlocks = message.content.filter((b): b is Extract<PiContentBlock, { type: 'thinking' }> => b.type === 'thinking');
        const toolCallBlocks = message.content.filter((b): b is Extract<PiContentBlock, { type: 'toolCall' }> => b.type === 'toolCall');

        const parts: Part[] = [];
        let partIndex = 0;

        // Text parts
        for (const block of textBlocks) {
            parts.push({
                id: `${messageId}:text:${partIndex++}`,
                type: 'text',
                text: block.text,
                sessionID: sessionId,
                messageID: messageId,
                time: { start: timestamp, end: timestamp },
            } as Part);
        }

        // Reasoning parts
        for (const block of thinkingBlocks) {
            parts.push({
                id: `${messageId}:reasoning:${partIndex++}`,
                type: 'reasoning',
                text: block.thinking,
                sessionID: sessionId,
                messageID: messageId,
                time: { start: timestamp, end: timestamp },
            } as Part);
        }

        // Tool call parts - 直接从 toolExecutions 获取状态
        for (const block of toolCallBlocks) {
            const toolCallId = block.id || `${messageId}:tool:${partIndex}`;
            const execution = block.id ? toolExecutionsById.get(block.id) : undefined;
            const toolName = execution?.toolName || block.name || 'tool';
            const status = execution?.status === 'running' ? 'running' : execution?.isError ? 'error' : 'completed';

            const outputChunks: string[] = [];
            if (execution?.partialResult !== undefined && execution.partialResult !== null) {
                outputChunks.push(typeof execution.partialResult === 'string'
                    ? execution.partialResult
                    : JSON.stringify(execution.partialResult, null, 2));
            }
            if (execution?.result !== undefined && execution.result !== null) {
                outputChunks.push(typeof execution.result === 'string'
                    ? execution.result
                    : JSON.stringify(execution.result, null, 2));
            }
            const output = outputChunks.join('\n\n');

            parts.push({
                id: toolCallId,
                type: 'tool',
                tool: toolName,
                callID: toolCallId,
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
                ...(finish ? { finish } : {}),
                status: message.stopReason && message.stopReason !== 'toolUse' ? 'completed' : undefined,
                time: { created: timestamp, completed: finish ? timestamp : undefined },
            } as Message,
            parts,
        };
    }

    // Tool result / bash execution / custom - 简化为文本
    const contentStr = message.role === 'toolResult'
        ? (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
        : message.role === 'bashExecution'
            ? message.output
            : JSON.stringify(message);

    return {
        info: {
            id: messageId,
            sessionID: sessionId,
            role: message.role,
            clientRole: message.role,
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
    const messages = (session.messages ?? []).map(m => buildMinimalMessageEntryFromPi(m, session.id, toolExecutionsById));

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
