import fs from 'fs/promises';
import path from 'path';
import { getAgentDir } from '@mariozechner/pi-coding-agent';

const RELATIONS_DIR = path.join(getAgentDir(), 'ridge');
const RELATIONS_FILE = path.join(RELATIONS_DIR, 'task-relations.json');

let cachedRelations = null;
let loadPromise = null;
let writePromise = Promise.resolve();

const normalizeSessionId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeRelationRecord = (sessionId, value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const parentID = normalizeSessionId(value.parentID ?? value.parentId);
  if (!parentID) {
    return null;
  }

  const rootID = normalizeSessionId(value.rootID ?? value.rootId) ?? parentID;
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    ? value.createdAt
    : Date.now();

  return {
    sessionId,
    parentID,
    rootID,
    createdAt,
  };
};

const cloneRelations = (relations) => new Map(
  Array.from(relations.entries()).map(([sessionId, relation]) => [sessionId, { ...relation }]),
);

const ensureLoaded = async () => {
  if (cachedRelations) {
    return cachedRelations;
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const raw = await fs.readFile(RELATIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const next = new Map();
      if (parsed && typeof parsed === 'object') {
        for (const [rawSessionId, rawRelation] of Object.entries(parsed)) {
          const sessionId = normalizeSessionId(rawSessionId);
          if (!sessionId) {
            continue;
          }
          const normalized = normalizeRelationRecord(sessionId, rawRelation);
          if (normalized) {
            next.set(sessionId, normalized);
          }
        }
      }
      cachedRelations = next;
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code !== 'ENOENT') {
        console.warn('Failed to read task relations:', error instanceof Error ? error.message : String(error));
      }
      cachedRelations = new Map();
    }
    return cachedRelations;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
};

const persistRelations = async (relations) => {
  await fs.mkdir(RELATIONS_DIR, { recursive: true });
  const payload = Object.fromEntries(Array.from(relations.entries()).map(([sessionId, relation]) => [sessionId, relation]));
  const tempFile = `${RELATIONS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tempFile, RELATIONS_FILE);
};

export const listTaskRelations = async () => {
  const relations = await ensureLoaded();
  return cloneRelations(relations);
};

export const getTaskRelation = async (sessionId) => {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  const relations = await ensureLoaded();
  const relation = relations.get(normalizedSessionId);
  return relation ? { ...relation } : null;
};

export const setTaskRelation = async (sessionId, relation) => {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalized = normalizeRelationRecord(normalizedSessionId, relation);
  if (!normalizedSessionId || !normalized) {
    throw new Error('Task relation requires a valid sessionId and parentID.');
  }

  const relations = await ensureLoaded();
  relations.set(normalizedSessionId, normalized);

  writePromise = writePromise.then(async () => {
    await persistRelations(relations);
  });

  await writePromise;
  return { ...normalized };
};
