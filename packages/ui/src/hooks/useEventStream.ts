import React from 'react';

import { piClient } from '@/lib/pi/client';
import type { PiClientState } from '@/lib/pi/reducer';
import {
  applyPiClientServerEvent,
  bootstrapPiClientSessions,
  getPiClientState,
  subscribePiClientState,
  upsertPiClientSession,
} from '@/lib/pi/stateRuntime';
import {
  buildRuntimeSessionsByDirectory,
  projectPiSessionToRuntimeSession,
  projectPiSessionsToRuntimeStatus,
} from '@/lib/runtime/projections';
import { useSessionStore as useSessionManagementStore } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useMessageStore } from '@/stores/messageStore';
import type { MessageStreamLifecycle, SessionHistoryMeta, SessionMemoryState } from '@/stores/types/sessionTypes';

const projectPiStateToStores = (state: PiClientState) => {
  const sessions = Object.values(state.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
  // NOTE: Pi-native 化路径 - 保留旧 Session 投影作为 UI 过渡，但优先使用 PiSessions
  const uiSessions = sessions.map(projectPiSessionToRuntimeSession);
  const sessionIds = new Set(sessions.map((session) => session.id));

  const sessionStore = useSessionManagementStore.getState();
  const previousCurrent = sessionStore.currentSessionId;
  const currentSessionId = previousCurrent && sessionIds.has(previousCurrent)
    ? previousCurrent
    : sessions[0]?.id ?? null;

  useSessionManagementStore.setState({
    // Pi-native: piSessions 作为唯一真相源
    piSessions: new Map(sessions.map((session) => [session.id, session])),
    // 兼容：保留旧 Session 投影作为 UI 过渡
    sessions: uiSessions,
    archivedSessions: [],
    sessionsByDirectory: buildRuntimeSessionsByDirectory(uiSessions),
    currentSessionId,
    lastLoadedDirectory: currentSessionId
      ? (sessions.find((session) => session.id === currentSessionId)?.cwd ?? null)
      : null,
    isLoading: false,
    error: null,
  });

  // Pi-native: 不再维护旧消息缓存投影，状态直接从 piSessions 消费
  const previousMessageState = useMessageStore.getState();
  const sessionHistoryMeta = new Map<string, SessionHistoryMeta>();
  const sessionMemoryState = new Map<string, SessionMemoryState>();
  const streamingMessageIds = new Map<string, string | null>();
  const messageStreamStates = new Map<string, MessageStreamLifecycle>();

  for (const session of sessions) {
    const previousMemory = previousMessageState.sessionMemoryState.get(session.id);
    const messageCount = session.messages.length;

    sessionHistoryMeta.set(session.id, {
      limit: Number.MAX_SAFE_INTEGER,
      complete: true,
      loading: false,
    });

    sessionMemoryState.set(session.id, {
      viewportAnchor: previousMemory?.viewportAnchor ?? 0,
      isStreaming: session.isStreaming,
      streamStartTime: previousMemory?.streamStartTime,
      lastAccessedAt: previousMemory?.lastAccessedAt ?? Date.now(),
      backgroundMessageCount: previousMemory?.backgroundMessageCount ?? 0,
      loadedTurnCount: messageCount,
      totalAvailableMessages: messageCount,
      hasMoreAbove: false,
      hasMoreTurnsAbove: false,
      historyLoading: false,
      historyComplete: true,
      historyLimit: Number.MAX_SAFE_INTEGER,
    });

    if (session.runtime.activeAssistantMessageId) {
      streamingMessageIds.set(session.id, session.runtime.activeAssistantMessageId);
      messageStreamStates.set(session.runtime.activeAssistantMessageId, {
        phase: 'streaming',
        startedAt: session.updatedAt,
        lastUpdateAt: session.updatedAt,
      });
    }
  }

  useMessageStore.setState({
    sessionHistoryMeta,
    sessionMemoryState,
    streamingMessageIds,
    messageStreamStates,
    isSyncing: false,
  });

  useSessionStore.setState({
    piSessions: new Map(
      Object.values(state.sessions).map((session) => [session.id, session])
    ),
    interactiveRequests: new Map(
      Object.values(state.sessions)
        .filter((session) => session.interactiveRequests.length > 0)
        .map((session) => [session.id, [...session.interactiveRequests]])
    ),
    sessionStatus: projectPiSessionsToRuntimeStatus(state.sessions),
  });
};

export const useEventStream = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    let frame: number | null = null;
    let projectedState = getPiClientState();

    const scheduleProjection = (nextState: PiClientState) => {
      projectedState = nextState;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!active) return;
        projectPiStateToStores(projectedState);
      });
    };

    const bootstrap = async () => {
      useSessionManagementStore.setState({ isLoading: true, error: null });
      try {
        const sessions = await piClient.listSessions();
        if (!active) return;
        bootstrapPiClientSessions(sessions);
      } catch (error) {
        if (!active) return;
        useSessionManagementStore.setState({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load Pi sessions',
        });
      }
    };

    const unsubscribeProjection = subscribePiClientState((nextState) => {
      if (!active) {
        return;
      }
      scheduleProjection(nextState);
    });
    if (Object.keys(projectedState.sessions).length > 0) {
      scheduleProjection(projectedState);
    }

    void bootstrap();

    const unsubscribe = piClient.subscribe(null, (event) => {
      if (!active) return;

      const currentState = getPiClientState();

      if (event.type !== 'heartbeat' && event.type !== 'notification' && !currentState.sessions[event.sessionId]) {
        void piClient.getSession(event.sessionId)
          .then((session) => {
            if (!active) return;
            upsertPiClientSession(session);
            applyPiClientServerEvent(event);
          })
          .catch(() => {
            // Ignore late events for sessions that disappeared before hydration.
          });
        return;
      }

      applyPiClientServerEvent(event);
    });

    return () => {
      active = false;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      unsubscribeProjection();
      unsubscribe();
    };
  }, [enabled]);
};
