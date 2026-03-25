import React from 'react';

import { piClient } from '@/lib/pi/client';
import type {
  PiContentBlock,
  PiInteractiveRequestViewState,
  PiMessageViewState,
  PiSessionViewState,
  PiToolExecutionViewState,
} from '@/lib/pi/types';

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const renderContentBlock = (block: PiContentBlock, key: string): React.ReactNode => {
  if (block.type === 'text') {
    return <div key={key} className="whitespace-pre-wrap leading-7">{block.text}</div>;
  }
  if (block.type === 'thinking') {
    return (
      <details key={key} className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer text-sm text-muted-foreground">Thinking</summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground/80">{block.thinking}</pre>
      </details>
    );
  }
  if (block.type === 'toolCall') {
    return (
      <div key={key} className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-sm">
        <div className="font-medium">Tool call: {block.name}</div>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground/80">{stringify(block.arguments)}</pre>
      </div>
    );
  }
  return (
    <div key={key} className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
      Image: {block.mimeType}
    </div>
  );
};

const MessageCard: React.FC<{ message: PiMessageViewState }> = ({ message }) => {
  const roleClass = message.role === 'user'
    ? 'border-l-4 border-l-emerald-500 bg-emerald-500/5'
    : message.role === 'assistant'
      ? 'border-l-4 border-l-sky-500 bg-sky-500/5'
      : 'border-l-4 border-l-amber-500 bg-amber-500/5';

  return (
    <div className={`rounded-xl border border-border/50 p-3 ${roleClass}`}>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span>{message.role}</span>
        <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
      </div>

      {message.role === 'user' ? (
        typeof message.content === 'string'
          ? <div className="whitespace-pre-wrap leading-7">{message.content}</div>
          : <div className="space-y-3">{message.content.map((block, index) => renderContentBlock(block, `user-${index}`))}</div>
      ) : null}

      {message.role === 'assistant' ? (
        <div className="space-y-3">
          {message.content.map((block, index) => renderContentBlock(block, `assistant-${index}`))}
          {message.errorMessage ? <div className="text-sm text-red-400">{message.errorMessage}</div> : null}
          {message.stopReason ? <div className="text-xs text-muted-foreground">stop reason: {message.stopReason}</div> : null}
        </div>
      ) : null}

      {message.role === 'toolResult' ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">{message.toolName}</div>
          {message.content.map((block, index) => renderContentBlock(block, `tool-result-${index}`))}
          {message.details !== undefined ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 text-xs">{stringify(message.details)}</pre>
          ) : null}
        </div>
      ) : null}

      {message.role === 'custom' ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">{message.customType}</div>
          {typeof message.content === 'string'
            ? <div className="whitespace-pre-wrap leading-7">{message.content}</div>
            : message.content.map((block, index) => renderContentBlock(block, `custom-${index}`))}
          {message.details !== undefined ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 text-xs">{stringify(message.details)}</pre>
          ) : null}
        </div>
      ) : null}

      {message.role === 'bashExecution' ? (
        <div className="space-y-3">
          <div className="text-sm font-medium">$ {message.command}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 text-xs">{message.output}</pre>
        </div>
      ) : null}
    </div>
  );
};

const ToolExecutionCard: React.FC<{ execution: PiToolExecutionViewState }> = ({ execution }) => {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{execution.toolName}</div>
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{execution.status}</div>
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-foreground/80">{stringify(execution.args)}</pre>
      {execution.partialResult ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/20 p-2 text-xs">{stringify(execution.partialResult)}</pre>
      ) : null}
      {execution.result ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/20 p-2 text-xs">{stringify(execution.result)}</pre>
      ) : null}
    </div>
  );
};

