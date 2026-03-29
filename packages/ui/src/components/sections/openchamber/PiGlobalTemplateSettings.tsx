import React from 'react';
import { RiAlertLine, RiRefreshLine, RiUploadCloud2Line } from '@remixicon/react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { reloadRuntimeConfiguration } from '@/stores/useAgentsStore';

const PI_GLOBAL_SETTINGS_TEMPLATE_ENDPOINT = '/api/config/pi-global-settings-template';
const FALLBACK_PI_AGENT_DIR = '~/.pi/agent';

type PiGlobalTemplateFile = {
  path?: string;
  content?: string;
};

type PiGlobalTemplateResponse = {
  targetDir?: string;
  files?: PiGlobalTemplateFile[];
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
};

const isVisibleTemplateFile = (file: PiGlobalTemplateFile) => {
  return typeof file.path === 'string' && file.path.trim().length > 0 && !file.path.endsWith('/.keep');
};

export const PiGlobalTemplateSettings: React.FC = () => {
  const [targetDir, setTargetDir] = React.useState(FALLBACK_PI_AGENT_DIR);
  const [files, setFiles] = React.useState<PiGlobalTemplateFile[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isWriting, setIsWriting] = React.useState(false);

  const loadTemplate = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(PI_GLOBAL_SETTINGS_TEMPLATE_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as PiGlobalTemplateResponse | null;
      if (!response.ok) {
        throw new Error('加载 Pi 目录模板失败');
      }

      if (typeof payload?.targetDir === 'string' && payload.targetDir.trim().length > 0) {
        setTargetDir(payload.targetDir);
      }
      if (Array.isArray(payload?.files)) {
        setFiles(payload.files.filter(isVisibleTemplateFile));
      }
    } catch (error) {
      console.error('Failed to load Pi global template directory:', error);
      toast.error('加载 Pi 目录模板失败', {
        description: getErrorMessage(error, '请稍后重试'),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  const handleWriteTemplate = React.useCallback(async () => {
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(
        `这会先删除再重建 ${targetDir}，其中已有的 auth.json、models.json、sessions 等内容都会被清空，继续吗？`
      );
    if (!confirmed) {
      return;
    }

    setIsWriting(true);
    try {
      const response = await fetch(PI_GLOBAL_SETTINGS_TEMPLATE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as PiGlobalTemplateResponse | null;
      if (!response.ok) {
        throw new Error('覆盖 Pi 全局目录失败');
      }

      if (typeof payload?.targetDir === 'string' && payload.targetDir.trim().length > 0) {
        setTargetDir(payload.targetDir);
      }
      if (Array.isArray(payload?.files)) {
        setFiles(payload.files.filter(isVisibleTemplateFile));
      }

      await reloadRuntimeConfiguration({
        message: 'Pi 全局目录已重写，正在重载运行时...',
        scopes: ['all'],
        mode: 'projects',
      });

      toast.success('Pi 全局目录已覆盖写入', {
        description: typeof payload?.targetDir === 'string' && payload.targetDir.trim().length > 0 ? payload.targetDir : targetDir,
      });
    } catch (error) {
      console.error('Failed to overwrite Pi global agent directory:', error);
      toast.error('覆盖 Pi 全局目录失败', {
        description: getErrorMessage(error, '请检查服务端日志'),
      });
    } finally {
      setIsWriting(false);
    }
  }, [targetDir]);

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <div className="flex items-center gap-2">
          <h3 className="typography-ui-header font-medium text-foreground">Pi 全局目录模板</h3>
        </div>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-3">
        <p className="typography-meta text-muted-foreground">
          这里写入的不是单个 JSON，而是整个 Pi 全局配置目录模板。点击后会先删除再重建目标目录。
        </p>

        <div className="rounded-xl border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 text-[13px] text-foreground">
          <div className="flex items-start gap-2">
            <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]" />
            <div className="space-y-1">
              <div className="typography-ui-label text-foreground">危险操作</div>
              <p className="typography-meta text-muted-foreground">
                会整体覆盖 <span className="font-mono text-foreground">{targetDir}</span>，现有的认证、模型、自定义资源与会话文件都会被删除。
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[var(--surface-elevated)]/80 p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="typography-ui-label text-foreground">目标目录</div>
              <div className="break-all rounded-lg bg-background/80 px-2 py-1 font-mono text-xs text-muted-foreground">
                {targetDir}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void loadTemplate()}
                disabled={isLoading || isWriting}
              >
                <RiRefreshLine className="h-3.5 w-3.5" />
                刷新模板
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void handleWriteTemplate()}
                disabled={isLoading || isWriting}
              >
                <RiUploadCloud2Line className="h-4 w-4" />
                {isWriting ? '覆盖目录中...' : '覆盖整个全局 Pi 目录'}
              </Button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-2 typography-ui-label text-foreground">模板文件</div>
              <div className="flex flex-wrap gap-2">
                {isLoading ? (
                  <span className="typography-meta text-muted-foreground">正在加载模板文件...</span>
                ) : files.length > 0 ? (
                  files.map((file) => (
                    <span
                      key={file.path}
                      className="rounded-full border border-border/70 bg-background/70 px-2 py-1 font-mono text-xs text-muted-foreground"
                    >
                      {file.path}
                    </span>
                  ))
                ) : (
                  <span className="typography-meta text-muted-foreground">模板目录为空</span>
                )}
              </div>
            </div>

            {files.map((file) => (
              <div key={`preview:${file.path}`} className="overflow-hidden rounded-lg border border-border/60 bg-background/70">
                <div className="border-b border-border/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {file.path}
                </div>
                <pre className="max-h-72 overflow-auto px-3 py-3 font-mono text-xs leading-6 text-foreground">
                  {typeof file.content === 'string' && file.content.length > 0 ? file.content : '(empty file)'}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
