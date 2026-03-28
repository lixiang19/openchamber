import React from 'react';
import type { Message, Part } from '@/lib/runtime/types';
import type { PiContentBlock, PiMessageViewState } from '@/lib/pi/types';
import { RiCheckLine, RiFileCopyLine } from '@remixicon/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

import { deriveMessageRole } from '@/components/chat/message/messageRole';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { generateSyntaxTheme } from '@/lib/theme/syntaxThemeGenerator';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { copyTextToClipboard } from '@/lib/clipboard';

type SessionMessage = { info: Message; parts: Part[] };

const EMPTY_SESSION_MESSAGES: SessionMessage[] = [];

type ProviderModelLike = {
  id?: string;
  name?: string;
  limit?: { context?: number };
};

type ProviderLike = {
  id?: string;
  name?: string;
  models?: ProviderModelLike[];
};

type TokenBreakdown = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type ContextBuckets = {
  user: number;
  assistant: number;
  tool: number;
  other: number;
};

const EMPTY_BREAKDOWN: TokenBreakdown = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

const EMPTY_BUCKETS: ContextBuckets = {
  user: 0,
  assistant: 0,
  tool: 0,
  other: 0,
};

const toNonNegativeNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
};

const isPiTextBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'text' }> => block.type === 'text';
const isPiThinkingBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'thinking' }> => block.type === 'thinking';
const isPiToolCallBlock = (block: PiContentBlock): block is Extract<PiContentBlock, { type: 'toolCall' }> => block.type === 'toolCall';

const extractTokenBreakdown = (message: SessionMessage): TokenBreakdown => {
  const tokenCandidate = (message.info as { tokens?: unknown }).tokens;
  const source =
    tokenCandidate !== undefined
      ? tokenCandidate
      : (message.parts.find((part) => (part as { tokens?: unknown }).tokens !== undefined) as { tokens?: unknown } | undefined)?.tokens;

  if (typeof source === 'number') {
    return {
      ...EMPTY_BREAKDOWN,
      total: toNonNegativeNumber(source),
    };
  }

  if (!source || typeof source !== 'object') {
    return EMPTY_BREAKDOWN;
  }

  const breakdown = source as {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };

  const input = toNonNegativeNumber(breakdown.input);
  const output = toNonNegativeNumber(breakdown.output);
  const reasoning = toNonNegativeNumber(breakdown.reasoning);
  const cacheRead = toNonNegativeNumber(breakdown.cache?.read);
  const cacheWrite = toNonNegativeNumber(breakdown.cache?.write);

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
  };
};

const extractPiAssistantTokenBreakdown = (message: Extract<PiMessageViewState, { role: 'assistant' }> | null | undefined): TokenBreakdown => {
  const usage = message?.usage as {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
  } | undefined;

  if (!usage || typeof usage !== 'object') {
    return EMPTY_BREAKDOWN;
  }

  const input = toNonNegativeNumber(usage.input);
  const output = toNonNegativeNumber(usage.output);
  const reasoning = toNonNegativeNumber(usage.reasoning);
  const cacheRead = toNonNegativeNumber(usage.cacheRead);
  const cacheWrite = toNonNegativeNumber(usage.cacheWrite);
  const total = toNonNegativeNumber(usage.totalTokens) || (input + output + reasoning + cacheRead + cacheWrite);

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total,
  };
};

const pickString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return '';
};

const estimateTextLength = (value: unknown): number => {
  if (typeof value === 'string') {
    return value.length;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateTextLength(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + estimateTextLength(item), 0);
  }
  return 0;
};

