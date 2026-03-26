import type { FilesAPI, RuntimeAPIs } from './api/types';

export const PROJECT_TODO_TEXT_MAX_LENGTH = 240;

export type ProjectTodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ProjectTodoDocument = {
  version: 1;
  items: ProjectTodoItem[];
};

export type ProjectTodoLoadResult =
  | { status: 'ok'; path: string; data: ProjectTodoDocument }
  | { status: 'missing'; path: string; data: ProjectTodoDocument }
  | { status: 'invalid'; path: string; message: string }
  | { status: 'error'; path: string; message: string };

export type ProjectTodoSaveResult =
  | { ok: true; path: string }
  | { ok: false; path: string; message: string };

const TODO_DIRECTORY_NAME = '.work';
const TODO_FILENAME = 'todo.json';
const EMPTY_PROJECT_TODO_DOCUMENT: ProjectTodoDocument = { version: 1, items: [] };

const normalizePath = (value: string): string => {
  if (!value) return '';

  const raw = value.replace(/\\/g, '/');
  const hadUncPrefix = raw.startsWith('//');
  let normalized = raw.replace(/\/+$/g, '');
  normalized = normalized.replace(/\/+/g, '/');

  if (hadUncPrefix && !normalized.startsWith('//')) {
    normalized = `/${normalized}`;
  }

  if (normalized === '') {
    return raw.startsWith('/') ? '/' : '';
  }

  return normalized;
};

const joinPath = (base: string, segment: string): string => {
  const normalizedBase = normalizePath(base);
  const cleanSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');

  if (!normalizedBase || normalizedBase === '/') {
    return `/${cleanSegment}`;
  }

  return `${normalizedBase}/${cleanSegment}`;
};

const getRuntimeFilesAPI = (): FilesAPI | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  return apis?.files ?? null;
};

const getBaseUrl = (): string => {
  const defaultBaseUrl = import.meta.env.VITE_OPENCODE_URL || '/api';
  return defaultBaseUrl.startsWith('/') ? defaultBaseUrl : '/api';
};

const getProjectTodoDirectory = (directory: string): string => joinPath(directory, TODO_DIRECTORY_NAME);

export const getProjectTodoPath = (directory: string): string => {
  return joinPath(getProjectTodoDirectory(directory), TODO_FILENAME);
};

const isMissingFileError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /enoent|not found|does not exist/i.test(message);
};

const readTextFile = async (path: string): Promise<{ status: 'ok'; content: string } | { status: 'missing' } | { status: 'error'; message: string }> => {
  const runtimeFiles = getRuntimeFilesAPI();
  if (runtimeFiles?.readFile) {
    try {
      const result = await runtimeFiles.readFile(path);
      return { status: 'ok', content: typeof result?.content === 'string' ? result.content : '' };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: 'missing' };
      }
      return { status: 'error', message: error instanceof Error ? error.message : 'Failed to read todo.json' };
    }
  }

  try {
    const response = await fetch(`${getBaseUrl()}/fs/read?path=${encodeURIComponent(path)}`);
    if (response.status === 404) {
      return { status: 'missing' };
    }
    if (!response.ok) {
      return { status: 'error', message: `Failed to read todo.json (${response.status})` };
    }
    return { status: 'ok', content: await response.text() };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Failed to read todo.json' };
  }
};

const mkdirp = async (path: string): Promise<boolean> => {
  const runtimeFiles = getRuntimeFilesAPI();
  if (runtimeFiles?.createDirectory) {
    try {
      const result = await runtimeFiles.createDirectory(path);
      return Boolean(result?.success);
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(`${getBaseUrl()}/fs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const writeTextFile = async (path: string, content: string): Promise<boolean> => {
  const runtimeFiles = getRuntimeFilesAPI();
  if (runtimeFiles?.writeFile) {
    try {
      const result = await runtimeFiles.writeFile(path, content);
      return Boolean(result?.success);
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(`${getBaseUrl()}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const isValidTimestamp = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
};

const parseProjectTodoDocument = (raw: string): ProjectTodoDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('todo.json 不是合法 JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('todo.json 顶层必须是对象');
  }

  const record = parsed as { version?: unknown; items?: unknown };
  if (record.version !== 1) {
    throw new Error('todo.json version 必须为 1');
  }
  if (!Array.isArray(record.items)) {
    throw new Error('todo.json items 必须是数组');
  }

  const items: ProjectTodoItem[] = record.items.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`todo.json items[${index}] 必须是对象`);
    }

    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim() : '';

    if (!id) {
      throw new Error(`todo.json items[${index}].id 无效`);
    }
    if (!text) {
      throw new Error(`todo.json items[${index}].text 不能为空`);
    }
    if (text.length > PROJECT_TODO_TEXT_MAX_LENGTH) {
      throw new Error(`todo.json items[${index}].text 超过长度限制`);
    }
    if (typeof item.done !== 'boolean') {
      throw new Error(`todo.json items[${index}].done 必须是布尔值`);
    }
    if (!isValidTimestamp(item.createdAt)) {
      throw new Error(`todo.json items[${index}].createdAt 无效`);
    }
    if (!isValidTimestamp(item.updatedAt)) {
      throw new Error(`todo.json items[${index}].updatedAt 无效`);
    }

    return {
      id,
      text,
      done: item.done,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  return { version: 1, items };
};

export const createProjectTodoId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `todo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export async function readProjectTodoFile(directory: string): Promise<ProjectTodoLoadResult> {
  const normalizedDirectory = normalizePath(directory.trim());
  const todoPath = getProjectTodoPath(normalizedDirectory);

  if (!normalizedDirectory) {
    return { status: 'error', path: todoPath, message: '没有可用的项目目录' };
  }

  const file = await readTextFile(todoPath);
  if (file.status === 'missing') {
    return { status: 'missing', path: todoPath, data: EMPTY_PROJECT_TODO_DOCUMENT };
  }
  if (file.status === 'error') {
    return { status: 'error', path: todoPath, message: file.message };
  }

  const trimmed = file.content.trim();
  if (!trimmed) {
    return { status: 'invalid', path: todoPath, message: 'todo.json 为空，请写入合法的 JSON 文档' };
  }

  try {
    return { status: 'ok', path: todoPath, data: parseProjectTodoDocument(trimmed) };
  } catch (error) {
    return {
      status: 'invalid',
      path: todoPath,
      message: error instanceof Error ? error.message : 'todo.json 格式无效',
    };
  }
}

export async function writeProjectTodoFile(directory: string, document: ProjectTodoDocument): Promise<ProjectTodoSaveResult> {
  const normalizedDirectory = normalizePath(directory.trim());
  const todoDirectory = getProjectTodoDirectory(normalizedDirectory);
  const todoPath = getProjectTodoPath(normalizedDirectory);

  if (!normalizedDirectory) {
    return { ok: false, path: todoPath, message: '没有可用的项目目录' };
  }

  try {
    parseProjectTodoDocument(JSON.stringify(document));
  } catch (error) {
    return {
      ok: false,
      path: todoPath,
      message: error instanceof Error ? error.message : 'Todo 数据无效',
    };
  }

  const ensuredDirectory = await mkdirp(todoDirectory);
  if (!ensuredDirectory) {
    return { ok: false, path: todoPath, message: `无法创建目录 ${todoDirectory}` };
  }

  const wrote = await writeTextFile(todoPath, `${JSON.stringify(document, null, 2)}\n`);
  if (!wrote) {
    return { ok: false, path: todoPath, message: `无法写入 ${todoPath}` };
  }

  return { ok: true, path: todoPath };
}
