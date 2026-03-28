import React from 'react';
import { RiDownloadLine, RiLoaderLine } from '@remixicon/react';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { UpdateDialog } from '@/components/ui/UpdateDialog';
import { useDeviceInfo } from '@/lib/device';
import { toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const MIN_CHECKING_DURATION = 800; // ms

export const AboutSettings: React.FC = () => {
  const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
  const [showChecking, setShowChecking] = React.useState(false);
  const updateStore = useUpdateStore();
  const { isMobile } = useDeviceInfo();

  const currentVersion = updateStore.info?.currentVersion || 'unknown';

  const didInitiateCheck = React.useRef(false);

  React.useEffect(() => {
    if (updateStore.checking) {
      setShowChecking(true);
      didInitiateCheck.current = true;
    } else if (showChecking) {
      const timer = setTimeout(() => {
        setShowChecking(false);
        if (didInitiateCheck.current && !updateStore.available && !updateStore.error) {
          toast.success('You are on the latest version');
          didInitiateCheck.current = false;
        }
      }, MIN_CHECKING_DURATION);
      return () => clearTimeout(timer);
    }
  }, [updateStore.checking, showChecking, updateStore.available, updateStore.error]);

  const isChecking = updateStore.checking || showChecking;

  if (isMobile) {
    return (
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between">
          <span className="typography-meta text-muted-foreground">
            v{currentVersion}
          </span>

          {!updateStore.available && !updateStore.error && (
            <button
              onClick={() => updateStore.checkForUpdates()}
              disabled={isChecking}
              className={cn(
                'typography-meta text-muted-foreground/60 hover:text-muted-foreground disabled:cursor-default',
                isChecking && 'animate-pulse [animation-duration:1s]'
              )}
            >
              Check updates
            </button>
          )}

          {!isChecking && updateStore.available && (
            <button
              onClick={() => setUpdateDialogOpen(true)}
              className="flex items-center gap-1 typography-meta text-[var(--primary-base)] hover:underline"
            >
              <RiDownloadLine className="h-3.5 w-3.5" />
              Update
            </button>
          )}
        </div>

        {updateStore.error && (
          <p className="typography-micro text-[var(--status-error)] truncate">{updateStore.error}</p>
        )}

        <UpdateDialog
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
          info={updateStore.info}
          downloading={updateStore.downloading}
          downloaded={updateStore.downloaded}
          progress={updateStore.progress}
          error={updateStore.error}
          onDownload={updateStore.downloadUpdate}
          onRestart={updateStore.restartToUpdate}
          runtimeType={updateStore.runtimeType}
        />
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="mb-3 px-1">
        <h3 className="typography-ui-header font-semibold text-foreground">
          About ridge
        </h3>
      </div>

      <div className="rounded-lg bg-[var(--surface-elevated)]/70 overflow-hidden flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="typography-ui-label text-foreground">Version</span>
            <span className="typography-meta text-muted-foreground font-mono">{currentVersion}</span>
          </div>
          
          <div className="flex items-center gap-3">
            {updateStore.checking && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RiLoaderLine className="h-4 w-4 animate-spin" />
                <span className="typography-meta">Checking...</span>
              </div>
            )}

            {!updateStore.checking && updateStore.available && (
              <Button size="sm"
                variant="default"
                onClick={() => setUpdateDialogOpen(true)}
              >
                <RiDownloadLine className="h-4 w-4 mr-1" />
                Update to {updateStore.info?.version}
              </Button>
            )}

            {!updateStore.checking && !updateStore.available && !updateStore.error && (
              <span className="typography-meta text-muted-foreground">Up to date</span>
            )}

            <Button size="sm"
              variant="outline"
              onClick={() => updateStore.checkForUpdates()}
              disabled={updateStore.checking}
            >
              Check for updates
            </Button>
          </div>
        </div>
        
        {updateStore.error && (
          <div className="px-3 py-2 border-t border-[var(--surface-subtle)]">
            <p className="typography-meta text-[var(--status-error)]">{updateStore.error}</p>
          </div>
        )}
      </div>

      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        info={updateStore.info}
        downloading={updateStore.downloading}
        downloaded={updateStore.downloaded}
        progress={updateStore.progress}
        error={updateStore.error}
        onDownload={updateStore.downloadUpdate}
        onRestart={updateStore.restartToUpdate}
        runtimeType={updateStore.runtimeType}
      />
    </div>
  );
};
