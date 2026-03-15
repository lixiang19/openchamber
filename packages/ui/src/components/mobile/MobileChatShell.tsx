import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  RiApps2Line,
  RiAddLine,
  RiArrowLeftLine,
  RiChat4Line,
  RiFileTextLine,
  RiFolder6Line,
  RiFolderAddLine,
  RiFolderOpenLine,
  RiGitBranchLine,
  RiLoader4Line,
  RiMessage2Line,
  RiSettings3Line,
  RiStackLine,
  RiTerminalBoxLine,
  RiTimeLine,
  RiWifiOffLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DiffIcon } from '@/components/icons/DiffIcon';
import { MobileChatShellProvider } from '@/components/mobile/MobileChatShellContext';
import { ChatView } from '@/components/views';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { isDesktopLocalOriginActive, isTauriShell, requestDirectoryAccess } from '@/lib/desktop';
import type { ProjectEntry } from '@/lib/api/types';
import { PROJECT_COLOR_MAP, PROJECT_ICON_MAP, getProjectIconImageUrl } from '@/lib/projectMeta';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { sessionEvents } from '@/lib/sessionEvents';
import { cn, formatDirectoryName } from '@/lib/utils';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import {
  formatSessionDateLabel,
  isSessionRelatedToProject,
  normalizePath,
} from '@/components/session/sidebar/utils';

type MobileShellPage = 'conversations' | 'projects' | 'chat';

type SessionWithDirectory = Session & {
  directory?: string | null;
};

const getSessionUpdatedAt = (session: Session): number => {
  const updated = Number(session.time?.updated ?? session.time?.created ?? 0);
  return Number.isFinite(updated) ? updated : 0;
};

const formatRelativeTime = (timestamp?: number | null): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '刚刚';
  }

  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  if (diff < 604_800_000) {
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
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

const getProjectDisplayName = (project: ProjectEntry, homeDirectory?: string | null): string => {
  const trimmed = project.label?.trim();
  if (trimmed) {
    return trimmed;
  }
  return formatDirectoryName(project.path, homeDirectory);
};

const getSessionDirectory = (
  session: Session,
  worktreeMetadata: Map<string, { path?: string | null }>,
): string | null => {
  const worktreePath = worktreeMetadata.get(session.id)?.path;
  if (typeof worktreePath === 'string' && worktreePath.trim().length > 0) {
    return normalizePath(worktreePath) ?? worktreePath;
  }
  return normalizePath((session as SessionWithDirectory).directory ?? null);
};

const isSessionInProject = (
  session: Session,
  projectPath: string,
  worktreeMetadata: Map<string, { path?: string | null; projectDirectory?: string | null }>,
): boolean => {
  const normalizedProjectPath = normalizePath(projectPath);
  const worktreeProjectPath = normalizePath(worktreeMetadata.get(session.id)?.projectDirectory ?? null);

  if (normalizedProjectPath && worktreeProjectPath) {
    return normalizedProjectPath === worktreeProjectPath;
  }

  return isSessionRelatedToProject(session, projectPath);
};

const isSessionWorktree = (session: Session, worktreeMetadata: Map<string, { path?: string | null }>): boolean => {
  return Boolean(worktreeMetadata.get(session.id)?.path);
};

const MobileProjectAvatar: React.FC<{
  project: ProjectEntry;
  label: string;
  className?: string;
}> = ({ project, label, className }) => {
  const { currentTheme } = useThemeSystem();
  const [imageBroken, setImageBroken] = React.useState(false);
  const Icon = project.icon ? PROJECT_ICON_MAP[project.icon] : null;
  const iconColor = project.color ? (PROJECT_COLOR_MAP[project.color] ?? null) : null;
  const iconUrl = imageBroken
    ? null
    : getProjectIconImageUrl(project, {
      themeVariant: currentTheme.metadata.variant,
      iconColor: currentTheme.colors.surface.foreground,
    });
  const initial = label.slice(0, 1).toUpperCase() || '?';

  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted text-foreground',
        className,
      )}
      style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImageBroken(true)}
        />
      ) : Icon ? (
        <Icon className="size-5" style={iconColor ? { color: iconColor } : undefined} />
      ) : (
        <span className="text-sm font-semibold" style={iconColor ? { color: iconColor } : undefined}>
          {initial}
        </span>
      )}
    </div>
  );
};

