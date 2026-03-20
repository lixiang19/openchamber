import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  RiArrowRightUpLine,
  RiBookOpenLine,
  RiChat4Line,
  RiFileTextLine,
  RiFolderOpenLine,
  RiHistoryLine,
  RiSparklingLine,
  RiTimeLine,
} from '@remixicon/react';
import { ChatInput } from '@/components/chat/ChatInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn, formatPathForDisplay } from '@/lib/utils';
import type { ProjectEntry } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';
import { sessionEvents } from '@/lib/sessionEvents';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import { useFilesViewTabsStore } from '@/stores/useFilesViewTabsStore';
import { formatSessionDateLabel, isSessionRelatedToProject, normalizePath } from '@/components/session/sidebar/utils';

const RECENT_CONVERSATION_LIMIT = 8;
const WORKSPACE_PREVIEW_LIMIT = 6;
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

type SessionWithDirectory = Session & {
  directory?: string | null;
};

type WorkspaceSummary = {
  project: ProjectEntry;
  conversationCount: number;
  pendingCount: number;
};

type RecentLibraryFile = {
  root: string;
  path: string;
  project: ProjectEntry | null;
  fileName: string;
  relativePath: string;
  rootTouchedAt: number;
  isSelected: boolean;
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
    attentionState?.lastUserMessageAt
    && statusType === 'idle'
    && completionTimestamp > 0
    && completionTimestamp >= attentionState.lastUserMessageAt
    && now - completionTimestamp <= JUST_COMPLETED_WINDOW_MS,
  );

  if (hasRecentCompletion) {
    return { label: 'Just done', tone: 'success', isPending: false };
  }

  return null;
};

const DashboardMetric: React.FC<{ label: string; value: string; helper: string }> = ({ label, value, helper }) => (
  <div className="rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-4 py-3">
    <div className="typography-meta text-muted-foreground">{label}</div>
    <div className="mt-1 typography-ui-header font-semibold text-foreground">{value}</div>
    <div className="mt-1 typography-meta text-muted-foreground">{helper}</div>
  </div>
);

const getRelativeFilePath = (root: string, path: string): string => {
  if (!root) {
    return path;
  }
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
};

