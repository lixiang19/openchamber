import React from 'react';
import type { Session } from '@/lib/runtime/types';
import { RiChat4Line } from '@remixicon/react';
import { ChatInput } from '@/components/chat/ChatInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ProjectEntry } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import { formatSessionDateLabel, isSessionRelatedToProject, normalizePath } from '@/components/session/sidebar/utils';

const RECENT_SESSION_LIMIT = 12;
const JUST_COMPLETED_WINDOW_MS = 90 * 1000;
const JUST_COMPLETED_REFRESH_MS = 30 * 1000;

type InboxSessionStatus = {
  type: 'idle' | 'busy' | 'retry';
  attempt?: number;
  message?: string;
  next?: number;
  confirmedAt?: number;
};

type InboxAttentionState = {
  needsAttention: boolean;
  lastUserMessageAt: number | null;
  lastStatusChangeAt: number;
  status: 'idle' | 'busy' | 'retry';
  isViewed: boolean;
};

type InboxStatusTone = 'info' | 'warning' | 'success';

type InboxStatusBadge = {
  label: string;
  tone: InboxStatusTone;
  pulse?: boolean;
  isPending: boolean;
};

const INBOX_STATUS_STYLES: Record<InboxStatusTone, { text: string; dot: string }> = {
  info: {
    text: 'var(--status-info)',
    dot: 'var(--status-info)',
  },
  warning: {
    text: 'var(--status-warning)',
    dot: 'var(--status-warning)',
  },
  success: {
    text: 'var(--status-success)',
    dot: 'var(--status-success)',
  },
};

type SessionWithDirectory = Session & {
  directory?: string | null;
};

const getSessionUpdatedAt = (session: Session): number => {
  const updated = Number(session.time?.updated ?? session.time?.created ?? 0);
  return Number.isFinite(updated) ? updated : 0;
};

const getSessionDirectory = (
  session: Session,
  worktreeMetadata: Map<string, WorktreeMetadata>,
): string | null => {
  const worktreePath = worktreeMetadata.get(session.id)?.path;
  if (typeof worktreePath === 'string' && worktreePath.trim().length > 0) {
    return normalizePath(worktreePath) ?? worktreePath;
  }

  return normalizePath((session as SessionWithDirectory).directory ?? null);
};

const resolveProjectForSession = (
  session: Session,
  projects: ProjectEntry[],
  worktreeMetadata: Map<string, WorktreeMetadata>,
): ProjectEntry | null => {
  const worktreeProjectPath = normalizePath(worktreeMetadata.get(session.id)?.projectDirectory ?? null);
  if (worktreeProjectPath) {
    const exact = projects.find((project) => normalizePath(project.path) === worktreeProjectPath);
    if (exact) {
      return exact;
    }
  }

  const matches = projects
    .filter((project) => {
      const normalizedProjectPath = normalizePath(project.path);
      if (normalizedProjectPath && worktreeProjectPath) {
        return normalizedProjectPath === worktreeProjectPath;
      }
      return isSessionRelatedToProject(session, project.path);
    })
    .sort((a, b) => b.path.length - a.path.length);

  return matches[0] ?? null;
};

const resolveProjectForDraftDirectory = (
  draftDirectory: string | null | undefined,
  projects: ProjectEntry[],
  activeProjectId: string | null,
): string => {
  const normalizedDraft = normalizePath(draftDirectory ?? null);
  if (normalizedDraft) {
    const exact = projects.find((project) => normalizePath(project.path) === normalizedDraft);
    if (exact) {
      return exact.id;
    }
  }

  if (activeProjectId && projects.some((project) => project.id === activeProjectId)) {
    return activeProjectId;
  }

  return projects[0]?.id ?? '';
};

const getLikelyCompletionTimestamp = (
  sessionUpdatedAt: number,
  attentionState?: InboxAttentionState,
): number => {
  if (!attentionState || attentionState.status !== 'idle' || attentionState.lastStatusChangeAt <= 0) {
    return sessionUpdatedAt;
  }

  if (sessionUpdatedAt <= 0) {
    return attentionState.lastStatusChangeAt;
  }

  return Math.abs(sessionUpdatedAt - attentionState.lastStatusChangeAt) <= 15_000
    ? Math.max(sessionUpdatedAt, attentionState.lastStatusChangeAt)
    : sessionUpdatedAt;
};

