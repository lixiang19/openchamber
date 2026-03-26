import React from 'react';
import QRCode from 'qrcode';
import { RiCheckLine, RiErrorWarningLine, RiInformationLine, RiLoader4Line, RiRobot2Line } from '@remixicon/react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type WeChatBridgeLoginStatus = 'idle' | 'starting' | 'scanned' | 'connected' | 'error';

interface WeChatBridgeStatus {
  enabled: boolean;
  loginStatus: WeChatBridgeLoginStatus;
  connected: boolean;
  accountId: string | null;
  qrUrl: string | null;
  lastError: string | null;
  scannedAt: number | null;
  connectedAt: number | null;
  updatedAt: number;
  defaultSessionId: string | null;
  defaultCwd: string | null;
  bindings: Array<{ userId: string; sessionId: string; cwd: string | null; updatedAt: number }>;
}

interface WeChatSessionDialogProps {
  sessionId: string;
  sessionTitle: string;
  sessionCwd: string;
}

const API_BASE = '/api/wechat-bridge';

const EMPTY_STATUS: WeChatBridgeStatus = {
  enabled: false,
  loginStatus: 'idle',
  connected: false,
  accountId: null,
  qrUrl: null,
  lastError: null,
  scannedAt: null,
  connectedAt: null,
  updatedAt: Date.now(),
  defaultSessionId: null,
  defaultCwd: null,
  bindings: [],
};

const parseResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

const statusMeta: Record<WeChatBridgeLoginStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  idle: { label: 'Idle', tone: 'text-muted-foreground bg-muted/40 border-border/60', icon: null },
  starting: { label: 'Waiting for QR', tone: 'text-amber-500 bg-amber-500/10 border-amber-500/20', icon: <RiLoader4Line className="size-3.5 animate-spin" /> },
  scanned: { label: 'Scanned', tone: 'text-sky-500 bg-sky-500/10 border-sky-500/20', icon: <RiCheckLine className="size-3.5" /> },
  connected: { label: 'Connected', tone: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: <RiCheckLine className="size-3.5" /> },
  error: { label: 'Error', tone: 'text-red-500 bg-red-500/10 border-red-500/20', icon: <RiErrorWarningLine className="size-3.5" /> },
};

