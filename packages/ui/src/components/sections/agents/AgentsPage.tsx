import React from 'react';
import type { Agent } from '@/lib/runtime/types';
import { RiFolderLine, RiInformationLine, RiRobot2Line, RiUser3Line } from '@remixicon/react';

import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui';
import { useAvailableTools } from '@/hooks/useAvailableTools';
import { cn } from '@/lib/utils';
import { useAgentsStore, type AgentConfig, type AgentScope } from '@/stores/useAgentsStore';
import { ModelSelector } from './ModelSelector';

type ThinkingLevel = NonNullable<AgentConfig['thinking']>;
type PermissionAction = 'allow' | 'deny';
type PermissionRuleValue = PermissionAction | Record<string, PermissionAction>;
type EditPermissionMode = 'allow' | 'deny' | 'markdown' | 'custom';
type AgentPermissionRule = { permission: string; pattern: string; action: string };

type AgentWithPiFields = Agent & {
  scope?: AgentScope;
  displayName?: string;
  thinking?: ThinkingLevel;
  steps?: number;
  enabled?: boolean;
};

type AgentFormState = {
  draftName: string;
  draftScope: AgentScope;
  description: string;
  displayName: string;
  mode: NonNullable<AgentConfig['mode']>;
  model: string;
  thinking?: ThinkingLevel;
  steps?: number;
  enabled: boolean;
  prompt: string;
  simpleToolActions: Record<string, PermissionAction>;
  editPermissionMode: EditPermissionMode;
  customEditRulesText: string;
};

const EDIT_PERMISSION_MARKDOWN_RULES: Record<string, PermissionAction> = {
  '*': 'deny',
  '**/*.md': 'allow',
};

const DEFAULT_TOOL_ORDER = [
  'read',
  'bash',
  'grep',
  'find',
  'ls',
  'question',
  'subagent',
];

const THINKING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '__inherit__', label: 'Inherit' },
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

const normalizeToolName = (value: string): string => value.trim().toLowerCase();

