import React from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { debugUtils } from '@/lib/debug';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';

declare const __APP_VERSION__: string | undefined;

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const [version, setVersion] = React.useState<string | null>(null);
  const [isCopyingDiagnostics, setIsCopyingDiagnostics] = React.useState(false);
  const [copiedDiagnostics, setCopiedDiagnostics] = React.useState(false);
  const [diagnosticsReport, setDiagnosticsReport] = React.useState<string | null>(null);
  const [isPreparingDiagnostics, setIsPreparingDiagnostics] = React.useState(false);

  const handleCopyDiagnostics = React.useCallback(async () => {
    if (isCopyingDiagnostics) return;
    setIsCopyingDiagnostics(true);
    setCopiedDiagnostics(false);
    try {
      if (!diagnosticsReport) {
        toast.error('复制失败', {
          description: '诊断信息尚未准备好，请稍后再试。',
        });
        return;
      }

      const result = await debugUtils.copyTextToClipboard(diagnosticsReport);
      if (result.ok) {
        setCopiedDiagnostics(true);
        toast.success('诊断信息已复制');
      } else {
        toast.error('复制失败', {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error('复制失败');
      console.error('Failed to copy diagnostics:', error);
    } finally {
      setIsCopyingDiagnostics(false);
    }
  }, [diagnosticsReport, isCopyingDiagnostics]);

  React.useEffect(() => {
    if (!open) return;

    const isDesktop = typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);

    if (isDesktop) {
      const fetchVersion = async () => {
        try {
          const { getVersion } = await import('@tauri-apps/api/app');
          const v = await getVersion();
          setVersion(v);
        } catch {
          setVersion(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null);
        }
      };
      fetchVersion();
    } else {
      setVersion(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setDiagnosticsReport(null);
      setIsPreparingDiagnostics(false);
      return;
    }

    let cancelled = false;
    setIsPreparingDiagnostics(true);
    void debugUtils.buildDiagnosticsReport()
      .then((report) => {
        if (cancelled) return;
        setDiagnosticsReport(report);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to prepare diagnostics:', error);
        setDiagnosticsReport(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsPreparingDiagnostics(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const displayVersion = version;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs p-6">
        <div className="flex flex-col items-center text-center space-y-4">
          <OpenChamberLogo width={64} height={64} />

          <div className="space-y-1">
            <h2 className="text-lg font-semibold">ridge</h2>
            {displayVersion && (
              <p className="typography-meta text-muted-foreground">
                版本12 {displayVersion}
              </p>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <button
              onClick={handleCopyDiagnostics}
              disabled={isCopyingDiagnostics || isPreparingDiagnostics || !diagnosticsReport}
              className={cn(
                'typography-meta text-muted-foreground hover:text-foreground',
                'underline-offset-2 hover:underline',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {copiedDiagnostics
                ? '诊断信息已复制'
                : isPreparingDiagnostics
                  ? '正在准备诊断信息...'
                  : '复制诊断信息'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
