import React from 'react';
import type { Part } from '@/lib/runtime/types';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import type { StreamPhase } from '../types';
import type { ContentChangeReason } from '@/hooks/useChatScrollManager';
import { useStreamingTextThrottle } from '../../hooks/useStreamingTextThrottle';
import { resolveAssistantDisplayText, shouldRenderAssistantText } from './assistantTextVisibility';

type PartWithText = Part & {
    text?: string;
    content?: string;
    value?: string;
    time?: { start?: number; end?: number };
    metadata?: {
        pi?: {
            role?: string;
            customType?: string | null;
            details?: unknown;
            payload?: unknown;
            display?: boolean;
        };
    };
};

interface AssistantTextPartProps {
    part: Part;
    messageId: string;
    streamPhase: StreamPhase;
    chatRenderMode?: 'sorted' | 'live';
    onContentChange?: (reason?: ContentChangeReason, messageId?: string) => void;
}

const formatPiCustomPayload = (value: unknown): string | null => {
    if (value === undefined) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const AssistantTextPart: React.FC<AssistantTextPartProps> = ({
    part,
    messageId,
    streamPhase,
    chatRenderMode = 'live',
}) => {
    const partWithText = part as PartWithText;
    const rawText = typeof partWithText.text === 'string' ? partWithText.text : '';
    const piMetadata = partWithText.metadata?.pi;
    const isPiCustomMessage = piMetadata?.role === 'custom';
    const customType = typeof piMetadata?.customType === 'string' ? piMetadata.customType.trim() : '';
    const customPayloadText = formatPiCustomPayload(piMetadata?.payload ?? piMetadata?.details);
    const contentText = typeof partWithText.content === 'string' ? partWithText.content : '';
    const valueText = typeof partWithText.value === 'string' ? partWithText.value : '';
    const textContent = [rawText, contentText, valueText].reduce((best, candidate) => {
        return candidate.length > best.length ? candidate : best;
    }, '');
    const isStreamingPhase = streamPhase === 'streaming';
    const isCooldownPhase = streamPhase === 'cooldown';
    const isStreaming = chatRenderMode === 'live' && (isStreamingPhase || isCooldownPhase);

    const throttledTextContent = useStreamingTextThrottle({
        text: textContent,
        isStreaming,
        identityKey: `${messageId}:${part.id ?? 'text'}`,
    });

    const displayTextContent = resolveAssistantDisplayText({
        textContent,
        throttledTextContent,
        isStreaming,
    });

    const lastDisplayLengthRef = React.useRef(0);
    React.useEffect(() => {
        if (!isStreaming || typeof window === 'undefined') {
            lastDisplayLengthRef.current = displayTextContent.length;
            return;
        }
        const debugEnabled = window.localStorage.getItem('openchamber_stream_debug') === '1';
        if (!debugEnabled) {
            lastDisplayLengthRef.current = displayTextContent.length;
            return;
        }
        if (displayTextContent.length < lastDisplayLengthRef.current) {
            console.info('[STREAM-TRACE] render_shrink', {
                messageId,
                partId: part.id,
                rawTextLen: rawText.length,
                contentLen: contentText.length,
                valueLen: valueText.length,
                chosenLen: textContent.length,
                throttledLen: throttledTextContent.length,
                displayLen: displayTextContent.length,
                prevDisplayLen: lastDisplayLengthRef.current,
            });
        }
        lastDisplayLengthRef.current = displayTextContent.length;
    }, [contentText.length, displayTextContent.length, isStreaming, messageId, part.id, rawText.length, textContent.length, throttledTextContent.length, valueText.length]);

    const time = partWithText.time;
    const isFinalized = Boolean(time && typeof time.end !== 'undefined');

    const isRenderableTextPart = part.type === 'text' || part.type === 'reasoning';
    if (!isRenderableTextPart) {
        return null;
    }

    if (isPiCustomMessage && piMetadata?.display === false) {
        return null;
    }

    if (!shouldRenderAssistantText({
        displayTextContent,
        isFinalized,
    }) && !isPiCustomMessage) {
        return null;
    }

    return (
        <div
            className={`group/assistant-text relative break-words ${chatRenderMode === 'live' ? 'my-1' : ''}`}
            key={part.id || `${messageId}-text`}
        >
            {isPiCustomMessage ? (
                <div className="mb-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="typography-micro rounded bg-foreground/5 px-1.5 py-0.5 text-muted-foreground">Pi custom</span>
                        {customType ? <span className="typography-micro text-foreground/70">{customType}</span> : null}
                    </div>
                    {customPayloadText && customPayloadText.trim().length > 0 ? (
                        <details className="mb-2">
                            <summary className="cursor-pointer typography-micro text-muted-foreground">Payload</summary>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 typography-micro text-foreground/80">{customPayloadText}</pre>
                        </details>
                    ) : null}
                </div>
            ) : null}
            {displayTextContent ? (
                <MarkdownRenderer
                    content={displayTextContent}
                    part={part}
                    messageId={messageId}
                    isAnimated={false}
                    isStreaming={isStreaming}
                    disableStreamAnimation={chatRenderMode === 'sorted'}
                    variant={part.type === 'reasoning' ? 'reasoning' : 'assistant'}
                />
            ) : null}
        </div>
    );
};

export default AssistantTextPart;