const sortToolNames = (toolNames: Iterable<string>): string[] => {
  const unique = Array.from(new Set(Array.from(toolNames).map(normalizeToolName).filter(Boolean)));
  return unique.sort((left, right) => {
    const leftIndex = DEFAULT_TOOL_ORDER.indexOf(left);
    const rightIndex = DEFAULT_TOOL_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
};

const formatToolLabel = (toolName: string): string => {
  if (toolName === 'ls') return 'LS';
  return toolName
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const isPermissionAction = (value: unknown): value is PermissionAction => value === 'allow' || value === 'deny';

const asPermissionConfig = (value: unknown): AgentConfig['permission'] | undefined => {
  if (Array.isArray(value)) {
    const normalized: Record<string, PermissionAction> = {};
    value
      .filter((entry): entry is AgentPermissionRule => Boolean(entry) && typeof entry === 'object')
      .filter((entry) => typeof entry.permission === 'string' && typeof entry.pattern === 'string' && isPermissionAction(entry.action))
      .filter((entry) => entry.pattern === '*')
      .forEach((entry) => {
        normalized[normalizeToolName(entry.permission)] = entry.action as PermissionAction;
      });
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const normalized: Record<string, PermissionRuleValue> = {};
  for (const [rawKey, rawRule] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeToolName(rawKey);
    if (!key) continue;

    if (isPermissionAction(rawRule)) {
      normalized[key] = rawRule;
      continue;
    }

    if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
      continue;
    }

    const nested = Object.fromEntries(
      Object.entries(rawRule)
        .filter((entry): entry is [string, PermissionAction] => isPermissionAction(entry[1]))
        .map(([pattern, action]) => [pattern, action])
    );

    if (Object.keys(nested).length > 0) {
      normalized[key] = nested;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const getSimpleToolActions = (permission: AgentConfig['permission'] | undefined): Record<string, PermissionAction> => {
  const actions: Record<string, PermissionAction> = {};
  if (!permission) {
    return actions;
  }

  for (const [toolName, rule] of Object.entries(permission)) {
    if (toolName === 'edit') {
      continue;
    }
    if (isPermissionAction(rule)) {
      actions[normalizeToolName(toolName)] = rule;
    }
  }

  return actions;
};

const isMarkdownOnlyRules = (value: Record<string, PermissionAction>) => {
  return value['*'] === 'deny'
    && value['**/*.md'] === 'allow'
    && Object.keys(value).length === Object.keys(EDIT_PERMISSION_MARKDOWN_RULES).length;
};

const getEditPermissionMode = (permission: AgentConfig['permission'] | undefined): EditPermissionMode => {
  const rule = permission?.edit;
  if (!rule || rule === 'allow') {
    return 'allow';
  }
  if (rule === 'deny') {
    return 'deny';
  }
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    return isMarkdownOnlyRules(rule as Record<string, PermissionAction>) ? 'markdown' : 'custom';
  }
  return 'allow';
};

const getCustomEditRulesText = (permission: AgentConfig['permission'] | undefined): string => {
  const rule = permission?.edit;
  if (!rule || rule === 'allow' || rule === 'deny') {
    return JSON.stringify(EDIT_PERMISSION_MARKDOWN_RULES, null, 2);
  }
  return JSON.stringify(rule, null, 2);
};

const buildFormState = (params: {
  isNewAgent: boolean;
  agentDraft: ReturnType<typeof useAgentsStore.getState>['agentDraft'];
  selectedAgent: Agent | null;
}): AgentFormState | null => {
  const { isNewAgent, agentDraft, selectedAgent } = params;
  const draftPermission = asPermissionConfig(isNewAgent ? agentDraft?.permission : selectedAgent?.permission);

  if (isNewAgent && agentDraft) {
    return {
      draftName: agentDraft.name || '',
      draftScope: agentDraft.scope || 'user',
      description: agentDraft.description || '',
      displayName: agentDraft.display_name || '',
      mode: agentDraft.mode || 'subagent',
      model: agentDraft.model || '',
      thinking: agentDraft.thinking,
      steps: agentDraft.steps,
      enabled: agentDraft.enabled ?? true,
      prompt: agentDraft.prompt || '',
      simpleToolActions: getSimpleToolActions(draftPermission),
      editPermissionMode: getEditPermissionMode(draftPermission),
      customEditRulesText: getCustomEditRulesText(draftPermission),
    };
  }

  if (!selectedAgent) {
    return null;
  }

  const extended = selectedAgent as AgentWithPiFields;
  return {
    draftName: '',
    draftScope: 'user',
    description: selectedAgent.description || '',
    displayName: extended.displayName || '',
    mode: selectedAgent.mode || 'subagent',
    model: selectedAgent.model?.providerID && selectedAgent.model?.modelID
      ? `${selectedAgent.model.providerID}/${selectedAgent.model.modelID}`
      : '',
    thinking: extended.thinking,
    steps: extended.steps,
    enabled: extended.enabled ?? true,
    prompt: selectedAgent.prompt || '',
    simpleToolActions: getSimpleToolActions(draftPermission),
    editPermissionMode: getEditPermissionMode(draftPermission),
    customEditRulesText: getCustomEditRulesText(draftPermission),
  };
};

const areStringRecordArraysEqual = (left: Record<string, PermissionAction>, right: Record<string, PermissionAction>) => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
};

const buildPermissionConfig = (
  simpleToolActions: Record<string, PermissionAction>,
  editPermissionMode: EditPermissionMode,
  customEditRulesText: string,
): AgentConfig['permission'] => {
  const permission: Record<string, PermissionRuleValue> = {};

  Object.entries(simpleToolActions).forEach(([toolName, action]) => {
    if (action === 'deny') {
      permission[toolName] = 'deny';
    }
  });

  if (editPermissionMode === 'deny') {
    permission.edit = 'deny';
    permission.bash = 'deny';
    return permission;
  }

  if (editPermissionMode === 'markdown') {
    permission.edit = { ...EDIT_PERMISSION_MARKDOWN_RULES };
    permission.bash = 'deny';
    return permission;
  }

  if (editPermissionMode === 'custom') {
    const parsed = JSON.parse(customEditRulesText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Custom edit rules must be a JSON object.');
    }

    const normalized = Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, PermissionAction] => isPermissionAction(entry[1]))
        .map(([pattern, action]) => [pattern, action])
    );

    if (!Object.prototype.hasOwnProperty.call(normalized, '*')) {
      throw new Error('Custom edit rules must include a "*" fallback rule.');
    }

    permission.edit = normalized;
    permission.bash = 'deny';
    return permission;
  }

  if (permission.bash === 'deny') {
    delete permission.bash;
  }

  return Object.keys(permission).length > 0 ? permission : undefined;
};

export const AgentsPage: React.FC = () => {
  const {
    selectedAgentName,
    getAgentByName,
    createAgent,
    updateAgent,
    agents,
    agentDraft,
    setAgentDraft,
  } = useAgentsStore();
  const { tools: availableTools, isLoading: toolsLoading } = useAvailableTools();

  const selectedAgent = selectedAgentName ? (getAgentByName(selectedAgentName) ?? null) : null;
  const isNewAgent = Boolean(agentDraft && agentDraft.name === selectedAgentName && !selectedAgent);

  const [draftName, setDraftName] = React.useState('');
  const [draftScope, setDraftScope] = React.useState<AgentScope>('user');
  const [description, setDescription] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [mode, setMode] = React.useState<NonNullable<AgentConfig['mode']>>('subagent');
  const [model, setModel] = React.useState('');
  const [thinking, setThinking] = React.useState<ThinkingLevel | undefined>(undefined);
  const [steps, setSteps] = React.useState<number | undefined>(undefined);
  const [enabled, setEnabled] = React.useState(true);
  const [prompt, setPrompt] = React.useState('');
  const [simpleToolActions, setSimpleToolActions] = React.useState<Record<string, PermissionAction>>({});
  const [editPermissionMode, setEditPermissionMode] = React.useState<EditPermissionMode>('allow');
  const [customEditRulesText, setCustomEditRulesText] = React.useState(JSON.stringify(EDIT_PERMISSION_MARKDOWN_RULES, null, 2));
  const [isSaving, setIsSaving] = React.useState(false);
  const initialStateRef = React.useRef<AgentFormState | null>(null);

  const toolOptions = React.useMemo(() => {
    return sortToolNames([
      ...DEFAULT_TOOL_ORDER,
      ...availableTools.filter((toolName) => normalizeToolName(toolName) !== 'edit' && normalizeToolName(toolName) !== 'write'),
      ...Object.keys(simpleToolActions),
    ]);
  }, [availableTools, simpleToolActions]);

  React.useEffect(() => {
    const nextState = buildFormState({ isNewAgent, agentDraft, selectedAgent });
    if (!nextState) {
      initialStateRef.current = null;
      return;
    }

    setDraftName(nextState.draftName);
    setDraftScope(nextState.draftScope);
    setDescription(nextState.description);
    setDisplayName(nextState.displayName);
    setMode(nextState.mode);
    setModel(nextState.model);
    setThinking(nextState.thinking);
    setSteps(nextState.steps);
    setEnabled(nextState.enabled);
    setPrompt(nextState.prompt);
    setSimpleToolActions(nextState.simpleToolActions);
    setEditPermissionMode(nextState.editPermissionMode);
    setCustomEditRulesText(nextState.customEditRulesText);
    initialStateRef.current = nextState;
  }, [agentDraft, isNewAgent, selectedAgent]);

  const isDirty = React.useMemo(() => {
    const initial = initialStateRef.current;
    if (!initial) {
      return false;
    }

    if (isNewAgent) {
      if (draftName !== initial.draftName) return true;
      if (draftScope !== initial.draftScope) return true;
    }

    if (description !== initial.description) return true;
    if (displayName !== initial.displayName) return true;
    if (mode !== initial.mode) return true;
    if (model !== initial.model) return true;
    if (thinking !== initial.thinking) return true;
    if (steps !== initial.steps) return true;
    if (enabled !== initial.enabled) return true;
    if (prompt !== initial.prompt) return true;
    if (!areStringRecordArraysEqual(simpleToolActions, initial.simpleToolActions)) return true;
    if (editPermissionMode !== initial.editPermissionMode) return true;
    if (customEditRulesText !== initial.customEditRulesText) return true;
    return false;
  }, [customEditRulesText, description, displayName, draftName, draftScope, editPermissionMode, enabled, isNewAgent, mode, model, prompt, simpleToolActions, steps, thinking]);

  const toggleSimpleTool = React.useCallback((toolName: string) => {
    const normalized = normalizeToolName(toolName);
    setSimpleToolActions((current) => ({
      ...current,
      [normalized]: current[normalized] === 'deny' ? 'allow' : 'deny',
    }));
  }, []);

  const handleSave = async () => {
    const agentName = isNewAgent ? draftName.trim().replace(/\s+/g, '-') : selectedAgentName?.trim();

    if (!agentName) {
      toast.error('Agent name is required');
      return;
    }

    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }

    if (isNewAgent && agents.some((agent) => agent.name === agentName)) {
      toast.error('An agent with this name already exists');
      return;
    }

    setIsSaving(true);

    try {
      const trimmedModel = model.trim();
      const permission = buildPermissionConfig(simpleToolActions, editPermissionMode, customEditRulesText);
      const config: AgentConfig = {
        name: agentName,
        description: description.trim(),
        display_name: displayName.trim() || undefined,
        mode,
        model: trimmedModel === '' ? null : trimmedModel,
        thinking,
        steps,
        enabled,
        prompt: prompt.trim() || undefined,
        permission,
        scope: isNewAgent ? draftScope : undefined,
      };

      const success = isNewAgent
        ? await createAgent(config)
        : await updateAgent(agentName, config);

      if (success) {
        if (isNewAgent) {
          setAgentDraft(null);
        }
        toast.success(isNewAgent ? 'Agent created successfully' : 'Agent updated successfully');
      } else {
        toast.error(isNewAgent ? 'Failed to create agent' : 'Failed to update agent');
      }
    } catch (error) {
      console.error('Error saving agent:', error);
      const message = error instanceof Error && error.message ? error.message : 'An error occurred while saving';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!selectedAgentName) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiRobot2Line className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">Select an agent from the sidebar</p>
          <p className="typography-meta mt-1 opacity-75">or create a new one</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollableOverlay keyboardAvoid outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {isNewAgent ? 'New Pi Agent' : selectedAgentName}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              {isNewAgent ? 'Create a Pi-native agent configuration' : 'Edit Pi-native agent settings'}
            </p>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">Identity</h3>
          </div>
          <section className="px-2 pb-2 pt-0 space-y-4">
            {isNewAgent && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
                <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                  <span className="typography-ui-label text-foreground">Agent Name</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                  <div className="flex items-center">
                    <span className="typography-ui-label text-muted-foreground mr-1">@</span>
                    <Input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      placeholder="agent-name"
                      className="h-7 w-48 px-2"
                    />
                  </div>
                  <Select value={draftScope} onValueChange={(value) => setDraftScope(value as AgentScope)}>
                    <SelectTrigger className="w-fit min-w-[110px]">
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="user">
                        <div className="flex items-center gap-2">
                          <RiUser3Line className="h-3.5 w-3.5" />
                          <span>Global</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="project">
                        <div className="flex items-center gap-2">
                          <RiFolderLine className="h-3.5 w-3.5" />
                          <span>Project</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="py-1.5">
              <span className="typography-ui-label text-foreground">Description</span>
              <div className="mt-1.5">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What does this agent do?"
                  rows={2}
                  className="w-full resize-none min-h-[60px] bg-transparent"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                <span className="typography-ui-label text-foreground">Display Name</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Optional UI label"
                  className="h-7 w-56 px-2"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                <span className="typography-ui-label text-foreground">Enabled</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                <Select value={enabled ? 'true' : 'false'} onValueChange={(value) => setEnabled(value === 'true')}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Enabled</SelectItem>
                    <SelectItem value="false">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pb-1.5 pt-0.5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="typography-ui-label text-foreground">Mode</span>
                  <Tooltip delayDuration={1000}>
                    <TooltipTrigger asChild>
                      <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent sideOffset={8} className="max-w-xs">
                      Controls whether the agent is selectable as a main agent, callable as a subagent, or both.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {(['primary', 'subagent', 'all'] as const).map((candidateMode) => (
                    <Button
                      key={candidateMode}
                      variant="outline"
                      size="xs"
                      onClick={() => setMode(candidateMode)}
                      className={cn(
                        '!font-normal',
                        mode === candidateMode
                          ? 'border-[var(--primary-base)] text-[var(--primary-base)] bg-[var(--primary-base)]/10 hover:text-[var(--primary-base)]'
                          : 'text-foreground'
                      )}
                    >
                      {candidateMode === 'primary' ? 'Primary' : candidateMode === 'subagent' ? 'Subagent' : 'All'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">Runtime</h3>
          </div>
          <section className="px-2 pb-2 pt-0 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                <span className="typography-ui-label text-foreground">Override Model</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                <ModelSelector
                  providerId={model ? model.split('/')[0] : ''}
                  modelId={model ? model.split('/')[1] : ''}
                  onChange={(providerId: string, modelId: string) => {
                    if (providerId && modelId) {
                      setModel(`${providerId}/${modelId}`);
                    } else {
                      setModel('');
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                <span className="typography-ui-label text-foreground">Thinking</span>
                <span className="typography-meta text-muted-foreground">Optional override</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                <Select value={thinking ?? '__inherit__'} onValueChange={(value) => setThinking(value === '__inherit__' ? undefined : value as ThinkingLevel)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THINKING_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                <span className="typography-ui-label text-foreground">Steps</span>
                <span className="typography-meta text-muted-foreground">Empty means unlimited</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                <NumberInput
                  value={steps}
                  fallbackValue={8}
                  onValueChange={setSteps}
                  onClear={() => setSteps(undefined)}
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="—"
                  emptyLabel="—"
                  className="w-20"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">Prompt</h3>
          </div>
          <section className="px-2 pb-2 pt-0">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="You are an expert coding assistant..."
              rows={10}
              className="w-full font-mono typography-meta min-h-[160px] max-h-[60vh] bg-transparent resize-y"
            />
          </section>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">Permission</h3>
            <p className="typography-meta text-muted-foreground mt-1">
              `edit` now follows OpenCode-style rules. Use presets for disable or Markdown-only editing; all other tools still use simple allow/deny toggles.
            </p>
          </div>
          <section className="px-2 pb-2 pt-0 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="typography-ui-label text-foreground">Edit</span>
                <span className="typography-micro text-muted-foreground/70 font-mono">edit + write</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: 'allow', label: 'Allow' },
                  { value: 'deny', label: 'Deny' },
                  { value: 'markdown', label: 'Markdown only' },
                  { value: 'custom', label: 'Custom' },
                ] as const).map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    size="xs"
                    className={cn(
                      '!font-normal',
                      editPermissionMode === option.value
                        ? 'border-[var(--primary-base)] text-[var(--primary-base)] bg-[var(--primary-base)]/10 hover:text-[var(--primary-base)]'
                        : 'text-foreground'
                    )}
                    onClick={() => {
                      setEditPermissionMode(option.value);
                      if (option.value !== 'allow') {
                        setSimpleToolActions((current) => ({ ...current, bash: 'deny' }));
                      }
                      if (option.value === 'markdown' && customEditRulesText.trim().length === 0) {
                        setCustomEditRulesText(JSON.stringify(EDIT_PERMISSION_MARKDOWN_RULES, null, 2));
                      }
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {(editPermissionMode === 'markdown' || editPermissionMode === 'custom') && (
                <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                  <p className="typography-meta text-muted-foreground">
                    {editPermissionMode === 'markdown'
                      ? 'Preset: blocks all edits except `**/*.md`. Bash is forced to deny when saving.'
                      : 'Enter a JSON rule object. Last matching rule wins. A `"*"` fallback rule is required.'}
                  </p>
                  <Textarea
                    value={editPermissionMode === 'markdown' ? JSON.stringify(EDIT_PERMISSION_MARKDOWN_RULES, null, 2) : customEditRulesText}
                    onChange={(event) => {
                      if (editPermissionMode === 'custom') {
                        setCustomEditRulesText(event.target.value);
                      }
                    }}
                    readOnly={editPermissionMode === 'markdown'}
                    rows={editPermissionMode === 'custom' ? 8 : 4}
                    className="w-full font-mono typography-meta min-h-[96px] bg-transparent resize-y"
                  />
                </div>
              )}
            </div>

            <div className="space-y-0">
              {toolOptions.map((toolName, index) => {
                const denied = simpleToolActions[toolName] === 'deny';
                return (
                  <div
                    key={toolName}
                    className={cn(
                      'flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8',
                      index > 0 && 'border-t border-[var(--surface-subtle)]'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="typography-ui-label text-foreground">{formatToolLabel(toolName)}</span>
                      <span className="typography-micro text-muted-foreground/70 font-mono">{toolName}</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className={cn(
                        '!font-normal min-w-[110px]',
                        denied
                          ? 'border-[var(--status-error)] text-[var(--status-error)] bg-[var(--status-error)]/10 hover:text-[var(--status-error)]'
                          : 'border-[var(--status-success)] text-[var(--status-success)] bg-[var(--status-success)]/10 hover:text-[var(--status-success)]'
                      )}
                      onClick={() => toggleSimpleTool(toolName)}
                    >
                      {denied ? 'Denied' : 'Enabled'}
                    </Button>
                  </div>
                );
              })}
              {toolOptions.length === 0 && (
                <div className="py-3 typography-meta text-muted-foreground">
                  {toolsLoading ? 'Loading tools…' : 'No tools available'}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="px-2 py-1">
          <Button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            size="xs"
            className="!font-normal"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </ScrollableOverlay>
  );
};