const getFileName = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
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
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);

  const setAppPage = useUIStore((state) => state.setAppPage);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const filesByRoot = useFilesViewTabsStore((state) => state.byRoot);

  const [showNeedsAttentionOnly, setShowNeedsAttentionOnly] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const inboxOwnedDraftRef = React.useRef(false);
  const previousSessionIdRef = React.useRef<string | null>(currentSessionId);

  const recentConversations = React.useMemo(
    () => [...sessions].sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a)).slice(0, RECENT_CONVERSATION_LIMIT),
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

  const conversationBadges = React.useMemo(() => {
    const next = new Map<string, InboxStatusBadge | null>();

    for (const session of recentConversations) {
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
  }, [now, permissions, questions, recentConversations, sessionAttentionStates, sessionStatus]);

  const filteredConversations = React.useMemo(() => {
    return recentConversations.filter((session) => {
      const badge = conversationBadges.get(session.id);
      return showNeedsAttentionOnly ? badge?.isPending === true : true;
    });
  }, [conversationBadges, recentConversations, showNeedsAttentionOnly]);

  const selectedProjectId = React.useMemo(
    () => resolveProjectForDraftDirectory(newSessionDraft?.directoryOverride, projects, activeProjectId),
    [activeProjectId, newSessionDraft?.directoryOverride, projects],
  );

  const activeProject = React.useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [activeProjectId, projects, selectedProjectId],
  );

  const workspaceSummaries = React.useMemo<WorkspaceSummary[]>(() => {
    return [...projects]
      .sort((a, b) => (b.lastOpenedAt ?? b.addedAt ?? 0) - (a.lastOpenedAt ?? a.addedAt ?? 0))
      .slice(0, WORKSPACE_PREVIEW_LIMIT)
      .map((project) => {
        const relatedConversations = sessions.filter((session) => isSessionRelatedToProject(session, project.path));
        const pendingCount = relatedConversations.filter((session) => conversationBadges.get(session.id)?.isPending === true).length;
        return {
          project,
          conversationCount: relatedConversations.length,
          pendingCount,
        };
      });
  }, [conversationBadges, projects, sessions]);

  const attentionCount = React.useMemo(
    () => recentConversations.filter((session) => conversationBadges.get(session.id)?.isPending === true).length,
    [conversationBadges, recentConversations],
  );

  const recentLibraryFiles = React.useMemo<RecentLibraryFile[]>(() => {
    const items: RecentLibraryFile[] = [];

    for (const [root, state] of Object.entries(filesByRoot)) {
      const ordered = [state.selectedPath, ...state.openPaths.slice().reverse()]
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      const seen = new Set<string>();
      const project = projects.find((candidate) => normalizePath(candidate.path) === normalizePath(root)) ?? null;

      for (const filePath of ordered) {
        if (seen.has(filePath)) {
          continue;
        }
        seen.add(filePath);
        items.push({
          root,
          path: filePath,
          project,
          fileName: getFileName(filePath),
          relativePath: getRelativeFilePath(root, filePath),
          rootTouchedAt: state.touchedAt,
          isSelected: state.selectedPath === filePath,
        });
      }
    }

    return items
      .sort((a, b) => b.rootTouchedAt - a.rootTouchedAt)
      .slice(0, 8);
  }, [filesByRoot, projects]);

  const hasWorkspaces = projects.length > 0;
  const hasConversations = recentConversations.length > 0;
  const hasLibraryFiles = recentLibraryFiles.length > 0;

  const dashboardIntro = !hasWorkspaces
    ? 'Start by creating a workspace. Your conversations, notes, and library files will stay grouped around each topic.'
    : !hasConversations
      ? 'You already have a workspace. Start the first conversation or jump into the library to organize source material.'
      : !hasLibraryFiles
        ? 'Your conversations are flowing. Next, open files or reference material so the workspace becomes a real study and research hub.'
        : 'Start a new conversation, reopen recent work, or jump straight into the library without digging through coding-first panels.';

  const syncWorkspaceProject = React.useCallback((project: ProjectEntry, targetTab: 'chat' | 'files') => {
    if (project.id !== activeProjectId) {
      setActiveProjectIdOnly(project.id);
    }

    if (project.path !== currentDirectory) {
      setDirectory(project.path, { showOverlay: false });
    }

    setAppPage('workspace');
    setActiveMainTab(targetTab);
  }, [activeProjectId, currentDirectory, setActiveMainTab, setActiveProjectIdOnly, setAppPage, setDirectory]);

  const openLibraryFile = React.useCallback((entry: RecentLibraryFile) => {
    const project = entry.project ?? projects.find((candidate) => normalizePath(candidate.path) === normalizePath(entry.root)) ?? null;

    if (project && project.id !== activeProjectId) {
      setActiveProjectIdOnly(project.id);
    }

    if (entry.root !== currentDirectory) {
      setDirectory(entry.root, { showOverlay: false });
    }

    useFilesViewTabsStore.getState().setSelectedPath(entry.root, entry.path);
    setAppPage('workspace');
    setActiveMainTab('files');
  }, [activeProjectId, currentDirectory, projects, setActiveMainTab, setActiveProjectIdOnly, setAppPage, setDirectory]);

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
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in srgb, var(--primary-base) 10%, transparent), transparent), var(--surface-background)',
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-col px-6 py-8 sm:px-8 sm:py-10">
        <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="typography-meta uppercase tracking-[0.18em] text-muted-foreground">Home</div>
            <h1 className="mt-2 typography-ui-header text-[clamp(1.9rem,3vw,2.7rem)] font-semibold leading-none text-foreground">
              Workspace dashboard
            </h1>
            <p className="mt-3 max-w-2xl typography-ui-label text-muted-foreground">
              {dashboardIntro}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[30rem]">
            <DashboardMetric label="Recent conversations" value={String(recentConversations.length)} helper="Your latest AI threads" />
            <DashboardMetric label="Needs attention" value={String(attentionCount)} helper="Questions, approvals, or unread updates" />
            <DashboardMetric label="Library files" value={String(recentLibraryFiles.length)} helper="Recently opened source material" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
          <section className="flex min-h-0 flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 typography-ui-header font-medium text-foreground">
                    <RiSparklingLine className="h-4 w-4" />
                    {hasWorkspaces ? 'Start a new conversation' : 'Create your first workspace'}
                  </div>
                  <p className="mt-1 typography-meta text-muted-foreground">
                    {hasWorkspaces
                      ? 'New conversations start in the selected workspace so files, notes, and context stay together.'
                      : 'A workspace gives you one place for conversations, documents, and reference material.'}
                  </p>
                </div>
              </div>

              {hasWorkspaces ? (
                <>
                  <div className="[&_.chat-column]:px-0 [&_.chat-message-column]:px-0">
                    <ChatInput />
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-[var(--interactive-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                        <SelectTrigger
                          size="lg"
                          className="h-9 min-w-[14rem] max-w-[22rem] border-[var(--interactive-border)] bg-[var(--surface-background)] px-3 text-sm text-foreground shadow-none"
                        >
                          <SelectValue placeholder="Choose workspace" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.label?.trim() || project.path}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <button
                        type="button"
                        onClick={() => {
                          if (activeProject) {
                            syncWorkspaceProject(activeProject, 'files');
                          }
                        }}
                        disabled={!activeProject}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-background)] px-3 typography-ui-label text-foreground transition-colors hover:bg-[var(--interactive-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RiFileTextLine className="h-4 w-4" />
                        Open library
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => sessionEvents.requestProjectCreateDialog()}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-[var(--primary-base)] px-3 typography-ui-label text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)]"
                    >
                      <RiFolderOpenLine className="h-4 w-4" />
                      Add workspace
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-background)] px-5 py-5">
                  <div className="typography-ui-label font-medium text-foreground">Your first workspace becomes the home for one topic, project, course, or research thread.</div>
                  <div className="mt-2 typography-meta text-muted-foreground">
                    Create a fresh workspace from the starter template, or add an existing folder that already contains your material.
                  </div>
                  <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2">
                      Templates are good for new study, writing, or research tracks.
                    </div>
                    <div className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-3 py-2">
                      Existing folders are good when you already have notes or source files on disk.
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => sessionEvents.requestProjectCreateDialog()}
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--primary-base)] px-3 typography-ui-label text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)]"
                    >
                      <RiFolderOpenLine className="h-4 w-4" />
                      Create workspace
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="typography-ui-header font-medium text-foreground">Recent conversations</div>
                  <p className="mt-1 typography-meta text-muted-foreground">
                    Reopen active work, unread updates, or recently finished conversations.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 typography-meta text-muted-foreground cursor-pointer select-none">
                  <span className={cn('transition-colors', showNeedsAttentionOnly ? 'text-foreground' : 'text-muted-foreground')}>
                    Needs attention only
                  </span>
                  <Switch checked={showNeedsAttentionOnly} onCheckedChange={setShowNeedsAttentionOnly} aria-label="Show conversations that need attention only" />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {filteredConversations.length > 0 ? (
                  <div className="space-y-2">
                    {filteredConversations.map((session) => {
                      const project = resolveProjectForSession(session, projects, worktreeMetadata);
                      const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
                      const statusBadge = conversationBadges.get(session.id) ?? null;
                      const badgeStyle = statusBadge ? INBOX_STATUS_STYLES[statusBadge.tone] : null;
                      const isActiveConversation = currentSessionId === session.id;

                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => void handleOpenConversation(session)}
                          className={cn(
                            'flex w-full items-start justify-between gap-4 rounded-2xl border border-transparent px-4 py-3 text-left transition-colors',
                            isActiveConversation
                              ? 'border-[var(--interactive-border)] bg-[var(--interactive-selection)]/12'
                              : 'bg-[var(--surface-background)] hover:border-[var(--interactive-border)] hover:bg-[var(--interactive-hover)]/40',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <RiChat4Line className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate typography-ui-label font-medium text-foreground">
                                {session.title?.trim() || 'Untitled Conversation'}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 typography-meta text-muted-foreground">
                              <span className="truncate">{project?.label?.trim() || formatPathForDisplay(sessionDirectory || '—', homeDirectory)}</span>
                              <span className="inline-flex items-center gap-1">
                                <RiTimeLine className="h-3.5 w-3.5" />
                                {formatSessionDateLabel(getSessionUpdatedAt(session))}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {statusBadge && badgeStyle ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-1 typography-meta font-medium"
                                style={{ color: badgeStyle.text }}
                              >
                                <span
                                  className={cn('size-1.5 rounded-full', statusBadge.pulse && 'animate-pulse')}
                                  style={{ background: badgeStyle.dot }}
                                />
                                {statusBadge.label}
                              </span>
                            ) : null}
                            <RiArrowRightUpLine className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-background)] px-6 text-center">
                    <RiChat4Line className="h-8 w-8 text-muted-foreground" />
                    <div className="mt-3 typography-ui-label font-medium text-foreground">
                      {showNeedsAttentionOnly ? 'Nothing needs attention right now' : 'No recent conversations yet'}
                    </div>
                    <p className="mt-1 max-w-sm typography-meta text-muted-foreground">
                      {showNeedsAttentionOnly
                        ? 'Questions, approvals, and unread updates will surface here automatically.'
                        : hasWorkspaces
                          ? 'Start with the composer above and your recent work will appear here.'
                          : 'Create a workspace first, then your active conversations will show up here.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-6">
            <div className="rounded-[28px] border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="mb-4">
                <div className="typography-ui-header font-medium text-foreground">Workspaces</div>
                <p className="mt-1 typography-meta text-muted-foreground">
                  Jump between projects, studies, or research folders without opening developer panels first.
                </p>
              </div>

              <div className="space-y-3">
                {workspaceSummaries.map(({ project, conversationCount, pendingCount }) => {
                  const isActive = project.id === activeProjectId;
                  const label = project.label?.trim() || formatPathForDisplay(project.path, homeDirectory);
                  return (
                    <div
                      key={project.id}
                      className={cn(
                        'rounded-2xl border px-4 py-3',
                        isActive
                          ? 'border-[var(--interactive-border)] bg-[var(--interactive-selection)]/12'
                          : 'border-[var(--interactive-border)] bg-[var(--surface-background)]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate typography-ui-label font-medium text-foreground">{label}</div>
                          <div className="mt-1 truncate typography-meta text-muted-foreground" title={project.path}>
                            {formatPathForDisplay(project.path, homeDirectory)}
                          </div>
                        </div>
                        {pendingCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-[var(--status-info-background)] px-2 py-1 typography-meta font-medium text-[var(--status-info)]">
                            {pendingCount} active
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="typography-meta text-muted-foreground">
                          {conversationCount} {conversationCount === 1 ? 'conversation' : 'conversations'}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => syncWorkspaceProject(project, 'files')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--interactive-border)] px-2.5 typography-meta text-foreground transition-colors hover:bg-[var(--interactive-hover)]"
                          >
                            <RiFileTextLine className="h-3.5 w-3.5" />
                            Library
                          </button>
                          <button
                            type="button"
                            onClick={() => syncWorkspaceProject(project, 'chat')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--surface-muted)] px-2.5 typography-meta text-foreground transition-colors hover:bg-[var(--interactive-hover)]"
                          >
                            <RiArrowRightUpLine className="h-3.5 w-3.5" />
                            Open
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {workspaceSummaries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-6 text-center">
                    <div className="typography-ui-label font-medium text-foreground">No workspaces yet</div>
                    <p className="mt-1 typography-meta text-muted-foreground">
                      Add a workspace to organize files, notes, and conversations around one topic.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[28px] border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="mb-4">
                <div className="flex items-center gap-2 typography-ui-header font-medium text-foreground">
                  <RiHistoryLine className="h-4 w-4" />
                  Recent library files
                </div>
                <p className="mt-1 typography-meta text-muted-foreground">
                  Reopen source material you touched recently without navigating the full file tree.
                </p>
              </div>

              <div className="space-y-3">
                {recentLibraryFiles.map((entry) => (
                  <button
                    key={`${entry.root}:${entry.path}`}
                    type="button"
                    onClick={() => openLibraryFile(entry)}
                    className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-3 text-left transition-colors hover:bg-[var(--interactive-hover)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate typography-ui-label font-medium text-foreground">{entry.fileName}</div>
                      <div className="mt-1 truncate typography-meta text-muted-foreground">{entry.relativePath}</div>
                      <div className="mt-2 truncate typography-meta text-muted-foreground/80">
                        {entry.project?.label?.trim() || formatPathForDisplay(entry.root, homeDirectory)}
                      </div>
                    </div>
                    {entry.isSelected ? (
                      <span className="shrink-0 rounded-full bg-[var(--interactive-selection)] px-2 py-1 typography-meta font-medium text-[var(--interactive-selection-foreground)]">
                        Current
                      </span>
                    ) : (
                      <RiArrowRightUpLine className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))}

                {!hasLibraryFiles ? (
                  <div className="rounded-2xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-6 text-center">
                    <div className="typography-ui-label font-medium text-foreground">No recent library files yet</div>
                    <p className="mt-1 typography-meta text-muted-foreground">
                      Open files from a workspace library and they will appear here for quick return access.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[28px] border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="typography-ui-header font-medium text-foreground">Quick access</div>
              <div className="mt-1 typography-meta text-muted-foreground">
                Use the homepage as the calm starting point for writing, reading, and research work.
              </div>

              <div className="mt-4 grid gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (activeProject) {
                      syncWorkspaceProject(activeProject, 'chat');
                    }
                  }}
                    disabled={!activeProject}
                    className="flex items-center justify-between rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-3 text-left transition-colors hover:bg-[var(--interactive-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div>
                      <div className="typography-ui-label font-medium text-foreground">Return to workspace</div>
                      <div className="typography-meta text-muted-foreground">Continue in chat with the current workspace context.</div>
                  </div>
                  <RiArrowRightUpLine className="h-4 w-4 text-muted-foreground" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (activeProject) {
                      syncWorkspaceProject(activeProject, 'files');
                    }
                  }}
                  disabled={!activeProject}
                  className="flex items-center justify-between rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-3 text-left transition-colors hover:bg-[var(--interactive-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div>
                    <div className="typography-ui-label font-medium text-foreground">Browse library materials</div>
                    <div className="typography-meta text-muted-foreground">Open files, reading notes, and source material for the active workspace.</div>
                  </div>
                  <RiBookOpenLine className="h-4 w-4 text-muted-foreground" />
                </button>

                <button
                  type="button"
                  onClick={() => sessionEvents.requestProjectCreateDialog()}
                  className="flex items-center justify-between rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-3 text-left transition-colors hover:bg-[var(--interactive-hover)]"
                >
                  <div>
                    <div className="typography-ui-label font-medium text-foreground">Create or add workspace</div>
                    <div className="typography-meta text-muted-foreground">Open an existing folder or create a fresh workspace from the starter template.</div>
                  </div>
                  <RiFolderOpenLine className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
