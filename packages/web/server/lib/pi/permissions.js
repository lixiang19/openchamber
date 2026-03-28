import path from 'path';

const SIMPLE_PERMISSION_ACTIONS = new Set(['allow', 'deny']);
const SIMPLE_PERMISSION_KEYS = new Set(['read', 'grep', 'find', 'ls', 'bash', 'question', 'task']);
const EDIT_PERMISSION_KEY = 'edit';
const LEGACY_EDIT_TOOL_KEYS = new Set(['write']);
const MUTATION_TOOL_NAMES = new Set(['edit', 'write']);

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizePermissionAction = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  return SIMPLE_PERMISSION_ACTIONS.has(normalized) ? normalized : null;
};

const normalizeRulePattern = (value) => {
  const pattern = normalizeString(value).replace(/\\/g, '/');
  if (!pattern) {
    return null;
  }
  if (path.posix.isAbsolute(pattern)) {
    throw new Error(`Permission pattern must be workspace-relative: ${value}`);
  }
  const segments = pattern.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error(`Permission pattern cannot escape the workspace: ${value}`);
  }
  return pattern;
};

const normalizeRuleObject = (value, key) => {
  if (!isPlainObject(value)) {
    throw new Error(`Permission "${key}" must be an action or a rule object.`);
  }

  const normalized = {};
  for (const [rawPattern, rawAction] of Object.entries(value)) {
    const pattern = normalizeRulePattern(rawPattern);
    const action = normalizePermissionAction(rawAction);
    if (!pattern || !action) {
      throw new Error(`Invalid permission rule for "${key}": ${rawPattern}`);
    }
    normalized[pattern] = action;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`Permission "${key}" must include at least one rule.`);
  }

  return normalized;
};

const normalizeEditPermissionValue = (value) => {
  const simple = normalizePermissionAction(value);
  if (simple) {
    return simple;
  }
  const normalized = normalizeRuleObject(value, EDIT_PERMISSION_KEY);
  if (!Object.prototype.hasOwnProperty.call(normalized, '*')) {
    throw new Error('Permission "edit" must define a "*" fallback rule.');
  }
  return normalized;
};

const normalizeSimplePermissionValue = (value, key) => {
  const action = normalizePermissionAction(value);
  if (!action) {
    throw new Error(`Permission "${key}" only supports simple allow/deny actions.`);
  }
  return action;
};

export const isStructuredPermissionConfig = (value) => isPlainObject(value);

export const normalizeAgentPermission = (value) => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeString(rawKey).toLowerCase();
    if (!key) {
      continue;
    }

    if (key === EDIT_PERMISSION_KEY || LEGACY_EDIT_TOOL_KEYS.has(key)) {
      normalized[EDIT_PERMISSION_KEY] = normalizeEditPermissionValue(rawValue);
      continue;
    }

    if (!SIMPLE_PERMISSION_KEYS.has(key)) {
      throw new Error(`Unsupported permission key: ${rawKey}`);
    }

    normalized[key] = normalizeSimplePermissionValue(rawValue, key);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const createDefaultEditRules = () => [{ pattern: '*', action: 'allow' }];

const normalizeRuleEntries = (value) => {
  if (value === undefined) {
    return createDefaultEditRules();
  }

  if (typeof value === 'string') {
    return [{ pattern: '*', action: value }];
  }

  return Object.entries(value).map(([pattern, action]) => ({ pattern, action }));
};

const toPosixPath = (value) => value.split(path.sep).join('/');

export const normalizePathRelativeToCwd = (cwd, targetPath) => {
  const normalizedTarget = normalizeString(targetPath);
  if (!normalizedTarget) {
    return null;
  }

  const absoluteCwd = path.resolve(cwd);
  const absoluteTarget = path.resolve(absoluteCwd, normalizedTarget);
  const relative = path.relative(absoluteCwd, absoluteTarget);
  const normalizedRelative = toPosixPath(relative);

  if (!normalizedRelative || normalizedRelative === '.' || normalizedRelative === '..' || normalizedRelative.startsWith('../')) {
    return null;
  }

  return normalizedRelative;
};

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

