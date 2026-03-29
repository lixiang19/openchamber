import React from 'react';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { AgentSelector } from '@/components/sections/commands/AgentSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { updateDesktopSettings } from '@/lib/persistence';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';

const THINKING_LEVELS = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '最小' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
] as const;

const getDisplayModel = (
  storedModel: string | undefined
): { providerId: string; modelId: string } => {
  if (storedModel) {
    const parts = storedModel.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { providerId: parts[0], modelId: parts[1] };
    }
  }
  return { providerId: '', modelId: '' };
};

export const DefaultsSettings: React.FC = () => {
  const setProvider = useConfigStore((state) => state.setProvider);
  const setModel = useConfigStore((state) => state.setModel);
  const setAgent = useConfigStore((state) => state.setAgent);
  const setSettingsDefaultModel = useConfigStore((state) => state.setSettingsDefaultModel);
  const setSettingsDefaultAgent = useConfigStore((state) => state.setSettingsDefaultAgent);
  const setSettingsDefaultThinkingLevel = useConfigStore((state) => state.setSettingsDefaultThinkingLevel);
  const showDeletionDialog = useUIStore((state) => state.showDeletionDialog);
  const setShowDeletionDialog = useUIStore((state) => state.setShowDeletionDialog);
  const providers = useConfigStore((state) => state.providers);

  const settingsDefaultModel = useConfigStore((state) => state.settingsDefaultModel);
  const settingsDefaultAgent = useConfigStore((state) => state.settingsDefaultAgent);
  const settingsDefaultThinkingLevel = useConfigStore((state) => state.settingsDefaultThinkingLevel);

  const parsedModel = React.useMemo(() => getDisplayModel(settingsDefaultModel), [settingsDefaultModel]);

  const handleModelChange = React.useCallback(
    async (providerId: string, modelId: string) => {
      const newValue = providerId && modelId ? `${providerId}/${modelId}` : undefined;
      setSettingsDefaultModel(newValue);

      if (providerId && modelId) {
        const provider = providers.find((p) => p.id === providerId);
        if (provider) {
          setProvider(providerId);
          setModel(modelId);
        }
      }

      try {
        await updateDesktopSettings({ defaultModel: newValue ?? '' });
        await fetch('/api/config/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultModel: newValue }),
        });
      } catch (error) {
        console.warn('保存默认模型失败:', error);
      }
    },
    [providers, setModel, setProvider, setSettingsDefaultModel]
  );

  const handleThinkingLevelChange = React.useCallback(
    async (level: string) => {
      const newValue: typeof THINKING_LEVELS[number]['value'] | undefined = level === 'off' ? undefined : level as typeof THINKING_LEVELS[number]['value'];
      setSettingsDefaultThinkingLevel(newValue);

      try {
        await updateDesktopSettings({ defaultThinkingLevel: newValue });
        await fetch('/api/config/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultThinkingLevel: newValue }),
        });
      } catch (error) {
        console.warn('Failed to save default thinking level:', error);
      }
    },
    [setSettingsDefaultThinkingLevel]
  );

  const handleAgentChange = React.useCallback(
    async (agentName: string) => {
      const newValue = agentName || undefined;
      setSettingsDefaultAgent(newValue);

      if (agentName) {
        setAgent(agentName);
      }

      try {
        await updateDesktopSettings({ defaultAgent: newValue ?? '' });
      } catch (error) {
        console.warn('保存默认智能体失败:', error);
      }
    },
    [setAgent, setSettingsDefaultAgent]
  );

  return (
    <div className="mb-6">
      <div className="mb-0.5 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">Session Defaults</h3>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-0">
        <div className="mt-0 mb-1 typography-meta text-muted-foreground">
          新会话将使用：{' '}
          {parsedModel.providerId ? (
            <span className="text-foreground">
              {parsedModel.providerId}/{parsedModel.modelId}
            </span>
          ) : (
            <span className="text-foreground">pi agent default</span>
          )}
          {settingsDefaultThinkingLevel && (
            <>
              {' / '}
              <span className="text-foreground">思考: {settingsDefaultThinkingLevel}</span>
            </>
          )}
          {settingsDefaultAgent && (
            <>
              {' / '}
              <span className="text-foreground">{settingsDefaultAgent}</span>
            </>
          )}
        </div>

        <div className={cn('flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8')}>
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">默认模型</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
            <ModelSelector providerId={parsedModel.providerId} modelId={parsedModel.modelId} onChange={handleModelChange} />
          </div>
        </div>

        <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">默认思考级别</span>
          </div>
          <div className="flex items-center gap-2 sm:w-fit">
            <Select 
              value={settingsDefaultThinkingLevel ?? 'off'} 
              onValueChange={handleThinkingLevelChange}
            >
              <SelectTrigger className="w-fit min-w-[140px]">
                <SelectValue placeholder="思考级别" />
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">默认智能体</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
            <AgentSelector agentName={settingsDefaultAgent || ''} onChange={handleAgentChange} />
          </div>
        </div>

        <div
          className="group flex cursor-pointer items-center gap-2 py-1"
          role="button"
          tabIndex={0}
          aria-pressed={showDeletionDialog}
          onClick={() => setShowDeletionDialog(!showDeletionDialog)}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              setShowDeletionDialog(!showDeletionDialog);
            }
          }}
        >
          <Checkbox checked={showDeletionDialog} onChange={setShowDeletionDialog} ariaLabel="显示删除对话框" />
          <span className="typography-ui-label text-foreground">Show Deletion Dialog</span>
        </div>

      </section>
    </div>
  );
};
