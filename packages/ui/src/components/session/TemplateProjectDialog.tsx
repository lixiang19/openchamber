import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ButtonSmall } from '@/components/ui/button-small';
import { DirectoryAutocomplete, type DirectoryAutocompleteHandle } from './DirectoryAutocomplete';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { toast } from '@/components/ui';
import { formatPathForDisplay } from '@/lib/utils';
import { isDesktopLocalOriginActive, requestDirectoryAccess } from '@/lib/desktop';
import { useFileSystemAccess } from '@/hooks/useFileSystemAccess';
import { RiFolderOpenLine, RiSparklingLine } from '@remixicon/react';

type TemplateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const normalizePath = (value: string): string => {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return '';
  }
  if (trimmed === '/') {
    return '/';
  }
  return trimmed.replace(/\/+$/, '');
};

const expandTildePath = (value: string, homeDirectory: string | null): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('~') || !homeDirectory) {
    return trimmed;
  }
  if (trimmed === '~') {
    return homeDirectory;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return `${homeDirectory}${trimmed.slice(1)}`;
  }
  return trimmed;
};

const isExplicitUserPath = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.startsWith('/') || trimmed.startsWith('~') || /^[A-Za-z]:[\\/]/.test(trimmed);
};

const getParentDirectory = (targetPath: string): string => {
  const normalized = normalizePath(targetPath);
  if (!normalized || normalized === '/') {
    return normalized;
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '/';
  }
  return `/${segments.slice(0, -1).join('/')}`;
};

const joinProjectPath = (parentDirectory: string, projectName: string): string => {
  const normalizedParent = normalizePath(parentDirectory);
  const trimmedName = projectName.trim();
  if (!normalizedParent) {
    return trimmedName;
  }
  if (normalizedParent === '/') {
    return `/${trimmedName}`;
  }
  return `${normalizedParent}/${trimmedName}`;
};

