import React from 'react';
import { cn } from '@/lib/utils';
import type { PaceInfo } from '@/lib/quota';
import { getPaceStatusColor, formatRemainingTime } from '@/lib/quota';

interface PaceIndicatorProps {
  paceInfo: PaceInfo;
  className?: string;
  /** Compact mode shows just the status dot and prediction */
  compact?: boolean;
}

/**
 * Visual indicator showing whether usage is on track, slightly fast, or too fast.
 * Inspired by opencode-bar's pace visualization.
 */
export const PaceIndicator: React.FC<PaceIndicatorProps> = ({
  paceInfo,
  className,
  compact = false,
}) => {
  const statusColor = getPaceStatusColor(paceInfo.status);

  const statusLabel = React.useMemo(() => {
    switch (paceInfo.status) {
      case 'on-track':
        return '正常';
      case 'slightly-fast':
        return '略快';
      case 'too-fast':
        return '过快';
      case 'exhausted':
        return '已用完';
    }
  }, [paceInfo.status]);

  const predictionTooltip = `基于当前速度的窗口结束预测用量: ${paceInfo.predictText}`;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <div
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: statusColor }}
          title={statusLabel}
        />
        <span
          className="typography-micro tabular-nums"
          style={{ color: statusColor }}
          title={paceInfo.isExhausted ? undefined : predictionTooltip}
        >
          {paceInfo.isExhausted ? (
            <>等待 {formatRemainingTime(paceInfo.remainingSeconds)}</>
          ) : (
            <>预测: {paceInfo.predictText}</>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <div className="flex items-center gap-1.5">
        {!paceInfo.isExhausted && (
          <span className="typography-micro text-muted-foreground">
            速度: {paceInfo.paceRateText}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="typography-micro tabular-nums"
          style={{ color: statusColor }}
        >
          {paceInfo.isExhausted ? (
            <>
              <span className="font-medium">{statusLabel}</span>
              <span className="text-muted-foreground"> · 等待 </span>
              <span className="font-medium">{formatRemainingTime(paceInfo.remainingSeconds)}</span>
            </>
          ) : (
            <span title={predictionTooltip}>
              <span className="text-muted-foreground">预测: </span>
              <span className="font-medium">{paceInfo.predictText}</span>
            </span>
          )}
        </span>
        <div
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: statusColor }}
          title={statusLabel}
        />
      </div>
    </div>
  );
};
