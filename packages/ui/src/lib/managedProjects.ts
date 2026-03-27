import type { ManagedProjectTemplateSummary, ProjectEntry } from '@/lib/api/types';
import type { DesktopSettings } from '@/lib/desktop';
import { useProjectsStore } from '@/stores/useProjectsStore';

export type CreateManagedProjectInput = {
  projectName: string;
  templateId: string;
};

export type CreateManagedProjectResult = {
  success: boolean;
  project?: ProjectEntry;
  settings?: DesktopSettings;
  targetDirectory?: string;
  error?: string;
};

const syncSettings = (settings?: DesktopSettings | null) => {
  if (!settings) {
    return;
  }
  useProjectsStore.getState().synchronizeFromSettings(settings);
};

export const listManagedProjectTemplates = async (): Promise<ManagedProjectTemplateSummary[]> => {
  const response = await fetch('/api/projects/templates', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = (await response.json().catch(() => null)) as {
    templates?: ManagedProjectTemplateSummary[];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to load project templates');
  }

  return Array.isArray(payload?.templates) ? payload.templates : [];
};

export const createManagedProject = async (
  input: CreateManagedProjectInput,
): Promise<CreateManagedProjectResult> => {
  try {
    const response = await fetch('/api/projects/create-managed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });

    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      project?: ProjectEntry;
      settings?: DesktopSettings;
      targetDirectory?: string;
      error?: string;
    } | null;

    if (!response.ok || payload?.success !== true || !payload?.project) {
      return {
        success: false,
        error: payload?.error || 'Failed to create project',
      };
    }

    syncSettings(payload.settings);

    return {
      success: true,
      project: payload.project,
      settings: payload.settings,
      targetDirectory: payload.targetDirectory,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project',
    };
  }
};
