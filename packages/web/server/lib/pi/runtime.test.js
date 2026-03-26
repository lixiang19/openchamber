import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import {
  AGENT_RUNTIME_OPENCODE,
  AGENT_RUNTIME_PI,
  buildPromptTextFromParts,
  createPiRuntime,
  mapPiUiRequestToQuestionRequest,
  resolveAgentRuntimeMode,
  translateOpenCodeMessagesToSseEvents,
  translatePiEnvelopeToSseEvents,
  translatePiMessagesToOpenCodeMessages,
} from './runtime.js';

describe('pi runtime helpers', () => {
  it('resolves the runtime mode with opencode fallback', () => {
    expect(resolveAgentRuntimeMode('pi')).toBe(AGENT_RUNTIME_PI);
    expect(resolveAgentRuntimeMode('PI')).toBe(AGENT_RUNTIME_PI);
    expect(resolveAgentRuntimeMode('opencode')).toBe(AGENT_RUNTIME_OPENCODE);
    expect(resolveAgentRuntimeMode('unknown')).toBe(AGENT_RUNTIME_OPENCODE);
  });

  it('builds Pi prompt text from OpenCode message parts', () => {
    expect(buildPromptTextFromParts([
      { type: 'text', text: 'Review this patch' },
      { type: 'agent', name: 'Plan' },
      { type: 'file', filename: 'src/app.ts', url: 'file:///ignored' },
    ])).toBe('Review this patch\n\n@Plan\n\n[file] src/app.ts');
  });

  it('includes attached text-file contents in Pi prompt text', () => {
    expect(buildPromptTextFromParts([
      { type: 'text', text: 'Review attached file' },
      {
        type: 'file',
        filename: 'notes.txt',
        mime: 'text/plain',
        url: 'data:text/plain;base64,SGVsbG8gZnJvbSBhdHRhY2htZW50',
      },
    ])).toContain('<attached_file>\nHello from attachment\n</attached_file>');
  });

  it('includes attached text-file contents from file URLs in Pi prompt text', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-file-url-'));
    const filePath = path.join(tempDir, 'notes.txt');
    fs.writeFileSync(filePath, 'Hello from file URL', 'utf8');

    try {
      expect(buildPromptTextFromParts([
        { type: 'text', text: 'Review attached file' },
        {
          type: 'file',
          filename: 'notes.txt',
          mime: 'text/plain',
          url: pathToFileURL(filePath).toString(),
        },
      ])).toContain('<attached_file>\nHello from file URL\n</attached_file>');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('maps extension UI requests into QuestionCard-compatible requests', () => {
    const sessionRecord = { session: { id: 'session-bridge' } };

    expect(mapPiUiRequestToQuestionRequest(sessionRecord, {
      id: 'ui-input',
      method: 'input',
      bridgeKind: 'question',
      webSupport: 'priority',
      title: 'Need a branch name',
      placeholder: 'feature/pi-bridge',
    })).toEqual({
      id: 'ui-input',
      sessionID: 'session-bridge',
      questions: [{
        header: 'Need a branch name',
        question: 'feature/pi-bridge',
        options: [],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'input',
        bridgeKind: 'question',
        webSupport: 'priority',
      },
    });

    expect(mapPiUiRequestToQuestionRequest(sessionRecord, {
      id: 'ui-confirm',
      method: 'confirm',
      bridgeKind: 'question',
      webSupport: 'priority',
      title: 'Apply patch?',
      message: 'This edits files',
    })).toEqual({
      id: 'ui-confirm',
      sessionID: 'session-bridge',
      questions: [{
        header: 'Apply patch?',
        question: 'This edits files',
        options: [{ label: 'Confirm', description: '' }],
        multiple: false,
      }],
      metadata: {
        bridgeMethod: 'confirm',
        bridgeKind: 'question',
        webSupport: 'priority',
      },
    });
  });

  it('restores idle status when Pi prompt startup fails', async () => {
    const runtime = createPiRuntime({ cliPath: '/definitely/missing/pi-binary' });
    const session = runtime.createSession({ directory: '/tmp/project', title: 'Broken Pi' });

    await expect(runtime.promptAsync(session.id, {
      parts: [{ type: 'text', text: 'hello' }],
    })).rejects.toThrow();

    expect(runtime.getSessionStatus()[session.id]).toEqual({ type: 'idle' });
  });
});

describe('translatePiMessagesToOpenCodeMessages', () => {
  const sessionRecord = {
    session: {
      id: 'session-1',
      directory: '/tmp/project',
    },
    lastModel: {
      providerID: 'anthropic',
      modelID: 'claude-sonnet',
    },
    lastAgent: 'Plan',
    lastVariant: null,
    lastUserMessageId: null,
  };

  it('maps subagent tool activity into task-style OpenCode tool parts', () => {
    const records = translatePiMessagesToOpenCodeMessages(sessionRecord, [
      {
        role: 'user',
        messageKind: 'user-message',
        timestamp: 1,
        content: [{ type: 'text', text: 'Run lint', textSignature: null }],
      },
      {
        role: 'assistant',
        messageKind: 'assistant-message',
        timestamp: 2,
        stopReason: 'toolUse',
        usage: {
          input: 10,
          output: 20,
          cacheRead: 1,
          cacheWrite: 2,
          totalTokens: 30,
          cost: { total: 0.5 },
        },
        content: [
          { type: 'text', text: 'Launching worker', textSignature: null },
          { type: 'toolCall', id: 'call-1', name: 'subagent', arguments: { agent: 'reviewer', task: 'lint package' }, thoughtSignature: null },
        ],
      },
      {
        role: 'toolResult',
        messageKind: 'tool-result',
        timestamp: 3,
        toolCallId: 'call-1',
        toolName: 'subagent',
        isError: false,
        details: {
          mode: 'single',
          results: [{
            agent: 'reviewer',
            task: 'lint package',
            exitCode: 0,
            sessionId: 'sub-1',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'toolCall', id: 'child-call-1', name: 'bash', arguments: { command: 'npm run lint' } }],
                provider: 'anthropic',
                model: 'claude-sonnet',
                stopReason: 'toolUse',
                timestamp: 31,
              },
              {
                role: 'toolResult',
                toolCallId: 'child-call-1',
                toolName: 'bash',
                isError: false,
                content: [{ type: 'text', text: 'lint ok' }],
                timestamp: 32,
              },
            ],
          }],
        },
        content: [{ type: 'text', text: 'lint ok', textSignature: null }],
      },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0].info.role).toBe('user');
    expect(records[1].parts).toHaveLength(2);
    expect(records[1].parts[1]).toMatchObject({
      type: 'tool',
      callID: 'call-1',
      tool: 'task',
      state: {
        status: 'completed',
        input: {
          description: 'lint package',
          prompt: 'lint package',
          subagent_type: 'reviewer',
        },
        output: 'lint ok',
        metadata: {
          sessionId: 'sub-1',
          summary: [
            {
              id: 'child-call-1',
              tool: 'bash',
              state: {
                status: 'completed',
                title: 'lint ok',
              },
            },
          ],
        },
      },
    });
  });

  it('preserves custom message metadata in synthetic assistant text parts', () => {
    const records = translatePiMessagesToOpenCodeMessages(sessionRecord, [
      {
        role: 'custom',
        messageKind: 'custom-message',
        timestamp: 4,
        customType: 'pi.subagent.status',
        details: { sessionId: 'child-1' },
        payload: { progress: 100 },
        display: true,
        content: [{ type: 'text', text: 'worker finished', textSignature: null }],
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].parts[0]).toMatchObject({
      type: 'text',
      text: 'worker finished',
      metadata: {
        pi: {
          role: 'custom',
          customType: 'pi.subagent.status',
          details: { sessionId: 'child-1' },
          payload: { progress: 100 },
          display: true,
        },
      },
    });
  });

  it('projects translated message records into OpenCode SSE payloads', () => {
    const records = translatePiMessagesToOpenCodeMessages(sessionRecord, [
      {
        role: 'user',
        messageKind: 'user-message',
        timestamp: 10,
        content: [{ type: 'text', text: 'hello', textSignature: null }],
      },
    ]);

    const events = translateOpenCodeMessagesToSseEvents(
      { ...sessionRecord, session: { ...sessionRecord.session, id: 'session-1', directory: '/tmp/project' } },
      records,
      { status: { type: 'idle' } },
    );

    expect(events).toEqual([
      {
        type: 'session.status',
        properties: {
          sessionID: 'session-1',
          status: { type: 'idle' },
          directory: '/tmp/project',
        },
      },
      {
        type: 'message.updated',
        properties: {
          info: records[0].info,
          parts: records[0].parts,
          directory: '/tmp/project',
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          info: records[0].info,
          part: records[0].parts[0],
          directory: '/tmp/project',
        },
      },
    ]);
  });

  it('translates Pi streaming envelopes into incremental SSE snapshots', () => {
    const envelope = {
      envelope: 'agent-event',
      eventType: 'message_update',
      assistantStream: {
        partial: {
          role: 'assistant',
          messageKind: 'assistant-message',
          timestamp: 50,
          content: [{ type: 'text', text: 'streaming answer', textSignature: null }],
          provider: 'anthropic',
          model: 'claude-sonnet',
          stopReason: 'stop',
          usage: null,
          api: null,
          responseId: null,
          errorMessage: null,
        },
      },
    };

    const events = translatePiEnvelopeToSseEvents(sessionRecord, envelope, { directory: '/tmp/project' });
    expect(events[0]?.type).toBe('message.updated');
    expect(events[1]?.type).toBe('message.part.updated');
    expect(events[1]?.properties?.part?.text).toBe('streaming answer');
  });
});
