import React from 'react';
import type { Session } from '@/lib/runtime/types';
import { runtimeClient } from '@/lib/runtime/client';
import { normalizePath } from '../utils';

type ProjectLike = { path: string };

type Args = {
  sortedSessions: Session[];
  projects: ProjectLike[];
  directoryStatus: Map<string, 'unknown' | 'exists' | 'missing'>;
  setDirectoryStatus: React.Dispatch<React.SetStateAction<Map<string, 'unknown' | 'exists' | 'missing'>>>;
};

export const useDirectoryStatusProbe = ({
  sortedSessions,
  projects,
  directoryStatus,
  setDirectoryStatus,
}: Args): void => {
  const directoryStatusRef = React.useRef<Map<string, 'unknown' | 'exists' | 'missing'>>(new Map());
  const checkingDirectories = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    directoryStatusRef.current = directoryStatus;
  }, [directoryStatus]);

  React.useEffect(() => {
    const directories = new Set<string>();
    sortedSessions.forEach((session) => {
      const dir = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
      if (dir) {
        directories.add(dir);
      }
    });
    projects.forEach((project) => {
      const normalized = normalizePath(project.path);
      if (normalized) {
        directories.add(normalized);
      }
    });

    directories.forEach((directory) => {
      const known = directoryStatusRef.current.get(directory);
      if ((known && known !== 'unknown') || checkingDirectories.current.has(directory)) {
        return;
      }
      checkingDirectories.current.add(directory);
      runtimeClient
        .statLocalPath(directory)
        .then((stat) => {
          setDirectoryStatus((prev) => {
            const next = new Map(prev);
            const nextValue = stat.exists && stat.isDirectory ? 'exists' : 'missing';
            if (next.get(directory) === nextValue) {
              return prev;
            }
            next.set(directory, nextValue);
            return next;
          });
        })
        .finally(() => {
          checkingDirectories.current.delete(directory);
        });
    });
  }, [sortedSessions, projects, setDirectoryStatus]);
};
