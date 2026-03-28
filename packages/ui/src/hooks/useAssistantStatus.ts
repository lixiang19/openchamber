import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PiContentBlock, PiMessageViewState } from '@/lib/pi/types';
import type { MessageStreamPhase } from '@/stores/types/sessionTypes';
import { useSessionStore } from '@/stores/useSessionStore';
import { useCurrentSessionActivity } from './useSessionActivity';

export type AssistantActivity = 'idle' | 'streaming' | 'tooling' | 'cooldown' | 'permission';

interface WorkingSummary {
    activity: AssistantActivity;
    hasWorkingContext: boolean;
    hasActiveTools: boolean;
    isWorking: boolean;
    isStreaming: boolean;
    isCooldown: boolean;
    lifecyclePhase: MessageStreamPhase | null;
    statusText: string | null;
    isGenericStatus: boolean;
    isWaitingForPermission: boolean;
    canAbort: boolean;
    compactionDeadline: number | null;
    activePartType?: 'text' | 'tool' | 'reasoning' | 'editing';
    activeToolName?: string;
    wasAborted: boolean;
    abortActive: boolean;
    lastCompletionId: string | null;
    isComplete: boolean;
    retryInfo: { attempt?: number; next?: number } | null;
}

interface FormingSummary {
    isActive: boolean;
    characterCount: number;
}

export interface AssistantStatusSnapshot {
    forming: FormingSummary;
    working: WorkingSummary;
}

type AssistantPiMessage = Extract<PiMessageViewState, { role: 'assistant' }>;

const DEFAULT_WORKING: WorkingSummary = {
    activity: 'idle',
    hasWorkingContext: false,
    hasActiveTools: false,
    isWorking: false,
    isStreaming: false,
    isCooldown: false,
    lifecyclePhase: null,
    statusText: null,
    isGenericStatus: true,
    isWaitingForPermission: false,
    canAbort: false,
    compactionDeadline: null,
    activePartType: undefined,
    activeToolName: undefined,
    wasAborted: false,
    abortActive: false,
    lastCompletionId: null,
    isComplete: false,
    retryInfo: null,
};

const isTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => block.type === 'text';
const isThinkingBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => block.type === 'thinking';
const isToolCallBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'toolCall' }> => block.type === 'toolCall';

const TOOL_STATUS_PHRASES: Record<string, string> = {
    read: 'reading file',
    write: 'writing file',
    edit: 'editing file',
    multiedit: 'editing files',
    apply_patch: 'applying patch',
    bash: 'running command',
    grep: 'searching content',
    glob: 'finding files',
    list: 'listing directory',
    task: 'delegating task',
    webfetch: 'fetching URL',
    websearch: 'searching web',
    codesearch: 'web code search',
    todowrite: 'updating todos',
    todoread: 'reading todos',
    skill: 'learning skill',
    question: 'asking question',
    plan_enter: 'switching to planning',
    plan_exit: 'switching to building',
};

const WORKING_PHRASES = [
    'working',
    'processing',
    'preparing',
    'warming up',
    'gears turning',
    'computing',
    'calculating',
    'analyzing',
    'wheels spinning',
    'calibrating',
    'synthesizing',
    'connecting dots',
    'inspecting logic',
    'weighing options',
];

const getToolStatusPhrase = (toolName: string): string => TOOL_STATUS_PHRASES[toolName] ?? `using ${toolName}`;
const getRandomWorkingPhrase = (): string => WORKING_PHRASES[Math.floor(Math.random() * WORKING_PHRASES.length)];

