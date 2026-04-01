import React from 'react';

import { piClient } from '@/lib/pi/client';
import type { PiClientSessionState, PiClientState } from '@/lib/pi/reducer';
import type { PiSessionViewState } from '@/lib/pi/types';
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
  projectPiSessionStatusToRuntimeStatus,
} from '@/lib/runtime/projections';
import { useSessionStore as useSessionManagementStore } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useMessageStore } from '@/stores/messageStore';
import type { MessageStreamLifecycle, SessionHistoryMeta, SessionMemoryState } from '@/stores/types/sessionTypes';

// 上一次投影的状态缓存，用于增量更新
let lastProjectedState: PiClientState | null = null;
let lastPiSessions = new Map<string, PiSessionViewState>();

/**
 * 按 session 增量投影 Pi 状态到 stores
 * 只更新发生变化的 session，避免全量重建 Maps
 */
const projectPiStateToStoresIncremental = (nextState: PiClientState) => {
  const sessions = Object.values(nextState.sessions).sort((a: PiSessionViewState, b: PiSessionViewState) => b.updatedAt - a.updatedAt);
  const sessionIds = new Set(sessions.map((session) => session.id));
  
  // 检测哪些 sessions 发生了变化或新增
  const changedSessions: PiSessionViewState[] = [];
  const newSessions = new Map<string, PiSessionViewState>();
  
  for (const session of sessions) {
    const lastSession = lastPiSessions.get(session.id);
    if (!lastSession || lastSession.updatedAt !== session.updatedAt) {
      changedSessions.push(session);
    }
    newSessions.set(session.id, session);
  }
  
  // 检测被移除的 sessions
  const removedSessionIds: string[] = [];
  for (const [id] of lastPiSessions) {
    if (!sessionIds.has(id)) {
      removedSessionIds.push(id);
    }
  }
  
  // 如果没有变化且是增量更新，直接返回
  if (changedSessions.length === 0 && removedSessionIds.length === 0 && lastProjectedState) {
    return;
  }
  
  // 更新缓存
  lastProjectedState = nextState;
  lastPiSessions = newSessions;

  const sessionStore = useSessionManagementStore.getState();
  const previousCurrent = sessionStore.currentSessionId;
  const currentSessionId = previousCurrent && sessionIds.has(previousCurrent)
    ? previousCurrent
    : sessions[0]?.id ?? null;

  // 真正的增量投影：只重新投影变化的 sessions
  // 获取现有的 uiSessions Map，保留未变化的 session 数据
  const existingUiSessions = new Map(
    sessionStore.sessions?.map((s) => [s.id, s]) ?? []
  );
  
  // 只对变化的 sessions 重新投影，未变化的使用现有数据
  const uiSessions = sessions.map((session) => {
    const isChanged = changedSessions.some((s) => s.id === session.id);
    if (!isChanged && existingUiSessions.has(session.id)) {
      return existingUiSessions.get(session.id)!;
    }
    return projectPiSessionToRuntimeSession(session);
  });

  useSessionManagementStore.setState({
    piSessions: newSessions,
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

  // 增量更新 message store
  const previousMessageState = useMessageStore.getState();
  const sessionHistoryMeta = new Map(previousMessageState.sessionHistoryMeta);
  const sessionMemoryState = new Map(previousMessageState.sessionMemoryState);
  const streamingMessageIds = new Map(previousMessageState.streamingMessageIds);
  const messageStreamStates = new Map(previousMessageState.messageStreamStates);

  // 移除已删除的 sessions
  for (const id of removedSessionIds) {
    sessionHistoryMeta.delete(id);
    sessionMemoryState.delete(id);
    streamingMessageIds.delete(id);
  }

  // 只更新变化的 sessions
  for (const session of changedSessions) {
    const previousMemory = sessionMemoryState.get(session.id);
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

    if (session.isStreaming) {
      // 使用 runtime.activeAssistantMessageId 确定当前活跃的流式消息
      // 这比推断最后一个 assistant 更准确，尤其在复杂流式场景中
      const activeAssistantId = (session as PiClientSessionState).runtime?.activeAssistantMessageId;
      if (activeAssistantId) {
        streamingMessageIds.set(session.id, activeAssistantId);
        messageStreamStates.set(activeAssistantId, {
          phase: 'streaming',
          startedAt: session.updatedAt,
          lastUpdateAt: session.updatedAt,
        });
      } else {
        // 降级：如果 runtime 中没有，尝试取最后一个 assistant
        const lastAssistant = session.messages
          .filter((m): m is Extract<typeof m, { role: 'assistant' }> => m.role === 'assistant')
          .pop();
        if (lastAssistant?.id) {
          streamingMessageIds.set(session.id, lastAssistant.id);
          messageStreamStates.set(lastAssistant.id, {
            phase: 'streaming',
            startedAt: session.updatedAt,
            lastUpdateAt: session.updatedAt,
          });
        }
      }
    } else {
      streamingMessageIds.delete(session.id);
    }
  }

  useMessageStore.setState({
    sessionHistoryMeta,
    sessionMemoryState,
    streamingMessageIds,
    messageStreamStates,
    isSyncing: false,
  });

  // 更新 session store - 增量更新
  // 保留现有的 interactiveRequests，只更新变化的 sessions
  const currentInteractiveRequests = new Map(useSessionStore.getState().interactiveRequests);
  for (const session of changedSessions) {
    if (session.interactiveRequests.length > 0) {
      currentInteractiveRequests.set(session.id, [...session.interactiveRequests]);
    } else {
      currentInteractiveRequests.delete(session.id);
    }
  }
  for (const id of removedSessionIds) {
    currentInteractiveRequests.delete(id);
  }

  // 增量更新 sessionStatus，只更新变化的 sessions
  const currentSessionStatus = new Map(useSessionStore.getState().sessionStatus);
  for (const session of changedSessions) {
    currentSessionStatus.set(session.id, {
      ...projectPiSessionStatusToRuntimeStatus(session.status),
      confirmedAt: session.updatedAt,
    });
  }
  for (const id of removedSessionIds) {
    currentSessionStatus.delete(id);
  }

  useSessionStore.setState({
    piSessions: newSessions,
    interactiveRequests: currentInteractiveRequests,
    sessionStatus: currentSessionStatus,
  });
};

/**
 * 完整投影（用于初始加载或重置）
 */
const projectPiStateToStoresFull = (state: PiClientState) => {
  lastProjectedState = null;
  lastPiSessions = new Map();
  projectPiStateToStoresIncremental(state);
};

export const useEventStream = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;

    const bootstrap = async () => {
      useSessionManagementStore.setState({ isLoading: true, error: null });
      try {
        const sessions = await piClient.listSessions();
        if (!active) return;
        bootstrapPiClientSessions(sessions);
        // 初始投影：完整投影所有 sessions
        const state = getPiClientState();
        projectPiStateToStoresFull(state);
      } catch (error) {
        if (!active) return;
        useSessionManagementStore.setState({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load Pi sessions',
        });
      }
    };

    // 订阅 Pi 状态变化 - 增量投影，不使用 RAF
    const unsubscribeProjection = subscribePiClientState((nextState) => {
      if (!active) {
        return;
      }
      // 增量投影，只更新变化的 sessions
      projectPiStateToStoresIncremental(nextState);
    });

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
      unsubscribeProjection();
      unsubscribe();
    };
  }, [enabled]);
};
