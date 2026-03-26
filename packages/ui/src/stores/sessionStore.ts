import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import type { Session } from "@opencode-ai/sdk/v2";
import { runtimeClient } from "@/lib/runtime/client";
import { piClient } from "@/lib/pi/client";
import { toUiSession } from "@/lib/pi/ui-mappers";
import { getSafeStorage } from "./utils/safeStorage";
import type { WorktreeMetadata } from "@/types/worktree";
import { getWorktreeStatus } from "@/lib/worktrees/worktreeStatus";
import { removeProjectWorktree } from "@/lib/worktrees/worktreeManager";
import { useDirectoryStore } from "./useDirectoryStore";
import { useProjectsStore } from "./useProjectsStore";
import { triggerSessionStatusPoll } from "@/hooks/useServerSessionStatus";
import { streamDebugEnabled } from "@/stores/utils/streamDebug";

interface SessionState {
    sessions: Session[];
    archivedSessions: Session[];
    sessionsByDirectory: Map<string, Session[]>;
    currentSessionId: string | null;
    lastLoadedDirectory: string | null;
    isLoading: boolean;
    error: string | null;
    webUICreatedSessions: Set<string>;
    worktreeMetadata: Map<string, WorktreeMetadata>;
    availableWorktrees: WorktreeMetadata[];
    availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
}

interface SessionActions {
    loadSessions: () => Promise<void>;
    createSession: (title?: string, directoryOverride?: string | null, parentID?: string | null) => Promise<Session | null>;
    deleteSession: (id: string, options?: { archiveWorktree?: boolean; deleteRemoteBranch?: boolean; deleteLocalBranch?: boolean; remoteName?: string }) => Promise<boolean>;
    deleteSessions: (ids: string[], options?: { archiveWorktree?: boolean; deleteRemoteBranch?: boolean; deleteLocalBranch?: boolean; remoteName?: string; silent?: boolean }) => Promise<{ deletedIds: string[]; failedIds: string[] }>;
    archiveSession: (id: string) => Promise<boolean>;
    archiveSessions: (ids: string[], options?: { silent?: boolean }) => Promise<{ archivedIds: string[]; failedIds: string[] }>;
    updateSessionTitle: (id: string, title: string) => Promise<void>;
    shareSession: (id: string) => Promise<Session | null>;
    unshareSession: (id: string) => Promise<Session | null>;
    setCurrentSession: (id: string | null) => void;
    clearError: () => void;
    getSessionsByDirectory: (directory: string) => Session[];
    getDirectoryForSession: (sessionId: string) => string | null;
    applySessionMetadata: (sessionId: string, metadata: Partial<Session>) => void;
    isOpenChamberCreatedSession: (sessionId: string) => boolean;
    markSessionAsOpenChamberCreated: (sessionId: string) => void;
    initializeNewOpenChamberSession: (sessionId: string, agents: Record<string, unknown>[]) => void;
    setWorktreeMetadata: (sessionId: string, metadata: WorktreeMetadata | null) => void;
    getWorktreeMetadata: (sessionId: string) => WorktreeMetadata | undefined;
    setSessionDirectory: (sessionId: string, directory: string | null) => void;
    updateSession: (session: Session) => void;
    removeSessionFromStore: (sessionId: string) => void;
}

type SessionStore = SessionState & SessionActions;

const safeStorage = getSafeStorage();
const SESSION_SELECTION_STORAGE_KEY = "oc.sessionSelectionByDirectory";
type SessionSelectionMap = Record<string, string>;

const readSessionSelectionMap = (): SessionSelectionMap => {
    try {
        const raw = safeStorage.getItem(SESSION_SELECTION_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        return Object.entries(parsed as Record<string, unknown>).reduce<SessionSelectionMap>((acc, [directory, sessionId]) => {
            if (typeof directory === "string" && typeof sessionId === "string" && directory.length > 0 && sessionId.length > 0) {
                acc[directory] = sessionId;
            }
            return acc;
        }, {});
    } catch {
        return {};
    }
};

let sessionSelectionCache: SessionSelectionMap | null = null;
let loadSessionsRequestSeq = 0;
let loadSessionsInFlight: Promise<void> | null = null;
let loadSessionsQueued = false;
let persistSelectionTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSelectionMap: SessionSelectionMap | null = null;

const getSessionSelectionMap = (): SessionSelectionMap => {
    if (!sessionSelectionCache) {
        sessionSelectionCache = readSessionSelectionMap();
    }
    return sessionSelectionCache;
};

const persistSessionSelectionMap = (map: SessionSelectionMap) => {
    sessionSelectionCache = map;
    pendingSelectionMap = map;
    clearTimeout(persistSelectionTimer);
    persistSelectionTimer = setTimeout(() => {
        try {
            safeStorage.setItem(SESSION_SELECTION_STORAGE_KEY, JSON.stringify(map));
            pendingSelectionMap = null;
        } catch { /* ignored */ }
    }, 300);
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (pendingSelectionMap !== null) {
            clearTimeout(persistSelectionTimer);
            try {
                safeStorage.setItem(SESSION_SELECTION_STORAGE_KEY, JSON.stringify(pendingSelectionMap));
            } catch { /* ignored */ }
            pendingSelectionMap = null;
        }
    });
}