const getInboxStatusBadge = ({
  session,
  sessionState,
  attentionState,
  permissionCount,
  questionCount,
  now,
}: {
  session: Session;
  sessionState?: InboxSessionStatus;
  attentionState?: InboxAttentionState;
  permissionCount: number;
  questionCount: number;
  now: number;
}): InboxStatusBadge | null => {
  const statusType = sessionState?.type ?? 'idle';

  if (permissionCount > 0) {
    return { label: 'Approval', tone: 'warning', isPending: true };
  }

  if (questionCount > 0) {
    return { label: 'Question', tone: 'info', isPending: true };
  }

  if (statusType === 'retry') {
    return { label: 'Retrying', tone: 'warning', pulse: true, isPending: true };
  }

  if (statusType === 'busy') {
    return { label: 'Running', tone: 'info', pulse: true, isPending: true };
  }

  if (attentionState?.needsAttention) {
    return { label: 'Unread', tone: 'info', isPending: true };
  }

  const completionTimestamp = getLikelyCompletionTimestamp(getSessionUpdatedAt(session), attentionState);
  const hasRecentCompletion = Boolean(
    attentionState?.lastUserMessageAt &&
    statusType === 'idle' &&
    completionTimestamp > 0 &&
    completionTimestamp >= attentionState.lastUserMessageAt &&
    now - completionTimestamp <= JUST_COMPLETED_WINDOW_MS,
  );

  if (hasRecentCompletion) {
    return { label: 'Just done', tone: 'success', isPending: false };
  }

  return null;
};

