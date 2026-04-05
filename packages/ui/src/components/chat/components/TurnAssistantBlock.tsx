import React from 'react';

import type { ChatMessageEntry } from '../lib/turns/types';
import { isEmptyTextPart } from '../message/partUtils';

interface TurnAssistantBlockProps {
    assistantMessages: ChatMessageEntry[];
    renderMessage: (message: ChatMessageEntry) => React.ReactNode;
    chatRenderMode: 'sorted' | 'live';
    isStreaming: boolean;
    isCollapsedHistoryExpanded: boolean;
}

const hasVisibleText = (message: ChatMessageEntry): boolean => {
    return message.parts.some((part) => part.type === 'text' && !isEmptyTextPart(part));
};

const TurnAssistantBlock: React.FC<TurnAssistantBlockProps> = ({
    assistantMessages,
    renderMessage,
    chatRenderMode,
    isStreaming,
    isCollapsedHistoryExpanded,
}) => {
    const latestMessage = assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1]
        : null;

    const finalExpandedMessage = React.useMemo(() => {
        if (assistantMessages.length === 0) {
            return null;
        }
        for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
            const candidate = assistantMessages[index];
            if (hasVisibleText(candidate)) {
                return candidate;
            }
        }
        return assistantMessages[assistantMessages.length - 1] ?? null;
    }, [assistantMessages]);

    const hiddenMessageCount = React.useMemo(() => {
        if (!finalExpandedMessage) {
            return 0;
        }
        return Math.max(0, assistantMessages.length - 1);
    }, [assistantMessages.length, finalExpandedMessage]);

    const visibleMessages = React.useMemo(() => {
        if (assistantMessages.length === 0) {
            return [] as ChatMessageEntry[];
        }
        if (isStreaming) {
            if (chatRenderMode === 'sorted') {
                return latestMessage ? [latestMessage] : [];
            }
            return assistantMessages;
        }
        if (isCollapsedHistoryExpanded || hiddenMessageCount === 0) {
            return assistantMessages;
        }
        return finalExpandedMessage ? [finalExpandedMessage] : [];
    }, [assistantMessages, chatRenderMode, finalExpandedMessage, hiddenMessageCount, isCollapsedHistoryExpanded, isStreaming, latestMessage]);

    if (assistantMessages.length === 0) {
        return null;
    }

    return (
        <div className="relative z-0">
            {visibleMessages.map((message) => renderMessage(message))}
        </div>
    );
};

export default React.memo(TurnAssistantBlock);
