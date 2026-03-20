import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';

declare const __APP_VERSION__: string | undefined;

type ProbeResult = {
  ok: boolean;
  status: number;
  elapsedMs: number;
  summary: string;
};

type OpenAuroraHealthSnapshot = {
  openCodePort?: unknown;
  openCodeRunning?: unknown;
  openCodeSecureConnection?: unknown;
  openCodeAuthSource?: unknown;
  isOpenCodeReady?: unknown;
  lastOpenCodeError?: unknown;
  opencodeBinaryResolved?: unknown;
  opencodeBinarySource?: unknown;
  opencodeShimInterpreter?: unknown;
  nodeBinaryResolved?: unknown;
  bunBinaryResolved?: unknown;
};

type OpenAuroraOpencodeResolution = {
  configured?: unknown;
  resolved?: unknown;
  resolvedDir?: unknown;
  source?: unknown;
  detectedNow?: unknown;
  detectedSourceNow?: unknown;
  shim?: unknown;
  node?: unknown;
  bun?: unknown;
};

const getCurrentDirectory = (): string => {
  const state = useSessionStore.getState();
  const currentSessionId = state.currentSessionId;
  if (!currentSessionId) return '';
  const session = state.sessions.find((s) => s.id === currentSessionId);
  return typeof session?.directory === 'string' ? session.directory : '';
};

