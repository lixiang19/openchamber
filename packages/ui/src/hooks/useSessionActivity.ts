

import React from 'react';
import { useSessionStore } from '@/stores/useSessionStore';

// Mirrors OpenCode SessionStatus: busy|retry|idle.
export type SessionActivityPhase = 'idle' | 'busy' | 'retry' | 'streaming' | 'compacting';

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  // Kept for backward compatibility; always false with server session.status.
  isCooldown: boolean;
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
};

/**
 * Pi-native 化：直接从 Pi session 状态获取活动状态
 * 不再依赖旧的 sessionStatus 投影
 */
export function useSessionActivity(sessionId: string | null | undefined): SessionActivityResult {
  const piSession = useSessionStore((state) => {
    if (!sessionId) return null;
    return state.piSessions.get(sessionId) ?? null;
  });

  return React.useMemo<SessionActivityResult>(() => {
    if (!piSession) {
      return IDLE_RESULT;
    }

    // 直接从 Pi-native status 计算
    const status = piSession.status;
    const isStreaming = status === 'streaming';
    const isCompacting = status === 'compacting';
    const isRetrying = status === 'retrying';
    const isBusy = isStreaming || isCompacting || isRetrying;

    if (!isBusy) {
      return IDLE_RESULT;
    }

    // Map Pi status to activity phase
    let phase: SessionActivityPhase;
    if (isRetrying) {
      phase = 'retry';
    } else if (isStreaming) {
      phase = 'streaming';
    } else if (isCompacting) {
      phase = 'compacting';
    } else {
      phase = 'busy';
    }

    return {
      phase,
      isWorking: true,
      isBusy: true,
      isCooldown: false,
    };
  }, [piSession]);
}

export function useCurrentSessionActivity(): SessionActivityResult {
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  return useSessionActivity(currentSessionId);
}