const MobileShellMenu: React.FC = () => {
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0">
          <RiApps2Line className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => setActiveMainTab('plan')}>
          <RiStackLine className="size-4" />
          Plan
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setActiveMainTab('git')}>
          <RiGitBranchLine className="size-4" />
          Git
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setActiveMainTab('diff')}>
          <DiffIcon className="size-4" />
          Diff
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setActiveMainTab('files')}>
          <RiFileTextLine className="size-4" />
          Files
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setActiveMainTab('terminal')}>
          <RiTerminalBoxLine className="size-4" />
          Terminal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
          <RiSettings3Line className="size-4" />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MobileProjectsPage: React.FC<{
  onOpenChat: () => void;
}> = ({ onOpenChat }) => {
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const addProject = useProjectsStore((state) => state.addProject);
  const setActiveProject = useProjectsStore((state) => state.setActiveProject);
  const sessions = useSessionStore((state) => state.sessions);
  const openNewSessionDraft = useSessionStore((state) => state.openNewSessionDraft);
  const worktreeMetadata = useSessionStore((state) => state.worktreeMetadata);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const [creatingWorktreeFor, setCreatingWorktreeFor] = React.useState<string | null>(null);
  const tauriIpcAvailable = React.useMemo(() => isTauriShell(), []);

  const sortedProjects = React.useMemo(() => {
    return [...projects].sort((a, b) => {
      const aLast = a.lastOpenedAt ?? a.addedAt ?? 0;
      const bLast = b.lastOpenedAt ?? b.addedAt ?? 0;
      return bLast - aLast;
    });
  }, [projects]);

  const sessionCountByProject = React.useMemo(() => {
    const counts = new Map<string, number>();
    sortedProjects.forEach((project) => {
      const count = sessions.filter((session) => isSessionInProject(session, project.path, worktreeMetadata)).length;
      counts.set(project.id, count);
    });
    return counts;
  }, [sessions, sortedProjects, worktreeMetadata]);

  const handleAddProject = React.useCallback(() => {
    if (!tauriIpcAvailable || !isDesktopLocalOriginActive()) {
      sessionEvents.requestDirectoryDialog();
      return;
    }

    requestDirectoryAccess('')
      .then((result) => {
        if (result.success && result.path) {
          const added = addProject(result.path, { id: result.projectId });
          if (!added) {
            toast.error('添加项目失败', {
              description: '请选择有效目录。',
            });
          }
          return;
        }

        if (result.error && result.error !== 'Directory selection cancelled') {
          toast.error('选择目录失败', {
            description: result.error,
          });
        }
      })
      .catch((error) => {
        console.error('Failed to select directory:', error);
        toast.error('选择目录失败');
      });
  }, [addProject, tauriIpcAvailable]);

  const handleCreateSession = React.useCallback((project: ProjectEntry) => {
    setActiveProject(project.id);
    openNewSessionDraft({ directoryOverride: project.path });
    onOpenChat();
  }, [onOpenChat, openNewSessionDraft, setActiveProject]);

  const handleCreateWorktree = React.useCallback(async (project: ProjectEntry) => {
    setActiveProject(project.id);
    setCreatingWorktreeFor(project.id);
    try {
      const result = await createWorktreeSession();
      if (result?.id) {
        onOpenChat();
      }
    } finally {
      setCreatingWorktreeFor(null);
    }
  }, [onOpenChat, setActiveProject]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="px-4 pb-3 pt-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="typography-meta text-muted-foreground">手机项目页</p>
              <h1 className="typography-ui-header truncate text-foreground">项目</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleAddProject}>
                <RiFolderAddLine className="size-4" />
                添加
              </Button>
              <MobileShellMenu />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {sortedProjects.length > 0 ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {sortedProjects.map((project) => {
              const label = getProjectDisplayName(project, homeDirectory);
              const isActive = project.id === activeProjectId;
              const sessionCount = sessionCountByProject.get(project.id) ?? 0;
              const worktreeCount = sessions.filter((session) => {
                if (!isSessionWorktree(session, worktreeMetadata)) {
                  return false;
                }
                return isSessionInProject(session, project.path, worktreeMetadata);
              }).length;

              return (
                <Card
                  key={project.id}
                  className={cn(
                    'gap-0 overflow-hidden border-border bg-card p-0 shadow-none transition-colors',
                    isActive && 'border-[var(--interactive-selection)]',
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-start gap-4 px-4 py-4 text-left hover:bg-interactive-hover"
                    onClick={() => setActiveProject(project.id)}
                  >
                    <MobileProjectAvatar project={project} label={label} className="size-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
                        {isActive ? (
                          <span className="rounded-full bg-[var(--interactive-selection)] px-2 py-0.5 text-[11px] font-medium text-[var(--interactive-selection-foreground)]">
                            当前
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{compactPath(project.path, homeDirectory)}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <RiTimeLine className="size-3.5" />
                          {formatRelativeTime(project.lastOpenedAt ?? project.addedAt ?? 0)}
                        </span>
                        <span>{sessionCount} 个对话</span>
                        {worktreeCount > 0 ? <span>{worktreeCount} 个 Worktree</span> : null}
                      </div>
                    </div>
                  </button>

                  <div className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3">
                    <Button type="button" size="sm" onClick={() => handleCreateSession(project)}>
                      <RiMessage2Line className="size-4" />
                      新建对话
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={creatingWorktreeFor === project.id}
                      onClick={() => void handleCreateWorktree(project)}
                    >
                      {creatingWorktreeFor === project.id ? (
                        <RiLoader4Line className="size-4 animate-spin" />
                      ) : (
                        <RiGitBranchLine className="size-4" />
                      )}
                      Worktree
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
              <RiFolderOpenLine className="size-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">还没有项目</h2>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              添加一个本地目录后，这里会显示手机版项目卡片视图。
            </p>
            <Button type="button" className="mt-5" onClick={handleAddProject}>
              <RiAddLine className="size-4" />
              添加第一个项目
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const MobileConversationsPage: React.FC<{
  onOpenChat: () => void;
  onShowProjects: () => void;
}> = ({ onOpenChat, onShowProjects }) => {
  const sessions = useSessionStore((state) => state.sessions);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const sessionStatus = useSessionStore((state) => state.sessionStatus);
  const sessionAttentionStates = useSessionStore((state) => state.sessionAttentionStates);
  const worktreeMetadata = useSessionStore((state) => state.worktreeMetadata);
  const projects = useProjectsStore((state) => state.projects);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);

  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a));
  }, [sessions]);

  const resolveProjectForSession = React.useCallback((session: Session) => {
    const worktreeProjectPath = worktreeMetadata.get(session.id)?.projectDirectory;
    if (worktreeProjectPath) {
      const exact = projects.find((project) => normalizePath(project.path) === normalizePath(worktreeProjectPath));
      if (exact) {
        return exact;
      }
    }

    const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
    if (!sessionDirectory) {
      return null;
    }

    const matches = projects
      .filter((project) => isSessionInProject(session, project.path, worktreeMetadata))
      .sort((a, b) => b.path.length - a.path.length);
    return matches[0] ?? null;
  }, [projects, worktreeMetadata]);

  const handleOpenConversation = React.useCallback(async (session: Session) => {
    const project = resolveProjectForSession(session);
    const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
    if (project) {
      setActiveProjectIdOnly(project.id);
    }
    if (sessionDirectory && sessionDirectory !== currentDirectory) {
      setDirectory(sessionDirectory, { showOverlay: false });
    }
    await setCurrentSession(session.id);
    onOpenChat();
  }, [currentDirectory, onOpenChat, resolveProjectForSession, setActiveProjectIdOnly, setCurrentSession, setDirectory, worktreeMetadata]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="px-4 pb-3 pt-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="typography-meta text-muted-foreground">手机对话页</p>
              <h1 className="typography-ui-header truncate text-foreground">对话</h1>
            </div>
            <MobileShellMenu />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sortedSessions.length > 0 ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col">
            {sortedSessions.map((session) => {
              const project = resolveProjectForSession(session);
              const label = project ? getProjectDisplayName(project, homeDirectory) : (session.title?.trim() || '未命名对话');
              const statusType = sessionStatus.get(session.id)?.type ?? 'idle';
              const isWorking = statusType === 'busy' || statusType === 'retry';
              const needsAttention = sessionAttentionStates.get(session.id)?.needsAttention === true;
              const sessionDirectory = getSessionDirectory(session, worktreeMetadata);
              const worktree = worktreeMetadata.get(session.id);

              return (
                <button
                  key={session.id}
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-interactive-hover',
                    currentSessionId === session.id && 'bg-[var(--interactive-selection)]/55',
                  )}
                  onClick={() => void handleOpenConversation(session)}
                >
                  <div className="relative shrink-0">
                    {project ? (
                      <MobileProjectAvatar project={project} label={label} className="size-11" />
                    ) : (
                      <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-muted text-sm font-semibold text-foreground">
                        {(session.title?.trim() || 'O').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    {isWorking ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                        <RiLoader4Line className="size-3 animate-spin" />
                      </span>
                    ) : needsAttention ? (
                      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-[var(--status-info)]" />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {session.title?.trim() || '未命名对话'}
                          </h3>
                          {worktree ? (
                            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Worktree
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{project ? label : compactPath(sessionDirectory, homeDirectory)}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatSessionDateLabel(getSessionUpdatedAt(session))}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <RiTimeLine className="size-3.5" />
                        {compactPath(sessionDirectory, homeDirectory)}
                      </span>
                      {worktree?.branch ? (
                        <span className="inline-flex items-center gap-1 text-foreground/80">
                          <RiGitBranchLine className="size-3.5" />
                          {worktree.branch}
                        </span>
                      ) : null}
                      {needsAttention && !isWorking ? <span className="text-[var(--status-info)]">有未读更新</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
              <RiWifiOffLine className="size-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">还没有对话</h2>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              去项目页选一个项目，然后从手机版项目卡片里直接开启新对话。
            </p>
            <Button type="button" className="mt-5" onClick={onShowProjects}>
              <RiFolder6Line className="size-4" />
              去项目页
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const MobileChatPage: React.FC<{
  onBack: () => void;
}> = ({ onBack }) => {
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const newSessionDraft = useSessionStore((state) => state.newSessionDraft);
  const worktreeMetadata = useSessionStore((state) => state.worktreeMetadata);
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const showMobileSessionStatusBar = useUIStore((state) => state.showMobileSessionStatusBar);
  const setShowMobileSessionStatusBar = useUIStore((state) => state.setShowMobileSessionStatusBar);

  React.useEffect(() => {
    if (!showMobileSessionStatusBar) {
      return;
    }

    setShowMobileSessionStatusBar(false);

    return () => {
      setShowMobileSessionStatusBar(true);
    };
  }, [setShowMobileSessionStatusBar, showMobileSessionStatusBar]);

  const currentSession = React.useMemo(() => {
    if (!currentSessionId) {
      return null;
    }
    return sessions.find((session) => session.id === currentSessionId) ?? null;
  }, [currentSessionId, sessions]);

  const draftDirectory = newSessionDraft?.directoryOverride ?? null;
  const chatDirectory = currentSession
    ? getSessionDirectory(currentSession, worktreeMetadata)
    : normalizePath(draftDirectory ?? null);
  const activeProject = React.useMemo(() => {
    if (activeProjectId) {
      const exact = projects.find((project) => project.id === activeProjectId);
      if (exact) {
        return exact;
      }
    }

    if (!chatDirectory) {
      return null;
    }

    const matches = projects
      .filter((project) => {
        const normalizedProjectPath = normalizePath(project.path);
        return Boolean(
          normalizedProjectPath
          && (chatDirectory === normalizedProjectPath || chatDirectory.startsWith(`${normalizedProjectPath}/`)),
        );
      })
      .sort((a, b) => b.path.length - a.path.length);
    return matches[0] ?? null;
  }, [activeProjectId, chatDirectory, projects]);

  const currentWorktree = currentSessionId ? worktreeMetadata.get(currentSessionId) : null;
  const title = currentSession?.title?.trim() || '新对话';
  const subtitle = activeProject
    ? getProjectDisplayName(activeProject, homeDirectory)
    : compactPath(chatDirectory, homeDirectory);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="px-4 pb-3 pt-3" style={{ paddingTop: 'max(0.875rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3">
            <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" onClick={onBack}>
              <RiArrowLeftLine className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <MobileShellMenu />
          </div>

          {currentWorktree ? (
            <div className="mt-3 rounded-2xl border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <RiGitBranchLine className="size-4 text-primary" />
                <span className="truncate">{currentWorktree.label || currentWorktree.branch}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {compactPath(currentWorktree.path, homeDirectory)}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <MobileChatShellProvider value>
          <ChatView />
        </MobileChatShellProvider>
      </div>
    </div>
  );
};

export const MobileChatShell: React.FC = () => {
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionStore((state) => Boolean(state.newSessionDraft?.open));
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const initialPage = currentSessionId || newSessionDraftOpen ? 'chat' : 'conversations';
  const [page, setPage] = React.useState<MobileShellPage>(initialPage);
  const lastListPageRef = React.useRef<Extract<MobileShellPage, 'conversations' | 'projects'>>(initialPage === 'projects' ? 'projects' : 'conversations');

  const previousSelectionRef = React.useRef<{
    sessionId: string | null;
    draftOpen: boolean;
  }>({
    sessionId: currentSessionId,
    draftOpen: newSessionDraftOpen,
  });

  React.useEffect(() => {
    if (page !== 'chat') {
      lastListPageRef.current = page;
    }
  }, [page]);

  React.useEffect(() => {
    const previous = previousSelectionRef.current;
    const sessionChanged = currentSessionId !== previous.sessionId;
    const draftOpened = newSessionDraftOpen && !previous.draftOpen;

    if ((sessionChanged && currentSessionId) || draftOpened) {
      setPage('chat');
    }

    previousSelectionRef.current = {
      sessionId: currentSessionId,
      draftOpen: newSessionDraftOpen,
    };
  }, [currentSessionId, newSessionDraftOpen]);

  const openChatPage = React.useCallback(() => {
    setActiveMainTab('chat');
    setPage('chat');
  }, [setActiveMainTab]);

  const activeTab = page === 'projects' ? 'projects' : 'conversations';

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        {page === 'projects' ? <MobileProjectsPage onOpenChat={openChatPage} /> : null}
        {page === 'conversations' ? <MobileConversationsPage onOpenChat={openChatPage} onShowProjects={() => setPage('projects')} /> : null}
        {page === 'chat' ? <MobileChatPage onBack={() => setPage(lastListPageRef.current)} /> : null}
      </div>

      {page !== 'chat' ? (
        <nav className="grid shrink-0 grid-cols-2 gap-2 border-t border-border bg-card px-4 pb-3 pt-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button
            type="button"
            className={cn(
              'flex min-h-12 flex-col items-center justify-center rounded-2xl text-xs font-medium transition-colors',
              activeTab === 'conversations'
                ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]'
                : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
            )}
            onClick={() => setPage('conversations')}
          >
            <RiChat4Line className="size-5" />
            <span className="mt-1">对话</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex min-h-12 flex-col items-center justify-center rounded-2xl text-xs font-medium transition-colors',
              activeTab === 'projects'
                ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]'
                : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
            )}
            onClick={() => setPage('projects')}
          >
            <RiFolder6Line className="size-5" />
            <span className="mt-1">项目</span>
          </button>
        </nav>
      ) : null}
    </div>
  );
};
