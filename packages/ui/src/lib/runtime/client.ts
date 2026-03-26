import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { FilesAPI, RuntimeAPIs } from "../api/types";
import { getDesktopHomeDirectory } from "../desktop";
import type {
  Session,
  Message,
  Part,
  Provider,
  Config,
  Model,
  Agent,
  FilePartInput,
  Event,
} from "@opencode-ai/sdk/v2/client";
import type { PermissionRequest } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";
import type { PiAgentInfo, PiInteractiveRequestViewState, PiServerEvent, PiSessionViewState } from "@/lib/pi/types";
import {
  extractPiQuestionResponseValue,
  piSessionStatusToUiStatus,
  toUiMessageEntries,
  toUiQuestionRequest,
  toUiSession,
} from "@/lib/pi/ui-mappers";
export type RoutedOpencodeEvent = {
  directory: string;
  payload: Event;
};

// Use relative path by default (works with both dev and nginx proxy server)
// Can be overridden with VITE_OPENCODE_URL for absolute URLs in special deployments
const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || "/api";
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

const ensureAbsoluteBaseUrl = (candidate: string): string => {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : "/api";

  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized;
  }

  if (typeof window === "undefined") {
    return normalized;
  }

  const baseReference = window.location?.href || window.location?.origin;
  if (!baseReference) {
    return normalized;
  }

  try {
    return new URL(normalized, baseReference).toString();
  } catch (error) {
    console.warn("Failed to normalize OpenCode base URL:", error);
    return normalized;
  }
};

const resolveDesktopBaseUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const desktopServer = (window as typeof window & {
    __OPENCHAMBER_DESKTOP_SERVER__?: { origin: string; apiPrefix?: string };
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }).__OPENCHAMBER_DESKTOP_SERVER__;

  const isDesktop = Boolean(
    (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__?.runtime?.isDesktop
  );

  if (!desktopServer || !isDesktop) {
    return null;
  }

  const origin = typeof desktopServer.origin === "string" && desktopServer.origin.length > 0 ? desktopServer.origin : null;
  if (!origin) {
    return null;
  }

  return `${origin}/api`;
};

interface App {
  version?: string;
  [key: string]: unknown;
}

export type FilesystemEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink?: boolean;
};

export type ProjectFileSearchHit = {
  name: string;
  path: string;
  relativePath: string;
  extension?: string;
};

type FileInputLite = {
  id?: string;
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
};

export type DirectorySwitchResult = {
  success: boolean;
  restarted: boolean;
  path: string;
  agents?: Agent[];
  providers?: Provider[];
  models?: unknown[];
};

const normalizeFsPath = (path: string): string => path.replace(/\\/g, "/");
const FS_LIST_CACHE_TTL_MS = 400;

const getDesktopFilesApi = (): FilesAPI | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis && apis.runtime?.isDesktop && apis.files) {
    return apis.files;
  }
  return null;
};

class RuntimeService {
  private client: OpencodeClient;
  private baseUrl: string;
  private scopedClients: Map<string, OpencodeClient> = new Map();
  private sseAbortControllers: Map<string, AbortController> = new Map();
  private currentDirectory: string | undefined = undefined;
  private directoryContextQueue: Promise<void> = Promise.resolve();

  private globalSseAbortController: AbortController | null = null;
  private globalSseTask: Promise<void> | null = null;
  private globalSseIsConnected = false;
  private globalSseListeners: Set<(event: RoutedOpencodeEvent) => void> = new Set();
  private globalSseOpenListeners: Set<() => void> = new Set();
  private globalSseErrorListeners: Set<(error: unknown) => void> = new Set();
  private globalSseQueue: Array<RoutedOpencodeEvent | undefined> = [];
  private globalSseBuffer: Array<RoutedOpencodeEvent | undefined> = [];
  private globalSseCoalesced: Map<string, number> = new Map();
  private globalSseStaleDeltas: Set<string> = new Set();
  private globalSseFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private globalSseLastFlushAt = 0;
  private globalPiSource: EventSource | null = null;
  private listDirectoryCache = new Map<string, { entries: FilesystemEntry[]; expiresAt: number }>();
  private listDirectoryInFlight = new Map<string, Promise<FilesystemEntry[]>>();

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    const desktopBase = resolveDesktopBaseUrl();
    const requestedBaseUrl = desktopBase || baseUrl;
    this.baseUrl = ensureAbsoluteBaseUrl(requestedBaseUrl);
    this.client = createOpencodeClient({ baseUrl: this.baseUrl });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Returns a client-like object scoped to a project directory.
   * This keeps the rest of the UI talking to one runtime service while Pi owns the data model.
   */
  getScopedApiClient(directory: string): OpencodeClient {
    const normalized = this.normalizeCandidatePath(directory) ?? directory;
    const key = `runtime:${normalized || ''}`;
    const existing = this.scopedClients.get(key);
    if (existing) {
      return existing;
    }
    const scoped = this.createRuntimeApiClient(normalized);
    this.scopedClients.set(key, scoped);
    return scoped;
  }

