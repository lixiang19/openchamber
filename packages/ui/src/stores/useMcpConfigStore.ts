import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';
import { startConfigUpdate, finishConfigUpdate } from '@/lib/configUpdate';
import { reloadRuntimeConfiguration } from '@/stores/useAgentsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { runtimeClient } from '@/lib/runtime/client';

export type McpScope = 'user' | 'project';

const getConfigDirectory = (): string | null => {
  try {
    const projectsStore = useProjectsStore.getState();
    const activeProject = projectsStore.getActiveProject?.();
    if (activeProject?.path?.trim()) {
      return activeProject.path.trim();
    }

    const clientDir = runtimeClient.getDirectory();
    if (clientDir?.trim()) {
      return clientDir.trim();
    }
  } catch (err) {
    console.warn('[McpConfigStore] Error resolving config directory:', err);
  }
  return null;
};

export interface McpEnvironmentEntry {
  key: string;
  value: string;
}

export interface McpServerWithScope {
  name: string;
  scope: McpScope;
  type: 'local' | 'remote';
  command: string[];
  url: string;
  environment: McpEnvironmentEntry[];
  cwd: string;
  advancedJson: string;
  sourcePath?: string;
  cache?: {
    toolCount: number;
    resourceCount: number;
    cachedAt: number | null;
    isFresh: boolean;
  } | null;
}

export interface McpDraft extends McpServerWithScope {}

export const envRecordToArray = (env?: Record<string, string>): McpEnvironmentEntry[] => {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({ key, value }));
};

export const envArrayToRecord = (arr: McpEnvironmentEntry[]): Record<string, string> | undefined => {
  const filtered = arr.filter((entry) => entry.key.trim());
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((entry) => [entry.key.trim(), entry.value]));
};

const normalizeServer = (value: unknown): McpServerWithScope | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<McpServerWithScope> & Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  if (!name) {
    return null;
  }

  const type = candidate.type === 'remote' ? 'remote' : 'local';
  const scope: McpScope = candidate.scope === 'project' ? 'project' : 'user';
  const command = Array.isArray(candidate.command)
    ? candidate.command.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const url = typeof candidate.url === 'string' ? candidate.url : '';
  const environment = Array.isArray(candidate.environment)
    ? candidate.environment
        .filter((entry): entry is McpEnvironmentEntry => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
          key: typeof entry.key === 'string' ? entry.key : '',
          value: typeof entry.value === 'string' ? entry.value : '',
        }))
    : [];
  const cwd = typeof candidate.cwd === 'string' ? candidate.cwd : '';
  const advancedJson = typeof candidate.advancedJson === 'string' ? candidate.advancedJson : '';
  const sourcePath = typeof candidate.sourcePath === 'string' ? candidate.sourcePath : undefined;
  const cache = candidate.cache && typeof candidate.cache === 'object'
    ? {
        toolCount: typeof candidate.cache.toolCount === 'number' ? candidate.cache.toolCount : 0,
        resourceCount: typeof candidate.cache.resourceCount === 'number' ? candidate.cache.resourceCount : 0,
        cachedAt: typeof candidate.cache.cachedAt === 'number' ? candidate.cache.cachedAt : null,
        isFresh: candidate.cache.isFresh === true,
      }
    : null;

  return {
    name,
    scope,
    type,
    command,
    url,
    environment,
    cwd,
    advancedJson,
    sourcePath,
    cache,
  };
};

const serializeDraft = (draft: McpDraft): Record<string, unknown> => ({
  name: draft.name,
  scope: draft.scope,
  type: draft.type,
  command: draft.command,
  url: draft.url,
  environment: draft.environment,
  cwd: draft.cwd,
  advancedJson: draft.advancedJson,
});

interface McpConfigStore {
  mcpServers: McpServerWithScope[];
  selectedMcpName: string | null;
  isLoading: boolean;
  mcpDraft: McpDraft | null;