export function useAssistantStatus(): AssistantStatusSnapshot {
    const { currentSessionId, piSessions, permissions, interactiveRequests, sessionAbortFlags } = useSessionStore(
        useShallow((state) => ({
            currentSessionId: state.currentSessionId,
            piSessions: state.piSessions,
            permissions: state.permissions,
            interactiveRequests: state.interactiveRequests,
            sessionAbortFlags: state.sessionAbortFlags,
        }))
    );

    const { phase: activityPhase, isWorking: isPhaseWorking } = useCurrentSessionActivity();

    const currentPiSession = React.useMemo(() => {
        if (!currentSessionId) {
            return null;
        }
        return piSessions.get(currentSessionId) ?? null;
    }, [currentSessionId, piSessions]);

    // Pi-native: 直接从 piSessions 获取 retry 状态
    const sessionRetryInfo = React.useMemo(() => {
        if (!currentSessionId || !currentPiSession) return null;
        if (currentPiSession.status !== 'retrying') return null;
        // Pi-native retry 状态目前只返回基本状态，扩展字段需后端支持
        return { attempt: undefined as number | undefined, next: undefined as number | undefined };
    }, [currentSessionId, currentPiSession]);

    const assistantMessages = React.useMemo<AssistantPiMessage[]>(() => {
        if (!currentPiSession) {
            return [];
        }
        return currentPiSession.messages.filter(
            (message): message is AssistantPiMessage => message.role === 'assistant'
        );
    }, [currentPiSession]);

    const lastAssistantMessage = React.useMemo<AssistantPiMessage | null>(() => {
        if (assistantMessages.length === 0) {
            return null;
        }
        return [...assistantMessages].sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp;
            }
            return (a.id ?? '').localeCompare(b.id ?? '');
        })[assistantMessages.length - 1] ?? null;
    }, [assistantMessages]);

    type ParsedStatusResult = {
        activePartType: 'text' | 'tool' | 'reasoning' | 'editing' | undefined;
        activeToolName: string | undefined;
        statusText: string;
        isGenericStatus: boolean;
    };

    const parsedStatus = React.useMemo<ParsedStatusResult>(() => {
        if (!currentPiSession || !lastAssistantMessage) {
            return { activePartType: undefined, activeToolName: undefined, statusText: 'working', isGenericStatus: true };
        }

        let activePartType: 'text' | 'tool' | 'reasoning' | 'editing' | undefined = undefined;
        let activeToolName: string | undefined = undefined;

        const editingTools = new Set(['edit', 'write', 'apply_patch']);
        const toolExecutionsById = new Map(currentPiSession.toolExecutions.map((execution) => [execution.toolCallId, execution]));
        const contentBlocks = Array.isArray(lastAssistantMessage.content) ? lastAssistantMessage.content : [];

        for (let i = contentBlocks.length - 1; i >= 0; i -= 1) {
            const block = contentBlocks[i];
            if (!block) continue;

            if (isThinkingBlock(block) && block.thinking.trim().length > 0 && !activePartType) {
                activePartType = 'reasoning';
                continue;
            }

            if (isToolCallBlock(block) && !activePartType) {
                const execution = block.id ? toolExecutionsById.get(block.id) : undefined;
                const toolStatus = execution?.status;
                const toolName = execution?.toolName || block.name || 'tool';
                if (toolStatus === 'running') {
                    if (editingTools.has(toolName)) {
                        activePartType = 'editing';
                    } else {
                        activePartType = 'tool';
                        activeToolName = toolName;
                    }
                    continue;
                }
            }

            if (isTextBlock(block) && block.text.trim().length > 0 && currentPiSession.isStreaming && !activePartType) {
                activePartType = 'text';
            }
        }

        const isGenericStatus = activePartType === undefined;
        const statusText = (() => {
            const nativeWorkingMessage = currentPiSession.workingMessage?.trim();
            if (nativeWorkingMessage) return nativeWorkingMessage;
            if (activePartType === 'editing') return 'editing file';
            if (activePartType === 'tool' && activeToolName) return getToolStatusPhrase(activeToolName);
            if (activePartType === 'reasoning') return 'thinking';
            if (activePartType === 'text') return 'composing';
            return getRandomWorkingPhrase();
        })();

        return { activePartType, activeToolName, statusText, isGenericStatus };
    }, [currentPiSession, lastAssistantMessage]);

    const abortState = React.useMemo(() => {
        const sessionId = currentSessionId;
        const abortRecord = sessionId ? sessionAbortFlags?.get(sessionId) ?? null : null;
        const hasActiveAbort = Boolean(abortRecord && !abortRecord.acknowledged);
        return { wasAborted: hasActiveAbort, abortActive: hasActiveAbort };
    }, [currentSessionId, sessionAbortFlags]);

    const baseWorking = React.useMemo<WorkingSummary>(() => {
        if (abortState.wasAborted) {
            return {
                ...DEFAULT_WORKING,
                wasAborted: true,
                abortActive: abortState.abortActive,
                activity: 'idle',
                hasWorkingContext: false,
                isWorking: false,
                isStreaming: false,
                isCooldown: false,
                statusText: null,
                canAbort: false,
                retryInfo: null,
            };
        }

        const isWorking = isPhaseWorking;
        const isStreaming = activityPhase === 'busy';
        const isCooldown = false;
        const isRetry = activityPhase === 'retry';

        const hasNativeActiveTools = currentPiSession?.toolExecutions.some((execution) => execution.status === 'running') ?? false;

        let activity: AssistantActivity = 'idle';
        if (isWorking) {
            if (hasNativeActiveTools || parsedStatus.activePartType === 'tool' || parsedStatus.activePartType === 'editing') {
                activity = 'tooling';
            } else {
                activity = isCooldown ? 'cooldown' : 'streaming';
            }
        }

        const retryInfo = isRetry ? sessionRetryInfo : null;

        return {
            activity,
            hasWorkingContext: isWorking,
            hasActiveTools: hasNativeActiveTools || parsedStatus.activePartType === 'tool' || parsedStatus.activePartType === 'editing',
            isWorking,
            isStreaming,
            isCooldown,
            lifecyclePhase: isStreaming ? 'streaming' : isCooldown ? 'cooldown' : null,
            statusText: isWorking ? parsedStatus.statusText : null,
            isGenericStatus: isWorking ? parsedStatus.isGenericStatus : true,
            isWaitingForPermission: false,
            canAbort: isWorking,
            compactionDeadline: null,
            activePartType: isWorking ? parsedStatus.activePartType : undefined,
            activeToolName: isWorking ? parsedStatus.activeToolName : undefined,
            wasAborted: false,
            abortActive: false,
            lastCompletionId: null,
            isComplete: false,
            retryInfo,
        };
    }, [activityPhase, isPhaseWorking, parsedStatus, abortState, currentPiSession, sessionRetryInfo]);

    const forming = React.useMemo<FormingSummary>(() => {
        const isActive = isPhaseWorking && parsedStatus.activePartType === 'text';

        if (!isActive || !lastAssistantMessage) {
            return { isActive, characterCount: 0 };
        }

        let characterCount = 0;
        (lastAssistantMessage.content ?? []).forEach((block) => {
            if (!isTextBlock(block)) return;
            if (block.text.trim().length > 0) {
                characterCount += block.text.length;
            }
        });

        return { isActive, characterCount };
    }, [isPhaseWorking, lastAssistantMessage, parsedStatus.activePartType]);

    const working = React.useMemo<WorkingSummary>(() => {
        if (baseWorking.wasAborted || baseWorking.abortActive) {
            return baseWorking;
        }

        const sessionId = currentSessionId;
        const permissionList = sessionId ? permissions?.get(sessionId) ?? [] : [];
        const requestList = sessionId ? interactiveRequests?.get(sessionId) ?? [] : [];
        const hasPendingPermission = permissionList.length > 0;
        const hasPendingQuestion = requestList.length > 0;

        if (!hasPendingPermission && !hasPendingQuestion) {
            return baseWorking;
        }

        if (hasPendingPermission) {
            return {
                ...baseWorking,
                statusText: 'waiting for permission',
                isWaitingForPermission: true,
                canAbort: false,
                retryInfo: null,
            };
        }

        return {
            ...baseWorking,
            statusText: 'waiting for input',
            isWaitingForPermission: false,
            canAbort: false,
            retryInfo: null,
        };
    }, [currentSessionId, permissions, interactiveRequests, baseWorking]);

    return {
        forming,
        working,
    };
}