  private normalizeCandidatePath(path?: string | null): string | null {
    if (typeof path !== 'string') {
      return null;
    }

    const trimmed = path.trim();
    if (!trimmed) {
      return null;
    }

    // Normalize backslashes and uppercase the Windows drive letter so that
    // d:\MyProject and D:\MyProject resolve to the same canonical form.
    const normalized = trimmed
      .replace(/\\/g, '/')
      .replace(/^([a-z]):/, (_, letter: string) => letter.toUpperCase() + ':');
    const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;

    return withoutTrailingSlash || null;
  }

  private deriveHomeDirectory(path: string): { homeDirectory: string; username?: string } {
    const windowsMatch = path.match(/^([A-Za-z]:)(?:\/|$)/);
    if (windowsMatch) {
      const drive = windowsMatch[1];
      const remainder = path.slice(drive.length + (path.charAt(drive.length) === '/' ? 1 : 0));
      const segments = remainder.split('/').filter(Boolean);

      if (segments.length >= 2) {
        const homeDirectory = `${drive}/${segments[0]}/${segments[1]}`;
        return { homeDirectory, username: segments[1] };
      }

      if (segments.length === 1) {
        const homeDirectory = `${drive}/${segments[0]}`;
        return { homeDirectory, username: segments[0] };
      }

      return { homeDirectory: drive, username: undefined };
    }

    const absolute = path.startsWith('/');
    const segments = path.split('/').filter(Boolean);

    if (segments.length >= 2 && (segments[0] === 'Users' || segments[0] === 'home')) {
      const homeDirectory = `${absolute ? '/' : ''}${segments[0]}/${segments[1]}`;
      return { homeDirectory, username: segments[1] };
    }

    if (absolute) {
      if (segments.length === 0) {
        return { homeDirectory: '/', username: undefined };
      }
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    if (segments.length > 0) {
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    return { homeDirectory: '/', username: undefined };
  }

  // Set the current working directory for all API calls
  setDirectory(directory: string | undefined) {
    this.currentDirectory = directory;
  }

  getDirectory(): string | undefined {
    return this.currentDirectory;
  }

  async withDirectory<T>(directory: string | undefined | null, fn: () => Promise<T>): Promise<T> {
    const runWithContext = async (): Promise<T> => {
      if (directory === undefined || directory === null) {
        return fn();
      }

      const previousDirectory = this.currentDirectory;
      this.currentDirectory = directory;
      try {
        return await fn();
      } finally {
        this.currentDirectory = previousDirectory;
      }
    };

    const queuedRun = this.directoryContextQueue.then(runWithContext, runWithContext);
    this.directoryContextQueue = queuedRun.then(
      () => undefined,
      () => undefined,
    );

    return queuedRun;
  }

  private getPiApiBase(): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/pi`;
  }

  private async fetchPi<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.getPiApiBase()}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      ...init,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Pi request failed (${response.status})`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private toPiAgentModel(agent: PiAgentInfo): Agent['model'] | undefined {
    const candidate = typeof agent.model === 'string' ? agent.model.trim() : '';
    if (!candidate || !candidate.includes('/')) {
      return undefined;
    }

    const [providerID, modelID, ...rest] = candidate.split('/');
    if (!providerID || !modelID || rest.length > 0) {
      return undefined;
    }

    return { providerID, modelID } as Agent['model'];
  }

  private toPiUiAgent(agent: PiAgentInfo): Agent {
    const mapped = {
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      permission: Object.entries(agent.permission || {}).map(([permission, action]) => ({ permission, pattern: '*', action })),
      ...(agent.scope ? { scope: agent.scope } : {}),
      ...(agent.source ? { source: agent.source } : {}),
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.thinking ? { thinking: agent.thinking } : {}),
      ...(typeof agent.steps === 'number' ? { steps: agent.steps } : {}),
      ...(agent.enabled === false ? { enabled: false } : {}),
    } as Agent & {
      scope?: PiAgentInfo['scope'];
      source?: string;
      displayName?: string;
      thinking?: string;
      steps?: number;
      enabled?: boolean;
    };

    const model = this.toPiAgentModel(agent);
    if (model) {
      mapped.model = model;
    }

    return mapped;
  }

  private async listPiSessions(): Promise<PiSessionViewState[]> {
    return this.fetchPi<PiSessionViewState[]>('/sessions');
  }

  private async getPiSession(sessionId: string): Promise<PiSessionViewState> {
    return this.fetchPi<PiSessionViewState>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  private async findPiInteractiveRequest(requestId: string): Promise<PiInteractiveRequestViewState | null> {
    const sessions = await this.listPiSessions().catch(() => []);
    for (const session of sessions) {
      const request = session.interactiveRequests.find((entry) => entry.id === requestId);
      if (request) {
        return request;
      }
    }
    return null;
  }

  private buildPromptText(params: {
    text: string;
    prefaceText?: string;
    files?: Array<{ filename?: string; url: string }>;
    additionalParts?: Array<{ text: string; synthetic?: boolean; files?: Array<{ filename?: string; url: string }> }>;
    agentMentions?: Array<{ name: string }>;
  }): string {
    const sections: string[] = [];

    if (params.prefaceText && params.prefaceText.trim()) {
      sections.push(params.prefaceText.trim());
    }

    if (params.text && params.text.trim()) {
      sections.push(params.text.trim());
    }

    for (const part of params.additionalParts || []) {
      if (part.text && part.text.trim()) {
        sections.push(part.text.trim());
      }
      const fileLabels = (part.files || []).map((file) => file.filename || file.url).filter(Boolean);
      if (fileLabels.length > 0) {
        sections.push(`Attachments: ${fileLabels.join(', ')}`);
      }
    }

    const fileLabels = (params.files || []).map((file) => file.filename || file.url).filter(Boolean);
    if (fileLabels.length > 0) {
      sections.push(`Attachments: ${fileLabels.join(', ')}`);
    }

    const agentLabels = (params.agentMentions || []).map((entry) => entry.name).filter(Boolean);
    if (agentLabels.length > 0) {
      sections.push(`Mentions: ${agentLabels.map((name) => `@${name}`).join(' ')}`);
    }

    return sections.filter(Boolean).join('\n\n');
  }

  private createRuntimeApiClient(directory?: string | null): OpencodeClient {
    const scopeDirectory = this.normalizeCandidatePath(directory ?? null);
    const baseClient = scopeDirectory
      ? createOpencodeClient({ baseUrl: this.baseUrl, directory: scopeDirectory })
      : this.client;

    const withScope = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (!scopeDirectory) {
        return operation();
      }
      return this.withDirectory(scopeDirectory, operation);
    };

    const runtimeSession = {
      ...((baseClient as unknown as { session?: Record<string, unknown> }).session || {}),
      list: async () => ({ data: await withScope(() => this.listSessions()) }),
      update: async ({ sessionID, title }: { sessionID: string; title?: string }) => ({
        data: await withScope(() => this.updateSession(sessionID, title)),
      }),
      delete: async ({ sessionID }: { sessionID: string }) => ({
        data: await withScope(() => this.deleteSession(sessionID)),
      }),
      share: async () => ({ data: null }),
      unshare: async () => ({ data: null }),
      prompt: async ({ sessionID, parts }: { sessionID: string; parts?: Array<Record<string, unknown>> }) => {
        const text = Array.isArray(parts)
          ? parts.map((part) => {
              if (typeof part?.text === 'string') return part.text;
              if (typeof part?.content === 'string') return part.content;
              return '';
            }).filter(Boolean).join('\n\n')
          : '';
        await withScope(() => this.sendMessage({
          id: sessionID,
          providerID: 'opencode',
          modelID: 'big-pickle',
          text,
        }));
        return { data: true };
      },
      shell: async ({ sessionID, command }: { sessionID: string; command: string }) => {
        await withScope(() => this.sendMessage({
          id: sessionID,
          providerID: 'opencode',
          modelID: 'big-pickle',
          text: command,
        }));
        return { data: true };
      },
      summarize: async ({ sessionID }: { sessionID: string }) => {
        await withScope(() => this.sendMessage({
          id: sessionID,
          providerID: 'opencode',
          modelID: 'big-pickle',
          text: '/compact',
        }));
        return { data: true };
      },
    };

    const runtimeExperimental = {
      ...((baseClient as unknown as { experimental?: Record<string, unknown> }).experimental || {}),
      session: {
        ...(((baseClient as unknown as { experimental?: { session?: Record<string, unknown> } }).experimental?.session) || {}),
        list: async ({ archived }: { archived?: boolean } = {}) => ({
          data: archived ? [] : await withScope(() => this.listSessions()),
          nextCursor: null,
        }),
      },
    };

    return new Proxy(baseClient as unknown as object, {
      get(target, prop, receiver) {
        if (prop === 'session') {
          return runtimeSession;
        }
        if (prop === 'experimental') {
          return runtimeExperimental;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as OpencodeClient;
  }

  // Get the raw API client for direct access.
  // Keep this unscoped so global session loaders can still see every Pi session.
  getApiClient(): OpencodeClient {
    return this.createRuntimeApiClient(null);
  }

  // Get system information including home directory
  async getSystemInfo(): Promise<{ homeDirectory: string; username?: string }> {
    const candidates = new Set<string>();
    const addCandidate = (value?: string | null) => {
      const normalized = this.normalizeCandidatePath(value);
      if (normalized) {
        candidates.add(normalized);
      }
    };

    try {
      const response = await this.client.path.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      const info = response.data;
      if (info) {
        addCandidate(info.directory);
        addCandidate(info.worktree);
        addCandidate(info.state);
      }
    } catch (error) {
      console.debug('Failed to load path info:', error);
    }

    if (!candidates.size) {
      try {
        const project = await this.client.project.current(
          this.currentDirectory ? { directory: this.currentDirectory } : undefined
        );
        addCandidate(project.data?.worktree);
      } catch (error) {
        console.debug('Failed to load project info:', error);
      }
    }

    if (!candidates.size) {
      try {
        const sessions = await this.listSessions();
        sessions.forEach((session) => addCandidate(session.directory));
      } catch (error) {
        console.debug('Failed to inspect sessions for system info:', error);
      }
    }

    addCandidate(this.currentDirectory);

    if (typeof window !== 'undefined') {
      try {
        addCandidate(window.localStorage.getItem('lastDirectory'));
        addCandidate(window.localStorage.getItem('homeDirectory'));
      } catch {
        // Access to storage failed (e.g. privacy mode)
      }
    }

    if (!candidates.size && typeof process !== 'undefined' && typeof process.cwd === 'function') {
      addCandidate(process.cwd());
    }

    if (!candidates.size) {
      return { homeDirectory: '/', username: undefined };
    }

    const [primary] = Array.from(candidates);
    return this.deriveHomeDirectory(primary);
  }

  /**
   * Best-effort probe whether a directory is accessible to OpenCode.
   * This is intentionally NOT the same as local filesystem access in the UI runtime.
   */
  async probeDirectory(directory: string): Promise<boolean> {
    const normalized = this.normalizeCandidatePath(directory);
    if (!normalized) {
      return false;
    }
    try {
      const response = await this.client.path.get({ directory: normalized });
      const info = response.data as { directory?: unknown } | undefined;
      const returned = typeof info?.directory === 'string' ? info.directory : null;
      return Boolean(returned && returned.trim().length > 0);
    } catch {
      return false;
    }
  }

  // Session Management
  async listSessions(): Promise<Session[]> {
    const sessions = (await this.listPiSessions()).map((session) => toUiSession(session));

    if (!this.currentDirectory) {
      return sessions;
    }

    const normalizedCurrent = this.normalizeCandidatePath(this.currentDirectory);
    if (!normalizedCurrent) {
      return sessions;
    }

    return sessions.filter((session) => {
      const directory = this.normalizeCandidatePath((session as { directory?: string | null }).directory ?? null);
      return !directory || directory === normalizedCurrent || directory.startsWith(`${normalizedCurrent}/`);
    });
  }

  async createSession(params?: { parentID?: string; title?: string }): Promise<Session> {
    const snapshot = await this.fetchPi<PiSessionViewState>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        cwd: this.currentDirectory,
        title: params?.title,
      }),
    });
    return toUiSession(snapshot);
  }

  async getSession(id: string): Promise<Session> {
    return toUiSession(await this.getPiSession(id));
  }

  async deleteSession(_id: string): Promise<boolean> {
    void _id;
    throw new Error('Pi session deletion is not supported yet.');
  }

  async updateSession(id: string, title?: string): Promise<Session> {
    const snapshot = await this.fetchPi<PiSessionViewState>(`/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    });
    return toUiSession(snapshot);
  }

  async getSessionMessages(id: string, limit?: number): Promise<{ info: Message; parts: Part[] }[]> {
    const snapshot = await this.getPiSession(id);
    const entries = toUiMessageEntries(snapshot);
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async getSessionTodos(sessionId: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    try {
      const base = this.baseUrl.replace(/\/$/, "");
      const url = new URL(`${base}/session/${encodeURIComponent(sessionId)}/todo`);

      if (this.currentDirectory && this.currentDirectory.length > 0) {
        url.searchParams.set("directory", this.currentDirectory);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json().catch(() => null);
      if (!data || !Array.isArray(data)) {
        return [];
      }

      return data as Array<{ id: string; content: string; status: string; priority: string }>;
    } catch {
      return [];
    }
  }

  /**
   * Check if MIME type needs normalization to text/plain.
   * Some text MIME types (like text/markdown) aren't supported by AI providers.
   */
  private shouldNormalizeToTextPlain(mime: string): boolean {
    if (!mime) return false;
    
    const lowerMime = mime.toLowerCase();
    
    // All text/* types except text/plain need normalization
    if (lowerMime.startsWith('text/') && lowerMime !== 'text/plain') {
      return true;
    }
    
    // Common application types that are actually text
    const textBasedTypes = [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      'application/x-yaml',
      'application/yaml',
      'application/toml',
      'application/x-sh',
      'application/x-shellscript',
      'application/octet-stream',
      'image/svg+xml',
    ];
    
    return textBasedTypes.includes(lowerMime);
  }

  /**
   * Check if MIME type is HEIC/HEIF (iPhone photo format).
   */
  private isHeicMime(mime: string): boolean {
    if (!mime) return false;
    const lowerMime = mime.toLowerCase();
    return lowerMime === 'image/heic' || lowerMime === 'image/heif';
  }

  /**
   * Convert HEIC image to JPEG.
   * Returns the original file if conversion fails.
   */
  private async convertHeicToJpeg(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    try {
      // Dynamic import to avoid loading heic2any unless needed
      const heic2any = (await import('heic2any')).default;
      
      // Extract base64 data from data URL
      const commaIndex = file.url.indexOf(',');
      if (commaIndex === -1) return file;
      
      const base64Data = file.url.substring(commaIndex + 1);
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const heicBlob = new Blob([bytes], { type: file.mime });
      
      // Convert to JPEG
      const jpegBlob = await heic2any({
        blob: heicBlob,
        toType: 'image/jpeg',
        quality: 0.9,
      }) as Blob;
      
      // Convert back to data URL
      const jpegDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(jpegBlob);
      });
      
      // Update filename extension
      let newFilename = file.filename;
      if (newFilename) {
        newFilename = newFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
      }
      
      return {
        mime: 'image/jpeg',
        filename: newFilename,
        url: jpegDataUrl
      };
    } catch (error) {
      console.warn('Failed to convert HEIC to JPEG:', error);
      return file;
    }
  }

  /**
   * Normalize file part for sending to AI providers.
   * - Converts unsupported text MIME types to text/plain
   * - Converts HEIC/HEIF images to JPEG
   */
  private async normalizeFilePart(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    // Handle HEIC conversion
    if (this.isHeicMime(file.mime)) {
      return this.convertHeicToJpeg(file);
    }

    // Handle text MIME normalization
    if (!this.shouldNormalizeToTextPlain(file.mime)) {
      return file;
    }

    let normalizedUrl = file.url;
    
    // Update MIME type in data URL if present
    // Format: data:<mime>;base64,<content> or data:<mime>,<content>
    if (file.url.startsWith('data:')) {
      const commaIndex = file.url.indexOf(',');
      if (commaIndex !== -1) {
        const meta = file.url.substring(5, commaIndex); // after "data:"
        const content = file.url.substring(commaIndex); // includes comma
        
        // Replace the MIME type in meta, preserving ;base64 if present
        const newMeta = meta.replace(/^[^;,]+/, 'text/plain');
        normalizedUrl = `data:${newMeta}${content}`;
      }
    }

    return {
      mime: 'text/plain',
      filename: file.filename,
      url: normalizedUrl
    };
  }

  private async toNormalizedFilePartInput(file: FileInputLite): Promise<FilePartInput> {
    const normalized = await this.normalizeFilePart(file);
    return {
      ...(file.id ? { id: file.id } : {}),
      type: 'file',
      mime: normalized.mime,
      filename: normalized.filename,
      url: normalized.url,
    };
  }

  async sendMessage(params: {
    id: string;
    providerID: string;
    modelID: string;
    text: string;
    prefaceText?: string;
    prefaceTextSynthetic?: boolean;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    /** Additional text/file parts to include (for batch sending queued messages) */
    additionalParts?: Array<{
      text: string;
      synthetic?: boolean;
      files?: Array<FileInputLite>;
    }>;
    messageId?: string;
    agentMentions?: Array<{ name: string; source?: { value: string; start: number; end: number } }>;
    format?: {
      type: 'json_schema';
      schema: Record<string, unknown>;
      retryCount?: number;
    };
  }): Promise<string> {
    const baseTimestamp = Date.now();
    const tempMessageId = params.messageId ?? `temp_${baseTimestamp}_${Math.random().toString(36).substring(2, 9)}`;

    const promptText = this.buildPromptText({
      text: params.text,
      prefaceText: params.prefaceText,
      files: params.files,
      additionalParts: params.additionalParts,
      agentMentions: params.agentMentions,
    });

    if (!promptText.trim()) {
      throw new Error('Message must have at least one part (text or file)');
    }

    await this.fetchPi<void>(`/sessions/${encodeURIComponent(params.id)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        text: promptText,
        model: {
          providerID: params.providerID,
          modelID: params.modelID,
        },
        agent: params.agent,
      }),
    });

