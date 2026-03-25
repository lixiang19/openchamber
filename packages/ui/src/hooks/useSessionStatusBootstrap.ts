import React from 'react';
import { piClient } from '@/lib/pi/client';
import { piSessionStatusToUiStatus } from '@/lib/pi/ui-mappers';
import { useSessionStore } from '@/stores/useSessionStore';

type SessionStatusPayload = {
  type: 'idle' | 'busy' | 'retry';
  attempt?: number;
  message?: string;
  next?: number;
};

export const useSessionStatusBootstrap = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const sessions = await piClient.listSessions();
        if (cancelled || !sessions) return;

        const nextStatus = new Map<string, SessionStatusPayload>();
        sessions.forEach((session) => {
          nextStatus.set(session.id, piSessionStatusToUiStatus(session.status));
        });

        if (nextStatus.size > 0) {
          useSessionStore.setState({ sessionStatus: nextStatus });
        }
      } catch { /* ignored */ }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
};