const getStoredSessionForDirectory = (directory: string | null | undefined): string | null => {
    if (!directory) {
        return null;
    }
    const map = getSessionSelectionMap();
    const selection = map[directory];
    return typeof selection === "string" ? selection : null;
};

const storeSessionForDirectory = (directory: string | null | undefined, sessionId: string | null) => {
    if (!directory) {
        return;
    }
    const map = { ...getSessionSelectionMap() };
    if (sessionId) {
        map[directory] = sessionId;
    } else {
        delete map[directory];
    }
    persistSessionSelectionMap(map);
};

const archiveSessionWorktree = async (
    metadata: WorktreeMetadata,
    options?: { deleteRemoteBranch?: boolean; deleteLocalBranch?: boolean; remoteName?: string }
) => {
    const status = metadata.status ?? (await getWorktreeStatus(metadata.path).catch(() => undefined));

    const projects = useProjectsStore.getState().projects;
    const normalizedProject = normalizePath(metadata.projectDirectory) ?? metadata.projectDirectory;
    const projectEntry = projects.find((project) => normalizePath(project.path) === normalizedProject);

    const projectRef = {
        id: projectEntry?.id ?? `path:${normalizedProject}`,
        path: normalizedProject,
    };

    await removeProjectWorktree(
        projectRef,
        status ? ({ ...metadata, status } as WorktreeMetadata) : metadata,
        {
            deleteRemoteBranch: options?.deleteRemoteBranch,
            deleteLocalBranch: options?.deleteLocalBranch,
            remoteName: options?.remoteName,
        }
    );
};

const deleteSessionOnServer = async (_sessionId: string, _directory?: string | null): Promise<boolean> => {
    void _sessionId;
    void _directory;
    throw new Error('Pi runtime does not support deleting sessions yet.');
};

const setSessionArchivedOnServer = async (
    _sessionId: string,
    _archivedAt: number,
    _directory?: string | null,
): Promise<Session | null> => {
    void _sessionId;
    void _archivedAt;
    void _directory;
    throw new Error('Pi runtime does not support archiving sessions yet.');
};

const normalizePath = (value?: string | null): string | null => {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const replaced = trimmed.replace(/\\/g, "/");
    if (replaced === "/") {
        return "/";
    }
    return replaced.length > 1 ? replaced.replace(/\/+$/, "") : replaced;
};

const readVSCodeWorkspaceDirectory = (): string | null => {
    if (typeof window === "undefined") {
        return null;
    }
    const config = (window as unknown as { __VSCODE_CONFIG__?: { workspaceFolder?: unknown } }).__VSCODE_CONFIG__;
    const workspaceFolder = typeof config?.workspaceFolder === "string" ? config.workspaceFolder : null;
    return normalizePath(workspaceFolder);
};

const isVSCodeRuntime = (): boolean => {
    if (typeof window === "undefined") return false;
    const runtime = (window as unknown as { __OPENCHAMBER_RUNTIME_APIS__?: { runtime?: { isVSCode?: boolean } } })
        .__OPENCHAMBER_RUNTIME_APIS__?.runtime;
    return Boolean(runtime?.isVSCode);
};

const vscodeDebugLog = (...args: unknown[]) => {
    if (!streamDebugEnabled()) return;
    if (!isVSCodeRuntime()) return;
    console.log("[OpenChamber][VSCode][sessions]", ...args);
};

const dedupeSessionsById = (sessions: Session[]): Session[] => {
    const map = new Map<string, Session>();

    sessions.forEach((session) => {
        if (!session || typeof session.id !== "string" || session.id.length === 0) {
            return;
        }

        const existing = map.get(session.id);
        if (!existing) {
            map.set(session.id, session);
            return;
        }

        const existingUpdated = (existing as { time?: { updated?: number | null } }).time?.updated ?? 0;
        const candidateUpdated = (session as { time?: { updated?: number | null } }).time?.updated ?? 0;
        if (candidateUpdated > existingUpdated) {
            map.set(session.id, session);
        }
    });

    return Array.from(map.values());
};

const buildSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
    const map = new Map<string, Session[]>();

    sessions.forEach((session) => {
        const directory = normalizePath((session as { directory?: string | null }).directory ?? null);
        if (!directory) {
            return;
        }

        const existing = map.get(directory);
        if (existing) {
            existing.push(session);
        } else {
            map.set(directory, [session]);
        }
    });

    for (const [key, value] of map.entries()) {
        map.set(key, dedupeSessionsById(value));
    }

    return map;
};

const getSessionDirectory = (sessions: Session[], sessionId: string): string | null => {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) {
        return null;
    }
    return normalizePath((target as { directory?: string | null }).directory ?? null);
};

