import type { Session } from '@/lib/runtime/types';
import type { PiClientSessionState } from '@/lib/pi/reducer';
import type { PiSessionViewState } from '@/lib/pi/types';

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

export const projectPiSessionToRuntimeSession = (session: Pick<PiSessionViewState, 'id' | 'title' | 'cwd' | 'createdAt' | 'updatedAt' | 'status'>): Session => ({
  id: session.id,
  title: session.title || 'Pi Session',
  directory: normalizePath(session.cwd),
  version: 'pi',
  projectID: '',
  time: {
    created: session.createdAt,
    updated: session.updatedAt,
    ...(session.status === 'compacting' ? { compacting: session.updatedAt } : {}),
  },
  summary: undefined,
  share: undefined,
} as Session);

export const projectPiSessionStatusToRuntimeStatus = (status: PiSessionViewState['status']): { type: 'idle' | 'busy' | 'retry' } => {
  if (status === 'retrying') {
    return { type: 'retry' };
  }
  if (status === 'streaming' || status === 'compacting') {
    return { type: 'busy' };
  }
  return { type: 'idle' };
};

export const projectPiSessionsToRuntimeStatus = (sessions: Record<string, PiClientSessionState>): Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }> => {
  const next = new Map<string, { type: 'idle' | 'busy' | 'retry'; confirmedAt?: number }>();
  for (const session of Object.values(sessions)) {
    next.set(session.id, { ...projectPiSessionStatusToRuntimeStatus(session.status), confirmedAt: session.updatedAt });
  }
  return next;
};

export const buildRuntimeSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
  const grouped = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = normalizePath((session as { directory?: string | null }).directory ?? null) || '__no_directory__';
    const existing = grouped.get(key) || [];
    grouped.set(key, [...existing, session]);
  }
  return grouped;
};