  setSelectedMcp: (name: string | null) => void;
  setMcpDraft: (draft: McpDraft | null) => void;
  loadMcpConfigs: () => Promise<boolean>;
  createMcp: (config: McpDraft) => Promise<boolean>;
  updateMcp: (name: string, config: McpDraft) => Promise<boolean>;
  deleteMcp: (name: string) => Promise<boolean>;
  getMcpByName: (name: string) => McpServerWithScope | undefined;
}

const refreshRuntime = async () => {
  try {
    await reloadRuntimeConfiguration({
      message: 'Reloading Pi MCP configuration…',
      scopes: ['all'],
    });
  } catch (error) {
    console.warn('[McpConfigStore] Runtime reload failed:', error);
  }
};

export const useMcpConfigStore = create<McpConfigStore>()(
  devtools(
    persist(
      (set, get) => ({
        mcpServers: [],
        selectedMcpName: null,
        isLoading: false,
        mcpDraft: null,

        setSelectedMcp: (name) => set({ selectedMcpName: name }),

        setMcpDraft: (draft) => set({ mcpDraft: draft }),

        loadMcpConfigs: async () => {
          const configDirectory = getConfigDirectory();
          const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';

          set({ isLoading: true });
          try {
            const response = await fetch(`/api/config/mcp${queryParams}`, {
              headers: configDirectory ? { 'x-opencode-directory': configDirectory } : undefined,
            });
            if (!response.ok) {
              throw new Error('Failed to load MCP configs');
            }
            const data = await response.json();
            const servers = Array.isArray(data) ? data.map(normalizeServer).filter(Boolean) as McpServerWithScope[] : [];
            set({ mcpServers: servers, isLoading: false });
            return true;
          } catch (error) {
            console.error('[McpConfigStore] Failed to load MCP configs:', error);
            set({ isLoading: false });
            return false;
          }
        },

        createMcp: async (config) => {
          startConfigUpdate('Creating Pi MCP server configuration…');
          try {
            const configDirectory = getConfigDirectory();
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await fetch(`/api/config/mcp/${encodeURIComponent(config.name)}${queryParams}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(configDirectory ? { 'x-opencode-directory': configDirectory } : {}),
              },
              body: JSON.stringify(serializeDraft(config)),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to create MCP server');
            }

            await get().loadMcpConfigs();
            await refreshRuntime();
            return true;
          } catch (error) {
            console.error('[McpConfigStore] Failed to create MCP:', error);
            throw error;
          } finally {
            finishConfigUpdate();
          }
        },

        updateMcp: async (name, config) => {
          startConfigUpdate('Updating Pi MCP server configuration…');
          try {
            const configDirectory = getConfigDirectory();
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await fetch(`/api/config/mcp/${encodeURIComponent(name)}${queryParams}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(configDirectory ? { 'x-opencode-directory': configDirectory } : {}),
              },
              body: JSON.stringify(serializeDraft(config)),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to update MCP server');
            }

            await get().loadMcpConfigs();
            await refreshRuntime();
            return true;
          } catch (error) {
            console.error('[McpConfigStore] Failed to update MCP:', error);
            throw error;
          } finally {
            finishConfigUpdate();
          }
        },

        deleteMcp: async (name) => {
          startConfigUpdate('Deleting Pi MCP server configuration…');
          try {
            const configDirectory = getConfigDirectory();
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await fetch(`/api/config/mcp/${encodeURIComponent(name)}${queryParams}`, {
              method: 'DELETE',
              headers: configDirectory ? { 'x-opencode-directory': configDirectory } : undefined,
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to delete MCP server');
            }

            if (get().selectedMcpName === name) {
              set({ selectedMcpName: null });
            }
            await get().loadMcpConfigs();
            await refreshRuntime();
            return true;
          } catch (error) {
            console.error('[McpConfigStore] Failed to delete MCP:', error);
            return false;
          } finally {
            finishConfigUpdate();
          }
        },

        getMcpByName: (name) => {
          return get().mcpServers.find((server) => server.name === name);
        },
      }),
      {
        name: 'mcp-config-store',
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({ selectedMcpName: state.selectedMcpName }),
      },
    ),
    { name: 'mcp-config-store' },
  ),
);
