import React from 'react';
import { RiDownloadLine, RiFolderLine, RiLoaderLine } from '@remixicon/react';

import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { ButtonSmall } from '@/components/ui/button-small';
import { toast } from '@/components/ui';
import { finishConfigUpdate, startConfigUpdate, updateConfigUpdateMessage } from '@/lib/configUpdate';
import { isDesktopLocalOriginActive, isTauriShell, requestDirectoryAccess } from '@/lib/desktop';
import { refreshAfterOpenCodeRestart } from '@/stores/useAgentsStore';

type InstallSource = 'template' | 'directory' | 'upload';

type UploadedConfigFile = {
  relativePath: string;
  contentBase64: string;
};

type InstallRequest =
  | { source: 'template' }
  | { source: 'directory'; directoryPath: string }
  | { source: 'upload'; files: UploadedConfigFile[] };

type InstallResponse = {
  success: boolean;
  error?: string;
  message?: string;
  requiresReload?: boolean;
  reloadDelayMs?: number;
  stats?: {
    files: number;
    directories: number;
  };
};

type UploadCapableFile = File & {
  webkitRelativePath?: string;
};

const TEMPLATE_ENTRIES = ['opencode.json', 'agents/', 'skills/', 'commands/'] as const;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function encodeFileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
}

function stripTopLevelUploadDirectory(relativePaths: string[]): string[] {
  const normalizedPaths = relativePaths.map(normalizeRelativePath).filter(Boolean);
  if (normalizedPaths.length === 0) {
    return [];
  }

  const topLevelSegments = new Set(normalizedPaths.map((entry) => entry.split('/')[0]).filter(Boolean));
  if (topLevelSegments.size !== 1) {
    return normalizedPaths;
  }

  return normalizedPaths.map((entry) => {
    const stripped = entry.split('/').slice(1).join('/');
    return stripped || entry;
  });
}

async function buildUploadedConfigFiles(fileList: FileList): Promise<UploadedConfigFile[]> {
  const files = Array.from(fileList) as UploadCapableFile[];
  const relativePaths = stripTopLevelUploadDirectory(
    files.map((file) => file.webkitRelativePath?.trim() || file.name),
  );

  return await Promise.all(
    files.map(async (file, index) => ({
      relativePath: relativePaths[index] || file.name,
      contentBase64: await encodeFileToBase64(file),
    })),
  );
}

function describeInstallStats(stats?: { files: number; directories: number }): string {
  if (!stats) {
    return '配置目录已更新';
  }
  return `已写入 ${stats.files} 个文件，创建 ${stats.directories} 个目录`;
}

