import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const fsPromises = fs.promises;
const PI_AGENT_DIR = path.join(os.homedir(), '.pi', 'agent');
const GLOBAL_MCP_CONFIG_PATH = path.join(PI_AGENT_DIR, 'mcp.json');
const GLOBAL_MCP_CACHE_PATH = path.join(PI_AGENT_DIR, 'mcp-cache.json');
const MCP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const BASE_LOCAL_FIELDS = new Set([
  'name',
  'type',
  'command',
  'args',
  'env',
  'cwd',
  'lifecycle',
  'idleTimeout',
  'exposeResources',
  'directTools',
  'debug',
]);

const BASE_REMOTE_FIELDS = new Set([
  'name',
  'type',
  'url',
  'env',
  'cwd',
  'auth',
  'bearerToken',
  'bearerTokenEnv',
  'headers',
  'lifecycle',
  'idleTimeout',
  'exposeResources',
  'directTools',
  'debug',
]);

const cloneJson = (value) => {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeDirectory = (value) => {
  if (typeof value !== 'string') {
    return process.cwd();
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return process.cwd();
  }
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
};

const getProjectMcpConfigPath = (directory) => {
  return path.join(normalizeDirectory(directory), '.pi', 'mcp.json');
};

const readJsonFile = async (filePath, fallback = {}) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return fallback;
    }
    console.warn(`[PiMcpConfig] Failed to read JSON file ${filePath}:`, error);
    return fallback;
  }
};

const writeJsonFileAtomic = async (filePath, payload) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  try {
    await fsPromises.chmod(tmpFile, 0o600);
  } catch {
    // best effort
  }
  await fsPromises.rename(tmpFile, filePath);
  try {
    await fsPromises.chmod(filePath, 0o600);
  } catch {
    // best effort
  }
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeEnv = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }
  const result = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof entryValue !== 'string') continue;
    result[key.trim()] = entryValue;
  }
  return result;
};

const normalizeCommandArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
};

const normalizeDirectTools = (value) => {
  if (value === true) {
    return true;
  }
  if (value === false || value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
    return items.length > 0 ? items : false;
  }
  return false;
};

const normalizeLifecycle = (value) => {
  if (value === 'lazy' || value === 'eager' || value === 'keep-alive') {
    return value;
  }
  return 'lazy';
};

const normalizePositiveNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? 'null' : stableStringify(entry))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  if (value === undefined) {
    return 'null';
  }
  return JSON.stringify(value);
};

const computeServerConfigHash = (definition) => {
  const identity = {
    command: definition.command,
    args: definition.args,
    env: definition.env,
    cwd: definition.cwd,
    url: definition.url,
    headers: definition.headers,
    auth: definition.auth,
    bearerToken: definition.bearerToken,
    bearerTokenEnv: definition.bearerTokenEnv,
    exposeResources: definition.exposeResources,
  };
  return crypto.createHash('sha256').update(stableStringify(identity)).digest('hex');
};

const buildCacheIdentityFromRaw = (raw, type) => {
  if (type === 'remote') {
    return {
      command: undefined,
      args: undefined,
      env: normalizeEnv(raw.env),
      cwd: typeof raw.cwd === 'string' ? raw.cwd.trim() : '',
      url: typeof raw.url === 'string' ? raw.url.trim() : '',
      headers: isPlainObject(raw.headers) ? raw.headers : undefined,
      auth: typeof raw.auth === 'string' ? raw.auth : undefined,
      bearerToken: typeof raw.bearerToken === 'string' ? raw.bearerToken : undefined,
      bearerTokenEnv: typeof raw.bearerTokenEnv === 'string' ? raw.bearerTokenEnv : undefined,
      exposeResources: raw.exposeResources !== false,
    };
  }

  const command = typeof raw.command === 'string'
    ? [raw.command, ...(Array.isArray(raw.args) ? raw.args : [])]
    : normalizeCommandArray(Array.isArray(raw.command) ? raw.command : []);

  return {
    command: command[0],
    args: command.slice(1),
    env: normalizeEnv(raw.env),
    cwd: typeof raw.cwd === 'string' ? raw.cwd.trim() : '',
    url: undefined,
    headers: isPlainObject(raw.headers) ? raw.headers : undefined,
    auth: typeof raw.auth === 'string' ? raw.auth : undefined,
    bearerToken: typeof raw.bearerToken === 'string' ? raw.bearerToken : undefined,
    bearerTokenEnv: typeof raw.bearerTokenEnv === 'string' ? raw.bearerTokenEnv : undefined,
    exposeResources: raw.exposeResources !== false,
  };
};