const InteractiveRequestCard: React.FC<{
  request: PiInteractiveRequestViewState;
  onRespond: (requestId: string, response: string | boolean) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}> = ({ request, onRespond, onReject }) => {
  const [value, setValue] = React.useState(request.prefill || '');
  const [busy, setBusy] = React.useState(false);

  const submit = async (response: string | boolean) => {
    setBusy(true);
    try {
      await onRespond(request.id, response);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="mb-2 text-sm font-semibold">{request.title}</div>
      {request.message ? <div className="mb-3 whitespace-pre-wrap text-sm text-foreground/80">{request.message}</div> : null}

      {request.method === 'confirm' ? (
        <div className="flex gap-2">
          <button className="rounded-lg bg-foreground px-3 py-2 text-background disabled:opacity-50" disabled={busy} onClick={() => void submit(true)}>Confirm</button>
          <button className="rounded-lg border border-border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void onReject(request.id)}>Cancel</button>
        </div>
      ) : null}

      {request.method === 'select' ? (
        <div className="flex flex-wrap gap-2">
          {request.options.map((option) => (
            <button
              key={option}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void submit(option)}
            >
              {option}
            </button>
          ))}
          <button className="rounded-lg border border-border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void onReject(request.id)}>Cancel</button>
        </div>
      ) : null}

      {(request.method === 'input' || request.method === 'editor') ? (
        <div className="space-y-3">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={request.placeholder || 'Enter a response'}
            className="min-h-28 w-full rounded-xl border border-border bg-background/70 p-3 outline-none"
          />
          <div className="flex gap-2">
            <button className="rounded-lg bg-foreground px-3 py-2 text-background disabled:opacity-50" disabled={busy || !value.trim()} onClick={() => void submit(value)}>Submit</button>
            <button className="rounded-lg border border-border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void onReject(request.id)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const PiChatApp: React.FC = () => {
  const [sessions, setSessions] = React.useState<Record<string, PiSessionViewState>>({});
  const [currentSessionId, setCurrentSessionId] = React.useState<string | null>(null);
  const [composer, setComposer] = React.useState('');
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    const applySession = (session: PiSessionViewState) => {
      setSessions((prev) => ({ ...prev, [session.id]: session }));
      setCurrentSessionId((prev) => prev || session.id);
    };

    const bootstrap = async () => {
      try {
        const existing = await piClient.listSessions();
        if (!active) return;
        if (existing.length > 0) {
          existing.forEach(applySession);
          return;
        }
        const created = await piClient.createSession({ title: 'Pi Session' });
        if (!active) return;
        applySession(created);
      } catch (error) {
        if (!active) return;
        setBootError(error instanceof Error ? error.message : String(error));
      }
    };

    void bootstrap();

    const unsubscribe = piClient.subscribe(null, (event) => {
      if (event.type === 'session_snapshot') {
        applySession(event.session);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const orderedSessions = React.useMemo(
    () => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  const currentSession = currentSessionId ? sessions[currentSessionId] ?? null : null;

  const createSession = React.useCallback(async () => {
    setBusy(true);
    try {
      const session = await piClient.createSession({ title: `Pi Session ${orderedSessions.length + 1}` });
      setSessions((prev) => ({ ...prev, [session.id]: session }));
      setCurrentSessionId(session.id);
      setComposer('');
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [orderedSessions.length]);

  const sendMessage = React.useCallback(async () => {
    if (!currentSessionId || !composer.trim()) return;
    setBusy(true);
    try {
      await piClient.prompt(currentSessionId, composer.trim());
      setComposer('');
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [composer, currentSessionId]);

  const abort = React.useCallback(async () => {
    if (!currentSessionId) return;
    setBusy(true);
    try {
      await piClient.abort(currentSessionId);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [currentSessionId]);

  const respondToRequest = React.useCallback(async (requestId: string, response: string | boolean) => {
    await piClient.respondToRequest(requestId, response);
  }, []);

  const rejectRequest = React.useCallback(async (requestId: string) => {
    await piClient.rejectRequest(requestId);
  }, []);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,1))] text-foreground lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-border/50 bg-background/40 p-4 backdrop-blur lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pi</div>
            <div className="text-lg font-semibold">Native Sessions</div>
          </div>
          <button className="rounded-lg border border-border px-3 py-2 text-sm" disabled={busy} onClick={() => void createSession()}>New</button>
        </div>
        <div className="space-y-2">
          {orderedSessions.map((session) => {
            const active = session.id === currentSessionId;
            return (
              <button
                key={session.id}
                className={`w-full rounded-xl border p-3 text-left ${active ? 'border-sky-500/50 bg-sky-500/10' : 'border-border/50 bg-background/40'}`}
                onClick={() => setCurrentSessionId(session.id)}
              >
                <div className="text-sm font-medium">{session.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{session.cwd}</div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{session.status}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-h-0 flex-col">
        <div className="border-b border-border/50 bg-background/30 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current Session</div>
              <div className="text-lg font-semibold">{currentSession?.title || 'Loading'}</div>
            </div>
            {currentSession?.model ? (
              <div className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
                {currentSession.model.provider}/{currentSession.model.id}
              </div>
            ) : null}
            {currentSession?.workingMessage ? (
              <div className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
                {currentSession.workingMessage}
              </div>
            ) : null}
            {currentSession?.statusEntries.length ? (
              currentSession.statusEntries.map((entry) => (
                <div key={entry.key} className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">{entry.text}</div>
              ))
            ) : null}
            <div className="ml-auto flex gap-2">
              <button className="rounded-lg border border-border px-3 py-2 text-sm" disabled={!currentSession || busy || !currentSession.isStreaming} onClick={() => void abort()}>Abort</button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {bootError ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{bootError}</div> : null}
              {!currentSession ? <div className="text-sm text-muted-foreground">Loading session…</div> : null}
              {currentSession?.interactiveRequests.map((request) => (
                <InteractiveRequestCard key={request.id} request={request} onRespond={respondToRequest} onReject={rejectRequest} />
              ))}
              {currentSession?.messages.map((message, index) => (
                <MessageCard key={`${message.role}-${message.timestamp}-${index}`} message={message} />
              ))}
            </div>
            <div className="border-t border-border/50 bg-background/40 p-5 backdrop-blur">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 shadow-[0_20px_80px_rgba(15,23,42,0.35)]">
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Talk to Pi directly. Cmd/Ctrl+Enter to send."
                  className="min-h-28 w-full resize-none bg-transparent p-2 outline-none"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                  <div className="text-xs text-muted-foreground">Pi-native chat path. No OpenCode compatibility layer.</div>
                  <button className="rounded-xl bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50" disabled={busy || !composer.trim() || !currentSessionId} onClick={() => void sendMessage()}>Send</button>
                </div>
              </div>
            </div>
          </section>

          <aside className="border-t border-border/50 bg-background/20 p-5 xl:border-l xl:border-t-0">
            <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Tool Execution</div>
            <div className="space-y-3 overflow-y-auto xl:max-h-full">
              {currentSession?.toolExecutions.length ? currentSession.toolExecutions.map((execution) => (
                <ToolExecutionCard key={execution.toolCallId} execution={execution} />
              )) : <div className="text-sm text-muted-foreground">No tool activity yet.</div>}
              {currentSession?.widgets.length ? currentSession.widgets.map((widget) => (
                <div key={widget.key} className="rounded-xl border border-border/50 bg-background/60 p-3">
                  <div className="mb-2 text-sm font-medium">Widget: {widget.key}</div>
                  <pre className="whitespace-pre-wrap text-xs text-foreground/80">{widget.content.join('\n')}</pre>
                </div>
              )) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
