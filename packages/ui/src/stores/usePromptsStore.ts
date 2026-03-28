import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { getSafeStorage } from "./utils/safeStorage";
import { useProjectsStore } from "@/stores/useProjectsStore";

export type PromptScope = 'user' | 'project';

export interface PromptConfig {
  name: string;
  description?: string;
  template: string;
  scope?: PromptScope;
}

export interface Prompt extends PromptConfig {
  source: string;
  sourceScope: PromptScope;
}

export interface PromptDraft {
  name: string;
  scope: PromptScope;
  description?: string;
  template?: string;
}

interface PromptsStore {
  selectedPromptName: string | null;
  prompts: Prompt[];
  isLoading: boolean;
  promptDraft: PromptDraft | null;

  setSelectedPrompt: (name: string | null) => void;
  setPromptDraft: (draft: PromptDraft | null) => void;
  loadPrompts: () => Promise<boolean>;
  createPrompt: (config: PromptConfig) => Promise<boolean>;
  updatePrompt: (name: string, config: Partial<PromptConfig>) => Promise<boolean>;
  deletePrompt: (name: string) => Promise<boolean>;
  getPromptByName: (name: string) => Prompt | undefined;
}

declare global {
  interface Window {
    __zustand_prompts_store__?: UseBoundStore<StoreApi<PromptsStore>>;
  }
}

const getRequestDirectory = (): string | null => {
  try {
    const projectsStore = useProjectsStore.getState();
    const activeProject = projectsStore.getActiveProject?.();
    if (activeProject?.path?.trim()) {
      return activeProject.path.trim();
    }
  } catch (err) {
    console.warn('[PromptsStore] Error resolving config directory:', err);
  }
  return null;
};

export const usePromptsStore = create<PromptsStore>()(
  devtools(
    persist(
      (set, get) => ({
        selectedPromptName: null,
        prompts: [],
        isLoading: false,
        promptDraft: null,

        setSelectedPrompt: (name: string | null) => {
          set({ selectedPromptName: name });
        },

        setPromptDraft: (draft: PromptDraft | null) => {
          set({ promptDraft: draft });
        },

        loadPrompts: async () => {
          set({ isLoading: true });
          try {
            const directory = getRequestDirectory();
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : '';

            const response = await fetch(`/api/config/prompts${queryParams}`, {
              headers: directory ? { 'x-opencode-directory': directory } : undefined,
            });

            if (!response.ok) {
              throw new Error('Failed to load prompts');
            }

            const prompts = await response.json();
            set({ prompts: prompts || [], isLoading: false });
            return true;
          } catch (error) {
            console.error('[PromptsStore] Failed to load prompts:', error);
            set({ isLoading: false });
            return false;
          }
        },

        createPrompt: async (config: PromptConfig) => {
          try {
            const directory = getRequestDirectory();
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : '';

            const response = await fetch(`/api/config/prompts/${encodeURIComponent(config.name)}${queryParams}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(directory ? { 'x-opencode-directory': directory } : {}),
              },
              body: JSON.stringify({
                template: config.template,
                description: config.description,
                scope: config.scope,
              })
            });

            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || 'Failed to create prompt');
            }

            await get().loadPrompts();
            return true;
          } catch (error) {
            console.error('[PromptsStore] Failed to create prompt:', error);
            return false;
          }
        },

        updatePrompt: async (name: string, config: Partial<PromptConfig>) => {
          try {
            const directory = getRequestDirectory();
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : '';

            const response = await fetch(`/api/config/prompts/${encodeURIComponent(name)}${queryParams}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(directory ? { 'x-opencode-directory': directory } : {}),
              },
              body: JSON.stringify({
                ...(config.template !== undefined && { template: config.template }),
                ...(config.description !== undefined && { description: config.description }),
              })
            });

            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || 'Failed to update prompt');
            }

            await get().loadPrompts();
            return true;
          } catch (error) {
            console.error('[PromptsStore] Failed to update prompt:', error);
            return false;
          }
        },

        deletePrompt: async (name: string) => {
          try {
            const directory = getRequestDirectory();
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : '';

            const response = await fetch(`/api/config/prompts/${encodeURIComponent(name)}${queryParams}`, {
              method: 'DELETE',
              headers: directory ? { 'x-opencode-directory': directory } : undefined,
            });

            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || 'Failed to delete prompt');
            }

            if (get().selectedPromptName === name) {
              set({ selectedPromptName: null });
            }

            await get().loadPrompts();
            return true;
          } catch (error) {
            console.error('[PromptsStore] Failed to delete prompt:', error);
            return false;
          }
        },

        getPromptByName: (name: string) => {
          return get().prompts.find((p) => p.name === name);
        },
      }),
      {
        name: "prompts-store",
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          selectedPromptName: state.selectedPromptName,
        }),
      },
    ),
    {
      name: "prompts-store",
    },
  ),
);

if (typeof window !== "undefined") {
  window.__zustand_prompts_store__ = usePromptsStore;
}
