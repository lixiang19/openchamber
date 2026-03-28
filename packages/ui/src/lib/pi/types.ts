export interface PiToolExecutionViewState {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: 'running' | 'completed' | 'error';
  partialResult: unknown;
  result: unknown;
  isError: boolean;
}

export interface PiAgentInfo {
  name: string;
  mode: 'primary' | 'task' | 'all';
  description: string;
  source: string;
  scope?: 'user' | 'project';
  displayName?: string;
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  steps?: number;
  enabled?: boolean;
  permission?: Record<string, 'allow' | 'deny' | Record<string, 'allow' | 'deny'>>;
}

export type PiSlashCommandSource = 'extension' | 'prompt' | 'skill';

export interface PiSlashCommandInfo {
  name: string;
  description?: string;
  source: PiSlashCommandSource;
  sourceInfo?: unknown;
}

export interface PiInteractiveRequestViewState {
  id: string;
  sessionId: string;
  method: 'question';
  title: string;
  message: string;
  questions?: Array<{
    header?: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiple?: boolean;
    allowCustom?: boolean;
  }>;
  bridgeKind?: string;
  webSupport?: string;
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
  | { type: 'text'; text: string; textSignature?: string | null }
  | { type: 'thinking'; thinking: string; redacted?: boolean; thinkingSignature?: string | null }
  | { type: 'image'; data: string; mimeType: string | null }
  | { type: 'toolCall'; id: string | null; name: string | null; arguments: Record<string, unknown> | null; thoughtSignature?: string | null }
  | { type: string; raw?: Record<string, unknown> };

export type PiMessageViewState =
  | {
      id?: string;
      role: 'user';
      content: string | PiContentBlock[];
      timestamp: number;
    }
  | {
      id?: string;
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
      id?: string;
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: PiContentBlock[];
      details?: unknown;
      isError: boolean;
      timestamp: number;
    }
  | {
      id?: string;
      role: 'custom';
      customType: string;
      content: PiContentBlock[] | string;
      display?: boolean;
      details?: unknown;
      timestamp: number;
    }
  | {
      id?: string;
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
  parentID?: string | null;
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
  sequence?: number;
}

export type PiNormalizedMessage =
  | {
      role: 'user';
      messageKind: 'user-message';
      timestamp: number | null;
      content: PiContentBlock[];
    }
  | {
      role: 'assistant';
      messageKind: 'assistant-message';
      timestamp: number | null;
      content: PiContentBlock[];
      api: string | null;
      provider: string | null;
      model: string | null;
      responseId: string | null;
      stopReason: string | null;
      errorMessage: string | null;
      usage: unknown;
    }
  | {
      role: 'toolResult';
      messageKind: 'tool-result';
      timestamp: number | null;
      toolCallId: string | null;
      toolName: string | null;
      content: PiContentBlock[];
      details: unknown;
      isError: boolean;
    }
  | {
      role: 'custom';
      messageKind: 'custom-message';
      timestamp: number | null;
      customType: string | null;
      content: PiContentBlock[];
      display: boolean;
      details: unknown;
      payload: unknown;
    }
  | {
      role: 'bashExecution';
      messageKind: 'bash-execution';
      timestamp: number | null;
      command: string;
      output: string;
      exitCode: number | null;
      cancelled: boolean;
      truncated: boolean;
      fullOutputPath: string | null;
      excludeFromContext: boolean;
    }
  | {
      role: 'branchSummary';
      messageKind: 'branch-summary';
      timestamp: number | null;
      summary: string;
      fromId: string | null;
    }
  | {
      role: 'compactionSummary';
      messageKind: 'compaction-summary';
      timestamp: number | null;
      summary: string;
      tokensBefore: number | null;
    }
  | {
      role: string;
      messageKind: 'unknown-message';
      timestamp: number | null;
      raw: Record<string, unknown>;
    };

export interface PiAssistantStreamEvent {
  type: string;
  contentIndex: number | null;
  delta: string | null;
  content: string | null;
  reason: string | null;
  toolCall: PiContentBlock | null;
  partial: PiNormalizedMessage | null;
  message: PiNormalizedMessage | null;
  error: PiNormalizedMessage | null;
  raw?: Record<string, unknown>;
}

export type PiAgentEventPayload =
  | {
      source: 'pi';
      envelope: 'agent-event';
      eventType: 'message_start' | 'message_update' | 'message_end';
      channel: 'message';
      phase: 'start' | 'update' | 'end';
      message: PiNormalizedMessage | null;
      assistantStream: PiAssistantStreamEvent | null;
    }
  | {
      source: 'pi';
      envelope: 'agent-event';
      eventType: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end';
      channel: 'tool';
      phase: 'start' | 'update' | 'end';
      toolCallId: string | null;
      toolName: string | null;
      args: Record<string, unknown> | null;
      partialResult: { content: PiContentBlock[]; details: unknown } | null;
      result: { content: PiContentBlock[]; details: unknown } | null;
      isError: boolean | null;
    }
  | {
      source: 'pi';
      envelope: 'agent-event';
      eventType: 'turn_end';
      channel: 'turn';
      phase: 'end';
      message: PiNormalizedMessage | null;
      toolResults: PiNormalizedMessage[];
    }
  | {
      source: 'pi';
      envelope: 'agent-event';
      eventType: 'agent_end';
      channel: 'agent';
      phase: 'end';
      messages: PiNormalizedMessage[];
    }
  | {
      source: 'pi';
      envelope: 'agent-event';
      eventType: string;
      channel: string;
      phase: string;
      [key: string]: unknown;
    };

export type PiUiEventPayload =
  | { kind: 'interactive_request'; request: PiInteractiveRequestViewState }
  | { kind: 'interactive_request_resolved'; requestId: string }
  | { kind: 'status'; key: string; text: string | null }
  | { kind: 'working_message'; message: string | null }
  | { kind: 'widget'; key: string; content: string[] | null; placement: string | null; bordered: boolean }
  | { kind: 'title'; title: string }
  | { kind: 'editor_text'; text: string };

export type PiSystemEventPayload =
  | { kind: 'session_created'; title: string }
  | { kind: 'session_aborted' }
  | { kind: 'session_error'; message: string }
  | { kind: 'status'; status: PiSessionViewState['status']; message?: string | null };

export type PiServerEvent =
  | {
      type: 'pi_event';
      sessionId: string;
      eventId: string;
      sequence: number;
      emittedAt: number;
      payload: PiAgentEventPayload;
    }
  | {
      type: 'pi_ui_event';
      sessionId: string;
      eventId: string;
      sequence: number;
      emittedAt: number;
      payload: PiUiEventPayload;
    }
  | {
      type: 'pi_system';
      sessionId: string;
      eventId: string;
      sequence: number;
      emittedAt: number;
      payload: PiSystemEventPayload;
    }
  | { type: 'notification'; sessionId: string; level: string; message: string }
  | { type: 'heartbeat'; timestamp: number };
