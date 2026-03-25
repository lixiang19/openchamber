export interface PiToolExecutionViewState {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: 'running' | 'completed' | 'error';
  partialResult: unknown;
  result: unknown;
  isError: boolean;
}

export interface PiInteractiveRequestViewState {
  id: string;
  sessionId: string;
  method: 'input' | 'select' | 'confirm' | 'editor';
  title: string;
  message: string;
  placeholder: string;
  options: string[];
  prefill: string;
  createdAt: number;
}

export interface PiStatusEntry {
  key: string;
  text: string;
}

export interface PiWidgetEntry {
  key: string;
  content: string[];
  placement: string;
  bordered: boolean;
}

export interface PiModelSummary {
  provider: string;
  id: string;
  reasoning: boolean;
  name: string | null;
}

export type PiMessageRole = 'user' | 'assistant' | 'toolResult' | 'custom' | 'bashExecution';

export type PiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; redacted?: boolean }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };

export type PiMessageViewState =
  | {
      role: 'user';
      content: string | PiContentBlock[];
      timestamp: number;
    }
  | {
      role: 'assistant';
      content: PiContentBlock[];
      api?: string;
      provider?: string;
      model?: string;
      responseId?: string;
      stopReason?: string;
      errorMessage?: string;
      usage?: unknown;
      timestamp: number;
    }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: PiContentBlock[];
      details?: unknown;
      isError: boolean;
      timestamp: number;
    }
  | {
      role: 'custom';
      customType: string;
      content: PiContentBlock[] | string;
      display?: boolean;
      details?: unknown;
      timestamp: number;
    }
  | {
      role: 'bashExecution';
      command: string;
      output: string;
      exitCode?: number;
      cancelled?: boolean;
      truncated?: boolean;
      timestamp: number;
    };

export interface PiSessionViewState {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'error' | 'retrying' | 'compacting';
  lastError: string | null;
  model: PiModelSummary | null;
  thinkingLevel: string;
  isStreaming: boolean;
  messages: PiMessageViewState[];
  toolExecutions: PiToolExecutionViewState[];
  interactiveRequests: PiInteractiveRequestViewState[];
  statusEntries: PiStatusEntry[];
  widgets: PiWidgetEntry[];
  workingMessage: string | null;
}

export type PiServerEvent =
  | { type: 'session_snapshot'; session: PiSessionViewState }
  | { type: 'notification'; sessionId: string; level: string; message: string }
  | { type: 'heartbeat'; timestamp: number };