export const OpencodeConfigInstallPage: React.FC = () => {
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const [activeInstallSource, setActiveInstallSource] = React.useState<InstallSource | null>(null);

  const canUseNativeDirectoryPicker = React.useMemo(() => {
    return isTauriShell() && isDesktopLocalOriginActive();
  }, []);

  React.useEffect(() => {
    const input = uploadInputRef.current;
    if (!input) {
      return;
    }
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  const runInstall = React.useCallback(async (request: InstallRequest) => {
    setActiveInstallSource(request.source);
    startConfigUpdate('Installing OpenCode configuration…');

    let requiresReload = false;

    try {
      const response = await fetch('/api/config/opencode/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
      });

      const payload = (await response.json().catch(() => null)) as InstallResponse | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to install OpenCode configuration');
      }

      if (payload.requiresReload) {
        requiresReload = true;
        await refreshAfterOpenCodeRestart({
          message: payload.message,
          delayMs: payload.reloadDelayMs,
          scopes: ['all'],
          mode: 'projects',
        });
      }

      toast.success('配置安装完成', {
        description: describeInstallStats(payload.stats),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install OpenCode configuration';
      updateConfigUpdateMessage('OpenCode configuration install failed. Please retry.');
      toast.error('配置安装失败', {
        description: message,
      });
    } finally {
      if (!requiresReload) {
        finishConfigUpdate();
      }
      setActiveInstallSource(null);
    }
  }, []);

  const handleInstallTemplate = React.useCallback(async () => {
    await runInstall({ source: 'template' });
  }, [runInstall]);

  const handleImportFolder = React.useCallback(async () => {
    if (canUseNativeDirectoryPicker) {
      const result = await requestDirectoryAccess('');
      if (!result.success || !result.path?.trim()) {
        if (result.error && !result.error.toLowerCase().includes('cancelled')) {
          toast.error('选择文件夹失败', {
            description: result.error,
          });
        }
        return;
      }

      await runInstall({
        source: 'directory',
        directoryPath: result.path.trim(),
      });
      return;
    }

    uploadInputRef.current?.click();
  }, [canUseNativeDirectoryPicker, runInstall]);

  const handleUploadInputChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.currentTarget.value = '';

    if (!files || files.length === 0) {
      return;
    }

    try {
      const uploadedFiles = await buildUploadedConfigFiles(files);
      await runInstall({ source: 'upload', files: uploadedFiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read selected folder';
      toast.error('读取文件夹失败', {
        description: message,
      });
    }
  }, [runInstall]);

  const isInstallingTemplate = activeInstallSource === 'template';
  const isInstallingFolder = activeInstallSource === 'directory' || activeInstallSource === 'upload';
  const isBusy = activeInstallSource !== null;

  return (
    <SettingsPageLayout>
      <div className="space-y-6">
        <div className="space-y-1 px-1">
          <h1 className="typography-ui-header font-semibold text-foreground">Config Install</h1>
          <p className="typography-ui text-muted-foreground">
            覆盖写入本地 <span className="font-mono text-xs">~/.config/opencode</span>，用于安装你的专属工作平台配置。
          </p>
        </div>

        <section className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="space-y-1">
                <h2 className="typography-ui-header font-medium text-foreground">仓库模板</h2>
                <p className="typography-meta text-muted-foreground">
                  使用仓库内预置模板整体替换本地配置目录。适合第一次安装或快速重置。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_ENTRIES.map((entry) => (
                  <span
                    key={entry}
                    className="inline-flex items-center rounded-md border border-[var(--interactive-border)] bg-[var(--surface-background)] px-2 py-1 font-mono text-xs text-[var(--surface-muted-foreground)]"
                  >
                    {entry}
                  </span>
                ))}
              </div>
            </div>

            <ButtonSmall
              type="button"
              onClick={() => void handleInstallTemplate()}
              disabled={isBusy}
              className="shrink-0 !font-normal"
            >
              {isInstallingTemplate ? (
                <>
                  <RiLoaderLine className="h-4 w-4 animate-spin" />
                  覆盖安装中…
                </>
              ) : (
                <>
                  <RiDownloadLine className="h-4 w-4" />
                  覆盖式安装
                </>
              )}
            </ButtonSmall>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="typography-ui-header font-medium text-foreground">上传文件夹</h2>
              <p className="typography-meta text-muted-foreground">
                选择一个本地文件夹，并将该文件夹内容整体覆盖写入目标配置目录。
              </p>
              <p className="typography-meta text-muted-foreground/80">
                {canUseNativeDirectoryPicker
                  ? '当前运行时会打开系统目录选择器。'
                  : '当前运行时会读取你选择的文件夹内容后再上传写入。'}
              </p>
              {!canUseNativeDirectoryPicker && (
                <p className="typography-meta text-muted-foreground/80">
                  浏览器文件夹上传不会保留空目录。
                </p>
              )}
            </div>

            <ButtonSmall
              type="button"
              variant="outline"
              onClick={() => void handleImportFolder()}
              disabled={isBusy}
              className="shrink-0 !font-normal"
            >
              {isInstallingFolder ? (
                <>
                  <RiLoaderLine className="h-4 w-4 animate-spin" />
                  上传中…
                </>
              ) : (
                <>
                  <RiFolderLine className="h-4 w-4" />
                  上传文件夹
                </>
              )}
            </ButtonSmall>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-4">
          <div className="space-y-1">
            <div className="typography-ui-label text-[var(--status-warning)]">注意</div>
            <p className="typography-meta text-[var(--status-warning)]">
              两个操作都会整体替换 <span className="font-mono text-xs">~/.config/opencode</span> 当前内容，然后自动重载 OpenCode。
            </p>
          </div>
        </section>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleUploadInputChange(event);
          }}
        />
      </div>
    </SettingsPageLayout>
  );
};
