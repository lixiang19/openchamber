import { piClient } from '@/lib/pi/client';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';

declare const __APP_VERSION__: string | undefined;

const getCurrentDirectory = (): string => {
  const state = useSessionStore.getState();
  const currentSessionId = state.currentSessionId;
  if (!currentSessionId) return '';
  const session = state.sessions.find((entry) => entry.id === currentSessionId);
  return typeof session?.directory === 'string' ? session.directory : '';
};

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '(none)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const buildOpenCodeStatusReport = async (): Promise<string> => {
  const now = new Date();
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '(unknown)';
  const eventStreamStatus = useUIStore.getState().eventStreamStatus;
  const directory = getCurrentDirectory();
  const origin = typeof window !== 'undefined' ? window.location.origin : '(unknown)';

  let sessionsText = '(failed to load Pi sessions)';
  try {
    const sessions = await piClient.listSessions();
    sessionsText = sessions.length === 0
      ? '(no Pi sessions)'
      : sessions.map((session) => {
          const modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : '(default)';
          return `- ${session.title || session.id}\n  id: ${session.id}\n  cwd: ${session.cwd}\n  status: ${session.status}\n  model: ${modelLabel}\n  updatedAt: ${new Date(session.updatedAt).toISOString()}`;
        }).join('\n');
  } catch (error) {
    sessionsText = `error: ${error instanceof Error ? error.message : String(error)}`;
  }

  const lines = [
    `Time: ${now.toISOString()}`,
    `OpenAurora version: ${appVersion}`,
    `Runtime: Pi`,
    `Origin: ${origin}`,
    `API: ${origin === '(unknown)' ? '(unknown)' : `${origin}/api/pi`}`,
    `Event stream: ${eventStreamStatus}`,
    `Current directory: ${directory || '(none)'}`,
    '',
    'Pi sessions:',
    sessionsText,
    '',
    'Current store snapshot:',
    stringify({
      currentSessionId: useSessionStore.getState().currentSessionId,
      sessionCount: useSessionStore.getState().sessions.length,
      statusCount: useSessionStore.getState().sessionStatus?.size ?? 0,
      questionCount: Array.from(useSessionStore.getState().interactiveRequests.values()).reduce((sum, entry) => sum + entry.length, 0),
    }),
  ];

  return lines.join('\n');
};

export const showOpenCodeStatus = async () => {
  const report = await buildOpenCodeStatusReport();
  const ui = useUIStore.getState();
  ui.setOpenCodeStatusText(report);
  ui.setOpenCodeStatusDialogOpen(true);
};
