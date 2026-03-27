import React from 'react';

import { piClient } from '@/lib/pi/client';
import {
  applyPiServerEventAction,
  bootstrapSessionsAction,
  createInitialPiClientState,
  piClientReducer,
  upsertSessionAction,
  type PiClientState,
} from '@/lib/pi/reducer';
import {
  buildRuntimeSessionsByDirectory,
  projectPiSessionToRuntimeMessages,
  projectPiSessionToRuntimeSession,
  projectPiSessionsToQuestions,
  projectPiSessionsToRuntimeStatus,
} from '@/lib/runtime/projections';
import { useSessionStore as useSessionManagementStore } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useMessageStore } from '@/stores/messageStore';
import { useQuestionStore } from '@/stores/questionStore';
import type { MessageStreamLifecycle, SessionHistoryMeta, SessionMemoryState } from '@/stores/types/sessionTypes';

const projectPiStateToStores = (state: PiClientState) => {
  const sessions = Object.values(state.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
  const uiSessions = sessions.map(projectPiSessionToRuntimeSession);
  const sessionIds = new Set(uiSessions.map((session) => session.id));

  const sessionStore = useSessionManagementStore.getState();
  const previousCurrent = sessionStore.currentSessionId;
  const currentSessionId = previousCurrent && sessionIds.has(previousCurrent)
    ? previousCurrent
    : uiSessions[0]?.id ?? null;

  useSessionManagementStore.setState({
    sessions: uiSessions,
    archivedSessions: [],
    sessionsByDirectory: buildRuntimeSessionsByDirectory(uiSessions),
    currentSessionId,
    lastLoadedDirectory: currentSessionId
      ? ((uiSessions.find((session) => session.id === currentSessionId) as { directory?: string | null } | undefined)?.directory ?? null)
      : null,
    isLoading: false,
    error: null,
  });

  const previousMessageState = useMessageStore.getState();
  const messages = new Map<string, { info: import('@/lib/runtime/types').Message; parts: import('@/lib/runtime/types').Part[] }[]>();
  const sessionHistoryMeta = new Map<string, SessionHistoryMeta>();
  const sessionMemoryState = new Map<string, SessionMemoryState>();
  const streamingMessageIds = new Map<string, string | null>();
  const messageStreamStates = new Map<string, MessageStreamLifecycle>();

  for (const session of sessions) {
    messages.set(session.id, projectPiSessionToRuntimeMessages(session));
    sessionHistoryMeta.set(session.id, {
      limit: Number.MAX_SAFE_INTEGER,
      complete: true,
      loading: false,
    });

    const previousMemory = previousMessageState.sessionMemoryState.get(session.id);
    sessionMemoryState.set(session.id, {
      viewportAnchor: previousMemory?.viewportAnchor ?? 0,
      isStreaming: session.isStreaming,
      streamStartTime: previousMemory?.streamStartTime,
      lastAccessedAt: previousMemory?.lastAccessedAt ?? Date.now(),
      backgroundMessageCount: previousMemory?.backgroundMessageCount ?? 0,
      loadedTurnCount: messages.get(session.id)?.length ?? 0,
      totalAvailableMessages: messages.get(session.id)?.length ?? 0,
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
    messages,
    sessionHistoryMeta,
    sessionMemoryState,
    streamingMessageIds,
    messageStreamStates,
    isSyncing: false,
  });

  useQuestionStore.setState({
    questions: projectPiSessionsToQuestions(state.sessions),
  });

  useSessionStore.setState({
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
    let state = createInitialPiClientState();

    const scheduleProjection = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!active) return;
        projectPiStateToStores(state);
      });
    };

    const bootstrap = async () => {
      useSessionManagementStore.setState({ isLoading: true, error: null });
      try {
        const sessions = await piClient.listSessions();
        if (!active) return;
        state = piClientReducer(state, bootstrapSessionsAction(sessions));
        scheduleProjection();
      } catch (error) {
        if (!active) return;
        useSessionManagementStore.setState({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load Pi sessions',
        });
      }
    };

    void bootstrap();

    const unsubscribe = piClient.subscribe(null, (event) => {
      if (!active) return;

      if (event.type !== 'heartbeat' && event.type !== 'notification' && !state.sessions[event.sessionId]) {
        void piClient.getSession(event.sessionId)
          .then((session) => {
            if (!active) return;
            state = piClientReducer(state, upsertSessionAction(session));
            state = piClientReducer(state, applyPiServerEventAction(event));
            scheduleProjection();
          })
          .catch(() => {
            // Ignore late events for sessions that disappeared before hydration.
          });
        return;
      }

      state = piClientReducer(state, applyPiServerEventAction(event));
      scheduleProjection();
    });

    return () => {
      active = false;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      unsubscribe();
    };
  }, [enabled]);
};