export const matchSimplePattern = (pattern, value) => {
  const source = escapeRegex(pattern)
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`).test(value);
};

export const matchPermissionRule = (value, rules) => {
  let action = 'deny';
  for (const rule of rules || []) {
    if (matchSimplePattern(rule.pattern, value)) {
      action = rule.action;
    }
  }
  return action;
};

export const mapToolToLogicalPermission = (toolName) => {
  const normalized = normalizeString(toolName).toLowerCase();
  if (MUTATION_TOOL_NAMES.has(normalized)) {
    return EDIT_PERMISSION_KEY;
  }
  return SIMPLE_PERMISSION_KEYS.has(normalized) ? normalized : null;
};

export const extractMutationPath = (toolName, input) => {
  const normalized = normalizeString(toolName).toLowerCase();
  if (!MUTATION_TOOL_NAMES.has(normalized) || !isPlainObject(input)) {
    return null;
  }

  return typeof input.path === 'string' ? input.path : null;
};

export const compileAgentPermission = (cwd, permission, availableToolNames = []) => {
  const normalizedPermission = normalizeAgentPermission(permission) || {};
  const activeToolNames = [...availableToolNames];
  const editValue = normalizedPermission[EDIT_PERMISSION_KEY];
  const editRules = normalizeRuleEntries(editValue);

  if (editRules.length === 1 && editRules[0].pattern === '*' && editRules[0].action === 'deny') {
    const blockedTools = new Set(['edit', 'write']);
    for (let index = activeToolNames.length - 1; index >= 0; index -= 1) {
      if (blockedTools.has(normalizeString(activeToolNames[index]).toLowerCase())) {
        activeToolNames.splice(index, 1);
      }
    }
  }

  for (const [permissionKey, action] of Object.entries(normalizedPermission)) {
    if (permissionKey === EDIT_PERMISSION_KEY) {
      continue;
    }
    if (action !== 'deny') {
      continue;
    }
    for (let index = activeToolNames.length - 1; index >= 0; index -= 1) {
      if (normalizeString(activeToolNames[index]).toLowerCase() === permissionKey) {
        activeToolNames.splice(index, 1);
      }
    }
  }

  return {
    raw: normalizedPermission,
    cwd,
    activeToolNames,
    editRules,
    toolActions: Object.fromEntries(
      Object.entries(normalizedPermission)
        .filter(([permissionKey, action]) => permissionKey !== EDIT_PERMISSION_KEY && typeof action === 'string')
    ),
  };
};

const resolvePolicy = (policyOrGetter) => {
  if (typeof policyOrGetter === 'function') {
    return policyOrGetter() || null;
  }
  return policyOrGetter || null;
};

export const createPermissionGateExtension = (policyOrGetter) => (pi) => {
  pi.on('tool_call', async (event) => {
    const policy = resolvePolicy(policyOrGetter);
    if (!policy) {
      return undefined;
    }

    const logicalPermission = mapToolToLogicalPermission(event.toolName);
    if (logicalPermission !== EDIT_PERMISSION_KEY) {
      return undefined;
    }

    const targetPath = extractMutationPath(event.toolName, event.input);
    if (!targetPath) {
      return { block: true, reason: 'EDIT_TARGET_PATH_MISSING' };
    }

    const normalizedPath = normalizePathRelativeToCwd(policy.cwd, targetPath);
    if (!normalizedPath) {
      return { block: true, reason: 'EDIT_TARGET_OUTSIDE_WORKSPACE' };
    }

    const action = matchPermissionRule(normalizedPath, policy.editRules || []);
    if (action !== 'allow') {
      return { block: true, reason: `EDIT_TARGET_NOT_ALLOWED:${normalizedPath}` };
    }

    return undefined;
  });
};
