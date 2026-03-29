import React from 'react';
import { toast } from '@/components/ui';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { sessionEvents } from '@/lib/sessionEvents';
import { isTauriShell } from '@/lib/desktop';
import { useFileSystemAccess } from '@/hooks/useFileSystemAccess';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { showOpenCodeStatus } from '@/lib/openCodeStatus';

const MENU_ACTION_EVENT = 'ridge:menu-action';
const CHECK_FOR_UPDATES_EVENT = 'ridge:check-for-updates';

type TauriEventApi = {
  listen?: (
    event: string,
    handler: (evt: { payload?: unknown }) => void
  ) => Promise<() => void>;
};

type TauriGlobal = {
  event?: TauriEventApi;
};

type MenuAction =
  | 'about'
  | 'settings'
  | 'command-palette'
  | 'new-session'
  | 'new-worktree-session'
  | 'change-workspace'
  | 'open-git-tab'
  | 'open-diff-tab'
  | 'open-files-tab'
  | 'open-terminal-tab'
  | 'copy'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'
  | 'toggle-sidebar'
  | 'toggle-memory-debug'
  | 'help-dialog'
  | 'download-logs';

export const useMenuActions = (
  onToggleMemoryDebug?: () => void
) => {
  const { openNewSessionDraft } = useSessionStore();
  const {
    toggleCommandPalette,
    toggleHelpDialog,
    toggleSidebar,
    setSessionSwitcherOpen,
    setActiveMainTab,
    setSettingsDialogOpen,
    setAboutDialogOpen,
  } = useUIStore();
  const { addProject } = useProjectsStore();
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const { requestAccess, startAccessing } = useFileSystemAccess();
  const { setThemeMode } = useThemeSystem();
  const checkUpdatesInFlightRef = React.useRef(false);

  const handleCheckForUpdates = React.useCallback(() => {
    if (checkUpdatesInFlightRef.current) {
      return;
    }
    checkUpdatesInFlightRef.current = true;

    void checkForUpdates()
      .then(() => {
        const { available, error } = useUpdateStore.getState();
        if (error) {
          toast.error('检查更新失败', {
            description: error,
          });
          return;
        }

        if (!available) {
          toast.success('已是最新版本');
        }
      })
      .finally(() => {
        checkUpdatesInFlightRef.current = false;
      });
  }, [checkForUpdates]);

  const handleChangeWorkspace = React.useCallback(() => {
    if (isTauriShell()) {
      requestAccess('')
        .then(async (result) => {
          if (!result.success || !result.path) {
            if (result.error && result.error !== '目录选择已取消') {
              toast.error('选择目录失败', {
                description: result.error,
              });
            }
            return;
          }

          const accessResult = await startAccessing(result.path);
          if (!accessResult.success) {
            toast.error('打开目录失败', {
              description: accessResult.error || '桌面无法授予文件访问权限。',
            });
            return;
          }

          const added = addProject(result.path, { id: result.projectId });
          if (!added) {
            toast.error('添加项目失败', {
              description: '请选择有效的目录路径。',
            });
          }
        })
        .catch((error) => {
          console.error('Desktop: Error selecting directory:', error);
          toast.error('选择目录失败');
        });
    }

    sessionEvents.requestDirectoryDialog();
  }, [addProject, requestAccess, startAccessing]);

  const handleAction = React.useCallback(
    (action: MenuAction) => {
      switch (action) {
        case 'about':
          setAboutDialogOpen(true);
          break;

        case 'settings':
          setSettingsDialogOpen(true);
          break;

        case 'command-palette':
          toggleCommandPalette();
          break;

        case 'new-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          openNewSessionDraft();
          break;

        case 'new-worktree-session':
          setActiveMainTab('chat');
          setSessionSwitcherOpen(false);
          createWorktreeSession();
          break;

        case 'change-workspace':
          handleChangeWorkspace();
          break;

        case 'open-git-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'git' ? 'chat' : 'git');
          break;
        }

        case 'open-diff-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'diff' ? 'chat' : 'diff');
          break;
        }

        case 'open-files-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'files' ? 'chat' : 'files');
          break;
        }

        case 'open-terminal-tab': {
          const { activeMainTab } = useUIStore.getState();
          setActiveMainTab(activeMainTab === 'terminal' ? 'chat' : 'terminal');
          break;
        }

        case 'copy': {
          const copyEvent = new Event('ridge:copy', { cancelable: true });
          const wasHandled = !window.dispatchEvent(copyEvent);
          if (!wasHandled) {
            document.execCommand('copy');
          }
          break;
        }

        case 'theme-light':
          setThemeMode('light');
          break;

        case 'theme-dark':
          setThemeMode('dark');
          break;

        case 'theme-system':
          setThemeMode('system');
          break;

        case 'toggle-sidebar':
          toggleSidebar();
          break;

        case 'toggle-memory-debug':
          onToggleMemoryDebug?.();
          break;

        case 'help-dialog':
          toggleHelpDialog();
          break;

        case 'download-logs': {
          void showOpenCodeStatus().catch(() => {
            toast.error('收集 OpenCode 状态失败');
          });
          break;
        }
      }
    },
    [
      handleChangeWorkspace,
      onToggleMemoryDebug,
      openNewSessionDraft,
      setAboutDialogOpen,
      setActiveMainTab,
      setSessionSwitcherOpen,
      setSettingsDialogOpen,
      setThemeMode,
      toggleCommandPalette,
      toggleHelpDialog,
      toggleSidebar,
    ]
  );

  React.useEffect(() => {
    const handleMenuAction = (event: Event) => {
      const action = (event as CustomEvent<MenuAction>).detail;
      if (!action) return;
      handleAction(action);
    };

    const handleCheckForUpdatesEvent = () => {
      handleCheckForUpdates();
    };

    window.addEventListener(MENU_ACTION_EVENT, handleMenuAction);
    window.addEventListener(CHECK_FOR_UPDATES_EVENT, handleCheckForUpdatesEvent);
    return () => {
      window.removeEventListener(MENU_ACTION_EVENT, handleMenuAction);
      window.removeEventListener(CHECK_FOR_UPDATES_EVENT, handleCheckForUpdatesEvent);
    };
  }, [handleAction, handleCheckForUpdates]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
    const listen = tauri?.event?.listen;
    if (typeof listen !== 'function') return;

    let unlistenMenu: null | (() => void | Promise<void>) = null;
    let unlistenUpdate: null | (() => void | Promise<void>) = null;

    listen('ridge:menu-action', (evt) => {
      const action = evt?.payload;
      if (typeof action !== 'string') return;
      handleAction(action as MenuAction);
    })
      .then((fn) => {
        unlistenMenu = fn;
      })
      .catch(() => {
        // ignore
      });

    listen('ridge:check-for-updates', () => {
      window.dispatchEvent(new Event(CHECK_FOR_UPDATES_EVENT));
    })
      .then((fn) => {
        unlistenUpdate = fn;
      })
      .catch(() => {
        // ignore
      });

    return () => {
      const cleanup = async () => {
        try {
          const a = unlistenMenu?.();
          if (a instanceof Promise) await a;
        } catch {
          // ignore
        }
        try {
          const b = unlistenUpdate?.();
          if (b instanceof Promise) await b;
        } catch {
          // ignore
        }
      };
      void cleanup();
    };
  }, [handleAction]);
};