    return tempMessageId;
  }

  async sendCommand(params: {
    id: string;
    providerID: string;
    modelID: string;
    command: string;
    arguments?: string;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    messageId?: string;
  }): Promise<string> {
    const commandText = [`/${params.command}`, params.arguments || ''].filter(Boolean).join(' ').trim();
    return this.sendMessage({
      id: params.id,
      providerID: params.providerID,
      modelID: params.modelID,
      text: commandText,
      agent: params.agent,
      variant: params.variant,
      files: params.files,
      messageId: params.messageId,
    });
  }

  async abortSession(id: string): Promise<boolean> {
    await this.fetchPi<void>(`/sessions/${encodeURIComponent(id)}/abort`, {
      method: 'POST',
    });
    return true;
  }

  async revertSession(_sessionId: string, _messageId: string, _partId?: string): Promise<Session> {
    void _sessionId;
    void _messageId;
    void _partId;
    throw new Error('Pi runtime does not support revert yet.');
  }

  async unrevertSession(_sessionId: string): Promise<Session> {
    void _sessionId;
    throw new Error('Pi runtime does not support redo yet.');
  }

  async forkSession(_sessionId: string, _messageId?: string): Promise<Session> {
    void _sessionId;
    void _messageId;
    throw new Error('Pi runtime does not support forking sessions yet.');
  }

  async getSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return this.getSessionStatusForDirectory(this.currentDirectory ?? null);
  }

  async getSessionStatusForDirectory(
    directory: string | null | undefined
  ): Promise<Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>> {
    try {
      const normalizedDirectory = this.normalizeCandidatePath(directory ?? null);
      const sessions = await this.listPiSessions();
      const statusMap: Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }> = {};

      for (const session of sessions) {
        const sessionDirectory = this.normalizeCandidatePath(session.cwd);
        if (normalizedDirectory && sessionDirectory && sessionDirectory !== normalizedDirectory) {
          continue;
        }
        statusMap[session.id] = piSessionStatusToUiStatus(session.status);
      }

      return statusMap;
    } catch {
      return {};
    }
  }

  async getGlobalSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return this.getSessionStatusForDirectory(null);
  }

  /**
   * Get session activity from web server's in-memory tracking.
   * This is more reliable than getGlobalSessionStatus on visibility restore
   * because the web server tracks activity even when UI is not listening to SSE.
   */
  async getWebServerSessionActivity(): Promise<
    Record<string, { type: string }> | null
  > {
    try {
      const sessions = await this.listPiSessions();
      return sessions.reduce<Record<string, { type: string }>>((accumulator, session) => {
        accumulator[session.id] = { type: session.status === 'streaming' || session.status === 'compacting' ? 'busy' : session.status };
        return accumulator;
      }, {});
    } catch {
      return null;
    }
  }

  // Tools
  async listToolIds(options?: { directory?: string | null }): Promise<string[]> {
    try {
      const directory = typeof options?.directory === 'string'
        ? options.directory.trim()
        : (this.currentDirectory ? this.currentDirectory.trim() : '');

      const result = await this.client.tool.ids(directory ? { directory } : undefined);
      const tools = (result.data || []) as unknown as string[];
      return tools.filter((tool) => typeof tool === 'string' && tool !== 'invalid');
    } catch {
      return [];
    }
  }

  // Permissions
  async replyToPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    options?: { message?: string }
  ): Promise<boolean> {
    const result = await this.client.permission.reply({
      requestID: requestId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      reply,
      ...(options?.message ? { message: options.message } : {}),
    });
    return result.data || false;
  }

  async listPendingPermissions(options?: { directories?: Array<string | null | undefined> }): Promise<PermissionRequest[]> {
    const fetches: Array<Promise<PermissionRequest[]>> = [];

    const fetchForDirectory = async (directory?: string | null): Promise<PermissionRequest[]> => {
      try {
        const trimmed = typeof directory === 'string' ? directory.trim() : '';
        const result = await this.client.permission.list(trimmed ? { directory: trimmed } : undefined);
        return (result.data || []) as unknown as PermissionRequest[];
      } catch {
        return [];
      }
    };

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null));

    const uniqueDirectories = new Set<string>();
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null);
      if (normalized) {
        uniqueDirectories.add(normalized);
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory));
    }

    const results = await Promise.all(fetches);
    const merged: PermissionRequest[] = [];
    const seenIds = new Set<string>();

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
      }
    }

    return merged;
  }

  // Questions ("ask" tool)
  async replyToQuestion(requestId: string, answers: string[] | string[][]): Promise<boolean> {
    const request = await this.findPiInteractiveRequest(requestId);
    if (!request) {
      return false;
    }

    const responseValue = extractPiQuestionResponseValue(request, answers);
    await this.fetchPi<void>(`/requests/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ response: responseValue }),
    });
    return true;
  }

  async rejectQuestion(requestId: string): Promise<boolean> {
    await this.fetchPi<void>(`/requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
    });
    return true;
  }

  async listPendingQuestions(options?: { directories?: Array<string | null | undefined> }): Promise<QuestionRequest[]> {
    const normalizedDirectories = new Set(
      (options?.directories ?? [])
        .map((entry) => this.normalizeCandidatePath(entry ?? null))
        .filter((entry): entry is string => Boolean(entry))
    );

    const sessions = await this.listPiSessions().catch(() => []);
    const requests: QuestionRequest[] = [];

    for (const session of sessions) {
      const directory = this.normalizeCandidatePath(session.cwd);
      if (normalizedDirectories.size > 0 && directory && !normalizedDirectories.has(directory)) {
        continue;
      }

      for (const request of session.interactiveRequests) {
        requests.push(toUiQuestionRequest(request));
      }
    }

    return requests;
  }

  // Configuration
  async getConfig(): Promise<Config> {
    const response = await this.client.config.get();
    if (!response.data) throw new Error('Failed to get config');
    return response.data;
  }

  async updateConfig(config: Record<string, unknown>): Promise<Config> {
    // IMPORTANT: Do NOT pass directory parameter for config updates
    // The config should be global, not directory-specific
    const url = `${this.baseUrl}/config`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpencodeClient] Failed to update config:', response.status, errorText);
      throw new Error(`Failed to update config: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  /**
   * Update config with a partial modification function.
   * This handles the GET-modify-PATCH pattern required by the upstream API.
   *
   * NOTE: This method is deprecated for agent configuration.
   * Use backend endpoints at /api/config/agents/* instead, which write directly to files.
   *
   * @param modifier Function that receives current config and returns modified config
   * @returns Updated config from server
   */
  async updateConfigPartial(modifier: (config: Config) => Config): Promise<Config> {
    const currentConfig = await this.getConfig();
    const updatedConfig = modifier(currentConfig);
    const result = await this.updateConfig(updatedConfig);
    return result;
  }

  async getProviders(): Promise<{
    providers: Provider[];
    default: { [key: string]: string };
  }> {
    const directory = typeof this.currentDirectory === 'string' && this.currentDirectory.trim().length > 0
      ? this.currentDirectory.trim()
      : '';
    const query = directory ? `?cwd=${encodeURIComponent(directory)}` : '';
    return this.fetchPi<{ providers: Provider[]; default: { [key: string]: string } }>(`/providers${query}`);
  }

  // App Management - using config endpoint since /app doesn't exist in this version
  async getApp(): Promise<App> {
    // Return basic app info from config
    const config = await this.getConfig();
    return {
      version: "0.0.3", // from the OpenAPI spec
      config
    };
  }

  async initApp(): Promise<boolean> {
    return this.checkHealth();
  }

  // Agent Management
  async listAgents(): Promise<Agent[]> {
    const directory = typeof this.currentDirectory === 'string' && this.currentDirectory.trim().length > 0
      ? this.currentDirectory.trim()
      : '';
    const query = directory ? `?cwd=${encodeURIComponent(directory)}` : '';
    const agents = await this.fetchPi<PiAgentInfo[]>(`/agents${query}`);
    return agents.map((agent) => this.toPiUiAgent(agent));
  }

  private mapPiEventToRoutedEvent(raw: PiServerEvent): RoutedOpencodeEvent | null {
    if (raw.type === 'heartbeat') {
      return null;
    }

    if (raw.type === 'notification') {
      return {
        directory: 'global',
        payload: {
          type: 'openaurora:notification',
          properties: {
            title: raw.level === 'error' ? 'Pi error' : 'Pi notification',
            body: raw.message,
            tag: `pi:${raw.sessionId}:${raw.level}`,
          },
        } as unknown as Event,
      };
    }

    if (raw.type === 'pi_system' && raw.payload.kind === 'status') {
      return {
        directory: 'global',
        payload: {
          type: 'session.status',
          properties: {
            sessionID: raw.sessionId,
            status: piSessionStatusToUiStatus(raw.payload.status),
          },
        } as unknown as Event,
      };
    }

    return null;
  }

  subscribeToGlobalEvents(
    onEvent: (event: RoutedOpencodeEvent) => void,
    onError?: (error: unknown) => void,
    onOpen?: () => void,
    _options?: { directory?: string | null }
  ): () => void {
    void _options;
    const source = new EventSource(`${this.getPiApiBase()}/events`);

    source.onopen = () => {
      try {
        onOpen?.();
      } catch (error) {
        console.warn('[OpencodeClient] Global SSE open handler error:', error);
      }
    };

    source.onmessage = (message) => {
      if (!message.data) {
        return;
      }
      try {
        const parsed = JSON.parse(message.data) as PiServerEvent;
        const routed = this.mapPiEventToRoutedEvent(parsed);
        if (routed) {
          onEvent(routed);
        }
      } catch (error) {
        onError?.(error);
      }
    };

    source.onerror = (error) => {
      onError?.(error);
    };

    return () => {
      source.close();
    };
  }

  subscribeToEvents(
    onMessage: (event: { type: string; properties?: Record<string, unknown> }) => void,
    onError?: (error: unknown) => void,
    onOpen?: () => void,
    _directoryOverride?: string | null,
    _options?: { scope?: 'global' | 'directory'; key?: string }
  ): () => void {
    void _directoryOverride;
    void _options;
    return this.subscribeToGlobalEvents(
      (event) => {
        const payload = event.payload as unknown as Record<string, unknown>;
        onMessage(payload as { type: string; properties?: Record<string, unknown> });
      },
      onError,
      onOpen,
    );
  }

  // File Operations
  async readFile(path: string): Promise<string> {
    try {
      // For now, we'll use a placeholder implementation
      // In a real implementation, this would call an API endpoint to read the file
      const response = await fetch(`${this.baseUrl}/files/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          directory: this.currentDirectory
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }

      const data = await response.text();
      return data;
    } catch {
      // Return placeholder for development
      return `// Content of ${path}\n// This would be loaded from the server`;
    }
  }

  async listFiles(directory?: string): Promise<Record<string, unknown>[]> {
    try {
      const targetDir = directory || this.currentDirectory || '/';
      const response = await fetch(`${this.baseUrl}/files/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ directory: targetDir })
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch {
      // Return mock data for development
      return [];
    }
  }

  // Command Management
  async listCommands(): Promise<Array<{ name: string; description?: string; agent?: string; model?: string }>> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      // Return only lightweight info for autocomplete
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined
        // Intentionally excluding template to keep memory usage low
      }));
    } catch {
      return [];
    }
  }

  async listCommandsWithDetails(): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; template?: string }>> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      // Return full command details including template
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined,
        template: cmd.template as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  async getCommandDetails(name: string): Promise<{ name: string; template: string; description?: string; agent?: string; model?: string } | null> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );

      if (response.data) {
        const command = response.data.find((cmd: Record<string, unknown>) => cmd.name === name);
        if (command) {
          return {
            name: command.name as string,
            template: command.template as string,
            description: command.description as string | undefined,
            agent: command.agent as string | undefined,
            model: command.model as string | undefined
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Health Check - Pi runtime is exposed through the system info endpoint.
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/system/info`, {
        headers: { Accept: 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // File System Operations
  async createDirectory(
    dirPath: string,
    options?: { allowOutsideWorkspace?: boolean }
  ): Promise<{ success: boolean; path: string }> {
    const desktopFiles = getDesktopFilesApi();
    if (desktopFiles?.createDirectory) {
      try {
        return await desktopFiles.createDirectory(dirPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message || 'Failed to create directory');
      }
    }

    const payload = {
      path: dirPath,
      ...(options?.allowOutsideWorkspace ? { allowOutsideWorkspace: true } : {}),
    };

    const response = await fetch(`${this.baseUrl}/fs/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create directory' }));
      throw new Error(error.error || 'Failed to create directory');
    }

    const result = await response.json();
    return result;
  }

  async listLocalDirectory(directoryPath: string | null | undefined, options?: { respectGitignore?: boolean }): Promise<FilesystemEntry[]> {
    const normalizedDirectoryPath = typeof directoryPath === 'string' ? normalizeFsPath(directoryPath.trim()) : '';
    const cacheKey = `${normalizedDirectoryPath}|${options?.respectGitignore ? '1' : '0'}`;
    const now = Date.now();
    const cached = this.listDirectoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.entries;
    }

    const inFlight = this.listDirectoryInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const desktopFiles = getDesktopFilesApi();
      if (desktopFiles) {
        try {
          const result = await desktopFiles.listDirectory(directoryPath || '', options);
          if (!result || !Array.isArray(result.entries)) {
            return [];
          }
          const entries = result.entries.map<FilesystemEntry>((entry) => ({
            name: entry.name,
            path: normalizeFsPath(entry.path),
            isDirectory: !!entry.isDirectory,
            isFile: !entry.isDirectory,
            isSymbolicLink: false,
          }));
          this.listDirectoryCache.set(cacheKey, {
            entries,
            expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
          });
          return entries;
        } catch (error) {
          console.error('Failed to list directory contents:', error);
          throw error;
        }
      }

      try {
        const params = new URLSearchParams();
        if (directoryPath && directoryPath.trim().length > 0) {
          params.set('path', directoryPath);
        }
        if (options?.respectGitignore) {
          params.set('respectGitignore', 'true');
        }
        const query = params.toString();
        const response = await fetch(`${this.baseUrl}/fs/list${query ? `?${query}` : ''}`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message = typeof error.error === 'string' ? error.error : 'Failed to list directory';
          throw new Error(message);
        }

        const result = await response.json();
        if (!result || !Array.isArray(result.entries)) {
          return [];
        }

        const entries = result.entries as FilesystemEntry[];
        this.listDirectoryCache.set(cacheKey, {
          entries,
          expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
        });
        return entries;
      } catch (error) {
        console.error('Failed to list directory contents:', error);
        throw error;
      }
    })();

    const trackedTask = task.finally(() => {
      if (this.listDirectoryInFlight.get(cacheKey) === trackedTask) {
        this.listDirectoryInFlight.delete(cacheKey);
      }
    });
    this.listDirectoryInFlight.set(cacheKey, trackedTask);
    return trackedTask;
  }

  async searchFiles(
    query: string,
    options?: {
      directory?: string | null;
      limit?: number;
      includeHidden?: boolean;
      respectGitignore?: boolean;
      dirs?: boolean;
      type?: 'file' | 'directory';
    }
  ): Promise<ProjectFileSearchHit[]> {
    const directory = typeof options?.directory === 'string' && options.directory.trim().length > 0
      ? options.directory.trim()
      : this.currentDirectory;
    const normalizedDirectory = directory ? normalizeFsPath(directory) : null;
    const scopedClient = directory ? this.getScopedApiClient(directory) : this.client;

    try {
      const response = await scopedClient.find.files({
        query,
        limit: typeof options?.limit === 'number' && Number.isFinite(options.limit) ? options.limit : undefined,
        dirs: options?.dirs === false || options?.type === 'file' ? 'false' : 'true',
        type: options?.type,
      });

      const items = Array.isArray(response?.data) ? response.data : [];
      return items.map<ProjectFileSearchHit>((item) => {
        const normalizedRelativePath = normalizeFsPath(item);
        const name = normalizedRelativePath.split('/').filter(Boolean).pop() || normalizedRelativePath;
        const normalizedPath = normalizedDirectory
          ? normalizeFsPath(`${normalizedDirectory}/${normalizedRelativePath}`)
          : normalizeFsPath(normalizedRelativePath);

        return {
          name,
          path: normalizedPath,
          relativePath: normalizedRelativePath,
          extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
        };
      });
    } catch (error) {
      console.error('Failed to search files:', error);
      throw error;
    }
  }

  async getFilesystemHome(): Promise<string | null> {
    // Optimization: Check for desktop runtime first to avoid unnecessary network calls
    // and fix the "SyntaxError" warning when the endpoint is missing
    const desktopHome = await getDesktopHomeDirectory();
    if (desktopHome) {
      return desktopHome;
    }

    try {
      const response = await fetch(`${this.baseUrl}/fs/home`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to resolve home directory';
        throw new Error(message);
      }

      const payload = await response.json();
      if (payload && typeof payload.home === 'string' && payload.home.length > 0) {
        return payload.home;
      }
      return null;
    } catch (error) {
      console.warn('Failed to resolve filesystem home directory:', error);
      return null;
    }
  }

  async setOpenCodeWorkingDirectory(directoryPath: string | null | undefined): Promise<DirectorySwitchResult | null> {
    if (!directoryPath || typeof directoryPath !== 'string' || !directoryPath.trim()) {
      console.warn('[OpencodeClient] setOpenCodeWorkingDirectory: invalid path', directoryPath);
      return null;
    }

    const url = `${this.baseUrl}/opencode/directory`;
    console.log('[OpencodeClient] POST', url, 'with path:', directoryPath);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: directoryPath })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = payload ?? {};
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to update OpenCode working directory';
        throw new Error(message);
      }

      if (payload && typeof payload === 'object') {
        return payload as DirectorySwitchResult;
      }

      return {
        success: true,
        restarted: false,
        path: directoryPath
      };
    } catch (error) {
      console.warn('Failed to update OpenCode working directory:', error);
      throw error;
    }
  }
}

// Exported singleton instance
export const runtimeClient = new RuntimeService();

// Exported types
export type { Session, Message, Part, Provider, Config, Model };
export type { App };
