import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { isMobileDeviceViaCSS } from '@/lib/device';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RiAddLine, RiAiAgentFill, RiAiAgentLine, RiDeleteBinLine, RiFileCopyLine, RiMore2Line, RiRobot2Line, RiRobotLine, RiRestartLine, RiEditLine } from '@remixicon/react';
import { useAgentsStore, isAgentBuiltIn, isAgentHidden, type AgentScope, type AgentDraft } from '@/stores/useAgentsStore';
import { cn } from '@/lib/utils';
import type { Agent } from '@/lib/runtime/types';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';
import { SidebarGroup } from '@/components/sections/shared/SidebarGroup';

interface AgentsSidebarProps {
  onItemSelect?: () => void;
}

type PermissionRule = { permission: string; pattern: string; action: string };

type PermissionAction = 'allow' | 'deny';
type PermissionRuleValue = PermissionAction | Record<string, PermissionAction>;

const copyPermissionConfig = (value: unknown): AgentDraft['permission'] => {
  if (Array.isArray(value)) {
    const normalized: Record<string, PermissionAction> = {};
    value
      .filter((entry): entry is PermissionRule => Boolean(entry) && typeof entry === 'object')
      .filter((entry) => typeof entry.permission === 'string' && typeof entry.pattern === 'string' && typeof entry.action === 'string')
      .filter((entry) => entry.pattern === '*' && (entry.action === 'allow' || entry.action === 'deny'))
      .forEach((entry) => {
        normalized[entry.permission.trim().toLowerCase()] = entry.action as PermissionAction;
      });
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const normalized: Record<string, PermissionRuleValue> = {};
  for (const [rawKey, rawRule] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;

    if (rawRule === 'allow' || rawRule === 'deny') {
      normalized[key] = rawRule;
      continue;
    }

    if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
      continue;
    }

    const nested = Object.fromEntries(
      Object.entries(rawRule)
        .filter((entry): entry is [string, PermissionAction] => {
          return typeof entry[0] === 'string' && (entry[1] === 'allow' || entry[1] === 'deny');
        })
        .map(([pattern, action]) => [pattern, action])
    );

    if (Object.keys(nested).length > 0) {
      normalized[key] = nested;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const AgentsSidebar: React.FC<AgentsSidebarProps> = ({ onItemSelect }) => {
  const [renameDialogAgent, setRenameDialogAgent] = React.useState<Agent | null>(null);
  const [renameNewName, setRenameNewName] = React.useState('');
  const [confirmActionAgent, setConfirmActionAgent] = React.useState<Agent | null>(null);
  const [confirmActionType, setConfirmActionType] = React.useState<'delete' | 'reset' | null>(null);
  const [isConfirmActionPending, setIsConfirmActionPending] = React.useState(false);
  const [openMenuAgent, setOpenMenuAgent] = React.useState<string | null>(null);

  const {
    selectedAgentName,
    agents,
    setSelectedAgent,
    setAgentDraft,
    createAgent,
    deleteAgent,
    loadAgents,
  } = useAgentsStore();

  React.useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const bgClass = 'bg-background';

  const handleCreateNew = () => {
    // Generate unique name
    const baseName = 'new-agent';
    let newName = baseName;
    let counter = 1;
    while (agents.some((a) => a.name === newName)) {
      newName = `${baseName}-${counter}`;
      counter++;
    }

    // Set draft and open the page for editing
    setAgentDraft({ name: newName, scope: 'user' });
    setSelectedAgent(newName);
    onItemSelect?.();

  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (isAgentBuiltIn(agent)) {
      toast.error('Built-in agents cannot be deleted');
      return;
    }

    setConfirmActionAgent(agent);
    setConfirmActionType('delete');
  };

  const handleResetAgent = async (agent: Agent) => {
    if (!isAgentBuiltIn(agent)) {
      return;
    }

    setConfirmActionAgent(agent);
    setConfirmActionType('reset');
  };

  const closeConfirmActionDialog = () => {
    setConfirmActionAgent(null);
    setConfirmActionType(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmActionAgent || !confirmActionType) {
      return;
    }

    setIsConfirmActionPending(true);
    const success = await deleteAgent(confirmActionAgent.name);

    if (success) {
      if (confirmActionType === 'delete') {
        toast.success(`Agent "${confirmActionAgent.name}" deleted successfully`);
      } else {
        toast.success(`Agent "${confirmActionAgent.name}" reset to default`);
      }
      closeConfirmActionDialog();
    } else if (confirmActionType === 'delete') {
      toast.error('Failed to delete agent');
    } else {
      toast.error('Failed to reset agent');
    }

    setIsConfirmActionPending(false);
  };

  const handleDuplicateAgent = (agent: Agent) => {
    const baseName = agent.name;
    let copyNumber = 1;
    let newName = `${baseName}-copy`;

    while (agents.some((a) => a.name === newName)) {
      copyNumber++;
      newName = `${baseName}-copy-${copyNumber}`;
    }

    // Set draft with prefilled values from source agent
    const extAgent = agent as Agent & { scope?: AgentScope };
    const modelStr = agent.model?.providerID && agent.model?.modelID
      ? `${agent.model.providerID}/${agent.model.modelID}`
      : null;
    const draftAgent = agent as Agent & { thinking?: string; steps?: number; enabled?: boolean; displayName?: string };
    setAgentDraft({
      name: newName,
      scope: extAgent.scope || 'user',
      description: agent.description,
      model: modelStr,
      thinking: draftAgent.thinking as AgentDraft['thinking'],
      steps: draftAgent.steps,
      prompt: agent.prompt,
      mode: agent.mode,
      permission: copyPermissionConfig(agent.permission),
      enabled: draftAgent.enabled,
      display_name: draftAgent.displayName,
    });
    setSelectedAgent(newName);


  };

  const handleOpenRenameDialog = (agent: Agent) => {
    setRenameNewName(agent.name);
    setRenameDialogAgent(agent);
  };

  const handleRenameAgent = async () => {
    if (!renameDialogAgent) return;

    const sanitizedName = renameNewName.trim().replace(/\s+/g, '-');

    if (!sanitizedName) {
      toast.error('Agent name is required');
      return;
    }

    if (sanitizedName === renameDialogAgent.name) {
      setRenameDialogAgent(null);
      return;
    }

    if (agents.some((a) => a.name === sanitizedName)) {
      toast.error('An agent with this name already exists');
      return;
    }

    // Create new agent with new name and all existing config
    const renameModelStr = renameDialogAgent.model?.providerID && renameDialogAgent.model?.modelID
      ? `${renameDialogAgent.model.providerID}/${renameDialogAgent.model.modelID}`
      : null;
    const renameExt = renameDialogAgent as Agent & {
      scope?: AgentScope;
      thinking?: AgentDraft['thinking'];
      steps?: number;
      enabled?: boolean;
      displayName?: string;
    };
    const success = await createAgent({
      name: sanitizedName,
      description: renameDialogAgent.description,
      model: renameModelStr,
      thinking: renameExt.thinking,
      steps: renameExt.steps,
      prompt: renameDialogAgent.prompt,
      mode: renameDialogAgent.mode,
      permission: copyPermissionConfig(renameDialogAgent.permission),
      enabled: renameExt.enabled,
      display_name: renameExt.displayName,
      scope: renameExt.scope,
    });

    if (success) {
      // Delete old agent
      const deleteSuccess = await deleteAgent(renameDialogAgent.name);
      if (deleteSuccess) {
        toast.success(`Agent renamed to "${sanitizedName}"`);
        setSelectedAgent(sanitizedName);
      } else {
        toast.error('Failed to remove old agent after rename');
      }
    } else {
      toast.error('Failed to rename agent');
    }

    setRenameDialogAgent(null);
  };

  const getAgentModeIcon = (mode?: string) => {
    switch (mode) {
      case 'primary':
        return <RiAiAgentLine className="h-3 w-3 text-primary" />;
      case 'all':
        return <RiAiAgentFill className="h-3 w-3 text-primary" />;
      case 'subagent':
        return <RiRobotLine className="h-3 w-3 text-primary" />;
      default:
        return null;
    }
  };

  // Filter out hidden agents (internal agents like title, compaction, summary)
  const visibleAgents = agents.filter((agent) => !isAgentHidden(agent));
  const builtInAgents = visibleAgents.filter(isAgentBuiltIn);
  const customAgents = visibleAgents.filter((agent) => !isAgentBuiltIn(agent));

  // Group custom agents by subfolder
  const { groupedCustomAgents, ungroupedCustomAgents } = useMemo(() => {
    const groups: Record<string, typeof customAgents> = {};
    const ungrouped: typeof customAgents = [];
    for (const agent of customAgents) {
      const ext = agent as { group?: string };
      if (ext.group) {
        if (!groups[ext.group]) groups[ext.group] = [];
        groups[ext.group].push(agent);
      } else {
        ungrouped.push(agent);
      }
    }
    const sortedGroups = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, agents: groups[name] }));
    return { groupedCustomAgents: sortedGroups, ungroupedCustomAgents: ungrouped };
  }, [customAgents]);

  return (
    <div className={cn('flex h-full flex-col', bgClass)}>
      <div className="border-b px-3 pt-4 pb-3">
        <h2 className="text-base font-semibold text-foreground mb-3">Agents</h2>
        <SettingsProjectSelector className="mb-3" />
        <div className="flex items-center justify-between gap-2">
          <span className="typography-meta text-muted-foreground">Total {visibleAgents.length}</span>
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
        {visibleAgents.length === 0 ? (
          <div className="py-12 px-4 text-center text-muted-foreground">
            <RiRobot2Line className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p className="typography-ui-label font-medium">No agents configured</p>
            <p className="typography-meta mt-1 opacity-75">Use the + button above to create one</p>
          </div>
        ) : (
          <>
            {builtInAgents.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Pi Built-ins
                </div>
                {builtInAgents.map((agent) => (
                  <AgentListItem
                    key={agent.name}
                    agent={agent}
                    isSelected={selectedAgentName === agent.name}
                    onSelect={() => {
                      setSelectedAgent(agent.name);
                      onItemSelect?.();

                    }}
                    onReset={() => handleResetAgent(agent)}
                    onDuplicate={() => handleDuplicateAgent(agent)}
                    getAgentModeIcon={getAgentModeIcon}
                    isMenuOpen={openMenuAgent === agent.name}
                    onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                  />
                ))}
              </>
            )}

            {customAgents.length > 0 && (
              <>
                <div className="px-2 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Custom Agents
                </div>

                {/* Grouped agents by subfolder */}
                {groupedCustomAgents.map(({ name: groupName, agents: groupAgents }) => (
                  <SidebarGroup
                    key={groupName}
                    label={groupName}
                    count={groupAgents.length}
                    storageKey="agents"
                  >
                    {groupAgents.map((agent) => (
                      <AgentListItem
                        key={agent.name}
                        agent={agent}
                        isSelected={selectedAgentName === agent.name}
                        onSelect={() => {
                          setSelectedAgent(agent.name);
                          onItemSelect?.();

                        }}
                        onRename={() => handleOpenRenameDialog(agent)}
                        onDelete={() => handleDeleteAgent(agent)}
                        onDuplicate={() => handleDuplicateAgent(agent)}
                        getAgentModeIcon={getAgentModeIcon}
                        isMenuOpen={openMenuAgent === agent.name}
                        onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                      />
                    ))}
                  </SidebarGroup>
                ))}

                {/* Ungrouped agents (flat in root agents dir) */}
                {ungroupedCustomAgents.map((agent) => (
                  <AgentListItem
                    key={agent.name}
                    agent={agent}
                    isSelected={selectedAgentName === agent.name}
                    onSelect={() => {
                      setSelectedAgent(agent.name);
                      onItemSelect?.();

                    }}
                    onRename={() => handleOpenRenameDialog(agent)}
                    onDelete={() => handleDeleteAgent(agent)}
                    onDuplicate={() => handleDuplicateAgent(agent)}
                    getAgentModeIcon={getAgentModeIcon}
                    isMenuOpen={openMenuAgent === agent.name}
                    onMenuOpenChange={(open) => setOpenMenuAgent(open ? agent.name : null)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollableOverlay>

      <Dialog
        open={confirmActionAgent !== null && confirmActionType !== null}
        onOpenChange={(open) => {
          if (!open && !isConfirmActionPending) {
            closeConfirmActionDialog();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmActionType === 'delete' ? 'Delete Agent' : 'Reset Agent'}</DialogTitle>
            <DialogDescription>
              {confirmActionType === 'delete'
                ? `Are you sure you want to delete agent "${confirmActionAgent?.name}"?`
                : `Are you sure you want to reset agent "${confirmActionAgent?.name}" to its default configuration?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={closeConfirmActionDialog}
              disabled={isConfirmActionPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmAction} disabled={isConfirmActionPending}>
              {confirmActionType === 'delete' ? 'Delete' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogAgent !== null} onOpenChange={(open) => !open && setRenameDialogAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Agent</DialogTitle>
            <DialogDescription>
              Enter a new name for the agent "@{renameDialogAgent?.name}"
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            placeholder="New agent name..."
            className="text-foreground placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRenameAgent();
              }
            }}
          />
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRenameDialogAgent(null)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleRenameAgent}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface AgentListItemProps {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  onRename?: () => void;
  onDuplicate: () => void;
  getAgentModeIcon: (mode?: string) => React.ReactNode;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

const AgentListItem: React.FC<AgentListItemProps> = ({
  agent,
  isSelected,
  onSelect,
  onDelete,
  onReset,
  onRename,
  onDuplicate,
  getAgentModeIcon,
  isMenuOpen,
  onMenuOpenChange,
}) => {
  const extAgent = agent as Agent & { scope?: AgentScope };
  const isMobile = isMobileDeviceViaCSS();
  
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md px-1.5 py-1 transition-all duration-200 select-none',
        isSelected ? 'bg-interactive-selection' : 'hover:bg-interactive-hover'
      )}
      onContextMenu={!isMobile ? (e) => {
        e.preventDefault();
        onMenuOpenChange(true);
      } : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <button
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          tabIndex={0}
        >
          <div className="flex items-center gap-1.5">
            <span className="typography-ui-label font-normal truncate text-foreground">
              {agent.name}
            </span>
            {getAgentModeIcon(agent.mode)}
            {(extAgent.scope || isAgentBuiltIn(agent)) && (
              <span className="typography-micro text-muted-foreground bg-muted px-1 rounded flex-shrink-0 leading-none pb-px border border-border/50">
                {isAgentBuiltIn(agent) ? 'system' : extAgent.scope}
              </span>
            )}
          </div>

          {agent.description && (
            <div className="typography-micro text-muted-foreground/60 truncate leading-tight">
              {agent.description}
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
            {onRename && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
              >
                <RiEditLine className="h-4 w-4 mr-px" />
                Rename
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <RiFileCopyLine className="h-4 w-4 mr-px" />
              Duplicate
            </DropdownMenuItem>

            {onReset && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
              >
                <RiRestartLine className="h-4 w-4 mr-px" />
                Reset
              </DropdownMenuItem>
            )}

            {onDelete && (
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
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