const normalizeServerRecord = (name, rawValue, scope, sourcePath, cacheEntry) => {
  if (!name || !isPlainObject(rawValue)) {
    return null;
  }

  const raw = cloneJson(rawValue) || {};
  const hasRemoteTransport = typeof raw.url === 'string' && raw.url.trim().length > 0;
  const command = normalizeCommandArray(Array.isArray(raw.command) ? raw.command : [raw.command, ...(Array.isArray(raw.args) ? raw.args : [])]);
  const type = hasRemoteTransport ? 'remote' : 'local';
  const knownFields = new Set([...BASE_LOCAL_FIELDS, ...BASE_REMOTE_FIELDS]);
  const advanced = {};
  for (const [key, value] of Object.entries(raw)) {
    if (knownFields.has(key)) continue;
    advanced[key] = value;
  }

  const cacheValid = Boolean(cacheEntry && cacheEntry.configHash === computeServerConfigHash(buildCacheIdentityFromRaw(raw, type)));
  const cachedAt = cacheEntry && typeof cacheEntry.cachedAt === 'number' ? cacheEntry.cachedAt : null;
  const isFresh = cacheValid && cachedAt !== null && Date.now() - cachedAt <= MCP_CACHE_MAX_AGE_MS;

  return {
    name,
    scope,
    type,
    command,
    url: hasRemoteTransport ? raw.url.trim() : '',
    environment: normalizeEnv(raw.env),
    cwd: typeof raw.cwd === 'string' ? raw.cwd.trim() : '',
    advancedJson: Object.keys(advanced).length > 0 ? JSON.stringify(advanced, null, 2) : '',
    raw,
    sourcePath,
    cache: cacheEntry
      ? {
          toolCount: Array.isArray(cacheEntry.tools) ? cacheEntry.tools.length : 0,
          resourceCount: Array.isArray(cacheEntry.resources) ? cacheEntry.resources.length : 0,
          cachedAt,
          isFresh,
        }
      : null,
  };
};

const readConfigBundle = async (directory) => {
  const normalizedDirectory = normalizeDirectory(directory);
  const projectConfigPath = getProjectMcpConfigPath(normalizedDirectory);

  const [globalConfig, projectConfig, cache] = await Promise.all([
    readJsonFile(GLOBAL_MCP_CONFIG_PATH, {}),
    readJsonFile(projectConfigPath, {}),
    readJsonFile(GLOBAL_MCP_CACHE_PATH, { version: 1, servers: {} }),
  ]);

  const globalServers = isPlainObject(globalConfig.mcpServers) ? globalConfig.mcpServers : {};
  const projectServers = isPlainObject(projectConfig.mcpServers) ? projectConfig.mcpServers : {};
  const cacheServers = isPlainObject(cache.servers) ? cache.servers : {};

  const merged = new Map();
  for (const [name, value] of Object.entries(globalServers)) {
    merged.set(name, {
      value,
      scope: 'user',
      sourcePath: GLOBAL_MCP_CONFIG_PATH,
    });
  }
  for (const [name, value] of Object.entries(projectServers)) {
    merged.set(name, {
      value,
      scope: 'project',
      sourcePath: projectConfigPath,
    });
  }

  const servers = Array.from(merged.entries())
    .map(([name, entry]) => normalizeServerRecord(name, entry.value, entry.scope, entry.sourcePath, cacheServers[name]))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    directory: normalizedDirectory,
    globalConfigPath: GLOBAL_MCP_CONFIG_PATH,
    projectConfigPath,
    cachePath: GLOBAL_MCP_CACHE_PATH,
    settings: {
      global: isPlainObject(globalConfig.settings) ? cloneJson(globalConfig.settings) : {},
      project: isPlainObject(projectConfig.settings) ? cloneJson(projectConfig.settings) : {},
    },
    imports: {
      global: Array.isArray(globalConfig.imports) ? cloneJson(globalConfig.imports) : [],
      project: Array.isArray(projectConfig.imports) ? cloneJson(projectConfig.imports) : [],
    },
    mcpServers: servers,
  };
};

const extractKnownFields = (raw) => {
  const knownFields = new Set([...BASE_LOCAL_FIELDS, ...BASE_REMOTE_FIELDS]);
  const preserved = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (knownFields.has(key)) continue;
    preserved[key] = value;
  }
  return preserved;
};

