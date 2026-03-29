import React from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { RiAddLine, RiFileCopyLine, RiDeleteBinLine, RiEditLine, RiFileTextLine, RiFolderLine, RiMore2Line, RiUser3Line } from '@remixicon/react';
import { usePromptsStore, type PromptDraft, type PromptScope } from '@/stores/usePromptsStore';
import { cn } from '@/lib/utils';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';

interface PromptsSidebarProps {
  onItemSelect?: () => void;
}

export const PromptsSidebar: React.FC<PromptsSidebarProps> = ({ onItemSelect }) => {
  const [openMenuPrompt, setOpenMenuPrompt] = React.useState<string | null>(null);
  const [renameDialogPrompt, setRenameDialogPrompt] = React.useState<{ name: string; sourceScope: PromptScope } | null>(null);
  const [renameNewName, setRenameNewName] = React.useState('');

  const {
    selectedPromptName,
    prompts,
    setSelectedPrompt,
    setPromptDraft,
    createPrompt,
    deletePrompt,
    loadPrompts,
  } = usePromptsStore();

  React.useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleCreateNew = () => {
    // Generate unique name
    const baseName = 'new-prompt';
    let newName = baseName;
    let counter = 1;
    while (prompts.some((p) => p.name === newName)) {
      newName = `${baseName}-${counter}`;
      counter++;
    }

    // Set draft and open the page for editing
    setPromptDraft({ name: newName, scope: 'user' });
    setSelectedPrompt(newName);
    onItemSelect?.();
  };

  const handleDeletePrompt = async (prompt: { name: string; sourceScope: PromptScope }) => {
    const success = await deletePrompt(prompt.name);
    if (success) {
      toast.success(`Prompt "${prompt.name}" deleted successfully`);
    } else {
      toast.error('Failed to delete prompt');
    }
  };

  const handleDuplicatePrompt = (prompt: { name: string; description?: string; template: string; sourceScope: PromptScope }) => {
    const baseName = prompt.name;
    let copyNumber = 1;
    let newName = `${baseName}-copy`;

    while (prompts.some((p) => p.name === newName)) {
      copyNumber++;
      newName = `${baseName}-copy-${copyNumber}`;
    }

    // Set draft with prefilled values from source prompt
    const draft: PromptDraft = {
      name: newName,
      scope: prompt.sourceScope,
      description: prompt.description,
      template: prompt.template,
    };
    setPromptDraft(draft);
    setSelectedPrompt(newName);
    onItemSelect?.();
  };

  const handleOpenRenameDialog = (prompt: { name: string; sourceScope: PromptScope }) => {
    setRenameNewName(prompt.name);
    setRenameDialogPrompt(prompt);
  };

  const handleRenamePrompt = async () => {
    if (!renameDialogPrompt) return;

    const sanitizedName = renameNewName.trim().replace(/\s+/g, '-');

    if (!sanitizedName) {
      toast.error('Prompt name is required');
      return;
    }

    if (sanitizedName === renameDialogPrompt.name) {
      setRenameDialogPrompt(null);
      return;
    }

    if (prompts.some((p) => p.name === sanitizedName)) {
      toast.error('A prompt with this name already exists');
      return;
    }

    // Create new prompt with new name and all existing config
    const sourcePrompt = prompts.find(p => p.name === renameDialogPrompt.name);
    if (!sourcePrompt) {
      toast.error('Source prompt not found');
      return;
    }

    const success = await createPrompt({
      name: sanitizedName,
      description: sourcePrompt.description,
      template: sourcePrompt.template,
      scope: renameDialogPrompt.sourceScope,
    });

    if (success) {
      // Delete old prompt
      const deleteSuccess = await deletePrompt(renameDialogPrompt.name);
      if (deleteSuccess) {
        toast.success(`Prompt renamed to "${sanitizedName}"`);
        setSelectedPrompt(sanitizedName);
      } else {
        toast.error('Failed to remove old prompt after rename');
      }
    } else {
      toast.error('Failed to rename prompt');
    }

    setRenameDialogPrompt(null);
  };

  // Group prompts by scope
  const userPrompts = prompts.filter((p) => p.sourceScope === 'user');
  const projectPrompts = prompts.filter((p) => p.sourceScope === 'project');

  return (
    <div className={cn('flex h-full flex-col bg-background')}>
      <div className="border-b px-3 pt-4 pb-3">
        <h2 className="text-base font-semibold text-foreground mb-3">Prompts</h2>
        <SettingsProjectSelector className="mb-3" />
        <div className="flex items-center justify-between gap-2">
          <span className="typography-meta text-muted-foreground">Total {prompts.length}</span>
          <Button size="sm"
            variant="ghost"
            className="h-7 w-7 px-0 -my-1 text-muted-foreground"
            onClick={handleCreateNew}
          >
            <RiAddLine className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="space-y-1 px-3 py-2 overflow-x-hidden">
        {prompts.length === 0 ? (
          <div className="py-12 px-4 text-center text-muted-foreground">
            <RiFileTextLine className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="typography-ui-label font-medium">No prompts configured</p>
            <p className="typography-meta mt-1 opacity-75">Use the + button above to create one</p>
          </div>
        ) : (
          <>
            {userPrompts.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <RiUser3Line className="h-3 w-3 inline-block mr-1.5" />
                  Global
                </div>
                {userPrompts.map((prompt) => (
                  <PromptListItem
                    key={prompt.name}
                    prompt={prompt}
                    isSelected={selectedPromptName === prompt.name}
                    onSelect={() => {
                      setSelectedPrompt(prompt.name);
                      onItemSelect?.();
                    }}
                    onRename={() => handleOpenRenameDialog(prompt)}
                    onDelete={() => handleDeletePrompt(prompt)}
                    onDuplicate={() => handleDuplicatePrompt(prompt)}
                    isMenuOpen={openMenuPrompt === prompt.name}
                    onMenuOpenChange={(open) => setOpenMenuPrompt(open ? prompt.name : null)}
                  />
                ))}
              </>
            )}

            {projectPrompts.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <RiFolderLine className="h-3 w-3 inline-block mr-1.5" />
                  Project
                </div>
                {projectPrompts.map((prompt) => (
                  <PromptListItem
                    key={prompt.name}
                    prompt={prompt}
                    isSelected={selectedPromptName === prompt.name}
                    onSelect={() => {
                      setSelectedPrompt(prompt.name);
                      onItemSelect?.();
                    }}
                    onRename={() => handleOpenRenameDialog(prompt)}
                    onDelete={() => handleDeletePrompt(prompt)}
                    onDuplicate={() => handleDuplicatePrompt(prompt)}
                    isMenuOpen={openMenuPrompt === prompt.name}
                    onMenuOpenChange={(open) => setOpenMenuPrompt(open ? prompt.name : null)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollableOverlay>

      {/* Rename Dialog */}
      {renameDialogPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg border p-4 w-80">
            <h3 className="typography-ui-header font-semibold text-foreground mb-2">Rename Prompt</h3>
            <p className="typography-meta text-muted-foreground mb-3">
              Enter a new name for "/{renameDialogPrompt.name}"
            </p>
            <input
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              placeholder="新提示词名称..."
              className="w-full h-8 px-2 rounded border bg-transparent typography-meta mb-4"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenamePrompt();
                } else if (e.key === 'Escape') {
                  setRenameDialogPrompt(null);
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRenameDialogPrompt(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRenamePrompt}>
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface PromptListItemProps {
  prompt: { name: string; description?: string; sourceScope: PromptScope };
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

const PromptListItem: React.FC<PromptListItemProps> = ({
  prompt,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  onDuplicate,
  isMenuOpen,
  onMenuOpenChange,
}) => {
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md px-1.5 py-1 transition-all duration-200 select-none',
        isSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover'
      )}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <button
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          tabIndex={0}
        >
          <div className="flex items-center gap-1.5">
            <span className="typography-ui-label font-normal truncate text-foreground">
              /{prompt.name}
            </span>
          </div>

          {prompt.description && (
            <div className="typography-micro text-muted-foreground/60 truncate leading-tight">
              {prompt.description}
            </div>
          )}
        </button>

        <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button size="sm"
              variant="ghost"
              className="h-6 w-6 px-0 flex-shrink-0 -mr-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <RiMore2Line className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-fit min-w-20">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <RiEditLine className="h-4 w-4 mr-px" />
              Rename
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <RiFileCopyLine className="h-4 w-4 mr-px" />
              Duplicate
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-destructive focus:text-destructive"
            >
              <RiDeleteBinLine className="h-4 w-4 mr-px" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