const estimatePartChars = (part: Part, role: 'user' | 'assistant' | 'tool' | 'other'): ContextBuckets => {
  const partRecord = part as Record<string, unknown>;
  const type = typeof partRecord.type === 'string' ? partRecord.type : '';

  if (type === 'reasoning') {
    return {
      ...EMPTY_BUCKETS,
      assistant: estimateTextLength(partRecord.text) + estimateTextLength(partRecord.content),
    };
  }

  const directText = pickString(
    partRecord.text,
    partRecord.content,
    partRecord.value,
    (partRecord.source as { value?: unknown; text?: { value?: unknown } } | undefined)?.value,
    (partRecord.source as { value?: unknown; text?: { value?: unknown } } | undefined)?.text?.value,
  );

  if (type === 'tool' || role === 'tool') {
    const toolInputOutputLength =
      estimateTextLength(partRecord.input)
      + estimateTextLength(partRecord.output)
      + estimateTextLength(partRecord.error)
      + estimateTextLength((partRecord.call as { input?: unknown; output?: unknown; error?: unknown } | undefined)?.input)
      + estimateTextLength((partRecord.call as { input?: unknown; output?: unknown; error?: unknown } | undefined)?.output)
      + estimateTextLength((partRecord.call as { input?: unknown; output?: unknown; error?: unknown } | undefined)?.error);

    const toolPayloadLength =
      toolInputOutputLength
      + estimateTextLength(partRecord.raw)
      + Math.round(estimateTextLength(partRecord.metadata) * 0.25)
      + Math.round(estimateTextLength(partRecord.state) * 0.1);

    return { user: 0, assistant: 0, tool: toolPayloadLength, other: 0 };
  }

  if (role === 'user') {
    return { user: directText.length, assistant: 0, tool: 0, other: 0 };
  }

  if (role === 'assistant') {
    return { user: 0, assistant: directText.length, tool: 0, other: 0 };
  }

  return { user: 0, assistant: 0, tool: 0, other: directText.length };
};

const addBuckets = (target: ContextBuckets, value: ContextBuckets): ContextBuckets => ({
  user: target.user + value.user,
  assistant: target.assistant + value.assistant,
  tool: target.tool + value.tool,
  other: target.other + value.other,
});

const deriveRoleBucket = (message: SessionMessage): 'user' | 'assistant' | 'tool' | 'other' => {
  const roleInfo = deriveMessageRole(message.info);
  if (roleInfo.isUser) return 'user';
  if (roleInfo.role === 'assistant') return 'assistant';
  if (roleInfo.role === 'tool') return 'tool';
  return 'other';
};

const computeContextBreakdown = (
  sessionMessages: SessionMessage[],
  systemPrompt: string,
): ContextBuckets => {
  if (sessionMessages.length === 0) {
    return { ...EMPTY_BUCKETS };
  }

  const totalChars = sessionMessages.reduce<ContextBuckets>((acc, message) => {
    const role = deriveRoleBucket(message);
    let bucket = { ...EMPTY_BUCKETS };
    for (const part of message.parts) {
      bucket = addBuckets(bucket, estimatePartChars(part, role));
    }
    return addBuckets(acc, bucket);
  }, { ...EMPTY_BUCKETS });

  totalChars.user += systemPrompt.length;

  return {
    user: Math.ceil(totalChars.user / 4),
    assistant: Math.ceil(totalChars.assistant / 4),
    tool: Math.ceil(totalChars.tool / 4),
    other: Math.ceil(totalChars.other / 4),
  };
};

const formatNumber = (value: number): string => value.toLocaleString();

const formatMoney = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const formatDateTime = (timestamp: number | null): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  const value = new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return value.replace(/, (\d{1,2}:\d{2} [AP]M)$/, ' at $1');
};

const formatMessageDateMeta = (timestamp: number | null): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const capitalizeRole = (role: string): string => {
  if (!role) return role;
  return `${role[0].toUpperCase()}${role.slice(1)}`;
};

const resolveProviderAndModel = (
  providers: ProviderLike[],
  providerID: string,
  modelID: string,
): { providerName: string; modelName: string; contextLimit: number | null } => {
  const provider = providers.find((entry) => entry.id === providerID);
  const model = provider?.models?.find((entry) => entry.id === modelID);

  return {
    providerName: provider?.name || providerID || '-',
    modelName: model?.name || modelID || '-',
    contextLimit: typeof model?.limit?.context === 'number' ? model.limit.context : null,
  };
};

