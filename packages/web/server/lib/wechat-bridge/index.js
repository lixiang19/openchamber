import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { WeChatBot, stripMarkdown } from '@wechatbot/wechatbot';

const RIDGE_CONFIG_DIR = path.join(os.homedir(), '.config', 'ridge');
const WECHAT_BRIDGE_STATE_FILE = path.join(RIDGE_CONFIG_DIR, 'wechat-bridge.json');
const WECHATBOT_STORAGE_DIR = path.join(os.homedir(), '.wechatbot');

const DEFAULT_STATE = {
  enabled: false,
  loginStatus: 'idle',
  connected: false,
  accountId: null,
  qrUrl: null,
  lastError: null,
  scannedAt: null,
  connectedAt: null,
  updatedAt: Date.now(),
  defaultSessionId: null,
  defaultCwd: null,
  bindings: [],
};

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const normalizeNullableString = (value) => {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
};

const cloneBindings = (bindings) => {
  if (!Array.isArray(bindings)) {
    return [];
  }

  return bindings
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const userId = normalizeString(entry.userId);
      const sessionId = normalizeString(entry.sessionId);
      if (!userId || !sessionId) {
        return null;
      }

      return {
        userId,
        sessionId,
        cwd: normalizeNullableString(entry.cwd),
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
      };
    })
    .filter(Boolean);
};

const loadPersistedState = () => {
  try {
    const raw = fs.readFileSync(WECHAT_BRIDGE_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled === true,
      defaultSessionId: normalizeNullableString(parsed?.defaultSessionId),
      defaultCwd: normalizeNullableString(parsed?.defaultCwd),
      bindings: cloneBindings(parsed?.bindings),
    };
  } catch {
    return null;
  }
};

const buildErrorMessage = (error, fallback) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
};

const createBot = () => {
  fs.mkdirSync(WECHATBOT_STORAGE_DIR, { recursive: true });
  return new WeChatBot({
    storage: 'file',
    storageDir: WECHATBOT_STORAGE_DIR,
    logLevel: 'warn',
  });
};

const createConversationTitle = (userId) => `WeChat ${userId}`;
const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.yaml', '.yml', '.toml', '.log', '.py', '.js', '.ts', '.tsx', '.go', '.rs', '.java', '.c', '.cpp', '.h']);
const MEDIA_FILE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|webm|avi|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz)$/i;

const createMediaTempDir = async (prefix) => {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
};

const saveIncomingMedia = async (media, filename, prefix) => {
  const data = media?.data;
  if (!data) {
    return null;
  }

  const safeName = normalizeString(filename) || 'attachment.bin';
  const tempDir = await createMediaTempDir(prefix);
  const absolutePath = path.join(tempDir, safeName);
  await fsPromises.writeFile(absolutePath, data);
  return absolutePath;
};

const buildPromptPayloadFromIncomingMessage = async (activeBot, message) => {
  const text = normalizeString(message?.text);

  if (message?.type === 'text') {
    return { text: text || '[empty WeChat message]' };
  }

  if (message?.type === 'image') {
    const media = await activeBot.download(message).catch(() => null);
    if (media?.data) {
      return {
        text: text ? `[WeChat image message]\nCaption: ${text}` : '[WeChat image message]',
        images: [{
          type: 'image',
          data: media.data.toString('base64'),
          mimeType: typeof media.mimeType === 'string' && media.mimeType.trim() ? media.mimeType : 'image/jpeg',
        }],
      };
    }
    return { text: text ? `[WeChat image message]\nCaption: ${text}` : '[WeChat image message received, but download failed.]' };
  }

  if (message?.type === 'voice') {
    const transcript = normalizeString(message?.voices?.[0]?.text);
    if (transcript) {
      return { text: `[WeChat voice transcript]\n${transcript}` };
    }

    const media = await activeBot.download(message).catch(() => null);
    if (media?.data) {
      const extension = normalizeString(media.format) || 'bin';
      const absolutePath = await saveIncomingMedia(media, `voice.${extension}`, 'wechat-voice');
      return { text: absolutePath ? `[WeChat voice message]\nSaved to: ${absolutePath}` : '[WeChat voice message received, but could not persist media.]' };
    }

    return { text: '[WeChat voice message received. Voice transcription is not available.]' };
  }

  if (message?.type === 'file') {
    const fileName = normalizeString(message?.files?.[0]?.fileName) || 'attachment.bin';
    const media = await activeBot.download(message).catch(() => null);
    if (!media?.data) {
      return { text: `[WeChat file message]\nFile: ${fileName}\nDownload failed.` };
    }

    const fileExtension = path.extname(fileName).toLowerCase();
    if (TEXT_FILE_EXTENSIONS.has(fileExtension)) {
      const content = media.data.toString('utf8');
      const truncatedContent = content.length > 12000 ? `${content.slice(0, 12000)}\n... [truncated]` : content;
      return { text: `[WeChat file message]\nFile: ${fileName}\n\n${truncatedContent}` };
    }

    const absolutePath = await saveIncomingMedia(media, fileName, 'wechat-file');
    return { text: absolutePath ? `[WeChat file message]\nFile: ${fileName}\nSaved to: ${absolutePath}` : `[WeChat file message]\nFile: ${fileName}\nCould not persist media.` };
  }

  if (message?.type === 'video') {
    const media = await activeBot.download(message).catch(() => null);
    if (!media?.data) {
      return { text: '[WeChat video message received, but download failed.]' };
    }

    const absolutePath = await saveIncomingMedia(media, 'video.mp4', 'wechat-video');
    return { text: absolutePath ? `[WeChat video message]\nSaved to: ${absolutePath}` : '[WeChat video message received, but could not persist media.]' };
  }

  return { text: text || `[WeChat ${normalizeString(message?.type) || 'unknown'} message received]` };
};

