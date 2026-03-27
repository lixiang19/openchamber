export type PermissionAction = 'allow' | 'deny';
export type PermissionRuleValue = PermissionAction | Record<string, PermissionAction>;
export type PermissionConfig = Record<string, PermissionRuleValue>;

export type Model = any;
export type Provider = any;
export type Agent = Record<string, any> & { name: string };
export type Session = Record<string, any> & { id: string; time: Record<string, any> };
export type Message = Record<string, any> & { id: string; role: string; time: Record<string, any> };
export type BasePart = any;
export type TextPart = any;
export type ReasoningPart = any;
export type FilePart = any;
export type ToolState = any;
export type ToolStateUnion = any;
export type ToolPart = any;
export type Part = any;
export type AssistantMessage = Message & { role: 'assistant' };
export type McpStatus = Record<string, any> & { status: 'connected' | 'failed' | 'needs_auth' | 'needs_client_registration' | string };
export type Config = Record<string, any>;

export interface FilePartInput {
  id?: string;
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
}

export type RuntimeEvent = Record<string, any> & {
  type: string;
  properties?: Record<string, unknown>;
};

export type Event = RuntimeEvent;

export interface RuntimeApiResponse<T> {
  data?: T;
  nextCursor?: number | null;
  headers?: Headers | Record<string, string>;
  [key: string]: unknown;
}

export interface RuntimeSessionApi {
  list: (payload?: Record<string, any>) => Promise<RuntimeApiResponse<Session[]>>;
  update: (payload: Record<string, any>) => Promise<RuntimeApiResponse<Session>>;
  delete: (payload: Record<string, any>) => Promise<RuntimeApiResponse<boolean>>;
  share: (...args: unknown[]) => Promise<RuntimeApiResponse<null>>;
  unshare: (...args: unknown[]) => Promise<RuntimeApiResponse<null>>;
  prompt: (payload: Record<string, any>) => Promise<RuntimeApiResponse<any>>;
  shell: (payload: Record<string, any>) => Promise<RuntimeApiResponse<boolean>>;
  summarize: (payload: Record<string, any>) => Promise<RuntimeApiResponse<boolean>>;
}

export interface RuntimeExperimentalApi {
  session: {
    list: (payload?: Record<string, any>) => Promise<RuntimeApiResponse<Session[]>>;
  };
}

export interface RuntimeMcpApi {
  status: () => Promise<RuntimeApiResponse<Record<string, McpStatus>>>;
  connect: (payload: Record<string, any>, options?: { throwOnError?: boolean }) => Promise<RuntimeApiResponse<boolean>>;
  disconnect: (payload: Record<string, any>, options?: { throwOnError?: boolean }) => Promise<RuntimeApiResponse<boolean>>;
}

export interface RuntimePathApi {
  get: (params?: Record<string, any>) => Promise<RuntimeApiResponse<Record<string, any>>>;
}

export interface RuntimeFileApi {
  list: (payload: Record<string, any>) => Promise<RuntimeApiResponse<any[]>>;
}

export interface RuntimeFindApi {
  files: (payload: Record<string, any>) => Promise<RuntimeApiResponse<string[]>>;
}

export interface RuntimeApiClient {
  session: RuntimeSessionApi;
  experimental: RuntimeExperimentalApi;
  mcp: RuntimeMcpApi;
  path: RuntimePathApi;
  file: RuntimeFileApi;
  find: RuntimeFindApi;
}

export type OpencodeClient = RuntimeApiClient;
