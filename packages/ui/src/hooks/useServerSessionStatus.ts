import React from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import { piClient } from '@/lib/pi/client';
import { projectPiSessionStatusToRuntimeStatus } from '@/lib/runtime/projections';

interface SessionAttentionState {
  needsAttention: boolean;
  lastUserMessageAt: number | null;
  lastStatusChangeAt: number;
  status: 'idle' | 'busy' | 'retry';
  isViewed: boolean;
}

const IMMEDIATE_POLL_DELAY_MS = 150;
const FOLLOW_UP_POLL_DELAY_MS = 1100;
const MIN_IMMEDIATE_POLL_GAP_MS = 1200;
const FOLLOW_UP_REARM_COOLDOWN_MS = 5000;

// Ref exposed for non-hook callers that need to force an immediate poll.
let triggerImmediatePollRef: (() => void) | null = null;

// Global function to trigger immediate poll from outside React
export const triggerSessionStatusPoll = () => {
  if (triggerImmediatePollRef) {
    triggerImmediatePollRef();
  }
};

/**
 * Hook to synchronize session status and attention state from server.
 *
 * Architecture: server maintains authoritative state, client applies snapshots.
 * SSE remains the primary transport; snapshots repair missed updates.
 */
export function useServerSessionStatus(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const isSyncingRef = React.useRef(false);
  const hasPendingImmediateSyncRef = React.useRef(false);
  const lastSyncAtRef = React.useRef(0);
  const lastImmediatePollRequestAtRef = React.useRef(0);
  const lastFollowUpPollRequestAtRef = React.useRef(0);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const followUpTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const fetchSessionStatus = React.useCallback(async (immediate = false) => {
    const now = Date.now();
    if (!immediate && now - lastSyncAtRef.current < 1000) {
      return;
    }
    if (immediate && now - lastSyncAtRef.current < 600) {
      return;
    }

    // Prevent concurrent syncs; if an immediate sync is requested while running,
    // queue one more pass right after current request settles.
    if (isSyncingRef.current) {
      if (immediate) {
        hasPendingImmediateSyncRef.current = true;
      }
      return;
    }

    isSyncingRef.current = true;
    lastSyncAtRef.current = now;

    try {
      const sessions = await piClient.listSessions();
      const currentStatuses = useSessionStore.getState().sessionStatus || new Map();
      const nextStatuses = new Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number; attempt?: number; message?: string; next?: number }>();

      sessions.forEach((session) => {
        nextStatuses.set(session.id, {
          ...projectPiSessionStatusToRuntimeStatus(session.status),
          confirmedAt: session.updatedAt,
        });
      });

      for (const [sessionId, status] of currentStatuses) {
        if (!nextStatuses.has(sessionId) && (status.type === 'busy' || status.type === 'retry')) {
          nextStatuses.set(sessionId, {
            type: 'idle',
            confirmedAt: Date.now(),
          });
        }
      }

      const currentAttentionStates = useSessionStore.getState().sessionAttentionStates || new Map();
      const nextAttentionStates = new Map<string, SessionAttentionState>();
      sessions.forEach((session) => {
        const previous = currentAttentionStates.get(session.id);
        const uiStatus = projectPiSessionStatusToRuntimeStatus(session.status).type;
        nextAttentionStates.set(session.id, {
          needsAttention: false,
          lastUserMessageAt: previous?.lastUserMessageAt ?? null,
          lastStatusChangeAt: session.updatedAt,
          status: uiStatus,
          isViewed: previous?.isViewed ?? session.id === useSessionStore.getState().currentSessionId,
        });
      });

      useSessionStore.setState({
        sessionStatus: nextStatuses,
        sessionAttentionStates: nextAttentionStates,
      });

      if (process.env.NODE_ENV === 'development') {
        console.debug('[useServerSessionStatus] Updated Pi session statuses:', {
          statusCount: nextStatuses.size,
          attentionCount: nextAttentionStates.size,
        });
      }
    } catch (error) {
      console.warn('[useServerSessionStatus] Error fetching session status:', error);
    } finally {
      isSyncingRef.current = false;
      if (hasPendingImmediateSyncRef.current) {
        hasPendingImmediateSyncRef.current = false;
        setTimeout(() => {
          void fetchSessionStatus(true);
        }, 120);
      }
    }
  }, []);

  // Function to trigger immediate snapshot sync from external modules
  const triggerImmediatePoll = React.useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastImmediatePollRequestAtRef.current;
    lastImmediatePollRequestAtRef.current = now;

    if (!timeoutRef.current) {
      const minGapDelay = elapsed >= MIN_IMMEDIATE_POLL_GAP_MS
        ? IMMEDIATE_POLL_DELAY_MS
        : Math.max(IMMEDIATE_POLL_DELAY_MS, MIN_IMMEDIATE_POLL_GAP_MS - elapsed);

      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        void fetchSessionStatus(true);
      }, minGapDelay);
    }

    // Run one follow-up sync after short settle period to catch delayed
    // server status transitions that happen right after reconnect/restore.
    // Re-arm at most once per cooldown window to avoid stacked follow-ups.
    if (!followUpTimeoutRef.current && now - lastFollowUpPollRequestAtRef.current >= FOLLOW_UP_REARM_COOLDOWN_MS) {
      lastFollowUpPollRequestAtRef.current = now;
      followUpTimeoutRef.current = setTimeout(() => {
        followUpTimeoutRef.current = null;
        void fetchSessionStatus(true);
      }, FOLLOW_UP_POLL_DELAY_MS);
    }
  }, [fetchSessionStatus]);

  // Initial snapshot sync on mount
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    void fetchSessionStatus(true);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (followUpTimeoutRef.current) {
        clearTimeout(followUpTimeoutRef.current);
      }
    };
  }, [enabled, fetchSessionStatus]);

  // Sync snapshot when tab becomes visible
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerImmediatePoll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, triggerImmediatePoll]);

  // Update the ref for external access
  React.useEffect(() => {
    if (!enabled) {
      triggerImmediatePollRef = null;
      return;
    }

    triggerImmediatePollRef = triggerImmediatePoll;
    return () => {
      triggerImmediatePollRef = null;
    };
  }, [enabled, triggerImmediatePoll]);

  return {
    fetchSessionStatus,
    triggerImmediatePoll,
  };
}

// Export ref accessor for external modules
export const getTriggerImmediatePoll = () => triggerImmediatePollRef;

export default useServerSessionStatus;
