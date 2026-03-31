import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import {
  useMcpConfigStore,
  type McpDraft,
  type McpScope,
} from '@/stores/useMcpConfigStore';
import { useMcpStore } from '@/stores/useMcpStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import {
  RiAddLine,
  RiClipboardLine,
  RiCodeLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFolderLine,
  RiPlugLine,
  RiUser3Line,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

interface CommandTextareaProps {
  value: string[];
  onChange: (v: string[]) => void;
}

function parseShellCommand(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current) {
    args.push(current);
  }
  return args;
}

const CommandTextarea: React.FC<CommandTextareaProps> = ({ value, onChange }) => {
  const [text, setText] = React.useState(() => value.join('\n'));
  const prevValueRef = React.useRef(value);

  React.useEffect(() => {
    if (JSON.stringify(prevValueRef.current) !== JSON.stringify(value)) {
      prevValueRef.current = value;
      setText(value.join('\n'));
    }
  }, [value]);

  const commit = (raw: string) => {
    const lines = raw
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    onChange(lines);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const trimmed = raw.trim();
      const lines = trimmed.includes('\n')
        ? trimmed.split('\n').filter((line) => line.trim())
        : parseShellCommand(trimmed);
      setText(lines.join('\n'));
      onChange(lines);
      toast.success(`已粘贴 ${lines.length} 个参数`);
    } catch {
      toast.error('无法读取剪贴板');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="xs"
          className="!font-normal gap-1 text-muted-foreground"
          onClick={handlePasteFromClipboard}
          type="button"
          title="从剪贴板粘贴完整命令并自动分割"
        >
          <RiClipboardLine className="h-3 w-3" />
          Paste command
        </Button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => {
          const cleaned = text
            .split('\n')
            .map((line) => line.trimEnd())
            .join('\n');
          setText(cleaned);
          commit(cleaned);
        }}
        placeholder={'npx\n-y\nchrome-devtools-mcp@latest'}
        rows={Math.max(4, value.length + 1)}
        className="font-mono typography-meta resize-y min-h-[80px]"
        spellCheck={false}
      />

      {value.length > 0 && (
        <details className="group">
          <summary className="typography-micro text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground">
            Preview ({value.length} args)
          </summary>
          <div className="mt-1 rounded-md bg-[var(--surface-elevated)] px-3 py-2 overflow-x-auto">
            <code className="typography-micro text-foreground/80 whitespace-pre">
              {value.map((arg, index) => (
                <span key={index} className="block">
                  <span className="text-muted-foreground select-none mr-2">[{index}]</span>
                  {arg}
                </span>
              ))}
            </code>
          </div>
        </details>
      )}
    </div>
  );
};

interface EnvEntry {
  key: string;
  value: string;
}

interface EnvEditorProps {
  value: EnvEntry[];
  onChange: (v: EnvEntry[]) => void;
}

const EnvEditor: React.FC<EnvEditorProps> = ({ value, onChange }) => {
  const [revealedKeys, setRevealedKeys] = React.useState<Set<number>>(new Set());

  const addRow = () => onChange([...value, { key: '', value: '' }]);

  const removeRow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  const updateRow = (idx: number, field: 'key' | 'value', val: string) => {
    const next = [...value];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  };

  const toggleReveal = (idx: number) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handlePasteDotEnv = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed: EnvEntry[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) parsed.push({ key, value: val });
      }
      onChange([...value, ...parsed]);
      toast.success(`已解析 ${parsed.length} 个环境变量`);
    } catch {
      toast.error('无法读取剪贴板');
    }
  };

  const hasSensitiveValues = value.some((entry) => /token|secret|key|password/i.test(entry.key) && entry.value.trim().length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="xs"
          className="!font-normal gap-1 text-muted-foreground"
          onClick={handlePasteDotEnv}
          type="button"
          title="从剪贴板粘贴 .env 格式"
        >
          <RiClipboardLine className="h-3 w-3" />
          Paste .env
        </Button>
      </div>

      <div className="space-y-2">
        {value.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-md border border-border/60 bg-[var(--surface-elevated)] px-2 py-2">
            <Input
              value={entry.key}
              onChange={(e) => updateRow(idx, 'key', e.target.value)}
              placeholder="KEY"
              className="h-7 w-40 font-mono px-2"
              spellCheck={false}
            />
            <Input
              value={entry.value}
              onChange={(e) => updateRow(idx, 'value', e.target.value)}
              placeholder="value"
              className="h-7 min-w-0 flex-1 font-mono px-2"
              type={revealedKeys.has(idx) ? 'text' : 'password'}
              spellCheck={false}
            />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 w-7 px-0 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => toggleReveal(idx)}
            >
              {revealedKeys.has(idx) ? <RiEyeOffLine className="h-3.5 w-3.5" /> : <RiEyeLine className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 px-0 shrink-0 text-muted-foreground hover:text-[var(--status-error)]"
              onClick={() => removeRow(idx)}
            >
              <RiDeleteBinLine className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="xs"
        className="!font-normal gap-1.5"
        onClick={addRow}
        type="button"
      >
        <RiAddLine className="h-3.5 w-3.5" />
        Add variable
      </Button>

      {hasSensitiveValues && (
        <p className="typography-micro text-muted-foreground/60">
          ⚠ 值会以明文写入 Pi MCP 配置文件。
        </p>
      )}
    </div>
  );
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  failed: 'Failed',
  needs_auth: 'Needs auth',
  needs_client_registration: 'Needs registration',
  cached: 'Cached',
  configured: 'Configured',
  idle: 'Idle',
};

