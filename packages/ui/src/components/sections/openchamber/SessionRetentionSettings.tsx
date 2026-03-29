import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RiInformationLine, RiRestartLine } from '@remixicon/react';
import { toast } from '@/components/ui';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionAutoCleanup } from '@/hooks/useSessionAutoCleanup';

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_RETENTION_DAYS = 30;

export const SessionRetentionSettings: React.FC = () => {
  const autoDeleteEnabled = useUIStore((state) => state.autoDeleteEnabled);
  const autoDeleteAfterDays = useUIStore((state) => state.autoDeleteAfterDays);
  const setAutoDeleteEnabled = useUIStore((state) => state.setAutoDeleteEnabled);
  const setAutoDeleteAfterDays = useUIStore((state) => state.setAutoDeleteAfterDays);

  const { candidates, isRunning, runCleanup } = useSessionAutoCleanup({ autoRun: false });
  const pendingCount = candidates.length;

  const handleRunCleanup = React.useCallback(async () => {
    const result = await runCleanup({ force: true });
    if (result.deletedIds.length === 0 && result.failedIds.length === 0) {
      toast.message('没有符合删除条件的会话');
      return;
    }
    if (result.deletedIds.length > 0) {
      toast.success(`Deleted ${result.deletedIds.length} session${result.deletedIds.length === 1 ? '' : 's'}`);
    }
    if (result.failedIds.length > 0) {
      toast.error(`Failed to delete ${result.failedIds.length} session${result.failedIds.length === 1 ? '' : 's'}`);
    }
  }, [runCleanup]);

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">
            Session Retention
          </h3>
          <Tooltip delayDuration={1000}>
            <TooltipTrigger asChild>
              <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent sideOffset={8} className="max-w-xs">
              根据上次活动自动删除非活动会话。保留最近5个会话。
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-0.5">
        <div
          className="group flex cursor-pointer items-center gap-2 py-1.5"
          role="button"
          tabIndex={0}
          aria-pressed={autoDeleteEnabled}
          onClick={() => setAutoDeleteEnabled(!autoDeleteEnabled)}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              setAutoDeleteEnabled(!autoDeleteEnabled);
            }
          }}
        >
          <Checkbox
            checked={autoDeleteEnabled}
            onChange={setAutoDeleteEnabled}
            ariaLabel="启用自动清理"
          />
          <span className="typography-ui-label text-foreground">启用自动清理</span>
        </div>

        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">Retention Period</span>
          </div>
          <div className="flex items-center gap-2 sm:w-fit">
            <NumberInput
              value={autoDeleteAfterDays}
              onValueChange={setAutoDeleteAfterDays}
              min={MIN_DAYS}
              max={MAX_DAYS}
              step={1}
              aria-label="保留期限（天）"
              className="w-20 tabular-nums"
            />
            <span className="typography-ui-label text-muted-foreground">天</span>
            <Button size="sm"
              type="button"
              variant="ghost"
              onClick={() => setAutoDeleteAfterDays(DEFAULT_RETENTION_DAYS)}
              disabled={autoDeleteAfterDays === DEFAULT_RETENTION_DAYS}
              className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
              aria-label="重置保留期限"
              title="重置"
            >
              <RiRestartLine className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <div className="mt-1 px-2 py-1.5 space-y-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <p className="typography-meta text-foreground font-medium">Manual Cleanup</p>
          </div>
          <div className="flex items-center gap-2 sm:w-fit">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleRunCleanup}
              disabled={isRunning}
              className="!font-normal"
            >
              {isRunning ? '清理中...' : '立即运行清理'}
            </Button>
          </div>
        </div>
        <p className="typography-meta text-muted-foreground">
          当前符合删除条件： <span className="tabular-nums">{pendingCount}</span>
        </p>
      </div>
    </div>
  );
};