export const WeChatSessionDialog: React.FC<WeChatSessionDialogProps> = ({ sessionId, sessionTitle, sessionCwd }) => {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<WeChatBridgeStatus>(EMPTY_STATUS);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isStarting, setIsStarting] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [isBinding, setIsBinding] = React.useState(false);

  const refreshStatus = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/status`, { headers: { Accept: 'application/json' } });
      const nextStatus = await parseResponse<WeChatBridgeStatus>(response);
      setStatus(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load WeChat status';
      setStatus((current) => ({
        ...current,
        loginStatus: 'error',
        lastError: message,
      }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    void refreshStatus();
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [open, refreshStatus]);

  React.useEffect(() => {
    if (!status.qrUrl) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(status.qrUrl, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrDataUrl(dataUrl);
      }
    }).catch(() => {
      if (!cancelled) {
        setQrDataUrl(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [status.qrUrl]);

  const linkCurrentSession = React.useCallback(async () => {
    setIsBinding(true);
    try {
      const response = await fetch(`${API_BASE}/default-target`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ sessionId, cwd: sessionCwd, rebindExisting: true }),
      });
      const nextStatus = await parseResponse<WeChatBridgeStatus>(response);
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBinding(false);
    }
  }, [sessionCwd, sessionId]);

  const handleConnect = React.useCallback(async () => {
    setIsStarting(true);
    try {
      await linkCurrentSession();
      if (status.loginStatus === 'connected') {
        await parseResponse<WeChatBridgeStatus>(await fetch(`${API_BASE}/stop`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
        }));
      }
      const response = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const nextStatus = await parseResponse<WeChatBridgeStatus>(response);
      setStatus(nextStatus);
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect WeChat';
      setStatus((current) => ({
        ...current,
        loginStatus: 'error',
        lastError: message,
      }));
    } finally {
      setIsStarting(false);
    }
  }, [linkCurrentSession, refreshStatus, status.loginStatus]);

  const handleDisconnect = React.useCallback(async () => {
    setIsStopping(true);
    try {
      const response = await fetch(`${API_BASE}/stop`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const nextStatus = await parseResponse<WeChatBridgeStatus>(response);
      setStatus(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop WeChat bridge';
      setStatus((current) => ({
        ...current,
        loginStatus: 'error',
        lastError: message,
      }));
    } finally {
      setIsStopping(false);
    }
  }, []);

  const loginStatus = status.loginStatus;
  const statusInfo = statusMeta[loginStatus];
  const isCurrentSessionTarget = status.defaultSessionId === sessionId;
  const showQr = Boolean(qrDataUrl && (loginStatus === 'starting' || loginStatus === 'scanned'));
  const connectLabel = loginStatus === 'connected' ? '重新扫码到当前会话' : '连接微信到当前会话';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => setOpen(true)}
        className="absolute right-3 top-3 z-20 !font-normal bg-[var(--surface-background)]/95"
        aria-label="Connect WeChat to this session"
      >
        <RiRobot2Line className="h-4 w-4" />
        WeChat
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RiRobot2Line className="h-4 w-4" />
              WeChat Link
            </DialogTitle>
            <DialogDescription>
              Link WeChat to the current chat session instead of configuring it globally.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-[var(--surface-elevated)]/40 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="typography-ui-label text-foreground">Current Session</div>
                <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 typography-micro font-medium', statusInfo.tone)}>
                  {statusInfo.icon}
                  <span>{statusInfo.label}</span>
                </span>
              </div>
              <div className="typography-ui text-foreground">{sessionTitle}</div>
              <div className="mt-1 font-mono typography-micro text-muted-foreground/80">{sessionCwd}</div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2">
                <RiInformationLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground/70" />
                <div className="typography-micro text-muted-foreground/80">
                  {isCurrentSessionTarget
                    ? 'WeChat messages are linked to this session.'
                    : 'This session is not the active WeChat target yet. Click the primary button to switch the link here.'}
                </div>
              </div>
            </div>

            {status.lastError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 typography-micro text-red-500">
                {status.lastError}
              </div>
            )}

            {showQr ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="rounded-xl border border-border bg-[var(--surface-elevated)] p-3 shadow-none">
                  <img
                    src={qrDataUrl ?? undefined}
                    alt="WeChat link QR code"
                    className="size-52 rounded-lg bg-white p-2"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                  <div className="typography-ui text-muted-foreground">
                    Scan the QR code in WeChat to link the current session.
                  </div>
                  <div className="typography-micro text-muted-foreground/70">
                    {loginStatus === 'starting' ? 'Waiting for the QR code to be scanned.' : 'QR scanned. Confirm the login in WeChat.'}
                  </div>
                  {status.accountId && (
                    <div className="typography-micro text-muted-foreground/70">
                      Account: {status.accountId}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-[var(--surface-elevated)]/40 px-4 py-6 text-center typography-ui text-muted-foreground/80">
                {loginStatus === 'connected'
                  ? 'WeChat is connected. You can relink or rescan for this session.'
                  : loginStatus === 'starting'
                    ? 'Generating a fresh QR code…'
                    : loginStatus === 'scanned'
                      ? 'QR scanned. Waiting for WeChat confirmation…'
                      : 'Click the button below to link this session with WeChat.'}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                onClick={() => void handleConnect()}
                disabled={isLoading || isStarting || isStopping || isBinding}
                className="!font-normal"
              >
                {isStarting ? 'Linking…' : connectLabel}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void linkCurrentSession()}
                disabled={isLoading || isStarting || isStopping || isBinding}
                className="!font-normal"
              >
                {isBinding ? 'Binding…' : '仅切换到当前会话'}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void handleDisconnect()}
                disabled={isStopping || loginStatus === 'idle'}
                className="!font-normal"
              >
                {isStopping ? 'Disconnecting…' : '断开微信'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
