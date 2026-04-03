import React from 'react';

interface UseStreamingTextThrottleInput {
    text: string;
    isStreaming: boolean;
    throttleMs?: number;
    identityKey?: string;
}

const DEFAULT_STREAMING_TEXT_THROTTLE_MS = 100;

export const computeStreamingThrottleDelay = (lastEmitAt: number, now: number, throttleMs: number): number => {
    const elapsed = now - lastEmitAt;
    return Math.max(0, throttleMs - elapsed);
};

interface StreamingThrottleState {
    timer: ReturnType<typeof setTimeout> | null;
    pendingText: string;
    lastEmitAt: number;
}

const clearTimer = (state: StreamingThrottleState): void => {
    if (!state.timer) {
        return;
    }
    clearTimeout(state.timer);
    state.timer = null;
};

export const useStreamingTextThrottle = ({
    text,
    isStreaming,
    throttleMs = DEFAULT_STREAMING_TEXT_THROTTLE_MS,
    identityKey,
}: UseStreamingTextThrottleInput): string => {
    const [throttledText, setThrottledText] = React.useState(text);
    const latestTextRef = React.useRef(text);
    const emittedTextRef = React.useRef(text);

    const stateRef = React.useRef<StreamingThrottleState>({
        timer: null,
        pendingText: text,
        lastEmitAt: 0,
    });

    const commitText = React.useCallback((nextText: string) => {
        emittedTextRef.current = nextText;
        setThrottledText((previousText) => (previousText === nextText ? previousText : nextText));
    }, []);

    React.useEffect(() => {
        latestTextRef.current = text;
    }, [text]);

    React.useEffect(() => {
        const state = stateRef.current;
        clearTimer(state);
        state.pendingText = latestTextRef.current;
        state.lastEmitAt = 0;
        commitText(latestTextRef.current);
    }, [commitText, identityKey]);

    React.useEffect(() => {
        const state = stateRef.current;
        state.pendingText = text;
        const currentText = emittedTextRef.current;
        const stableText = isStreaming && currentText.length > text.length ? currentText : text;

        if (!isStreaming) {
            clearTimer(state);
            state.lastEmitAt = Date.now();
            commitText(stableText);
            return;
        }

        const now = Date.now();
        const remaining = computeStreamingThrottleDelay(state.lastEmitAt, now, throttleMs);

        if (remaining <= 0) {
            clearTimer(state);
            state.lastEmitAt = now;
            commitText(stableText);
            return;
        }

        clearTimer(state);
        state.timer = setTimeout(() => {
            state.timer = null;
            state.lastEmitAt = Date.now();
            const nextText = emittedTextRef.current.length > state.pendingText.length
                ? emittedTextRef.current
                : state.pendingText;
            commitText(nextText);
        }, remaining);

        return () => {
            clearTimer(state);
        };
    }, [commitText, isStreaming, text, throttleMs]);

    React.useEffect(() => {
        const state = stateRef.current;
        return () => {
            clearTimer(state);
        };
    }, []);

    return throttledText;
};