const extractTextFromMessageBlocks = (content) => {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
};

const extractMediaPaths = (text) => {
  const paths = [];
  const pathRegex = /(?:^|\s)((?:\/[\w./-]+|\.\/[\w./-]+))/gm;
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    const candidate = normalizeString(match[1]);
    if (MEDIA_FILE_EXTENSIONS.test(candidate)) {
      paths.push(candidate);
    }
  }
  return [...new Set(paths)];
};

const removeMediaPaths = (text, paths) => {
  let next = text;
  for (const filePath of paths) {
    next = next.replace(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
  }
  return next.replace(/\n{3,}/g, '\n\n').trim();
};

const extractLatestAssistantReply = (sessionSnapshot) => {
  const messages = Array.isArray(sessionSnapshot?.messages) ? sessionSnapshot.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const text = extractTextFromMessageBlocks(message.content);
    if (text) {
      const cleanText = stripMarkdown(text).trim();
      return {
        text: cleanText,
        mediaPaths: extractMediaPaths(cleanText),
      };
    }
  }
  return { text: '', mediaPaths: [] };
};

export const createWechatBridgeService = ({ piHost, defaultCwd = process.cwd() } = {}) => {
  const persistedState = loadPersistedState();

  let bot = null;
  let loginTask = null;
  let lifecycleId = 0;
  let state = {
    ...DEFAULT_STATE,
    ...(persistedState ? {
      enabled: persistedState.enabled,
      defaultSessionId: persistedState.defaultSessionId,
      defaultCwd: persistedState.defaultCwd,
      bindings: persistedState.bindings,
    } : {}),
  };
  const userMessageQueues = new Map();

  const persistState = async () => {
    await fsPromises.mkdir(RIDGE_CONFIG_DIR, { recursive: true });
    const payload = {
      enabled: state.enabled,
      defaultSessionId: state.defaultSessionId,
      defaultCwd: state.defaultCwd,
      bindings: state.bindings,
    };
    await fsPromises.writeFile(WECHAT_BRIDGE_STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  };

  const snapshot = () => ({
    enabled: state.enabled,
    loginStatus: state.loginStatus,
    connected: state.connected,
    accountId: state.accountId,
    qrUrl: state.qrUrl,
    lastError: state.lastError,
    scannedAt: state.scannedAt,
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
    defaultSessionId: state.defaultSessionId,
    defaultCwd: state.defaultCwd,
    bindings: state.bindings.map((entry) => ({ ...entry })),
  });

  const updateState = (patch) => {
    state = {
      ...state,
      ...patch,
      updatedAt: Date.now(),
    };
    void persistState().catch(() => {});
    return snapshot();
  };

  const clearRuntimeState = ({ keepEnabled = false, keepAccountId = true, lastError = null, loginStatus = 'idle' } = {}) => {
    state = {
      ...state,
      enabled: keepEnabled ? state.enabled : false,
      loginStatus,
      connected: false,
      accountId: keepAccountId ? state.accountId : null,
      qrUrl: null,
      lastError,
      scannedAt: null,
      connectedAt: null,
      updatedAt: Date.now(),
    };
    void persistState().catch(() => {});
    return snapshot();
  };

  const createLifecycleGuard = () => {
    const current = lifecycleId;
    return () => current === lifecycleId;
  };

  const stopCurrentBot = async () => {
    const activeBot = bot;
    bot = null;
    if (!activeBot) {
      return;
    }

    try {
      await activeBot.stop();
    } catch {
    }
  };

  const handleLifecycleError = (guard, error, fallbackMessage) => {
    if (!guard()) {
      return;
    }
    clearRuntimeState({
      keepEnabled: true,
      keepAccountId: true,
      lastError: buildErrorMessage(error, fallbackMessage),
      loginStatus: 'error',
    });
  };

  const bindWechatUser = async ({ userId, sessionId, cwd = null } = {}) => {
    const normalizedUserId = normalizeString(userId);
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedUserId) {
      throw new Error('WeChat userId is required');
    }
    if (!normalizedSessionId) {
      throw new Error('Pi sessionId is required');
    }

    let resolvedCwd = normalizeNullableString(cwd);
    if (piHost) {
      const session = await piHost.getSession(normalizedSessionId);
      resolvedCwd = normalizeNullableString(session?.cwd) || resolvedCwd;
    }

    const nextBindings = state.bindings.filter((binding) => binding.userId !== normalizedUserId);
    nextBindings.push({
      userId: normalizedUserId,
      sessionId: normalizedSessionId,
      cwd: resolvedCwd,
      updatedAt: Date.now(),
    });

    updateState({ bindings: nextBindings });
    return snapshot();
  };

  const getBinding = (userId) => {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
      return null;
    }
    return state.bindings.find((binding) => binding.userId === normalizedUserId) || null;
  };

  const setDefaultTarget = async ({ sessionId = null, cwd = null, rebindExisting = false } = {}) => {
    const normalizedSessionId = normalizeNullableString(sessionId);
    let normalizedCwd = normalizeNullableString(cwd);

    if (normalizedSessionId && piHost) {
      const session = await piHost.getSession(normalizedSessionId);
      normalizedCwd = normalizeNullableString(session?.cwd) || normalizedCwd;
    }

    const nextBindings = rebindExisting && normalizedSessionId
      ? state.bindings.map((binding) => ({
          ...binding,
          sessionId: normalizedSessionId,
          cwd: normalizedCwd,
          updatedAt: Date.now(),
        }))
      : state.bindings;

    updateState({
      defaultSessionId: normalizedSessionId,
      defaultCwd: normalizedCwd,
      bindings: nextBindings,
    });
    return snapshot();
  };

  const ensureBoundSession = async (userId) => {
    if (!piHost) {
      throw new Error('Pi host is not available for WeChat bridge');
    }

    const existingBinding = getBinding(userId);
    if (existingBinding) {
      try {
        await piHost.getSession(existingBinding.sessionId);
        return existingBinding;
      } catch {
      }
    }

    const defaultSessionId = normalizeString(state.defaultSessionId);
    if (defaultSessionId) {
      try {
        const targetSession = await piHost.getSession(defaultSessionId);
        await bindWechatUser({
          userId,
          sessionId: targetSession.id,
          cwd: targetSession.cwd,
        });
        return getBinding(userId);
      } catch {
      }
    }

    const createdSession = await piHost.createSession({
      cwd: normalizeString(state.defaultCwd) || defaultCwd,
      title: createConversationTitle(userId),
    });

    await bindWechatUser({
      userId,
      sessionId: createdSession.id,
      cwd: createdSession.cwd,
    });

    return getBinding(userId);
  };

  const processIncomingMessage = async (activeBot, guard, message) => {
    if (!guard()) {
      return;
    }

    const userId = normalizeString(message?.userId);
    if (!userId) {
      return;
    }

    const queue = userMessageQueues.get(userId) || Promise.resolve();
    const nextQueue = queue
      .catch(() => {})
      .then(async () => {
        if (!guard()) {
          return;
        }

        const binding = await ensureBoundSession(userId);
        if (!binding?.sessionId) {
          throw new Error('Failed to resolve Pi session for WeChat user');
        }

        const promptPayload = await buildPromptPayloadFromIncomingMessage(activeBot, message);
        if (!promptPayload?.text) {
          return;
        }

        try {
          await activeBot.sendTyping(userId);
        } catch {
        }

        try {
          await piHost.prompt(binding.sessionId, {
            text: promptPayload.text,
            ...(Array.isArray(promptPayload.images) && promptPayload.images.length > 0 ? { images: promptPayload.images } : {}),
          });
          const sessionSnapshot = await piHost.getSession(binding.sessionId);
          const { text: replyText, mediaPaths } = extractLatestAssistantReply(sessionSnapshot);
          const finalReplyText = replyText || 'Done.';

          if (mediaPaths.length > 0) {
            const textWithoutPaths = removeMediaPaths(finalReplyText, mediaPaths);
            if (textWithoutPaths) {
              await activeBot.reply(message, textWithoutPaths);
            }
            for (const mediaPath of mediaPaths) {
              try {
                const fileData = await fsPromises.readFile(mediaPath);
                await activeBot.reply(message, {
                  file: fileData,
                  fileName: path.basename(mediaPath),
                });
              } catch {
                await activeBot.reply(message, `[Failed to send file: ${path.basename(mediaPath)}]`);
              }
            }
          } else {
            await activeBot.reply(message, finalReplyText);
          }

          updateState({
            loginStatus: 'connected',
            connected: true,
            lastError: null,
          });
        } catch (error) {
          const errorMessage = buildErrorMessage(error, 'Failed to process WeChat message');
          updateState({
            loginStatus: 'connected',
            connected: true,
            lastError: errorMessage,
          });
          try {
            await activeBot.reply(message, `System error: ${errorMessage}`);
          } catch {
          }
        } finally {
          try {
            await activeBot.stopTyping(userId);
          } catch {
          }
        }
      })
      .finally(() => {
        if (userMessageQueues.get(userId) === nextQueue) {
          userMessageQueues.delete(userId);
        }
      });

    userMessageQueues.set(userId, nextQueue);
    await nextQueue;
  };

  const startLoginLoop = async (guard, force) => {
    const activeBot = createBot();
    bot = activeBot;

    try {
      const credentials = await activeBot.login({
        force,
        callbacks: {
          onQrUrl: (url) => {
            if (!guard()) {
              return;
            }
            updateState({
              loginStatus: 'starting',
              qrUrl: typeof url === 'string' ? url : null,
              lastError: null,
            });
          },
          onScanned: () => {
            if (!guard()) {
              return;
            }
            updateState({
              loginStatus: 'scanned',
              scannedAt: Date.now(),
              lastError: null,
            });
          },
          onExpired: () => {
            if (!guard()) {
              return;
            }
            handleLifecycleError(guard, '二维码已过期，请重新扫码', '二维码已过期，请重新扫码');
            lifecycleId += 1;
            void stopCurrentBot();
          },
        },
      });

      if (!guard()) {
        return;
      }

      const accountId = normalizeString(credentials?.accountId) || normalizeString(activeBot.getCredentials?.()?.accountId) || null;
      updateState({
        loginStatus: 'connected',
        connected: true,
        accountId,
        qrUrl: null,
        lastError: null,
        connectedAt: Date.now(),
        scannedAt: null,
      });

      activeBot.on('error', (error) => {
        if (!guard()) {
          return;
        }
        handleLifecycleError(guard, error, '微信连接发生错误');
        lifecycleId += 1;
        void stopCurrentBot();
      });

      activeBot.on('session:expired', () => {
        if (!guard()) {
          return;
        }
        handleLifecycleError(guard, '微信会话已过期，请重新扫码', '微信会话已过期，请重新扫码');
        lifecycleId += 1;
        void stopCurrentBot();
      });

      activeBot.on('session:restored', (creds) => {
        if (!guard()) {
          return;
        }
        const restoredAccountId = normalizeString(creds?.accountId) || state.accountId;
        updateState({
          loginStatus: 'connected',
          connected: true,
          accountId: restoredAccountId,
          lastError: null,
        });
      });

      activeBot.onMessage(async (message) => {
        if (!guard()) {
          return;
        }
        await processIncomingMessage(activeBot, guard, message);
      });

      await activeBot.start();
    } catch (error) {
      handleLifecycleError(guard, error, '微信登录失败');
      if (guard()) {
        lifecycleId += 1;
        void stopCurrentBot();
      }
    } finally {
      if (bot === activeBot) {
        bot = null;
      }
      loginTask = null;
    }
  };

  const start = async ({ force = true } = {}) => {
    if (loginTask) {
      return snapshot();
    }

    if (state.loginStatus === 'starting' || state.loginStatus === 'scanned' || state.loginStatus === 'connected') {
      return snapshot();
    }

    lifecycleId += 1;
    const guard = createLifecycleGuard();

    updateState({
      enabled: true,
      loginStatus: 'starting',
      connected: false,
      lastError: null,
      qrUrl: null,
      scannedAt: null,
      connectedAt: null,
    });

    loginTask = startLoginLoop(guard, force).catch((error) => {
      handleLifecycleError(guard, error, '微信登录失败');
    });

    return snapshot();
  };

  const stop = async ({ keepEnabled = false } = {}) => {
    lifecycleId += 1;
    loginTask = null;
    userMessageQueues.clear();
    await stopCurrentBot();
    if (keepEnabled) {
      return clearRuntimeState({
        keepEnabled: true,
        keepAccountId: true,
        lastError: state.lastError || '微信连接已停止',
        loginStatus: 'error',
      });
    }
    return clearRuntimeState({
      keepEnabled: false,
      keepAccountId: true,
      lastError: null,
      loginStatus: 'idle',
    });
  };

  return {
    async start(options = {}) {
      return start(options);
    },
    async stop(options = {}) {
      return stop(options);
    },
    getStatus() {
      return snapshot();
    },
    async bindWechatUser(options = {}) {
      return bindWechatUser(options);
    },
    async setDefaultTarget(options = {}) {
      return setDefaultTarget(options);
    },
    getBinding,
    async dispose() {
      await stop({ keepEnabled: false });
    },
  };
};