const parseAdvancedJson = (advancedJson) => {
  if (typeof advancedJson !== 'string' || !advancedJson.trim()) {
    return {};
  }
  const parsed = JSON.parse(advancedJson);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是一个对象');
  }
  return parsed;
};

const buildServerPayload = (draft, preservedRaw = {}) => {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : '';
  if (!name) {
    throw new Error('Server name is required');
  }

  const scope = draft?.scope === 'project' ? 'project' : 'user';
  const type = draft?.type === 'remote' ? 'remote' : 'local';
  const env = normalizeEnv(Array.isArray(draft?.environment)
    ? Object.fromEntries(
      draft.environment
        .filter((entry) => entry && typeof entry.key === 'string' && entry.key.trim())
        .map((entry) => [entry.key.trim(), typeof entry.value === 'string' ? entry.value : ''])
    )
    : draft?.env);
  const cwd = typeof draft?.cwd === 'string' ? draft.cwd.trim() : '';
  const advanced = parseAdvancedJson(draft?.advancedJson);
  const commandList = normalizeCommandArray(draft?.command);
  const base = type === 'remote'
    ? {
        url: typeof draft?.url === 'string' ? draft.url.trim() : '',
      }
    : {
        command: commandList[0] || '',
        args: commandList.slice(1),
      };

  if (type === 'local' && !base.command) {
    throw new Error('本地服务器的命令不能为空');
  }
  if (type === 'remote' && !base.url) {
    throw new Error('远程服务器的 URL 不能为空');
  }

  const raw = {
    ...preservedRaw,
    name,
    type,
    ...advanced,
    env,
    cwd: cwd || undefined,
    ...base,
  };

  return { name, scope, type, raw };
};

const persistServerConfig = async (directory, existingName, draft) => {
  const normalizedDirectory = normalizeDirectory(directory);
  const projectConfigPath = getProjectMcpConfigPath(normalizedDirectory);
  const bundle = await readConfigBundle(normalizedDirectory);
  const existingServer = bundle.mcpServers.find((server) => server.name === existingName) || null;
  const preservedRaw = existingServer ? extractKnownFields(existingServer.raw) : {};
  const payload = buildServerPayload(draft, preservedRaw);

  const targetPath = payload.scope === 'project' ? projectConfigPath : GLOBAL_MCP_CONFIG_PATH;
  const targetConfig = await readJsonFile(targetPath, {});
  const sourcePath = existingServer?.sourcePath || targetPath;
  const sourceConfig = sourcePath === targetPath ? targetConfig : await readJsonFile(sourcePath, {});
  const sourceServers = isPlainObject(sourceConfig.mcpServers) ? { ...sourceConfig.mcpServers } : {};
  const targetServers = sourcePath === targetPath && sourceConfig === targetConfig
    ? sourceServers
    : isPlainObject(targetConfig.mcpServers)
      ? { ...targetConfig.mcpServers }
      : {};

  if (existingServer && sourcePath) {
    delete sourceServers[existingName];
    if (sourcePath !== targetPath) {
      await writeJsonFileAtomic(sourcePath, {
        ...sourceConfig,
        mcpServers: sourceServers,
      });
    }
  }

  targetServers[payload.name] = payload.raw;
  await writeJsonFileAtomic(targetPath, {
    ...targetConfig,
    mcpServers: targetServers,
  });

  return {
    ...payload,
    sourcePath: targetPath,
  };
};

const deleteServerConfig = async (directory, name) => {
  const normalizedDirectory = normalizeDirectory(directory);
  const bundle = await readConfigBundle(normalizedDirectory);
  const target = bundle.mcpServers.find((server) => server.name === name) || null;
  if (!target) {
    return false;
  }

  const sourceConfig = await readJsonFile(target.sourcePath, {});
  const sourceServers = isPlainObject(sourceConfig.mcpServers) ? { ...sourceConfig.mcpServers } : {};
  delete sourceServers[name];
  await writeJsonFileAtomic(target.sourcePath, {
    ...sourceConfig,
    mcpServers: sourceServers,
  });
  return true;
};

export {
  GLOBAL_MCP_CACHE_PATH,
  GLOBAL_MCP_CONFIG_PATH,
  computeServerConfigHash,
  deleteServerConfig,
  normalizeDirectory,
  normalizeDirectTools,
  normalizeEnv,
  normalizeLifecycle,
  normalizePositiveNumber,
  normalizeServerRecord,
  persistServerConfig,
  readConfigBundle,
};