export const InboxView: React.FC = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const newSessionDraft = useSessionStore((state) => state.newSessionDraft);
  const openNewSessionDraft = useSessionStore((state) => state.openNewSessionDraft);
  const closeNewSessionDraft = useSessionStore((state) => state.closeNewSessionDraft);
  const sessionStatus = useSessionStore((state) => state.sessionStatus);
  const sessionAttentionStates = useSessionStore((state) => state.sessionAttentionStates);
  const permissions = useSessionStore((state) => state.permissions);
  const questions = useSessionStore((state) => state.questions);
  const worktreeMetadata = useSessionStore((state) => state.worktreeMetadata);

  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);

  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);

  const setAppPage = useUIStore((state) => state.setAppPage);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);

  const [showPendingOnly, setShowPendingOnly] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const inboxOwnedDraftRef = React.useRef(false);
  const previousSessionIdRef = React.useRef<string | null>(currentSessionId);

  const recentSessions = React.useMemo(
    () => [...sessions].sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a)).slice(0, RECENT_SESSION_LIMIT),
    [sessions],
  );

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, JUST_COMPLETED_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (newSessionDraft?.open) {
      return undefined;
    }

    inboxOwnedDraftRef.current = true;
    openNewSessionDraft({ directoryOverride: currentDirectory ?? null });

    return () => undefined;
  }, [currentDirectory, newSessionDraft?.open, openNewSessionDraft]);

  React.useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    if (previousSessionId === null && currentSessionId) {
      setAppPage('workspace');
      setActiveMainTab('chat');
    }
    previousSessionIdRef.current = currentSessionId;
  }, [currentSessionId, setActiveMainTab, setAppPage]);

  React.useEffect(() => {
    return () => {
      if (!inboxOwnedDraftRef.current) {
        return;
      }

      const storeState = useSessionStore.getState();
      if (storeState.newSessionDraft?.open && !storeState.currentSessionId) {
        closeNewSessionDraft();
      }
    };
  }, [closeNewSessionDraft]);

  const sessionBadges = React.useMemo(() => {
    const next = new Map<string, InboxStatusBadge | null>();

    for (const session of recentSessions) {
      next.set(session.id, getInboxStatusBadge({
        session,
        sessionState: sessionStatus?.get(session.id),
        attentionState: sessionAttentionStates.get(session.id),
        permissionCount: permissions.get(session.id)?.length ?? 0,
        questionCount: questions.get(session.id)?.length ?? 0,
        now,
      }));
    }

    return next;
  }, [now, permissions, questions, recentSessions, sessionAttentionStates, sessionStatus]);

  const filteredSessions = React.useMemo(() => {
    return recentSessions.filter((session) => {
      const badge = sessionBadges.get(session.id);
      return showPendingOnly ? badge?.isPending === true : true;
    });
  }, [recentSessions, sessionBadges, showPendingOnly]);

  const selectedProjectId = React.useMemo(
    () => resolveProjectForDraftDirectory(newSessionDraft?.directoryOverride, projects, activeProjectId),
    [activeProjectId, newSessionDraft?.directoryOverride, projects],
  );

  const handleProjectChange = React.useCallback(
    (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        return;
      }

      if (project.id !== activeProjectId) {
        setActiveProjectIdOnly(project.id);
      }

      if (project.path !== currentDirectory) {
        setDirectory(project.path, { showOverlay: false });
      }

      useSessionStore.setState((state) => ({
        newSessionDraft: {
          ...state.newSessionDraft,
          open: true,
          directoryOverride: project.path,
          parentID: null,
        },
      }));
    },
    [activeProjectId, currentDirectory, projects, setActiveProjectIdOnly, setDirectory],
  );

  const handleOpenConversation = React.useCallback(
    async (session: Session) => {
      const project = resolveProjectForSession(session, projects, worktreeMetadata);
      const sessionDirectory = getSessionDirectory(session, worktreeMetadata);

      if (project && project.id !== activeProjectId) {
        setActiveProjectIdOnly(project.id);
      }
      if (sessionDirectory && sessionDirectory !== currentDirectory) {
        setDirectory(sessionDirectory, { showOverlay: false });
      }

      if (inboxOwnedDraftRef.current && useSessionStore.getState().newSessionDraft?.open) {
        closeNewSessionDraft();
      }

      setAppPage('workspace');
      setActiveMainTab('chat');
      await setCurrentSession(session.id);
    },
    [activeProjectId, closeNewSessionDraft, currentDirectory, projects, setActiveMainTab, setActiveProjectIdOnly, setAppPage, setCurrentSession, setDirectory, worktreeMetadata],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        background: 'radial-gradient(ellipse 80% 40% at 50% 0%, color-mix(in srgb, var(--primary) 5%, transparent), transparent), var(--background)',
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[680px] min-h-0 flex-col px-6 py-8 sm:px-10 sm:py-10">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="shrink-0 mb-7 flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[20px] font-semibold tracking-[-0.03em] text-foreground leading-none">Inbox</h1>
            {filteredSessions.length > 0 && (
              <span className="text-[13px] tabular-nums text-muted-foreground/50">
                {filteredSessions.length}
              </span>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer select-none">
            <span className={cn('transition-colors', showPendingOnly ? 'text-foreground' : 'text-muted-foreground/60')}>
              Pending
            </span>
            <Switch checked={showPendingOnly} onCheckedChange={setShowPendingOnly} aria-label="只看待处理对话" />
          </label>
        </div>

        {/* ── Input area — no wrapper, ChatInput's own border is the border ── */}
        <div className="shrink-0 mb-2 [&_.chat-column]:px-0 [&_.chat-message-column]:px-0">
          <ChatInput />
          <div className="mt-2 flex items-center px-1">
            <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger
                size="lg"
                className="h-auto w-auto min-w-0 max-w-[280px] border-0 bg-transparent p-0 text-[12px] text-muted-foreground/50 shadow-none hover:text-muted-foreground focus:ring-0"
              >
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.label?.trim() || project.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Divider ────────────────────────────────────────────── */}
        <div className="shrink-0 mb-1 flex items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/35">Recent</span>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        {/* ── Session list ───────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto -mx-2 px-0">
          {filteredSessions.length > 0 ? (
            <div className="py-1">
              {filteredSessions.map((session) => {
                const project = resolveProjectForSession(session, projects, worktreeMetadata);
                const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
                const statusBadge = sessionBadges.get(session.id) ?? null;
                const badgeStyle = statusBadge ? INBOX_STATUS_STYLES[statusBadge.tone] : null;
                const isActiveSession = currentSessionId === session.id;

                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void handleOpenConversation(session)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-100',
                      isActiveSession
                        ? 'bg-[var(--interactive-selection)]/10'
                        : 'hover:bg-[var(--interactive-hover)]/50',
                    )}
                  >
                    {/* Title row */}
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="truncate text-[13.5px] font-medium leading-5 tracking-[-0.01em] text-foreground">
                        {session.title?.trim() || '未命名对话'}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/45">
                        {formatSessionDateLabel(getSessionUpdatedAt(session))}
                      </span>
                    </div>

                    {/* Subtitle row: project + status */}
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate text-[12px] text-muted-foreground/50">
                        {project?.label?.trim() || sessionDirectory || '—'}
                      </span>
                      {statusBadge && badgeStyle ? (
                        <span
                          className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium"
                          style={{ color: badgeStyle.text }}
                        >
                          <span
                            className={cn('size-1.5 rounded-full', statusBadge.pulse && 'animate-pulse')}
                            style={{ background: badgeStyle.dot }}
                          />
                          {statusBadge.label}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* ── Empty State ─────────────────────────────────────── */
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
              <RiChat4Line className="size-7 text-muted-foreground/25" />
              <p className="text-[13px] text-muted-foreground/45">
                {showPendingOnly ? '没有待处理的对话' : '还没有对话，从上方开始新建'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
