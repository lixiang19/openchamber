import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { RiArrowRightLine, RiChat4Line, RiLoader4Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectEntry } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import { formatSessionDateLabel, isSessionRelatedToProject, normalizePath } from '@/components/session/sidebar/utils';

const RECENT_SESSION_LIMIT = 12;

type SessionWithDirectory = Session & {
  directory?: string | null;
};

const getSessionUpdatedAt = (session: Session): number => {
  const updated = Number(session.time?.updated ?? session.time?.created ?? 0);
  return Number.isFinite(updated) ? updated : 0;
};

const compactPath = (path: string | null | undefined, homeDirectory?: string | null): string => {
  if (!path) {
    return '未绑定目录';
  }

  const normalized = normalizePath(path) ?? path;
  const display = homeDirectory
    ? normalized.replace(new RegExp(`^${homeDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '~')
    : normalized;
  const segments = display.split('/').filter(Boolean);

  if (segments.length <= 2) {
    return display;
  }

  return `.../${segments.slice(-2).join('/')}`;
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

export const InboxView: React.FC = () => {
  const sessions = useSessionStore((state) => state.sessions);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const openNewSessionDraft = useSessionStore((state) => state.openNewSessionDraft);
  const sessionStatus = useSessionStore((state) => state.sessionStatus);
  const sessionAttentionStates = useSessionStore((state) => state.sessionAttentionStates);
  const worktreeMetadata = useSessionStore((state) => state.worktreeMetadata);

  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);

  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);

  const setAppPage = useUIStore((state) => state.setAppPage);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);

  const [prompt, setPrompt] = React.useState('');

  const recentSessions = React.useMemo(
    () => [...sessions].sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a)).slice(0, RECENT_SESSION_LIMIT),
    [sessions],
  );

  const activeProject = React.useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
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

      setAppPage('workspace');
      setActiveMainTab('chat');
      await setCurrentSession(session.id);
    },
    [activeProjectId, currentDirectory, projects, setActiveMainTab, setActiveProjectIdOnly, setAppPage, setCurrentSession, setDirectory, worktreeMetadata],
  );

  const handleCreateConversation = React.useCallback(() => {
    const text = prompt.trim();
    setAppPage('workspace');
    setActiveMainTab('chat');
    openNewSessionDraft({
      directoryOverride: activeProject?.path ?? currentDirectory ?? null,
      initialPrompt: text.length > 0 ? text : undefined,
    });
    setPrompt('');
  }, [activeProject?.path, currentDirectory, openNewSessionDraft, prompt, setActiveMainTab, setAppPage]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col gap-6 px-8 py-8">
        <section className="shrink-0 rounded-[28px] border border-border/60 bg-[var(--surface-elevated)] p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <RiChat4Line className="size-4" />
            <span>收件箱</span>
          </div>
          <div className="rounded-[24px] border border-border/70 bg-background/80 p-4 sm:p-5">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  handleCreateConversation();
                }
              }}
              placeholder="开始一个新对话..."
              className="min-h-[180px] w-full resize-none bg-transparent text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground/80"
            />
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
              <p className="text-sm text-muted-foreground">
                {activeProject?.label?.trim() || compactPath(activeProject?.path ?? currentDirectory, homeDirectory)}
              </p>
              <Button type="button" size="lg" onClick={handleCreateConversation}>
                开始对话
                <RiArrowRightLine className="size-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-[var(--surface-elevated)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">最近对话</p>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">继续上次的工作</h2>
            </div>
            <span className="text-xs text-muted-foreground">最近 {recentSessions.length} 条</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4">
            {recentSessions.length > 0 ? (
              <div className="space-y-3">
                {recentSessions.map((session) => {
                  const project = resolveProjectForSession(session, projects, worktreeMetadata);
                  const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
                  const statusType = sessionStatus?.get(session.id)?.type ?? 'idle';
                  const isWorking = statusType === 'busy' || statusType === 'retry';
                  const needsAttention = sessionAttentionStates.get(session.id)?.needsAttention === true;
                  const isActiveSession = currentSessionId === session.id;

                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => void handleOpenConversation(session)}
                      className={cn(
                        'flex w-full items-center gap-4 rounded-[22px] border px-4 py-4 text-left transition-colors',
                        isActiveSession
                          ? 'border-[var(--interactive-selection)] bg-[var(--interactive-selection)]/12'
                          : 'border-border/70 bg-background/70 hover:bg-interactive-hover/40',
                      )}
                    >
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-[var(--surface-elevated)] text-foreground">
                        {isWorking ? <RiLoader4Line className="size-4 animate-spin" /> : <RiChat4Line className="size-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-[15px] font-semibold text-foreground">
                              {session.title?.trim() || '未命名对话'}
                            </h3>
                            <p className="mt-1 truncate text-sm text-muted-foreground">
                              {project?.label?.trim() || compactPath(project?.path ?? sessionDirectory, homeDirectory)}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatSessionDateLabel(getSessionUpdatedAt(session))}
                          </span>
                        </div>
                        {needsAttention && !isWorking ? (
                          <p className="mt-2 text-xs text-[var(--status-info)]">有未读更新</p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-foreground">
                  <RiChat4Line className="size-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-foreground">还没有最近对话</h3>
                <p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">
                  在上面的输入框里输入你的第一个任务，马上开始新的对话。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
