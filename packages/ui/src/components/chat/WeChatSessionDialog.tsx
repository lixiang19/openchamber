import React from 'react';
import QRCode from 'qrcode';
import { RiCheckLine, RiErrorWarningLine, RiLoader4Line, RiRobot2Line, RiExternalLinkLine, RiInformationLine, RiCloseLine } from '@remixicon/react';

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
  triggerClassName?: string;
  triggerVariant?: React.ComponentProps<typeof Button>['variant'];
  triggerSize?: React.ComponentProps<typeof Button>['size'];
  showTriggerLabel?: boolean;
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
  idle: { label: '未连接', tone: 'text-muted-foreground bg-muted/20 border-border/40', icon: null },
  starting: { label: '等待扫码', tone: 'text-amber-500 bg-amber-500/10 border-amber-500/20', icon: <RiLoader4Line className="size-3.5 animate-spin" /> },
  scanned: { label: '等待手机确认', tone: 'text-sky-500 bg-sky-500/10 border-sky-500/20', icon: <RiCheckLine className="size-3.5" /> },
  connected: { label: '已连接', tone: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: <RiCheckLine className="size-3.5" /> },
  error: { label: '连接中断', tone: 'text-red-500 bg-red-500/10 border-red-500/20', icon: <RiErrorWarningLine className="size-3.5" /> },
};

