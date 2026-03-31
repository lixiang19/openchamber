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

type TodoFilter = 'todo' | 'done' | 'all';

const FILTERS: Array<{ id: TodoFilter; label: string }> = [
  { id: 'todo', label: 'todo' },
  { id: 'done', label: 'done' },
  { id: 'all', label: 'all' },
];

export const TodoView: React.FC = () => {
  const currentDirectory = useEffectiveDirectory() ?? '';
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const openNewSessionDraft = useSessionStore((state) => state.openNewSessionDraft);
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
    if (currentSessionId) {
      setPendingInputText(item.text, 'append');
    } else {
      openNewSessionDraft({
        directoryOverride: currentDirectory.trim() || undefined,
        initialPrompt: item.text,
      });
    }

    setActiveMainTab('chat');
    toast.success('Todo added to chat input');
  }, [currentDirectory, currentSessionId, openNewSessionDraft, setActiveMainTab, setPendingInputText]);

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
    if (filter === 'todo') {
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
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--interactive-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <RiFileList3Line className="h-4 w-4 text-[var(--surface-muted-foreground)]" />
          <h2 className="font-medium text-[var(--surface-foreground)]">Todo</h2>
          <span className="ml-2 rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--surface-muted-foreground)]">
            {activeCount} todo
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadTodos()}
          disabled={isLoading || !currentDirectory.trim()}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="刷新待办事项"
        >
          {isLoading ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : <RiRefreshLine className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Input section */}
      <div className="shrink-0 border-b border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-4">
        <div className="relative flex items-center">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, PROJECT_TODO_TEXT_MAX_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAddTodo();
              }
            }}
            placeholder="添加下一个具体任务..."
            disabled={disableEditing || isSaving}
            className="h-9 w-full rounded-md border-[var(--interactive-border)] bg-[var(--surface-elevated)] pr-10 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)]"
          />
          <button
            type="button"
            onClick={() => void handleAddTodo()}
            disabled={disableEditing || isSaving || draft.trim().length === 0}
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-sm text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="添加任务"
          >
            <RiAddLine className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-2">
        <div className="flex items-center gap-1">
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={cn(
                  'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)]',
                  active
                    ? 'bg-[var(--surface-foreground)] text-[var(--surface-background)]'
                    : 'text-[var(--surface-muted-foreground)] hover:bg-[var(--surface-elevated)] hover:text-[var(--surface-foreground)]',
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={() => void handleClearDone()}
            disabled={isSaving || Boolean(loadError) || !currentDirectory.trim()}
            className="text-xs text-[var(--surface-muted-foreground)] transition-colors hover:text-[var(--surface-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            清除已完成
          </button>
        )}
      </div>

      {/* Error State */}
      {loadError ? (
        <div className="m-4 shrink-0 rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2">
          <p className="text-sm font-medium text-[var(--status-error-foreground)]">
            {loadIssueKind === 'error' ? 'Failed to load todo.json' : 'todo.json is invalid'}
          </p>
          <p className="mt-1 text-xs text-[var(--status-error-foreground)] opacity-90">{loadError}</p>
        </div>
      ) : null}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!currentDirectory.trim() ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--interactive-border)] bg-[var(--surface-muted)] px-4 text-center">
            <p className="text-sm text-[var(--surface-muted-foreground)]">暂未打开项目，请先在资源管理器中选择文件夹以启用待办事项。</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--interactive-border)] bg-[var(--surface-muted)] px-4 text-center">
            <p className="text-sm text-[var(--surface-muted-foreground)]">
              {items.length === 0
                ? '空空如也。添加你的第一个待办任务吧！'
                : '没有匹配该过滤条件的任务。'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredItems.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <li
                  key={item.id}
                  className="group relative flex items-start gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-[var(--interactive-border)] hover:bg-[var(--surface-elevated)]"
                >
                  <div className="mt-0.5 shrink-0">
                    <Checkbox
                      checked={item.done}
                      onChange={(checked) => void handleToggleTodo(item.id, checked)}
                      ariaLabel={`标记 ${item.text} 为完成`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <Input
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value.slice(0, PROJECT_TODO_TEXT_MAX_LENGTH))}
                        onBlur={() => void handleSaveEdit()}
                        onKeyDown={(event) => {
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
                        className="h-7 w-full border-[var(--interactive-border)] bg-[var(--surface-background)] px-2 py-1 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        title="点击编辑任务"
                        className="block w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)]"
                      >
                        <span
                          className={cn(
                            'block whitespace-pre-wrap break-words text-sm transition-colors',
                            item.done
                              ? 'text-[var(--surface-muted-foreground)] line-through'
                              : 'text-[var(--surface-foreground)]',
                          )}
                        >
                          {item.text}
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleSendToCurrentChat(item)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--surface-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                      title="发送到当前对话"
                    >
                      <RiSendPlaneLine className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTodo(item.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--surface-muted-foreground)] transition-colors hover:bg-[var(--status-error-background)] hover:text-[var(--status-error-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--interactive-focus-ring)]"
                      title="删除任务"
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

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--interactive-border)] bg-[var(--surface-background)] px-4 py-2">
        <p className="text-xs text-[var(--surface-muted-foreground)]">
          {isSaving ? '正在保存到 .opencode/todo.json…' : '数据与项目一起在 Git 中跟踪'}
        </p>
      </div>
    </div>
  );
};
