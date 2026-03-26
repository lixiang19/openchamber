import React from 'react';
import { RiCommandLine, RiFileLine, RiFlashlightLine, RiRefreshLine, RiScissorsLine, RiTerminalBoxLine, RiArrowGoBackLine, RiArrowGoForwardLine, RiTimeLine } from '@remixicon/react';
import { cn, fuzzyMatch } from '@/lib/utils';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { piClient } from '@/lib/pi/client';
import { useChatSearchDirectory } from '@/hooks/useChatSearchDirectory';
import { useSessionStore } from '@/stores/useSessionStore';
import { useShallow } from 'zustand/react/shallow';

interface CommandInfo {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  isBuiltIn?: boolean;
  isSkill?: boolean;
  scope?: string;
}

export interface CommandAutocompleteHandle {
  handleKeyDown: (key: string) => void;
}

type AutocompleteTab = 'commands' | 'agents' | 'files';

interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo, options?: { dismissKeyboard?: boolean }) => void;
  onClose: () => void;
  showTabs?: boolean;
  activeTab?: AutocompleteTab;
  onTabSelect?: (tab: AutocompleteTab) => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery,
  onCommandSelect,
  onClose,
  showTabs,
  activeTab = 'commands',
  onTabSelect,
  style,
}, ref) => {
  const chatSearchDirectory = useChatSearchDirectory();
  const { currentSessionId } = useSessionStore(
    useShallow((state) => ({ currentSessionId: state.currentSessionId }))
  );
  const [catalogCommands, setCatalogCommands] = React.useState<CommandInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const ignoreClickRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);
  const ignoreTabClickRef = React.useRef(false);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useEffect(() => {
    let cancelled = false;

    const loadCommands = async () => {
      if (!chatSearchDirectory) {
        setCatalogCommands([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const piCommands = await piClient.listCommands(chatSearchDirectory);
        if (cancelled) {
          return;
        }

        const mapped = piCommands
          .map((cmd) => {
            const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
            if (!name) {
              return null;
            }
            return {
              name,
              description: typeof cmd.description === 'string' ? cmd.description : undefined,
              isBuiltIn: false,
              isSkill: cmd.source === 'skill',
              scope: cmd.source === 'prompt' || cmd.source === 'extension' ? cmd.source : undefined,
            } satisfies CommandInfo;
          })
          .filter((cmd): cmd is CommandInfo => Boolean(cmd));

        setCatalogCommands(mapped);
      } catch {
        if (!cancelled) {
          setCatalogCommands([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadCommands();

    return () => {
      cancelled = true;
    };
  }, [chatSearchDirectory]);

  const commands = React.useMemo(() => {
    const commandMap = new Map<string, CommandInfo>();

    [
      ...catalogCommands,
      ...(currentSessionId ? [
        { name: 'undo', description: 'Undo the last message', isBuiltIn: true },
        { name: 'redo', description: 'Redo previously undone messages', isBuiltIn: true },
        { name: 'timeline', description: 'Jump to a specific message', isBuiltIn: true },
      ] : []),
    ].forEach((command) => {
      commandMap.set(command.name, command);
    });

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = normalizedQuery
      ? Array.from(commandMap.values()).filter((cmd) =>
          fuzzyMatch(cmd.name, normalizedQuery) ||
          (cmd.description && fuzzyMatch(cmd.description, normalizedQuery))
        )
      : Array.from(commandMap.values());

    filtered.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(normalizedQuery);
      const bStartsWith = b.name.toLowerCase().startsWith(normalizedQuery);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [catalogCommands, currentSessionId, searchQuery]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [commands]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }, [selectedIndex]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      const total = commands.length;
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (total === 0) {
        return;
      }

      if (key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % total);
        return;
      }

      if (key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndex % total) + total) % total;
        const command = commands[safeIndex];
        if (command) {
          onCommandSelect(command);
        }
      }
    }
  }), [commands, selectedIndex, onClose, onCommandSelect]);

  const getCommandIcon = (command: CommandInfo) => {

    switch (command.name) {
      case 'init':
        return <RiFileLine className="h-3.5 w-3.5 text-green-500" />;
      case 'undo':
        return <RiArrowGoBackLine className="h-3.5 w-3.5 text-orange-500" />;
      case 'redo':
        return <RiArrowGoForwardLine className="h-3.5 w-3.5 text-orange-500" />;
      case 'timeline':
        return <RiTimeLine className="h-3.5 w-3.5 text-blue-500" />;
      case 'compact':
        return <RiScissorsLine className="h-3.5 w-3.5 text-purple-500" />;
      case 'test':
      case 'build':
      case 'run':
        return <RiTerminalBoxLine className="h-3.5 w-3.5 text-cyan-500" />;
      default:
        if (command.isBuiltIn) {
          return <RiFlashlightLine className="h-3.5 w-3.5 text-yellow-500" />;
        }
        return <RiCommandLine className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute z-[100] min-w-0 w-full max-w-[450px] max-h-64 bg-background border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 left-0 flex flex-col"
      style={style}
    >
      {showTabs ? (
        <div className="px-2 pt-2 pb-1 border-b border-border/60">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] p-1">
            {([
              { id: 'commands' as const, label: 'Commands' },
              { id: 'agents' as const, label: 'Agents' },
              { id: 'files' as const, label: 'Files' },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'flex-1 px-2.5 py-1 rounded-md typography-meta font-semibold transition-none',
                  activeTab === tab.id
                    ? 'bg-interactive-selection text-interactive-selection-foreground shadow-none'
                    : 'text-muted-foreground hover:bg-interactive-hover/50'
                )}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'touch') {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  ignoreTabClickRef.current = true;
                  onTabSelect?.(tab.id);
                }}
                onClick={() => {
                  if (ignoreTabClickRef.current) {
                    ignoreTabClickRef.current = false;
                    return;
                  }
                  onTabSelect?.(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="px-0 pb-2">
        <div>
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 typography-meta text-muted-foreground">
              <RiRefreshLine className="h-4 w-4 animate-spin" />
              Loading Pi commands...
            </div>
          ) : null}
          {commands.map((command, index) => {
            const isSystem = command.isBuiltIn;
            const isProject = command.scope === 'project';

            return (
              <div
                key={command.name}
                ref={(el) => { itemRefs.current[index] = el; }}
                className={cn(
                  "flex items-start gap-2 px-3 py-2 cursor-pointer rounded-lg",
                  index === selectedIndex && "bg-interactive-selection"
                )}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'touch') {
                    return;
                  }
                  pointerStartRef.current = { x: event.clientX, y: event.clientY };
                  pointerMovedRef.current = false;
                }}
                onPointerMove={(event) => {
                  if (event.pointerType !== 'touch' || !pointerStartRef.current) {
                    return;
                  }
                  const dx = event.clientX - pointerStartRef.current.x;
                  const dy = event.clientY - pointerStartRef.current.y;
                  if (Math.hypot(dx, dy) > 6) {
                    pointerMovedRef.current = true;
                  }
                }}
                onPointerUp={(event) => {
                  if (event.pointerType !== 'touch') {
                    return;
                  }
                  const didMove = pointerMovedRef.current;
                  pointerStartRef.current = null;
                  pointerMovedRef.current = false;
                  if (didMove) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  ignoreClickRef.current = true;
                  onCommandSelect(command, { dismissKeyboard: true });
                }}
                onPointerCancel={() => {
                  pointerStartRef.current = null;
                  pointerMovedRef.current = false;
                }}
                onClick={() => {
                  if (ignoreClickRef.current) {
                    ignoreClickRef.current = false;
                    return;
                  }
                  onCommandSelect(command);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="mt-0.5">
                  {getCommandIcon(command)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="typography-ui-label font-medium">/{command.name}</span>
                    {command.isSkill ? (
                      <span className="text-[10px] leading-none uppercase font-bold tracking-tight bg-[var(--status-info-background)] text-[var(--status-info)] border-[var(--status-info-border)] px-1.5 py-1 rounded border flex-shrink-0">
                        skill
                      </span>
                    ) : null}
                    {isSystem ? (
                      <span className="text-[10px] leading-none uppercase font-bold tracking-tight bg-[var(--status-warning-background)] text-[var(--status-warning)] border-[var(--status-warning-border)] px-1.5 py-1 rounded border flex-shrink-0">
                        system
                      </span>
                    ) : command.scope ? (
                      <span className={cn(
                        "text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0",
                        isProject
                          ? "bg-[var(--status-info-background)] text-[var(--status-info)] border-[var(--status-info-border)]"
                          : "bg-[var(--status-success-background)] text-[var(--status-success)] border-[var(--status-success-border)]"
                      )}>
                        {command.scope}
                      </span>
                    ) : null}
                    {command.agent && (
                      <span className="text-[10px] leading-none font-bold tracking-tight bg-[var(--surface-subtle)] text-[var(--surface-foreground)] border-[var(--interactive-border)] px-1.5 py-1 rounded border flex-shrink-0">
                        {command.agent}
                      </span>
                    )}
                  </div>
                  {command.description && (
                    <div className="typography-meta text-muted-foreground mt-0.5 truncate">
                      {command.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {commands.length === 0 && !loading && (
            <div className="px-3 py-2 typography-ui-label text-muted-foreground">
              No commands found
            </div>
          )}
        </div>
      </ScrollableOverlay>
      <div className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
        ↑↓ navigate • Enter select • Esc close
      </div>
    </div>
  );
});

CommandAutocomplete.displayName = 'CommandAutocomplete';

export type { CommandInfo };