export const WeChatSessionDialog: React.FC<WeChatSessionDialogProps> = ({
  sessionId,
  sessionTitle,
  sessionCwd,
  triggerClassName,
  triggerVariant = 'outline',
  triggerSize = 'xs',
  showTriggerLabel = true,
}) => {
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
      const response = await fetch(`${API_BASE}/status?t=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
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
  const connectLabel = loginStatus === 'connected' ? '重新扫码' : '连接微信';
  const statusSummary = loginStatus === 'connected'
    ? (status.accountId ? `已连接 ${status.accountId}` : '微信已连接')
    : loginStatus === 'starting'
      ? '请使用微信扫码。'
      : loginStatus === 'scanned'
        ? '已扫码，请在微信中确认登录。'
        : '把微信消息绑定到当前会话。';

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        onClick={() => setOpen(true)}
        className={cn('bg-[var(--surface-background)]/95 !font-normal', triggerClassName)}
        aria-label="连接当前会话的微信"
      >
        <RiRobot2Line className="h-4 w-4" />
        {showTriggerLabel ? 'WeChat' : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0 overflow-hidden border-none shadow-2xl">
          <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-[var(--surface-elevated)]">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                  <RiRobot2Line className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-semibold tracking-tight">微信消息转发</DialogTitle>
                  <p className="typography-micro mt-0.5 text-muted-foreground/80">扫码连接后，微信消息将同步进入当前会话</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full opacity-70 hover:opacity-100"
                onClick={() => setOpen(false)}
              >
                <RiCloseLine className="size-4" />
              </Button>
            </div>

            <div className="p-6 space-y-6 bg-[var(--surface-background)]">
              {/* Current Context Card */}
              <div className="relative overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated)] p-4 shadow-sm">
                <div className="relative z-10 flex items-start justify-between">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="typography-micro mb-2 inline-flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-0.5 font-medium text-muted-foreground">
                      <RiInformationLine className="size-3" />
                      当前目标会话
                    </div>
                    <div className="typography-ui truncate font-semibold text-foreground">{sessionTitle}</div>
                    <div className="mt-1 typography-micro truncate text-muted-foreground/60">{sessionCwd}</div>
                  </div>
                  <div className={cn('shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 typography-micro font-medium shadow-xs transition-colors', statusInfo.tone)}>
                    {statusInfo.icon}
                    <span>{statusInfo.label}</span>
                  </div>
                </div>

                {/* Selection Status Indicator */}
                <div className="mt-4 flex items-center gap-2.5 border-t border-border/30 pt-4">
                  <div className={cn(
                    'size-2.5 rounded-full ring-4 ring-offset-0',
                    isCurrentSessionTarget ? 'bg-emerald-500 ring-emerald-500/10' : 'bg-muted-foreground/30 ring-muted/20'
                  )} />
                  <span className="typography-micro font-medium text-muted-foreground/90">
                    {isCurrentSessionTarget ? '此会话正接收微信消息' : '此会话非响应目标'}
                  </span>
                  {!isCurrentSessionTarget && loginStatus === 'connected' && (
                    <Button
                      variant="link"
                      size="xs"
                      className="ml-auto h-auto p-0 text-sky-500 typography-micro hover:text-sky-600"
                      onClick={() => void linkCurrentSession()}
                      disabled={isBinding}
                    >
                      {isBinding ? '切换中...' : '切换到此'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Login Area */}
              {showQr ? (
                <div className="flex flex-col items-center justify-center space-y-4 py-2">
                  <div className="group relative rounded-2xl border border-border/80 bg-white p-4 shadow-sm transition-all hover:bg-white/95 active:scale-[0.99]">
                    <img
                      src={qrDataUrl ?? undefined}
                      alt="WeChat link QR code"
                      className={cn(
                        "size-48 rounded-lg bg-white transition-opacity duration-300",
                        loginStatus === 'scanned' ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'
                      )}
                    />
                    {loginStatus === 'scanned' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/10 backdrop-blur-[1px]">
                        <div className="flex size-14 items-center justify-center rounded-full bg-sky-500 text-white shadow-xl animate-in zoom-in-50 duration-300">
                          <RiCheckLine className="size-8" />
                        </div>
                        <p className="mt-4 font-semibold text-sky-600 typography-ui">手机端已扫码</p>
                        <p className="typography-micro text-sky-500/80">请在手机微信点击确认</p>
                      </div>
                    )}
                  </div>
                  <p className="typography-ui text-center text-muted-foreground/90">
                    {loginStatus === 'starting' ? '请使用微信扫一扫' : '等待确认登录...'}
                  </p>
                </div>
              ) : loginStatus === 'connected' ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-4 rounded-xl border border-dashed border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                    <RiCheckLine className="size-6" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-emerald-600 typography-ui">
                      {status.accountId ? `已登录: ${status.accountId}` : '微信已成功连接'}
                    </p>
                    <p className="typography-micro mt-1 text-emerald-500/70 truncate px-4">您可以开始通过微信发送消息了</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-border/60 bg-muted/5 opacity-80">
                  <RiRobot2Line className="size-10 mb-4 text-muted-foreground/30" />
                  <p className="typography-ui text-muted-foreground">尚未连接微信号</p>
                </div>
              )}

              {/* Error Message */}
              {status.lastError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/5 p-3 animate-in fade-in slide-in-from-top-1">
                  <RiErrorWarningLine className="size-4 shrink-0 mt-0.5 text-red-500/80" />
                  <p className="typography-micro leading-relaxed text-red-500/90">{status.lastError}</p>
                </div>
              )}

              {/* Action Bar */}
              <div className="flex items-center gap-3 pt-2">
                {loginStatus === 'idle' || loginStatus === 'error' ? (
                  <Button
                    type="button"
                    size="default"
                    className="flex-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700 shadow-md transition-all active:scale-[0.98]"
                    onClick={() => void handleConnect()}
                    disabled={isLoading || isStarting}
                  >
                    {isStarting ? (
                      <>
                        <RiLoader4Line className="mr-2 size-4 animate-spin" />
                        启动中...
                      </>
                    ) : '微信扫码登录'}
                  </Button>
                ) : (
                  <div className="flex w-full gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 !font-normal border-amber-200/50 hover:bg-amber-50"
                      onClick={() => void handleConnect()}
                      disabled={isLoading || isStarting}
                    >
                      重新扫码
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 !font-normal text-red-500 border-red-200/50 hover:bg-red-50 hover:text-red-600"
                      onClick={() => void handleDisconnect()}
                      disabled={isStopping}
                    >
                      {isStopping ? '断开中' : '退出登录'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