export const ContextPanelContent: React.FC = () => {
  const { currentTheme } = useThemeSystem();
  const syntaxTheme = React.useMemo(() => generateSyntaxTheme(currentTheme), [currentTheme]);
  const [expandedRawMessages, setExpandedRawMessages] = React.useState<Record<string, boolean>>({});
  const [copiedRawMessageId, setCopiedRawMessageId] = React.useState<string | null>(null);
  const copyResetTimeoutRef = React.useRef<number | null>(null);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const currentPiSession = useSessionStore((state) => {
    if (!state.currentSessionId) return null;
    return state.piSessions.get(state.currentSessionId) ?? null;
  });
  const providers = useConfigStore((state) => state.providers);

  React.useEffect(() => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
    setExpandedRawMessages((prev) => (Object.keys(prev).length > 0 ? {} : prev));
    setCopiedRawMessageId(null);
  }, [currentSessionId]);

  React.useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
    };
  }, []);

  const handleCopyRawMessage = React.useCallback(async (messageId: string, value: string) => {
    const result = await copyTextToClipboard(value);
    if (result.ok) {
      setCopiedRawMessageId(messageId);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedRawMessageId((prev) => (prev === messageId ? null : prev));
        copyResetTimeoutRef.current = null;
      }, 2000);
    } else {
      setCopiedRawMessageId(null);
    }
  }, []);

  const rawPiMessages = React.useMemo(() => [...(currentPiSession?.messages ?? [])].reverse(), [currentPiSession]);

  const viewModel = React.useMemo(() => {
    const currentSession = currentSessionId ? sessions.find((session) => session.id === currentSessionId) ?? null : null;
    const piMessages = currentPiSession?.messages ?? [];

    const nativeAssistantMessages = piMessages.filter(
      (message): message is Extract<PiMessageViewState, { role: 'assistant' }> => message.role === 'assistant'
    );
    const latestNativeAssistant = nativeAssistantMessages.length > 0
      ? nativeAssistantMessages[nativeAssistantMessages.length - 1]
      : null;

    const tokenBreakdown = extractPiAssistantTokenBreakdown(latestNativeAssistant);

    const totalAssistantCost = nativeAssistantMessages.reduce((sum, message) => {
      const usage = message.usage as { cost?: { total?: unknown } } | undefined;
      const cost = toNonNegativeNumber(usage?.cost?.total);
      return sum + cost;
    }, 0);

    const providerModel = resolveProviderAndModel(
      providers as ProviderLike[],
      latestNativeAssistant?.provider || currentPiSession?.model?.provider || '',
      latestNativeAssistant?.model || currentPiSession?.model?.id || '',
    );

    const contextLimit = providerModel.contextLimit;
    const usagePercent = contextLimit && contextLimit > 0
      ? Math.min(999, (tokenBreakdown.total / contextLimit) * 100)
      : 0;

    const computedBreakdown = piMessages.reduce<ContextBuckets>((acc, message) => {
      if (message.role === 'user') {
        const userText = typeof message.content === 'string'
          ? message.content.length
          : message.content.reduce((sum, block) => sum + (isPiTextBlock(block) ? block.text.length : 0), 0);
        return addBuckets(acc, { user: Math.ceil(userText / 4), assistant: 0, tool: 0, other: 0 });
      }

      if (message.role === 'assistant') {
        const assistantText = message.content.reduce((sum, block) => {
          if (isPiTextBlock(block)) return sum + block.text.length;
          if (isPiThinkingBlock(block)) return sum + block.thinking.length;
          if (isPiToolCallBlock(block)) return sum + estimateTextLength(block.arguments);
          return sum + estimateTextLength('raw' in block ? block.raw : block);
        }, 0);
        const toolCallChars = message.content.reduce((sum, block) => (
          isPiToolCallBlock(block) ? sum + estimateTextLength(block.arguments) : sum
        ), 0);
        return addBuckets(acc, {
          user: 0,
          assistant: Math.ceil(assistantText / 4),
          tool: Math.ceil(toolCallChars / 4),
          other: 0,
        });
      }

      if (message.role === 'toolResult') {
        const toolText = message.content.reduce((sum, block) => {
          if (isPiTextBlock(block)) return sum + block.text.length;
          if (isPiThinkingBlock(block)) return sum + block.thinking.length;
          return sum + estimateTextLength('raw' in block ? block.raw : block);
        }, 0) + estimateTextLength(message.details);
        return addBuckets(acc, { user: 0, assistant: 0, tool: Math.ceil(toolText / 4), other: 0 });
      }

      if (message.role === 'bashExecution') {
        const bashText = estimateTextLength(message.command) + estimateTextLength(message.output);
        return addBuckets(acc, { user: 0, assistant: 0, tool: Math.ceil(bashText / 4), other: 0 });
      }

      if (message.role === 'custom') {
        const customText = typeof message.content === 'string'
          ? message.content.length
          : message.content.reduce((sum, block) => {
            if (isPiTextBlock(block)) return sum + block.text.length;
            if (isPiThinkingBlock(block)) return sum + block.thinking.length;
            return sum + estimateTextLength('raw' in block ? block.raw : block);
          }, 0);
        return addBuckets(acc, { user: 0, assistant: 0, tool: 0, other: Math.ceil(customText / 4) });
      }

      return acc;
    }, { ...EMPTY_BUCKETS });

    const userTokens = computedBreakdown.user;
    const assistantTokens = computedBreakdown.assistant;
    const toolTokens = computedBreakdown.tool;
    const otherTokens = Math.max(0, tokenBreakdown.input - userTokens - assistantTokens - toolTokens);
    const breakdownTotal = userTokens + assistantTokens + toolTokens + otherTokens;

    const firstMessageTs = currentPiSession?.messages[0]?.timestamp ?? null;
    const lastMessageTs = currentPiSession && currentPiSession.messages.length > 0
      ? currentPiSession.messages[currentPiSession.messages.length - 1]?.timestamp
      : null;

    return {
      sessionTitle: currentSession?.title || 'Untitled Session',
      messagesCount: piMessages.length,
      userMessagesCount: piMessages.filter((message) => message.role === 'user').length,
      assistantMessagesCount: piMessages.filter((message) => message.role === 'assistant').length,
      createdAt: (currentSession?.time?.created ?? firstMessageTs ?? null) as number | null,
      lastActivityAt: (lastMessageTs ?? currentSession?.time?.created ?? null) as number | null,
      providerModel,
      tokenBreakdown,
      usagePercent,
      totalAssistantCost,
      contextLimit,
      breakdown: {
        user: userTokens,
        assistant: assistantTokens,
        tool: toolTokens,
        other: otherTokens,
      },
      breakdownTotal,
    };
  }, [currentPiSession, currentSessionId, providers, sessions]);

  if (!currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center typography-ui-label text-muted-foreground">
        Open a session to inspect context.
      </div>
    );
  }

  const segments: Array<{ key: string; label: string; value: number; color: string }> = [
    { key: 'user', label: 'User', value: viewModel.breakdown.user, color: 'var(--status-success)' },
    { key: 'assistant', label: 'Assistant', value: viewModel.breakdown.assistant, color: 'var(--primary-base)' },
    { key: 'tool', label: 'Tool Calls', value: viewModel.breakdown.tool, color: 'var(--status-warning)' },
    { key: 'other', label: 'Other', value: viewModel.breakdown.other, color: 'var(--surface-muted-foreground)' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[52rem] px-5 py-6">

        {/* ── Session header ── */}
        <div className="mb-6">
          <h2 className="typography-ui-header font-semibold text-foreground truncate">{viewModel.sessionTitle}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 typography-micro text-muted-foreground/70">
            <span>{viewModel.providerModel.providerName} / {viewModel.providerModel.modelName}</span>
            {viewModel.createdAt && (
              <>
                <span>&middot;</span>
                <span>{formatDateTime(viewModel.createdAt)}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Context usage ── */}
        <div className="mb-5 rounded-lg bg-[var(--surface-elevated)]/70 px-4 py-3.5">
          <div className="flex items-baseline justify-between">
            <span className="typography-micro text-muted-foreground">Context</span>
            <span className="typography-micro tabular-nums text-muted-foreground/70">
              {formatNumber(viewModel.tokenBreakdown.total)}
              {viewModel.contextLimit ? ` / ${formatNumber(viewModel.contextLimit)}` : ''}
            </span>
          </div>
          <div className="mt-2.5 flex h-1 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
            {viewModel.usagePercent > 0 && (
              <div
                className="rounded-full transition-all duration-300"
                style={{
                  width: `${Math.max(0.5, viewModel.usagePercent)}%`,
                  backgroundColor: viewModel.usagePercent > 80 ? 'var(--status-warning)' : 'var(--primary-base)',
                }}
              />
            )}
          </div>
          <div className="mt-1.5 typography-micro font-medium tabular-nums text-foreground/80">
            {viewModel.usagePercent.toFixed(1)}% used
          </div>
        </div>

        {/* ── Stat grid ── */}
        <div className="mb-5 grid grid-cols-2 gap-2">
          {([
            { label: 'Messages', value: formatNumber(viewModel.messagesCount) },
            { label: 'User', value: formatNumber(viewModel.userMessagesCount) },
            { label: 'Assistant', value: formatNumber(viewModel.assistantMessagesCount) },
            { label: 'Cost', value: formatMoney(viewModel.totalAssistantCost) },
          ] as const).map((item) => (
            <div key={item.label} className="rounded-lg bg-[var(--surface-elevated)]/70 px-3 py-2.5">
              <div className="typography-micro text-muted-foreground/70">{item.label}</div>
              <div className="mt-0.5 typography-ui-label tabular-nums text-foreground">{item.value}</div>
            </div>
          ))}
        </div>

        {/* ── Last turn tokens ── */}
        <div className="mb-5 rounded-lg bg-[var(--surface-elevated)]/70 px-4 py-3.5">
          <div className="typography-micro text-muted-foreground">Last Assistant Message</div>
          <div className="mt-2.5 grid grid-cols-3 gap-x-4 gap-y-2.5">
            {([
              { label: 'Input', value: viewModel.tokenBreakdown.input },
              { label: 'Output', value: viewModel.tokenBreakdown.output },
              { label: 'Reasoning', value: viewModel.tokenBreakdown.reasoning },
              { label: 'Cache Read', value: viewModel.tokenBreakdown.cacheRead },
              { label: 'Cache Write', value: viewModel.tokenBreakdown.cacheWrite },
            ] as const).map((item) => (
              <div key={item.label}>
                <div className="typography-micro text-muted-foreground/70">{item.label}</div>
                <div className="mt-0.5 typography-ui-label tabular-nums text-foreground">{formatNumber(item.value)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Context breakdown ── */}
        <div className="mb-6">
          <div className="flex h-1 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
            {segments.map((segment) => {
              if (segment.value <= 0 || viewModel.breakdownTotal <= 0) return null;
              return (
                <div
                  key={segment.key}
                  style={{
                    width: `${(segment.value / viewModel.breakdownTotal) * 100}%`,
                    backgroundColor: segment.color,
                  }}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {segments.map((segment) => {
              const pct = viewModel.breakdownTotal > 0 ? (segment.value / viewModel.breakdownTotal) * 100 : 0;
              return (
                <div key={segment.key} className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: segment.color }} />
                  <span className="typography-micro text-muted-foreground/70">
                    {segment.label} <span className="tabular-nums">{pct.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Raw messages ── */}
        <div>
          <div className="typography-micro text-muted-foreground">Raw Messages</div>
          <div className="mt-2.5 space-y-1">
            {rawPiMessages.map((message, index) => {
              const messageId = (typeof message.id === 'string' && message.id.length > 0)
                ? message.id
                : `${message.role}:${message.timestamp}:${index}`;
              const role = message.role;
              const isExpanded = expandedRawMessages[messageId] === true;
              const isCopied = copiedRawMessageId === messageId;
              const messageCreatedAt = message.timestamp ?? null;

              const jsonValue = isExpanded
                ? JSON.stringify(message, null, 2)
                : '';

              return (
                <div
                  key={messageId}
                  className="overflow-hidden rounded-lg bg-[var(--surface-elevated)]/70"
                >
                  <button
                    type="button"
                    className="w-full cursor-pointer px-3 py-1.5 text-left hover:bg-[var(--interactive-hover)]"
                    aria-expanded={isExpanded}
                    onClick={() => {
                      setExpandedRawMessages((prev) => ({
                        ...prev,
                        [messageId]: !(prev[messageId] === true),
                      }));
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 whitespace-nowrap overflow-hidden">
                      <span className="min-w-0 inline-flex items-center gap-1.5">
                        <span className="typography-ui-label text-foreground shrink-0">{capitalizeRole(role)}</span>
                        <span className="min-w-0 truncate typography-micro text-muted-foreground">{messageId}</span>
                      </span>
                      <span className="typography-micro text-muted-foreground shrink-0">{formatMessageDateMeta(messageCreatedAt)}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--surface-subtle)] p-0">
                      <div className="group relative max-h-[26rem] w-full overflow-auto bg-[var(--surface-background)]">
                        <div className="absolute top-1 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-interactive-hover/60 hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCopyRawMessage(messageId, jsonValue);
                            }}
                            aria-label={isCopied ? 'Copied' : 'Copy JSON'}
                            title={isCopied ? 'Copied' : 'Copy'}
                          >
                            {isCopied ? <RiCheckLine className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />}
                          </button>
                        </div>
                        <SyntaxHighlighter
                          language="json"
                          style={syntaxTheme}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            padding: '0.75rem',
                            background: 'transparent',
                            fontSize: 'var(--text-micro)',
                            lineHeight: '1.35',
                          }}
                          codeTagProps={{
                            style: {
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              overflowWrap: 'break-word',
                            },
                          }}
                          wrapLongLines
                        >
                          {jsonValue}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