const StatusBadge: React.FC<{ status: string | undefined; enabled: boolean }> = ({ status, enabled }) => {
  if (!enabled || !status) return null;

  const colorMap: Record<string, string> = {
    connected: 'text-[var(--status-success)]',
    failed: 'text-[var(--status-error)]',
    needs_auth: 'text-[var(--status-warning)]',
    needs_client_registration: 'text-[var(--status-warning)]',
    cached: 'text-muted-foreground',
    configured: 'text-muted-foreground',
    idle: 'text-muted-foreground',
  };

  return (
    <span className={cn('typography-micro font-medium', colorMap[status] ?? 'text-muted-foreground')}>
      ● {STATUS_LABEL[status] ?? status}
    </span>
  );
};

export const McpPage: React.FC = () => {
  const {
    selectedMcpName,
    mcpServers,
    mcpDraft,
    setMcpDraft,
    setSelectedMcp,
    getMcpByName,
    createMcp,
    updateMcp,
    deleteMcp,
  } = useMcpConfigStore();

  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const mcpStatus = useMcpStore((state) => state.getStatusForDirectory(currentDirectory ?? null));
  const refreshStatus = useMcpStore((state) => state.refresh);
  const connectMcp = useMcpStore((state) => state.connect);
  const disconnectMcp = useMcpStore((state) => state.disconnect);

  const selectedServer = selectedMcpName ? getMcpByName(selectedMcpName) : null;
  const isNewServer = Boolean(mcpDraft && mcpDraft.name === selectedMcpName && !selectedServer);

  const [draftName, setDraftName] = React.useState('');
  const [draftScope, setDraftScope] = React.useState<McpScope>('user');
  const [mcpType, setMcpType] = React.useState<'local' | 'remote'>('local');
  const [command, setCommand] = React.useState<string[]>([]);
  const [url, setUrl] = React.useState('');
  const [cwd, setCwd] = React.useState('');
  const [envEntries, setEnvEntries] = React.useState<EnvEntry[]>([]);
  const [advancedJson, setAdvancedJson] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isConnecting, setIsConnecting] = React.useState(false);

  const initialRef = React.useRef<{
    draftScope: McpScope;
    mcpType: 'local' | 'remote';
    command: string[];
    url: string;
    cwd: string;
    envEntries: EnvEntry[];
    advancedJson: string;
  } | null>(null);

  React.useEffect(() => {
    if (isNewServer && mcpDraft) {
      setDraftName(mcpDraft.name);
      setDraftScope(mcpDraft.scope || 'user');
      setMcpType(mcpDraft.type);
      setCommand(mcpDraft.command);
      setUrl(mcpDraft.url);
      setCwd(mcpDraft.cwd);
      setEnvEntries(mcpDraft.environment);
      setAdvancedJson(mcpDraft.advancedJson);
      initialRef.current = {
        draftScope: mcpDraft.scope || 'user',
        mcpType: mcpDraft.type,
        command: mcpDraft.command,
        url: mcpDraft.url,
        cwd: mcpDraft.cwd,
        envEntries: mcpDraft.environment,
        advancedJson: mcpDraft.advancedJson,
      };
      return;
    }

    if (selectedServer) {
      setDraftScope(selectedServer.scope === 'project' ? 'project' : 'user');
      setMcpType(selectedServer.type);
      setCommand(selectedServer.command);
      setUrl(selectedServer.url);
      setCwd(selectedServer.cwd);
      setEnvEntries(selectedServer.environment);
      setAdvancedJson(selectedServer.advancedJson);
      initialRef.current = {
        draftScope: selectedServer.scope === 'project' ? 'project' : 'user',
        mcpType: selectedServer.type,
        command: selectedServer.command,
        url: selectedServer.url,
        cwd: selectedServer.cwd,
        envEntries: selectedServer.environment,
        advancedJson: selectedServer.advancedJson,
      };
    }
  }, [selectedServer, isNewServer, mcpDraft]);

  const isDirty = React.useMemo(() => {
    const init = initialRef.current;
    if (!init) return false;
    return (
      draftScope !== init.draftScope ||
      mcpType !== init.mcpType ||
      JSON.stringify(command) !== JSON.stringify(init.command) ||
      url !== init.url ||
      cwd !== init.cwd ||
      JSON.stringify(envEntries) !== JSON.stringify(init.envEntries) ||
      advancedJson !== init.advancedJson
    );
  }, [draftScope, mcpType, command, url, cwd, envEntries, advancedJson]);

  const handleSave = async () => {
    const name = isNewServer ? draftName.trim() : selectedMcpName ?? '';
    if (!name) {
      toast.error('名称必填');
      return;
    }
    if (isNewServer && mcpServers.some((server) => server.name === name)) {
      toast.error('此名称的服务器已存在');
      return;
    }
    if (mcpType === 'local' && command.filter(Boolean).length === 0) {
      toast.error('本地服务器的命令不能为空');
      return;
    }
    if (mcpType === 'remote' && !url.trim()) {
      toast.error('远程服务器的 URL 不能为空');
      return;
    }
    if (advancedJson.trim()) {
      try {
        const parsed = JSON.parse(advancedJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error('高级 JSON 必须是一个对象');
          return;
        }
      } catch {
        toast.error('高级 JSON 格式无效');
        return;
      }
    }

    const draft: McpDraft = {
      name,
      scope: draftScope,
      type: mcpType,
      command,
      url,
      environment: envEntries,
      cwd,
      advancedJson,
      sourcePath: selectedServer?.sourcePath,
      cache: selectedServer?.cache ?? null,
    };

    setIsSaving(true);
    try {
      const success = isNewServer ? await createMcp(draft) : await updateMcp(name, draft);
      if (success) {
        if (isNewServer) {
          setMcpDraft(null);
          setSelectedMcp(name);
        }
        toast.success(isNewServer ? 'Pi MCP server created.' : 'Saved successfully.');
      } else {
        toast.error('保存失败');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发生错误');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMcpName) return;
    setIsDeleting(true);
    const ok = await deleteMcp(selectedMcpName);
    if (ok) {
      toast.success(`"${selectedMcpName}" 已删除`);
      setShowDeleteConfirm(false);
    } else {
      toast.error('删除失败');
    }
    setIsDeleting(false);
  };

  const handleToggleConnect = async () => {
    if (!selectedMcpName) return;
    setIsConnecting(true);
    try {
      const isConnected = mcpStatus[selectedMcpName]?.status === 'connected';
      if (isConnected) {
        await disconnectMcp(selectedMcpName, currentDirectory);
        toast.success('Disconnected');
      } else {
        await connectMcp(selectedMcpName, currentDirectory);
        toast.success('Connected');
      }
      await refreshStatus({ directory: currentDirectory, silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接失败');
    } finally {
      setIsConnecting(false);
    }
  };

  if (!selectedMcpName) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiPlugLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">从左侧选择一个 Pi MCP 服务器</p>
          <p className="typography-meta mt-1 opacity-75">或新建一个服务器</p>
        </div>
      </div>
    );
  }

  const runtimeStatus = mcpStatus[selectedMcpName];
  const isConnected = runtimeStatus?.status === 'connected';

  return (
    <ScrollableOverlay keyboardAvoid outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
        <div className="mb-4">
          <div className="min-w-0">
            {isNewServer ? (
              <h2 className="typography-ui-header font-semibold text-foreground truncate">New Pi MCP Server</h2>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="typography-ui-header font-semibold text-foreground truncate">{selectedMcpName}</h2>
                <StatusBadge status={runtimeStatus?.status} enabled={true} />
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <p className="typography-meta text-muted-foreground truncate">
                {isNewServer ? '创建一个新的 Pi MCP 服务器配置' : `${mcpType === 'local' ? 'Local · stdio' : 'Remote · HTTP'} transport`}
              </p>
              {!isNewServer && (
                <Button
                  variant={isConnected ? 'outline' : 'default'}
                  size="xs"
                  className="!font-normal"
                  onClick={handleToggleConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? 'Working...' : isConnected ? 'Disconnect' : 'Connect'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">Server</h3>
          </div>

          <section className="px-2 pb-2 pt-0 space-y-0">
            {isNewServer && (
              <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
                <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                  <span className="typography-ui-label text-foreground">Server Name</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                    placeholder="my-mcp-server"
                    className="h-7 w-48 font-mono px-2"
                    autoFocus
                  />
                  <Select value={draftScope} onValueChange={(value) => setDraftScope(value as McpScope)}>
                    <SelectTrigger
                      className="!h-7 !w-7 !min-w-0 !px-0 !py-0 justify-center [&>svg:last-child]:hidden"
                      title={draftScope === 'user' ? 'User scope' : 'Project scope'}
                    >
                      {draftScope === 'user' ? <RiUser3Line className="h-3.5 w-3.5" /> : <RiFolderLine className="h-3.5 w-3.5" />}
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="user">
                        <div className="flex items-center gap-2">
                          <RiUser3Line className="h-3.5 w-3.5" />
                          <span>User</span>
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

            <div className="group flex items-center gap-2 py-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-border/60 bg-[var(--surface-elevated)] text-[var(--primary-base)]">
                <RiCodeLine className="h-3.5 w-3.5" />
              </span>
              <span className="typography-ui-label text-foreground">Pi MCP Adapter 配置</span>
            </div>

            <div className="pb-1.5 pt-0.5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="typography-ui-label text-foreground">Transport Mode</span>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setMcpType('local')}
                    className={cn(
                      '!font-normal',
                      mcpType === 'local'
                        ? 'border-[var(--primary-base)] text-[var(--primary-base)] bg-[var(--primary-base)]/10 hover:text-[var(--primary-base)]'
                        : 'text-foreground'
                    )}
                  >
                    Local · stdio
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setMcpType('remote')}
                    className={cn(
                      '!font-normal',
                      mcpType === 'remote'
                        ? 'border-[var(--primary-base)] text-[var(--primary-base)] bg-[var(--primary-base)]/10 hover:text-[var(--primary-base)]'
                        : 'text-foreground'
                    )}
                  >
                    Remote · HTTP
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">
              {mcpType === 'local' ? 'Command' : 'Server URL'}
            </h3>
          </div>

          <section className="px-2 pb-2 pt-0 space-y-4">
            {mcpType === 'local' ? (
              <CommandTextarea value={command} onChange={setCommand} />
            ) : (
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="font-mono typography-meta"
              />
            )}

            <div className="space-y-1.5">
              <span className="typography-ui-label text-foreground">Working Directory</span>
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="font-mono typography-meta"
              />
            </div>
          </section>
        </div>

        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">
              Environment Variables
              {envEntries.length > 0 && (
                <span className="ml-1.5 typography-micro text-muted-foreground font-normal">
                  ({envEntries.length})
                </span>
              )}
            </h3>
          </div>

          <section className="px-2 pb-2 pt-0">
            <EnvEditor value={envEntries} onChange={setEnvEntries} />
          </section>
        </div>

        <div className="mb-2">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground flex items-center gap-2">
              <RiCodeLine className="h-4 w-4 text-muted-foreground" />
              Advanced JSON
            </h3>
            <p className="typography-micro text-muted-foreground/70 mt-1">
              这里会原样合并进服务器配置；适合 lifecycle、auth、directTools、headers 等高级字段。
            </p>
          </div>

          <section className="px-2 pb-2 pt-0">
            <Textarea
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              placeholder={`{\n  "lifecycle": "lazy",\n  "directTools": false,\n  "debug": false\n}`}
              rows={10}
              className="font-mono typography-meta min-h-[180px]"
              spellCheck={false}
            />
          </section>
        </div>

        <div className="flex items-center gap-2 px-2 py-1">
          <Button
            onClick={handleSave}
            disabled={isSaving || (!isDirty && !isNewServer)}
            size="xs"
            className="!font-normal"
          >
            {isSaving ? 'Saving...' : isNewServer ? 'Create' : 'Save Changes'}
          </Button>
          {!isNewServer && (
            <Button
              variant="ghost"
              size="xs"
              className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setShowDeleteConfirm(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete "{selectedMcpName}"?</DialogTitle>
            <DialogDescription>
              这会把服务器从 <code className="text-foreground">~/.pi/agent/mcp.json</code> 或{' '}
              <code className="text-foreground">.pi/mcp.json</code> 中移除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
              className="text-foreground hover:bg-interactive-hover hover:text-foreground"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollableOverlay>
  );
};