export const useSessionStore = create<SessionStore>()(
    devtools(
        persist(
            (set, get) => ({

                sessions: [],
                archivedSessions: [],
                sessionsByDirectory: new Map(),
                currentSessionId: null,
                lastLoadedDirectory: null,
                isLoading: false,
                error: null,
                webUICreatedSessions: new Set(),
                worktreeMetadata: new Map(),
                availableWorktrees: [],
                availableWorktreesByProject: new Map(),

                loadSessions: async () => {
                    if (loadSessionsInFlight) {
                        loadSessionsQueued = true;
                        return loadSessionsInFlight;
                    }

                    const task = (async () => {
                        const requestSeq = ++loadSessionsRequestSeq;
                        const isLatestRequest = () => requestSeq === loadSessionsRequestSeq;
                        set({ isLoading: true, error: null });

                        try {
                            const directoryStore = useDirectoryStore.getState();
                            const projectsStore = useProjectsStore.getState();
                            const vscodeWorkspaceDirectory = readVSCodeWorkspaceDirectory();
                            const activeProject = projectsStore.projects.find((project) => project.id === projectsStore.activeProjectId) ?? null;
                            const activeProjectRoot = normalizePath(activeProject?.path ?? null);
                            const activeDirectory = normalizePath(vscodeWorkspaceDirectory ?? directoryStore.currentDirectory ?? runtimeClient.getDirectory() ?? activeProjectRoot);

                            const snapshots = await piClient.listSessions();
                            if (!isLatestRequest()) {
                                return;
                            }

                            const sessions = dedupeSessionsById(snapshots.map((session) => toUiSession(session)));
                            const sessionsByDirectory = buildSessionsByDirectory(sessions);
                            const validSessionIds = new Set(sessions.map((session) => session.id));
                            const stateSnapshot = get();

                            let nextCurrentId = stateSnapshot.currentSessionId;
                            if (!nextCurrentId || !validSessionIds.has(nextCurrentId)) {
                                const storedSelection = activeDirectory ? getStoredSessionForDirectory(activeDirectory) : null;
                                nextCurrentId = storedSelection && validSessionIds.has(storedSelection)
                                    ? storedSelection
                                    : sessions[0]?.id ?? null;
                            }

                            const resolvedDirectoryForCurrent = nextCurrentId
                                ? getSessionDirectory(sessions, nextCurrentId)
                                : activeDirectory;

                            try {
                                runtimeClient.setDirectory(resolvedDirectoryForCurrent ?? activeDirectory ?? undefined);
                            } catch (error) {
                                console.warn('Failed to sync Pi directory after session load:', error);
                            }

                            set({
                                sessions,
                                archivedSessions: [],
                                sessionsByDirectory,
                                currentSessionId: nextCurrentId,
                                lastLoadedDirectory: activeDirectory ?? null,
                                isLoading: false,
                                error: null,
                                worktreeMetadata: new Map(),
                                availableWorktrees: [],
                                availableWorktreesByProject: new Map(),
                            });

                            if (activeDirectory) {
                                storeSessionForDirectory(activeDirectory, nextCurrentId);
                            }
                            if (resolvedDirectoryForCurrent && resolvedDirectoryForCurrent !== activeDirectory) {
                                storeSessionForDirectory(resolvedDirectoryForCurrent, nextCurrentId);
                            }
                        } catch (error) {
                            if (!isLatestRequest()) {
                                return;
                            }
                            set({
                                error: error instanceof Error ? error.message : 'Failed to load Pi sessions',
                                isLoading: false,
                            });
                        }
                    })();

                    loadSessionsInFlight = task;
                    try {
                        await task;
                    } finally {
                        if (loadSessionsInFlight === task) {
                            loadSessionsInFlight = null;
                        }
                        if (loadSessionsQueued) {
                            loadSessionsQueued = false;
                            await get().loadSessions();
                        }
                    }
                },

                createSession: async (title?: string, directoryOverride?: string | null, parentID?: string | null) => {
                    set({ error: null });
                    const directoryStore = useDirectoryStore.getState();
                    const fallbackDirectory = normalizePath(directoryStore.currentDirectory);
                    const vscodeWorkspaceDirectory = readVSCodeWorkspaceDirectory();
                    const targetDirectory = vscodeWorkspaceDirectory ?? normalizePath(directoryOverride ?? runtimeClient.getDirectory() ?? fallbackDirectory);
                    vscodeDebugLog("createSession:start", { title, parentID, targetDirectory, vscodeWorkspaceDirectory });

                    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                    const previousState = get();
                    const optimisticSession: Session = {
                        id: tempId,
                        title: title || "New session",
                        parentID: parentID ?? undefined,
                        directory: targetDirectory ?? null,
                        projectID: (previousState.sessions[0] as { projectID?: string })?.projectID ?? "",
                        version: "0.0.0",
                        time: {
                            created: Date.now(),
                            updated: Date.now(),
                        },
                        summary: undefined,
                        share: undefined,
                    } as Session;

                    set((state) => {
                        const nextSessions = [optimisticSession, ...state.sessions];
                        const nextByDirectory = new Map(state.sessionsByDirectory);
                        if (targetDirectory) {
                            const existing = nextByDirectory.get(targetDirectory) ?? [];
                            nextByDirectory.set(targetDirectory, dedupeSessionsById([optimisticSession, ...existing]));
                        }

                        return {
                            sessions: nextSessions,
                            sessionsByDirectory: nextByDirectory,
                            currentSessionId: tempId,
                            webUICreatedSessions: new Set([...state.webUICreatedSessions, tempId]),
                            isLoading: false,
                        };
                    });

                    if (targetDirectory) {
                        try {
                            runtimeClient.setDirectory(targetDirectory);
                        } catch (error) {
                            console.warn("Failed to sync OpenCode directory after session creation:", error);
                        }
                    }

                    const replaceOptimistic = (real: Session) => {
                        const normalizedTarget = targetDirectory ?? null;
                        const normalizedReal: Session = (normalizedTarget
                            ? ({ ...real, directory: normalizedTarget } as Session)
                            : real);
                        set((state) => {
                            const updatedSessions = state.sessions.map((item) => (item.id === tempId ? normalizedReal : item));

                            const nextByDirectory = new Map(state.sessionsByDirectory);
                            if (targetDirectory) {
                                const existing = nextByDirectory.get(targetDirectory) ?? [];
                                const replaced = existing.map((item) => (item.id === tempId ? normalizedReal : item));
                                nextByDirectory.set(targetDirectory, dedupeSessionsById(replaced));
                            }

                            return {
                                sessions: updatedSessions,
                                sessionsByDirectory: buildSessionsByDirectory(updatedSessions),
                                currentSessionId: normalizedReal.id,
                                webUICreatedSessions: new Set([
                                    ...Array.from(state.webUICreatedSessions).filter((id) => id !== tempId),
                                    normalizedReal.id,
                                ]),
                            };
                        });
                        storeSessionForDirectory(targetDirectory ?? null, normalizedReal.id);
                    };

                    try {
                        const createRequest = () => runtimeClient.createSession({ title, parentID: parentID ?? undefined });
                        const session = targetDirectory
                            ? await runtimeClient.withDirectory(targetDirectory, createRequest)
                            : await createRequest();

                        replaceOptimistic(session);
                        return session;
                    } catch (error) {

                        set((state) => ({
                            sessions: state.sessions.filter((s) => s.id !== tempId),
                            currentSessionId: previousState.currentSessionId,
                            webUICreatedSessions: new Set(
                                Array.from(state.webUICreatedSessions).filter((id) => id !== tempId)
                            ),
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Failed to create session",
                        }));
                        return null;
                    }
                },

                deleteSession: async (id: string, options) => {
                    set({ isLoading: true, error: null });
                    const metadata = get().worktreeMetadata.get(id);
                    const metadataPath = typeof metadata?.path === 'string' ? metadata.path : null;
                    const metadataProjectDirectory = typeof metadata?.projectDirectory === 'string' ? metadata.projectDirectory : null;
                    const snapshot = get();
                    const sessionDirectory = getSessionDirectory([...snapshot.sessions, ...snapshot.archivedSessions], id);
                    const requestDirectory = normalizePath(metadataProjectDirectory)
                        ?? normalizePath(sessionDirectory)
                        ?? normalizePath(runtimeClient.getDirectory() ?? null)
                        ?? null;

                    let archiveSucceeded = false;
                    try {
                        const success = await deleteSessionOnServer(id, requestDirectory);
                        if (!success) {
                            set({
                                isLoading: false,
                                error: "Failed to delete session",
                            });
                            return false;
                        }

                        if (metadata && options?.archiveWorktree) {
                            try {
                                await archiveSessionWorktree(metadata, {
                                    deleteRemoteBranch: options?.deleteRemoteBranch,
                                    deleteLocalBranch: options?.deleteLocalBranch,
                                    remoteName: options?.remoteName,
                                });
                                archiveSucceeded = true;
                            } catch (error) {
                                const message = error instanceof Error ? error.message : "Failed to delete worktree";
                                set({ error: message });
                            }
                        }

                        let nextCurrentId: string | null = null;
                        set((state) => {
                            const filteredSessions = state.sessions.filter((s) => s.id !== id);
                            const filteredArchivedSessions = state.archivedSessions.filter((s) => s.id !== id);
                            nextCurrentId = state.currentSessionId === id ? null : state.currentSessionId;
                            const nextMetadata = new Map(state.worktreeMetadata);
                            nextMetadata.delete(id);
                            const shouldRemoveWorktreeFromLists = Boolean(metadataPath && options?.archiveWorktree && archiveSucceeded);
                            const nextAvailableWorktrees = shouldRemoveWorktreeFromLists
                                ? state.availableWorktrees.filter((entry) => normalizePath(entry.path) !== normalizePath(metadataPath))
                                : state.availableWorktrees;
                            const nextAvailableWorktreesByProject = new Map(state.availableWorktreesByProject);
                            if (shouldRemoveWorktreeFromLists && metadataProjectDirectory) {
                                const projectKey = normalizePath(metadataProjectDirectory) ?? metadataProjectDirectory;
                                const projectWorktrees = nextAvailableWorktreesByProject.get(projectKey) ?? [];
                                nextAvailableWorktreesByProject.set(
                                    projectKey,
                                    projectWorktrees.filter((entry) => normalizePath(entry.path) !== normalizePath(metadataPath))
                                );
                            }
                            return {
                                sessions: filteredSessions,
                                archivedSessions: filteredArchivedSessions,
                                sessionsByDirectory: buildSessionsByDirectory(filteredSessions),
                                currentSessionId: nextCurrentId,
                                isLoading: false,
                                worktreeMetadata: nextMetadata,
                                availableWorktrees: nextAvailableWorktrees,
                                availableWorktreesByProject: nextAvailableWorktreesByProject,
                            };
                        });

                        const directoryToStore = normalizePath(sessionDirectory)
                            ?? normalizePath(runtimeClient.getDirectory() ?? null)
                            ?? null;
                        storeSessionForDirectory(directoryToStore, nextCurrentId);

                        return true;
                    } catch (error) {
                        const message = error instanceof Error ? error.message : "Failed to delete session";
                        set({
                            error: message,
                            isLoading: false,
                        });
                        return false;
                    }
                },

                deleteSessions: async (
                    ids: string[],
                    options?: { archiveWorktree?: boolean; deleteRemoteBranch?: boolean; deleteLocalBranch?: boolean; remoteName?: string; silent?: boolean }
                ) => {
                    const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));
                    if (uniqueIds.length === 0) {
                        return { deletedIds: [], failedIds: [] };
                    }

                    const silent = options?.silent === true;
                    if (!silent) {
                        set({ isLoading: true, error: null });
                    }
                    const deletedIds: string[] = [];
                    const failedIds: string[] = [];
                    const worktreesToArchive = new Map<string, WorktreeMetadata>();
                    const archivedWorktreePaths = new Set<string>();

                    for (const id of uniqueIds) {
                        try {
                            const metadata = get().worktreeMetadata.get(id);
                            const sessionDirectory = getSessionDirectory([...get().sessions, ...get().archivedSessions], id);
                            const requestDirectory = normalizePath(metadata?.projectDirectory ?? null)
                                ?? normalizePath(sessionDirectory)
                                ?? normalizePath(runtimeClient.getDirectory() ?? null)
                                ?? null;

                            if (metadata && options?.archiveWorktree) {
                                const key = normalizePath(metadata.path) ?? metadata.path;
                                if (!archivedWorktreePaths.has(key)) {
                                    archivedWorktreePaths.add(key);
                                    worktreesToArchive.set(key, metadata);
                                }
                            }

                            const success = await deleteSessionOnServer(id, requestDirectory);
                            if (success) {
                                deletedIds.push(id);
                            } else {
                                failedIds.push(id);
                            }
                        } catch {
                            failedIds.push(id);
                        }
                    }

                    const archivedWorktrees: Array<{ path: string; projectDirectory: string }> = [];
                    const archiveFailures: string[] = [];

                    if (options?.archiveWorktree && worktreesToArchive.size > 0) {
                        for (const metadata of worktreesToArchive.values()) {
                            try {
                                await archiveSessionWorktree(metadata, {
                                    deleteRemoteBranch: options?.deleteRemoteBranch,
                                    deleteLocalBranch: options?.deleteLocalBranch,
                                    remoteName: options?.remoteName,
                                });
                                archivedWorktrees.push({ path: metadata.path, projectDirectory: metadata.projectDirectory });
                            } catch (error) {
                                const message = error instanceof Error ? error.message : "Failed to delete worktree";
                                archiveFailures.push(message);
                            }
                        }
                    }

                    if (archiveFailures.length > 0) {
                        set({ error: archiveFailures[0] });
                    }

                    const directoryStore = useDirectoryStore.getState();
                    archivedWorktrees.forEach(({ path, projectDirectory }) => {
                        if (directoryStore.currentDirectory === path) {
                            directoryStore.setDirectory(projectDirectory, { showOverlay: false });
                        }
                    });

                    const deletedSet = new Set(deletedIds);
                    const errorMessage = failedIds.length > 0
                        ? (failedIds.length === uniqueIds.length ? "Failed to delete sessions" : "Failed to delete some sessions")
                        : null;
                    let nextCurrentId: string | null = null;

                    set((state) => {
                        const filteredSessions = state.sessions.filter((session) => !deletedSet.has(session.id));
                        const filteredArchivedSessions = state.archivedSessions.filter((session) => !deletedSet.has(session.id));
                        if (state.currentSessionId && deletedSet.has(state.currentSessionId)) {
                            nextCurrentId = null;
                        } else {
                            nextCurrentId = state.currentSessionId;
                        }

                        const nextMetadata = new Map(state.worktreeMetadata);
                        for (const removedId of deletedSet) {
                            nextMetadata.delete(removedId);
                        }

                        const removedPaths = new Set(
                            archivedWorktrees
                                .map((entry) => normalizePath(entry.path))
                                .filter((p): p is string => Boolean(p))
                        );
                        const nextAvailableWorktrees = removedPaths.size > 0
                            ? state.availableWorktrees.filter((entry) => !removedPaths.has(normalizePath(entry.path) ?? entry.path))
                            : state.availableWorktrees;

                        const nextAvailableWorktreesByProject = new Map(state.availableWorktreesByProject);
                        if (archivedWorktrees.length > 0) {
                            const removedPathsByProject = archivedWorktrees.reduce<Map<string, Set<string>>>((accumulator, entry) => {
                                const projectKey = normalizePath(entry.projectDirectory) ?? entry.projectDirectory;
                                const pathKey = normalizePath(entry.path) ?? entry.path;
                                if (!accumulator.has(projectKey)) {
                                    accumulator.set(projectKey, new Set());
                                }
                                accumulator.get(projectKey)?.add(pathKey);
                                return accumulator;
                            }, new Map());

                            removedPathsByProject.forEach((paths, projectKey) => {
                                const projectWorktrees = nextAvailableWorktreesByProject.get(projectKey) ?? [];
                                const filtered = projectWorktrees.filter(
                                    (entry) => !paths.has(normalizePath(entry.path) ?? entry.path)
                                );
                                nextAvailableWorktreesByProject.set(projectKey, filtered);
                            });
                        }

                        return {
                            sessions: filteredSessions,
                            archivedSessions: filteredArchivedSessions,
                            sessionsByDirectory: buildSessionsByDirectory(filteredSessions),
                            currentSessionId: nextCurrentId,
                            ...(silent ? {} : { isLoading: false, error: errorMessage }),
                            worktreeMetadata: nextMetadata,
                            availableWorktrees: nextAvailableWorktrees,
                            availableWorktreesByProject: nextAvailableWorktreesByProject,
                        };
                    });

                    const directory = runtimeClient.getDirectory() ?? null;
                    storeSessionForDirectory(directory, nextCurrentId);

                    return { deletedIds, failedIds };
                },

                archiveSession: async (id: string) => {
                    const { archivedIds, failedIds } = await get().archiveSessions([id]);
                    return archivedIds.length === 1 && failedIds.length === 0;
                },

                archiveSessions: async (ids: string[], options?: { silent?: boolean }) => {
                    const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));
                    if (uniqueIds.length === 0) {
                        return { archivedIds: [], failedIds: [] };
                    }

                    const silent = options?.silent === true;
                    if (!silent) {
                        set({ isLoading: true, error: null });
                    }

                    const archivedIds: string[] = [];
                    const failedIds: string[] = [];

                    for (const id of uniqueIds) {
                        try {
                            const metadata = get().worktreeMetadata.get(id);
                            const sessionDirectory = getSessionDirectory([...get().sessions, ...get().archivedSessions], id);
                            const requestDirectory = normalizePath(metadata?.projectDirectory ?? null)
                                ?? normalizePath(sessionDirectory)
                                ?? normalizePath(runtimeClient.getDirectory() ?? null)
                                ?? null;
                            const archived = await setSessionArchivedOnServer(id, Date.now(), requestDirectory);
                            if (!archived) {
                                failedIds.push(id);
                                continue;
                            }
                            archivedIds.push(id);
                        } catch {
                            failedIds.push(id);
                        }
                    }

                    const archivedSet = new Set(archivedIds);
                    let nextCurrentId: string | null = null;
                    const errorMessage = failedIds.length > 0
                        ? (failedIds.length === uniqueIds.length ? "Failed to archive sessions" : "Failed to archive some sessions")
                        : null;

                    set((state) => {
                        if (archivedSet.size === 0) {
                            return silent ? state : { ...state, isLoading: false, error: errorMessage };
                        }

                        const archivedRows = state.sessions.filter((session) => archivedSet.has(session.id)).map((session) => ({
                            ...session,
                            time: {
                                ...session.time,
                                archived: Date.now(),
                            },
                        } as Session));

                        const remaining = state.sessions.filter((session) => !archivedSet.has(session.id));
                        const nextArchivedSessions = dedupeSessionsById([...archivedRows, ...state.archivedSessions]);

                        if (state.currentSessionId && archivedSet.has(state.currentSessionId)) {
                            nextCurrentId = remaining[0]?.id ?? null;
                        } else {
                            nextCurrentId = state.currentSessionId;
                        }

                        return {
                            sessions: remaining,
                            archivedSessions: nextArchivedSessions,
                            sessionsByDirectory: buildSessionsByDirectory(remaining),
                            currentSessionId: nextCurrentId,
                            ...(silent ? {} : { isLoading: false, error: errorMessage }),
                        };
                    });

                    if (!silent && archivedSet.size === 0) {
                        set({ isLoading: false, error: errorMessage });
                    }

                    return { archivedIds, failedIds };
                },

                updateSessionTitle: async (id: string, title: string) => {
                    try {
                        const sessionDirectory = getSessionDirectory(get().sessions, id);
                        const metadata = get().worktreeMetadata.get(id);
                        const updateRequest = () => runtimeClient.updateSession(id, title);
                        const overrideDirectory = metadata?.path ?? sessionDirectory;
                        const updatedSession = overrideDirectory
                            ? await runtimeClient.withDirectory(overrideDirectory, updateRequest)
                            : await updateRequest();
                        set((state) => {
                            const sessions = state.sessions.map((s) => (s.id === id ? updatedSession : s));
                            return { sessions, sessionsByDirectory: buildSessionsByDirectory(sessions) };
                        });
                    } catch (error) {
                        set({
                            error: error instanceof Error ? error.message : "Failed to update session title",
                        });
                    }
                },

                shareSession: async (_id: string) => {
                    void _id;
                    set({ error: 'Pi runtime does not support session sharing yet.' });
                    return null;
                },

                unshareSession: async (_id: string) => {
                    void _id;
                    set({ error: 'Pi runtime does not support session sharing yet.' });
                    return null;
                },

                setCurrentSession: (id: string | null) => {
                    const prevSessionId = get().currentSessionId;
                    set({ currentSessionId: id, error: null });

                    // Notify server of view state changes
                    // This enables server-side needs_attention tracking
                    if (prevSessionId && prevSessionId !== id) {
                        // Leaving previous session
                        fetch(`/api/sessions/${prevSessionId}/unview`, { method: 'POST' })
                            .catch(() => { /* ignore */ });
                    }
                    if (id) {
                        // Entering new session
                        fetch(`/api/sessions/${id}/view`, { method: 'POST' })
                            .catch(() => { /* ignore */ });
                    }

                    // Trigger immediate poll to get latest attention states
                    // This prevents stale state when switching sessions
                    triggerSessionStatusPoll();

                    const directory = runtimeClient.getDirectory() ?? null;
                    storeSessionForDirectory(directory, id);
                },

                clearError: () => {
                    set({ error: null });
                },

                getSessionsByDirectory: (directory: string) => {
                    const normalized = normalizePath(directory) ?? directory;
                    const { sessionsByDirectory, sessions } = get();

                    const direct = sessionsByDirectory.get(normalized);
                    if (direct) {
                        return direct;
                    }

                    return sessions.filter((session) => {
                        const dir = normalizePath((session as { directory?: string | null }).directory ?? null);
                        return (dir ?? normalized) === normalized;
                    });
                },

                getDirectoryForSession: (sessionId: string) => {
                    if (!sessionId) {
                        return null;
                    }

                    const metadata = get().worktreeMetadata.get(sessionId);
                    if (metadata?.path) {
                        return normalizePath(metadata.path) ?? metadata.path;
                    }

                    const entry = get().sessions.find((session) => session.id === sessionId) as { directory?: string | null } | undefined;
                    const directory = normalizePath(entry?.directory ?? null);
                    return directory;
                },

                applySessionMetadata: (sessionId, metadata) => {
                    if (!sessionId || !metadata) {
                        return;
                    }

                    set((state) => {
                        const index = state.sessions.findIndex((session) => session.id === sessionId);
                        if (index === -1) {
                            return state;
                        }

                        const existingSession = state.sessions[index];
                        const mergedTime = metadata.time
                            ? { ...existingSession.time, ...metadata.time }
                            : existingSession.time;
                        const mergedSummary =
                            metadata.summary === undefined
                                ? existingSession.summary
                                : metadata.summary || undefined;
                        const mergedShare =
                            metadata.share === undefined
                                ? existingSession.share
                                : metadata.share || undefined;

                        const mergedSession: Session = {
                            ...existingSession,
                            ...metadata,
                            time: mergedTime,
                            summary: mergedSummary,
                            share: mergedShare,
                        };

                        const hasChanged =
                            mergedSession.title !== existingSession.title ||
                            mergedSession.parentID !== existingSession.parentID ||
                            mergedSession.directory !== existingSession.directory ||
                            mergedSession.version !== existingSession.version ||
                            mergedSession.projectID !== existingSession.projectID ||
                            (mergedTime !== existingSession.time && JSON.stringify(mergedTime) !== JSON.stringify(existingSession.time)) ||
                            (mergedSummary !== existingSession.summary && JSON.stringify(mergedSummary ?? null) !== JSON.stringify(existingSession.summary ?? null)) ||
                            (mergedShare !== existingSession.share && JSON.stringify(mergedShare ?? null) !== JSON.stringify(existingSession.share ?? null));

                        const sessions = [...state.sessions];
                        sessions[index] = hasChanged ? mergedSession : existingSession;

                        return {
                            sessions,
                            sessionsByDirectory: buildSessionsByDirectory(sessions),
                        };
                    });
                },

                isOpenChamberCreatedSession: (sessionId: string) => {
                    const { webUICreatedSessions } = get();
                    return webUICreatedSessions.has(sessionId);
                },

                markSessionAsOpenChamberCreated: (sessionId: string) => {
                    set((state) => {
                        const newOpenChamberCreatedSessions = new Set(state.webUICreatedSessions);
                        newOpenChamberCreatedSessions.add(sessionId);
                        return {
                            webUICreatedSessions: newOpenChamberCreatedSessions,
                        };
                    });
                },

                initializeNewOpenChamberSession: (sessionId: string) => {
                    const { markSessionAsOpenChamberCreated } = get();

                    markSessionAsOpenChamberCreated(sessionId);

                },

                setWorktreeMetadata: (sessionId: string, metadata: WorktreeMetadata | null) => {
                    if (!sessionId) {
                        return;
                    }
                    set((state) => {
                        const next = new Map(state.worktreeMetadata);
                        if (metadata) {
                            next.set(sessionId, metadata);
                        } else {
                            next.delete(sessionId);
                        }
                        return { worktreeMetadata: next };
                    });
                },

                getWorktreeMetadata: (sessionId: string) => {
                    if (!sessionId) {
                        return undefined;
                    }
                    return get().worktreeMetadata.get(sessionId);
                },

                setSessionDirectory: (sessionId: string, directory: string | null) => {
                    if (!sessionId) {
                        return;
                    }

                    const currentSessions = get().sessions;
                    const targetIndex = currentSessions.findIndex((session) => session.id === sessionId);
                    if (targetIndex === -1) {
                        return;
                    }

                    const existingSession = currentSessions[targetIndex];
                    const previousDirectory = existingSession.directory ?? null;
                    const normalizedDirectory = directory ?? undefined;

                    if (previousDirectory === (normalizedDirectory ?? null)) {
                        return;
                    }

                    set((state) => {
                        const sessions = [...state.sessions];
                        const updatedSession = { ...sessions[targetIndex] } as Record<string, unknown>;
                        if (normalizedDirectory !== undefined) {
                            updatedSession.directory = normalizedDirectory;
                        } else {
                            delete updatedSession.directory;
                        }
                        sessions[targetIndex] = updatedSession as Session;
                        return { sessions, sessionsByDirectory: buildSessionsByDirectory(sessions) };
                    });

                    if (previousDirectory) {
                        storeSessionForDirectory(previousDirectory, null);
                    }
                    if (directory) {
                        storeSessionForDirectory(directory, sessionId);
                    }

                },

                updateSession: (session: Session) => {
                    set((state) => {
                        const index = state.sessions.findIndex((s) => s.id === session.id);
                        const archivedIndex = state.archivedSessions.findIndex((s) => s.id === session.id);
                        const isArchived = Boolean(session.time?.archived);

                        const nextSessions = index === -1
                            ? (isArchived ? state.sessions : [session, ...state.sessions])
                            : state.sessions.map((s) => (s.id === session.id ? session : s));

                        const nextArchivedSessions = archivedIndex === -1
                            ? (isArchived ? [session, ...state.archivedSessions] : state.archivedSessions)
                            : state.archivedSessions.map((s) => (s.id === session.id ? session : s));

                        const deduped = dedupeSessionsById(nextSessions.filter((item) => !item.time?.archived));
                        const dedupedArchived = dedupeSessionsById(nextArchivedSessions.filter((item) => Boolean(item.time?.archived)));

                        return {
                            sessions: deduped,
                            archivedSessions: dedupedArchived,
                            sessionsByDirectory: buildSessionsByDirectory(deduped),
                        };
                    });
                },

                removeSessionFromStore: (sessionId: string) => {
                    if (!sessionId) {
                        return;
                    }

                    set((state) => {
                        const target = [...state.sessions, ...state.archivedSessions]
                            .find((session) => session.id === sessionId) as { directory?: string | null } | undefined;
                        const directory = normalizePath(target?.directory ?? null);

                        const filteredSessions = state.sessions.filter((session) => session.id !== sessionId);
                        const filteredArchivedSessions = state.archivedSessions.filter((session) => session.id !== sessionId);
                        if (filteredSessions.length === state.sessions.length && filteredArchivedSessions.length === state.archivedSessions.length) {
                            return state;
                        }

                        const nextMetadata = new Map(state.worktreeMetadata);
                        nextMetadata.delete(sessionId);

                        const nextCurrentId = state.currentSessionId === sessionId ? null : state.currentSessionId;

                        if (directory) {
                            storeSessionForDirectory(directory, null);
                        }

                        return {
                            sessions: filteredSessions,
                            archivedSessions: filteredArchivedSessions,
                            sessionsByDirectory: buildSessionsByDirectory(filteredSessions),
                            currentSessionId: nextCurrentId,
                            worktreeMetadata: nextMetadata,
                        };
                    });
                },
            }),
            {
                name: "session-store",
                storage: createJSONStorage(() => getSafeStorage()),
    partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        sessions: state.sessions,
        archivedSessions: state.archivedSessions,
        lastLoadedDirectory: state.lastLoadedDirectory,
        webUICreatedSessions: Array.from(state.webUICreatedSessions),
        worktreeMetadata: Array.from(state.worktreeMetadata.entries()),
        availableWorktrees: state.availableWorktrees,
        availableWorktreesByProject: Array.from(state.availableWorktreesByProject.entries()),
    }),
    merge: (persistedState, currentState) => {
        const isRecord = (value: unknown): value is Record<string, unknown> =>
            typeof value === "object" && value !== null;

        if (!isRecord(persistedState)) {
            return currentState;
        }

        const persistedSessions = Array.isArray(persistedState.sessions)
            ? (persistedState.sessions as Session[])
            : currentState.sessions;
        const persistedArchivedSessions = Array.isArray(persistedState.archivedSessions)
            ? (persistedState.archivedSessions as Session[])
            : currentState.archivedSessions;

        const persistedCurrentSessionId =
            typeof persistedState.currentSessionId === "string" || persistedState.currentSessionId === null
                ? (persistedState.currentSessionId as string | null)
                : currentState.currentSessionId;

        const webUiSessionsArray = Array.isArray(persistedState.webUICreatedSessions)
            ? (persistedState.webUICreatedSessions as string[])
            : [];

        const persistedWorktreeEntries = Array.isArray(persistedState.worktreeMetadata)
            ? (persistedState.worktreeMetadata as Array<[string, WorktreeMetadata]>)
            : [];

        const persistedAvailableWorktrees = Array.isArray(persistedState.availableWorktrees)
            ? (persistedState.availableWorktrees as WorktreeMetadata[])
            : currentState.availableWorktrees;

        const persistedWorktreesByProjectEntries = Array.isArray(persistedState.availableWorktreesByProject)
            ? (persistedState.availableWorktreesByProject as Array<[string, WorktreeMetadata[]]>)
            : [];
        const persistedWorktreesByProject = new Map(persistedWorktreesByProjectEntries);

        const lastLoadedDirectory =
            typeof persistedState.lastLoadedDirectory === "string"
                ? persistedState.lastLoadedDirectory
                : currentState.lastLoadedDirectory ?? null;

        const mergedSessions = dedupeSessionsById(persistedSessions);
        const mergedArchivedSessions = dedupeSessionsById(persistedArchivedSessions);

        const mergedResult = {
            ...currentState,
            ...persistedState,
            sessions: mergedSessions,
            archivedSessions: mergedArchivedSessions,
            sessionsByDirectory: buildSessionsByDirectory(mergedSessions),
            currentSessionId: persistedCurrentSessionId,
            webUICreatedSessions: new Set(webUiSessionsArray),
            worktreeMetadata: new Map(persistedWorktreeEntries),
            availableWorktrees: persistedAvailableWorktrees,
            availableWorktreesByProject: persistedWorktreesByProject.size > 0
                ? persistedWorktreesByProject
                : currentState.availableWorktreesByProject,
            lastLoadedDirectory,
        };
        return mergedResult;
    },
            }
        ),
        {
            name: "session-store",
        }
    )
);
