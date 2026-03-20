import React from 'react';
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileList3Line,
  RiLoader4Line,
  RiRefreshLine,
  RiSendPlaneLine,
} from '@remixicon/react';

import { toast } from '@/components/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { isIMECompositionEvent } from '@/lib/ime';
import {
  createProjectTodoId,
  getProjectTodoPath,
  PROJECT_TODO_TEXT_MAX_LENGTH,
  readProjectTodoFile,
  writeProjectTodoFile,
  type ProjectTodoItem,
} from '@/lib/projectTodoFile';
import { formatPathForDisplay } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';

type TodoFilter = 'all' | 'active' | 'done';

const FILTERS: Array<{ id: TodoFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
];

export const TodoView: React.FC = () => {
  const currentDirectory = useEffectiveDirectory() ?? '';
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const setPendingInputText = useSessionStore((state) => state.setPendingInputText);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const todoPath = React.useMemo(() => {
    if (!currentDirectory.trim()) {
      return '';
    }
    return getProjectTodoPath(currentDirectory);
  }, [currentDirectory]);

  const [items, setItems] = React.useState<ProjectTodoItem[]>([]);
  const [draft, setDraft] = React.useState('');
  const [filter, setFilter] = React.useState<TodoFilter>('all');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadIssueKind, setLoadIssueKind] = React.useState<'invalid' | 'error' | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const itemsRef = React.useRef<ProjectTodoItem[]>([]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const loadTodos = React.useCallback(async () => {
    const directory = currentDirectory.trim();
    if (!directory) {
      setItems([]);
      setLoadIssueKind(null);
      setLoadError(null);
      setEditingId(null);
      setEditingText('');
      return;
    }

    setIsLoading(true);
    const result = await readProjectTodoFile(directory);
    setIsLoading(false);

    if (result.status === 'ok' || result.status === 'missing') {
      setItems(result.data.items);
      setLoadIssueKind(null);
      setLoadError(null);
      setEditingId(null);
      setEditingText('');
      return;
    }

    setItems([]);
    setLoadIssueKind(result.status);
    setLoadError(`${result.message} (${formatPathForDisplay(result.path)})`);
    setEditingId(null);
    setEditingText('');
  }, [currentDirectory]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!currentDirectory.trim()) {
        setItems([]);
        setLoadIssueKind(null);
        setLoadError(null);
        setEditingId(null);
        setEditingText('');
        return;
      }

      setIsLoading(true);
      const result = await readProjectTodoFile(currentDirectory);
      if (cancelled) {
        return;
      }
      setIsLoading(false);

      if (result.status === 'ok' || result.status === 'missing') {
        setItems(result.data.items);
        setLoadIssueKind(null);
        setLoadError(null);
        setEditingId(null);
        setEditingText('');
        return;
      }

      setItems([]);
      setLoadIssueKind(result.status);
      setLoadError(`${result.message} (${formatPathForDisplay(result.path)})`);
      setEditingId(null);
      setEditingText('');
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [currentDirectory]);

  const persistItems = React.useCallback(
    async (nextItems: ProjectTodoItem[], previousItems: ProjectTodoItem[], failureTitle: string) => {
      const directory = currentDirectory.trim();
      if (!directory) {
        toast.error('No project directory available');
        return false;
      }

      setItems(nextItems);
      setIsSaving(true);
      const result = await writeProjectTodoFile(directory, { version: 1, items: nextItems });
      setIsSaving(false);

      if (!result.ok) {
        setItems(previousItems);
        toast.error(failureTitle, { description: result.message });
        return false;
      }

      setLoadIssueKind(null);
      setLoadError(null);
      return true;
    },
    [currentDirectory],
  );

  const handleAddTodo = React.useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }

    if (text.length > PROJECT_TODO_TEXT_MAX_LENGTH) {
      toast.error(`Todo text must be ${PROJECT_TODO_TEXT_MAX_LENGTH} characters or less`);
      return;
    }

    const now = Date.now();
    const previousItems = itemsRef.current;
    const nextItems = [
      {
        id: createProjectTodoId(),
        text,
        done: false,
        createdAt: now,
        updatedAt: now,
      },
      ...previousItems,
    ];

    setDraft('');
    const saved = await persistItems(nextItems, previousItems, 'Failed to add todo');
    if (!saved) {
      setDraft(text);
    }
  }, [draft, persistItems]);

  const handleToggleTodo = React.useCallback(async (id: string, done: boolean) => {
    const previousItems = itemsRef.current;
    const nextItems = previousItems.map((item) => (
      item.id === id
        ? { ...item, done, updatedAt: Date.now() }
        : item
    ));
    await persistItems(nextItems, previousItems, 'Failed to update todo');
  }, [persistItems]);

  const handleDeleteTodo = React.useCallback(async (id: string) => {
    const previousItems = itemsRef.current;
    const nextItems = previousItems.filter((item) => item.id !== id);
    await persistItems(nextItems, previousItems, 'Failed to delete todo');
  }, [persistItems]);

  const handleClearDone = React.useCallback(async () => {
    const previousItems = itemsRef.current;
    const nextItems = previousItems.filter((item) => !item.done);
    if (nextItems.length === previousItems.length) {
      return;
    }
    await persistItems(nextItems, previousItems, 'Failed to clear completed todos');
  }, [persistItems]);

  const handleSendToCurrentChat = React.useCallback((item: ProjectTodoItem) => {
    if (!currentSessionId) {
      toast.error('No active session', { description: 'Open a chat session first.' });
      return;
    }

    setPendingInputText(item.text, 'append');
    setActiveMainTab('chat');
    toast.success('Todo added to current chat input');
  }, [currentSessionId, setActiveMainTab, setPendingInputText]);

  const startEditing = React.useCallback((item: ProjectTodoItem) => {
    setEditingId(item.id);
    setEditingText(item.text);
  }, []);

  const stopEditing = React.useCallback(() => {
    setEditingId(null);
    setEditingText('');
  }, []);

  const handleSaveEdit = React.useCallback(async () => {
    const id = editingId;
    const text = editingText.trim();
    if (!id) {
      return;
    }
    if (!text) {
      toast.error('Todo text cannot be empty');
      return;
    }
    if (text.length > PROJECT_TODO_TEXT_MAX_LENGTH) {
      toast.error(`Todo text must be ${PROJECT_TODO_TEXT_MAX_LENGTH} characters or less`);
      return;
    }

    const previousItems = itemsRef.current;
    const nextItems = previousItems.map((item) => (
      item.id === id
        ? { ...item, text, updatedAt: Date.now() }
        : item
    ));
    const saved = await persistItems(nextItems, previousItems, 'Failed to update todo');
    if (saved) {
      stopEditing();
    }
  }, [editingId, editingText, persistItems, stopEditing]);

  const filteredItems = React.useMemo(() => {
    if (filter === 'active') {
      return items.filter((item) => !item.done);
    }
    if (filter === 'done') {
      return items.filter((item) => item.done);
    }
    return items;
  }, [filter, items]);

  const activeCount = React.useMemo(() => items.filter((item) => !item.done).length, [items]);
  const doneCount = items.length - activeCount;
  const disableEditing = !currentDirectory.trim() || Boolean(loadError) || isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-background)]">
      <div className="border-b border-[var(--interactive-border)] px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <RiFileList3Line className="h-4 w-4 text-[var(--surface-muted-foreground)]" />
              <h2 className="typography-ui-header font-medium text-foreground">Todo</h2>
            </div>
            <p className="typography-meta text-muted-foreground">
              {currentDirectory.trim() ? `${activeCount} active · ${doneCount} done` : 'Open a project to manage project todo items'}
            </p>
            {todoPath ? (
              <p className="truncate typography-meta text-muted-foreground/80" title={todoPath}>
                {formatPathForDisplay(todoPath)}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void loadTodos()}
            disabled={isLoading || !currentDirectory.trim()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--interactive-border)] bg-transparent text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Reload project todo file"
          >
            {isLoading ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiRefreshLine className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, PROJECT_TODO_TEXT_MAX_LENGTH))}
            onKeyDown={(event) => {
              if (isIMECompositionEvent(event)) {
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAddTodo();
              }
            }}
            placeholder="Add the next concrete task"
            disabled={disableEditing || isSaving}
            className="h-8 bg-[var(--surface-elevated)]"
          />
          <button
            type="button"
            onClick={() => void handleAddTodo()}
            disabled={disableEditing || isSaving || draft.trim().length === 0}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Add todo"
          >
            <RiAddLine className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1">
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={cn(
                  'inline-flex h-7 items-center rounded-md px-2.5 typography-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]',
                  active
                    ? 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]'
                    : 'text-[var(--surface-muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)]',
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <div className="mx-4 mt-4 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2">
          <p className="typography-ui-label text-[var(--status-error-foreground)]">
            {loadIssueKind === 'error' ? 'Failed to load todo.json' : 'todo.json is invalid'}
          </p>
          <p className="mt-1 typography-meta text-[var(--status-error-foreground)]">{loadError}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!currentDirectory.trim() ? (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-muted)] px-6 text-center">
            <p className="typography-ui-label text-muted-foreground">
              Open a project or session first. Todo items are stored in `.work/todo.json`.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[var(--interactive-border)] bg-[var(--surface-muted)] px-6 text-center">
            <p className="typography-ui-label text-muted-foreground">
              {items.length === 0
                ? 'No todos yet. Add the next concrete task for this project.'
                : 'No todos match the current filter.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filteredItems.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <li
                  key={item.id}
                  className="group rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5">
                      <Checkbox
                        checked={item.done}
                        onChange={(checked) => void handleToggleTodo(item.id, checked)}
                        ariaLabel={`Mark ${item.text} complete`}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <Input
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value.slice(0, PROJECT_TODO_TEXT_MAX_LENGTH))}
                          onBlur={() => void handleSaveEdit()}
                          onKeyDown={(event) => {
                            if (isIMECompositionEvent(event)) {
                              return;
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void handleSaveEdit();
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              stopEditing();
                            }
                          }}
                          autoFocus
                          className="h-8 bg-[var(--surface-background)]"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                          className="w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
                        >
                          <span
                            className={cn(
                              'block whitespace-pre-wrap break-words typography-ui-label text-[var(--surface-foreground)]',
                              item.done && 'text-[var(--surface-muted-foreground)] line-through',
                            )}
                          >
                            {item.text}
                          </span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSendToCurrentChat(item)}
                      disabled={!currentSessionId}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Send ${item.text} to current chat`}
                    >
                      <RiSendPlaneLine className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteTodo(item.id)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
                      aria-label={`Delete ${item.text}`}
                    >
                      <RiDeleteBinLine className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--interactive-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="typography-meta text-muted-foreground">
            {isSaving ? 'Saving to .work/todo.json…' : 'Tracked in Git with the project'}
          </p>
          <button
            type="button"
            onClick={() => void handleClearDone()}
            disabled={isSaving || doneCount === 0 || Boolean(loadError) || !currentDirectory.trim()}
            className="inline-flex h-7 items-center rounded-md px-2.5 typography-meta text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear done
          </button>
        </div>
      </div>
    </div>
  );
};