const safeFetch = async (input: string, timeoutMs = 6000): Promise<ProbeResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const resp = await fetch(input, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - startedAt;
    const contentType = resp.headers.get('content-type') || '';
    const lower = contentType.toLowerCase();
    const isJson = lower.includes('json') && !lower.includes('text/html');

    let summary = '';
    if (isJson) {
      const json = await resp.json().catch(() => null);
      if (Array.isArray(json)) {
        summary = `json[array] len=${json.length}`;
      } else if (json && typeof json === 'object') {
        const keys = Object.keys(json).slice(0, 8);
        summary = `json[object] keys=${keys.join(',')}${Object.keys(json).length > keys.length ? ',…' : ''}`;
      } else {
        summary = `json[${typeof json}]`;
      }
    } else {
      summary = contentType ? `content-type=${contentType}` : 'no content-type';
    }

    return { ok: resp.ok && isJson, status: resp.status, elapsedMs, summary };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const isAbort =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')));
    const message = isAbort
      ? `timeout after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ok: false, status: 0, elapsedMs, summary: `error=${message}` };
  } finally {
    clearTimeout(timeout);
  }
};

const formatIso = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '(n/a)';
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '(invalid)';
  }
};

const normalizePort = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

export const buildOpenCodeStatusReport = async (): Promise<string> => {
  const now = new Date();
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '(unknown)';
  const platform = typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)';
  const directory = getCurrentDirectory();
  const eventStreamStatus = useUIStore.getState().eventStreamStatus;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const apiBase = origin ? `${origin.replace(/\/+$/, '')}/api/` : '';

  const openAuroraHealth: OpenAuroraHealthSnapshot | null = await (async () => {
    if (!origin) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${origin.replace(/\/+$/, '')}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const json = (await resp.json().catch(() => null)) as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
      return json as OpenAuroraHealthSnapshot;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  const openAuroraOpencodeResolutionResult: {
    data: OpenAuroraOpencodeResolution | null;
    status: number | null;
    error: string | null;
  } = await (async () => {
    if (!origin) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await fetch(`${origin.replace(/\/+$/, '')}/api/config/opencode-resolution`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = resp.headers.get('content-type') || '(none)';
      if (!resp.ok) {
        return { data: null, status: resp.status, error: `http ${resp.status} content-type=${contentType}` };
      }
      const raw = await resp.text();
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        const snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
        return {
          data: null,
          status: resp.status,
          error: `invalid json content-type=${contentType} body=${snippet || '(empty)'}`,
        };
      }
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return { data: null, status: resp.status, error: `invalid json-shape content-type=${contentType}` };
      }
      return { data: json as OpenAuroraOpencodeResolution, status: resp.status, error: null };
    } catch (error) {
      return {
        data: null,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  })() || { data: null, status: null, error: null };

  const buildProbeUrl = (pathname: string, includeDirectory = true): string | null => {
    if (!apiBase) return null;
    const url = new URL(pathname.replace(/^\/+/, ''), apiBase);
    if (includeDirectory && directory) {
      url.searchParams.set('directory', directory);
    }
    return url.toString();
  };

  const probeTargets: Array<{ label: string; path: string; includeDirectory?: boolean; timeoutMs?: number }> = [
    { label: 'health', path: '/global/health', includeDirectory: false },
    { label: 'config', path: '/config', includeDirectory: true },
    { label: 'providers', path: '/config/providers', includeDirectory: true },
    { label: 'agents', path: '/agent', includeDirectory: true, timeoutMs: 12000 },
    { label: 'commands', path: '/command', includeDirectory: true, timeoutMs: 10000 },
    { label: 'project', path: '/project/current', includeDirectory: true },
    { label: 'path', path: '/path', includeDirectory: true },
    { label: 'sessions', path: '/session', includeDirectory: true, timeoutMs: 12000 },
    { label: 'sessionStatus', path: '/session/status', includeDirectory: true },
  ];

  const probes = apiBase
    ? await Promise.all(
        probeTargets.map(async (entry) => {
          const url = buildProbeUrl(entry.path, entry.includeDirectory !== false);
          if (!url) return { label: entry.label, url: '(none)', result: null as ProbeResult | null };
          const result = await safeFetch(url, typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined);
          return { label: entry.label, url, result };
        })
      )
    : [];

  const lines: string[] = [];
  lines.push(`Time: ${now.toISOString()}`);
  lines.push(`OpenAurora version: ${appVersion}`);
  lines.push(`Runtime: ${origin || '(unknown)'} (api=${origin ? origin + '/api' : '(unknown)'})`);
  lines.push(`Event stream: ${eventStreamStatus}`);
  lines.push(`Directory: ${directory || '(none)'}`);
  lines.push(`Platform: ${platform}`);

  const runtimeOpenCodePort = normalizePort(openAuroraHealth?.openCodePort);
  lines.push(`OpenCode runtime port: ${runtimeOpenCodePort ?? '(unknown)'}`);
  if (typeof openAuroraHealth?.openCodeRunning === 'boolean') {
    lines.push(`OpenCode runtime running: ${openAuroraHealth.openCodeRunning ? 'yes' : 'no'}`);
  }
  if (typeof openAuroraHealth?.openCodeSecureConnection === 'boolean') {
    lines.push(`Secure OpenCode connection: ${openAuroraHealth.openCodeSecureConnection ? 'true' : 'false'}`);
  }
  if (typeof openAuroraHealth?.openCodeAuthSource === 'string' && openAuroraHealth.openCodeAuthSource.trim()) {
    lines.push(`OpenCode auth source: ${openAuroraHealth.openCodeAuthSource}`);
  }

  if (typeof window !== 'undefined') {
    const injected = (window as unknown as { __OPENAURORA_MACOS_MAJOR__?: unknown }).__OPENAURORA_MACOS_MAJOR__;
    if (typeof injected === 'number' && Number.isFinite(injected) && injected > 0) {
      lines.push(`macOS major: ${injected}`);
    }
  }

  const isLikelyMac = /Mac OS X|Macintosh/.test(platform);
  if (isLikelyMac) {
    lines.push('');
    lines.push('OpenCode CLI resolution:');

    const openAuroraOpencodeResolution = openAuroraOpencodeResolutionResult.data;
    const configured =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.configured === 'string'
        ? openAuroraOpencodeResolution.configured
        : null;
    const resolved =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.resolved === 'string'
        ? openAuroraOpencodeResolution.resolved
        : (openAuroraHealth && typeof openAuroraHealth.opencodeBinaryResolved === 'string' ? openAuroraHealth.opencodeBinaryResolved : '');
    const resolvedDir =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.resolvedDir === 'string'
        ? openAuroraOpencodeResolution.resolvedDir
        : '';
    const source =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.source === 'string'
        ? openAuroraOpencodeResolution.source
        : (openAuroraHealth && typeof openAuroraHealth.opencodeBinarySource === 'string' ? openAuroraHealth.opencodeBinarySource : '');
    const shim =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.shim === 'string'
        ? openAuroraOpencodeResolution.shim
        : (openAuroraHealth && typeof openAuroraHealth.opencodeShimInterpreter === 'string' ? openAuroraHealth.opencodeShimInterpreter : '');
    const node =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.node === 'string'
        ? openAuroraOpencodeResolution.node
        : (openAuroraHealth && typeof openAuroraHealth.nodeBinaryResolved === 'string' ? openAuroraHealth.nodeBinaryResolved : '');
    const bun =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.bun === 'string'
        ? openAuroraOpencodeResolution.bun
        : (openAuroraHealth && typeof openAuroraHealth.bunBinaryResolved === 'string' ? openAuroraHealth.bunBinaryResolved : '');
    const detectedNow =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.detectedNow === 'string'
        ? openAuroraOpencodeResolution.detectedNow
        : '';
    const detectedSourceNow =
      openAuroraOpencodeResolution && typeof openAuroraOpencodeResolution.detectedSourceNow === 'string'
        ? openAuroraOpencodeResolution.detectedSourceNow
        : '';

    if (configured !== null) {
      lines.push(`- configured: ${configured.trim().length === 0 ? '(cleared)' : configured}`);
    }

    if (resolved) {
      const dir = resolvedDir || (resolved.includes('/') ? resolved.split('/').slice(0, -1).join('/') || '/' : '');
      lines.push(`- opencode: ${resolved}${dir ? ` (dir=${dir})` : ''}`);
    } else {
      lines.push('- opencode: (n/a)');
    }

    lines.push(`- source: ${source || '(n/a)'}`);
    if (detectedNow) {
      lines.push(`- detected-now: ${detectedNow}`);
      lines.push(`- detected-source: ${detectedSourceNow || '(n/a)'}`);
    }
    lines.push(`- shim: ${shim || '(n/a)'}`);
    lines.push(`- node: ${node || '(n/a)'}`);
    lines.push(`- bun: ${bun || '(n/a)'}`);
    if (!openAuroraOpencodeResolution && openAuroraOpencodeResolutionResult.error) {
      lines.push(`- resolution-endpoint: ${openAuroraOpencodeResolutionResult.error}`);
    }
  }

  lines.push('');
  if (probes.length) {
    lines.push('OpenCode API probes:');
    for (const probe of probes) {
      if (!probe.result) {
        lines.push(`- ${probe.label}: (no url)`);
        continue;
      }
      const { ok, status, elapsedMs, summary } = probe.result;
      const suffix = ok ? '' : ` url=${probe.url}`;
      lines.push(`- ${probe.label}: ${ok ? 'ok' : 'fail'} status=${status} time=${elapsedMs}ms ${summary}${suffix}`);
    }
  } else {
    lines.push('OpenCode API probes: (skipped)');
  }

  lines.push('');
  lines.push(`Generated: ${formatIso(Date.now())}`);
  return lines.join('\n');
};

export const showOpenCodeStatus = async (): Promise<void> => {
  const text = await buildOpenCodeStatusReport();
  const ui = useUIStore.getState();
  ui.setOpenCodeStatusText(text);
  ui.setOpenCodeStatusDialogOpen(true);
};