export const TemplateProjectDialog: React.FC<TemplateProjectDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { homeDirectory } = useDirectoryStore();
  const getActiveProject = useProjectsStore((state) => state.getActiveProject);
  const createProjectFromTemplate = useProjectsStore((state) => state.createProjectFromTemplate);
  const { isDesktop } = useFileSystemAccess();

  const [projectName, setProjectName] = React.useState('');
  const [parentDirectoryInput, setParentDirectoryInput] = React.useState('');
  const [resolvedParentDirectory, setResolvedParentDirectory] = React.useState('');
  const [autocompleteVisible, setAutocompleteVisible] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const autocompleteRef = React.useRef<DirectoryAutocompleteHandle>(null);

  const formatDisplayPath = React.useCallback((value: string) => {
    return formatPathForDisplay(value, homeDirectory);
  }, [homeDirectory]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const activeProject = getActiveProject();
    const defaultParentDirectory = activeProject?.path
      ? getParentDirectory(activeProject.path)
      : homeDirectory
        ? `${normalizePath(homeDirectory)}/OpenAurora`
        : '';

    setProjectName('');
    setResolvedParentDirectory(defaultParentDirectory);
    setParentDirectoryInput(formatDisplayPath(defaultParentDirectory));
    setAutocompleteVisible(false);
    setIsCreating(false);
  }, [formatDisplayPath, getActiveProject, homeDirectory, open]);

  const handleParentDirectoryChange = React.useCallback((value: string) => {
    setParentDirectoryInput(value);
    const expanded = normalizePath(expandTildePath(value, homeDirectory));
    setResolvedParentDirectory(expanded);
    setAutocompleteVisible(value.startsWith('/') || value.startsWith('~'));
  }, [homeDirectory]);

  const handleParentDirectoryKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocompleteRef.current?.handleKeyDown(event)) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
    }
  }, []);

  const handleAutocompleteSuggestion = React.useCallback((value: string) => {
    setResolvedParentDirectory(value);
    setParentDirectoryInput(formatDisplayPath(value));
  }, [formatDisplayPath]);

  const handleBrowseParentDirectory = React.useCallback(async () => {
    const result = await requestDirectoryAccess('');
    if (!result.success || !result.path) {
      if (result.error && result.error !== 'Directory selection cancelled') {
        toast.error('Failed to select folder', {
          description: result.error,
        });
      }
      return;
    }

    const normalized = normalizePath(result.path);
    setResolvedParentDirectory(normalized);
    setParentDirectoryInput(formatDisplayPath(normalized));
    setAutocompleteVisible(false);
  }, [formatDisplayPath]);

  const handleSubmit = React.useCallback(async () => {
    const trimmedProjectName = projectName.trim();
    const normalizedParentDirectory = normalizePath(expandTildePath(parentDirectoryInput, homeDirectory));

    if (!trimmedProjectName) {
      toast.error('Project name is required');
      return;
    }
    if (!isExplicitUserPath(parentDirectoryInput)) {
      toast.error('Parent directory must be an absolute path');
      return;
    }
    if (!normalizedParentDirectory) {
      toast.error('Parent directory is required');
      return;
    }

    setIsCreating(true);
    const result = await createProjectFromTemplate({
      projectName: trimmedProjectName,
      parentDirectory: normalizedParentDirectory,
    });
    setIsCreating(false);

    if (!result.ok) {
      toast.error('Failed to create project', {
        description: result.error,
      });
      return;
    }

    toast.success('Project created from template');
    onOpenChange(false);
  }, [createProjectFromTemplate, homeDirectory, onOpenChange, parentDirectoryInput, projectName]);

  const previewPath = projectName.trim() && resolvedParentDirectory
    ? joinProjectPath(resolvedParentDirectory, projectName.trim())
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(720px,100vw-2rem)] rounded-3xl border border-[var(--interactive-border)] bg-[var(--surface-background)] p-0 overflow-hidden">
        <div className="border-b border-[var(--interactive-border)] bg-[var(--surface-muted)]/70 px-6 py-5">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="flex items-center gap-2 typography-ui-header font-semibold text-foreground">
              <RiSparklingLine className="h-5 w-5" />
              Create project from template
            </DialogTitle>
            <DialogDescription className="typography-meta text-muted-foreground">
              A new folder will be created from the built-in OpenAurora workspace template.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <section className="space-y-2">
            <label className="typography-ui-label text-foreground" htmlFor="template-project-name">
              Project name
            </label>
            <Input
              id="template-project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="My Project"
              className="h-9"
              autoFocus
            />
          </section>

          <section className="space-y-2">
            <label className="typography-ui-label text-foreground" htmlFor="template-project-parent">
              Parent directory
            </label>
            <div className="relative flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="template-project-parent"
                  value={parentDirectoryInput}
                  onChange={(event) => handleParentDirectoryChange(event.target.value)}
                  onKeyDown={handleParentDirectoryKeyDown}
                  placeholder="~/OpenAurora"
                  className="h-9 font-mono typography-meta"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
                <DirectoryAutocomplete
                  ref={autocompleteRef}
                  inputValue={parentDirectoryInput}
                  homeDirectory={homeDirectory}
                  onSelectSuggestion={handleAutocompleteSuggestion}
                  visible={autocompleteVisible}
                  onClose={() => setAutocompleteVisible(false)}
                  showHidden={false}
                />
              </div>

              {isDesktop && isDesktopLocalOriginActive() ? (
                <ButtonSmall
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-9 gap-1 px-3"
                  onClick={handleBrowseParentDirectory}
                >
                  <RiFolderOpenLine className="h-4 w-4" />
                  Browse
                </ButtonSmall>
              ) : null}
            </div>
            <p className="typography-meta text-muted-foreground">
              The target folder must be new or empty. Existing non-empty folders are rejected.
            </p>
          </section>

          <section className="rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-4 py-3">
            <div className="typography-meta text-muted-foreground">Preview</div>
            <div className="mt-1 break-all font-mono typography-ui-label text-foreground">
              {previewPath || 'Choose a parent directory and project name'}
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-[var(--interactive-border)] px-6 py-4 sm:justify-between">
          <p className="typography-meta text-muted-foreground">
            The template includes `.opencode`, `docs`, and `notes` starter folders.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create project'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
