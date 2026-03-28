import type { PiContentBlock, PiMessageViewState, PiSessionViewState } from '@/lib/pi/types';
import type { ChatMessageEntry, TurnDiffStats, TurnSummaryRecord } from './types';

interface SummaryDiff {
    additions?: number | null;
    deletions?: number | null;
}

interface UserSummaryPayload {
    body?: string | null;
    diffs?: SummaryDiff[] | null;
}

const isPiTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => block.type === 'text';

const getTextFromPart = (part: unknown): string | undefined => {
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string' && text.trim().length > 0) {
        return text;
    }
    const content = (part as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim().length > 0) {
        return content;
    }
    return undefined;
};

const getAssistantFallbackText = (assistantMessage: ChatMessageEntry): { text: string; sourcePartId: string } | null => {
    for (let partIndex = assistantMessage.parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = assistantMessage.parts[partIndex];
        if (!part || part.type !== 'text') continue;

        const text = getTextFromPart(part);
        if (!text) continue;

        return {
            text,
            sourcePartId: part.id ?? `${assistantMessage.info.id}-part-${partIndex}-text`,
        };
    }

    return null;
};

export const buildPiAssistantTextById = (session: PiSessionViewState | null | undefined): Map<string, string> => {
    const next = new Map<string, string>();
    if (!session) {
        return next;
    }

    session.messages.forEach((message) => {
        if (message.role !== 'assistant' || typeof message.id !== 'string' || message.id.length === 0) {
            return;
        }
        const text = message.content
            .filter(isPiTextBlock)
            .map((block) => block.text)
            .join('')
            .trim();
        if (text.length > 0) {
            next.set(message.id, text);
        }
    });

    return next;
};

export const projectTurnSummary = (
    assistantMessages: ChatMessageEntry[],
    options?: {
        piAssistantTextById?: Map<string, string> | null;
        piAssistantById?: Map<string, Extract<PiMessageViewState, { role: 'assistant' }>> | null;
    },
): TurnSummaryRecord => {
    const piAssistantTextById = options?.piAssistantTextById ?? null;
    const piAssistantById = options?.piAssistantById ?? null;

    for (let messageIndex = assistantMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const assistantMessage = assistantMessages[messageIndex];
        if (!assistantMessage) continue;

        const piMessage = piAssistantById?.get(assistantMessage.info.id);
        const finish = piMessage?.stopReason === 'stop' || piMessage?.stopReason === 'endTurn'
            ? 'stop'
            : (assistantMessage.info as { finish?: string | null }).finish;
        if (finish !== 'stop') continue;

        const piText = piAssistantTextById?.get(assistantMessage.info.id);
        if (piText) {
            return {
                text: piText,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: `${assistantMessage.info.id}-pi-text`,
            };
        }

        const fallback = getAssistantFallbackText(assistantMessage);
        if (fallback) {
            return {
                text: fallback.text,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: fallback.sourcePartId,
            };
        }
    }

    for (let messageIndex = assistantMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const assistantMessage = assistantMessages[messageIndex];
        if (!assistantMessage) continue;

        const piText = piAssistantTextById?.get(assistantMessage.info.id);
        if (piText) {
            return {
                text: piText,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: `${assistantMessage.info.id}-pi-text`,
            };
        }

        const fallback = getAssistantFallbackText(assistantMessage);
        if (fallback) {
            return {
                text: fallback.text,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: fallback.sourcePartId,
            };
        }
    }

    return {};
};

export const projectTurnDiffStats = (userMessage: ChatMessageEntry): TurnDiffStats | undefined => {
    const summary = (userMessage.info as { summary?: UserSummaryPayload | null }).summary;
    const diffs = summary?.diffs;
    if (!Array.isArray(diffs) || diffs.length === 0) {
        return undefined;
    }

    let additions = 0;
    let deletions = 0;
    let files = 0;

    diffs.forEach((diff) => {
        if (!diff) return;

        const diffAdditions = typeof diff.additions === 'number' ? diff.additions : 0;
        const diffDeletions = typeof diff.deletions === 'number' ? diff.deletions : 0;

        if (diffAdditions !== 0 || diffDeletions !== 0) {
            files += 1;
        }

        additions += diffAdditions;
        deletions += diffDeletions;
    });

    if (files === 0) {
        return undefined;
    }

    return {
        additions,
        deletions,
        files,
    };
};
