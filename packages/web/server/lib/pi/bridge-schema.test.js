import { describe, expect, it } from 'bun:test';

import {
  PI_BRIDGE_EVENT_CATALOG,
  normalizePiExtensionUiRequest,
  normalizePiMessage,
  normalizePiRpcEnvelope,
} from './bridge-schema.js';

describe('pi bridge schema catalog', () => {
  it('tracks the upstream event families the server bridge needs to cover', () => {
    expect(PI_BRIDGE_EVENT_CATALOG.rpc.agentEvents).toEqual([
      'agent_start',
      'agent_end',
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
    ]);
    expect(PI_BRIDGE_EVENT_CATALOG.rpc.assistantStreamEvents).toContain('text_delta');
    expect(PI_BRIDGE_EVENT_CATALOG.messages.custom).toContain('custom');
    expect(PI_BRIDGE_EVENT_CATALOG.extensionUi.question.bridgeKind).toBe('question');
    expect(PI_BRIDGE_EVENT_CATALOG.extensionUi.confirm.webSupport).toBe('unsupported');
  });
});

describe('normalizePiMessage', () => {
  it('normalizes assistant tool-call messages', () => {
    const normalized = normalizePiMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Running tool' },
        { type: 'toolCall', id: 'call_1', name: 'subagent', arguments: { task: 'test' } },
      ],
      provider: 'openai',
      model: 'gpt-5',
      stopReason: 'toolUse',
      usage: {
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
      },
      timestamp: 42,
    });

    expect(normalized).toEqual({
      role: 'assistant',
      messageKind: 'assistant-message',
      timestamp: 42,
      content: [
        { type: 'text', text: 'Running tool', textSignature: null },
        { type: 'toolCall', id: 'call_1', name: 'subagent', arguments: { task: 'test' }, thoughtSignature: null },
      ],
      api: null,
      provider: 'openai',
      model: 'gpt-5',
      responseId: null,
      stopReason: 'toolUse',
      errorMessage: null,
      usage: {
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
      },
    });
  });

  it('preserves custom message details and payload for later rendering', () => {
    const normalized = normalizePiMessage({
      role: 'custom',
      customType: 'subagent.progress',
      content: 'Worker finished lint step',
      display: true,
      details: { sessionId: 'child-1', phase: 'lint' },
      payload: { progress: 100, steps: ['lint'] },
      timestamp: 9,
      pluginName: 'ignored-plugin-metadata',
    });

    expect(normalized).toEqual({
      role: 'custom',
      messageKind: 'custom-message',
      timestamp: 9,
      customType: 'subagent.progress',
      content: [{ type: 'text', text: 'Worker finished lint step', textSignature: null }],
      display: true,
      details: { sessionId: 'child-1', phase: 'lint' },
      payload: { progress: 100, steps: ['lint'] },
    });
  });
});

describe('normalizePiExtensionUiRequest', () => {
  it('only treats native question requests as supported interactive dialogs', () => {
    expect(normalizePiExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'ui_q1',
      method: 'question',
      title: 'Need rollout input',
      questions: [{
        header: 'Rollout',
        question: 'Where should we deploy first?',
        options: [{ label: 'staging', description: 'Smoke test first' }, { label: 'production' }],
        allowCustom: true,
      }],
    })).toEqual({
      id: 'ui_q1',
      method: 'question',
      bridgeKind: 'question',
      expectedReply: 'value',
      webSupport: 'priority',
      milestone: 'm3',
      title: 'Need rollout input',
      questions: [{
        header: 'Rollout',
        question: 'Where should we deploy first?',
        options: [{ label: 'staging', description: 'Smoke test first' }, { label: 'production' }],
        multiple: false,
        allowCustom: true,
      }],
    });
  });

  it('leaves legacy dialog methods unsupported instead of collapsing them into question', () => {
    expect(normalizePiExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'ui_legacy',
      method: 'input',
      title: 'Need more context',
      placeholder: 'Type here',
    })).toEqual({
      id: 'ui_legacy',
      method: 'input',
      bridgeKind: 'unsupported',
      expectedReply: 'value',
      webSupport: 'unsupported',
      milestone: null,
      raw: {
        type: 'extension_ui_request',
        id: 'ui_legacy',
        method: 'input',
        title: 'Need more context',
        placeholder: 'Type here',
      },
    });
  });

  it('retains deferred and unsupported methods for explicit downgrade handling', () => {
    expect(normalizePiExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'ui_4',
      method: 'setWidget',
      widgetKey: 'listen.waveform',
      widgetLines: ['recording...'],
      widgetPlacement: 'belowEditor',
    })).toEqual({
      id: 'ui_4',
      method: 'setWidget',
      bridgeKind: 'widget',
      expectedReply: 'none',
      webSupport: 'deferred',
      milestone: 'm3',
      widgetKey: 'listen.waveform',
      widgetLines: ['recording...'],
      widgetPlacement: 'belowEditor',
    });

    expect(normalizePiExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'ui_5',
      method: 'set_editor_text',
      text: 'draft answer',
    })).toMatchObject({
      bridgeKind: 'editor-text',
      webSupport: 'unsupported',
      text: 'draft answer',
    });
  });
});

describe('normalizePiRpcEnvelope', () => {
  it('normalizes message update envelopes with assistant stream metadata', () => {
    const normalized = normalizePiRpcEnvelope({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hel' }],
        provider: 'anthropic',
        model: 'claude-sonnet',
        stopReason: 'stop',
        timestamp: 1,
      },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'lo',
        partial: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          provider: 'anthropic',
          model: 'claude-sonnet',
          stopReason: 'stop',
          timestamp: 1,
        },
      },
    });

    expect(normalized).toEqual({
      source: 'pi',
      envelope: 'agent-event',
      eventType: 'message_update',
      channel: 'message',
      phase: 'update',
      message: {
        role: 'assistant',
        messageKind: 'assistant-message',
        timestamp: 1,
        content: [{ type: 'text', text: 'Hel', textSignature: null }],
        api: null,
        provider: 'anthropic',
        model: 'claude-sonnet',
        responseId: null,
        stopReason: 'stop',
        errorMessage: null,
        usage: null,
      },
      assistantStream: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'lo',
        content: null,
        reason: null,
        toolCall: null,
        partial: {
          role: 'assistant',
          messageKind: 'assistant-message',
          timestamp: 1,
          content: [{ type: 'text', text: 'Hello', textSignature: null }],
          api: null,
          provider: 'anthropic',
          model: 'claude-sonnet',
          responseId: null,
          stopReason: 'stop',
          errorMessage: null,
          usage: null,
        },
        message: null,
        error: null,
      },
    });
  });

  it('normalizes tool execution and response envelopes', () => {
    expect(normalizePiRpcEnvelope({
      type: 'tool_execution_end',
      toolCallId: 'call_9',
      toolName: 'subagent',
      args: { prompt: 'help' },
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: { sessionId: 'sub-1' },
      },
      isError: false,
    })).toEqual({
      source: 'pi',
      envelope: 'agent-event',
      eventType: 'tool_execution_end',
      channel: 'tool',
      phase: 'end',
      toolCallId: 'call_9',
      toolName: 'subagent',
      args: { prompt: 'help' },
      partialResult: null,
      result: {
        content: [{ type: 'text', text: 'done', textSignature: null }],
        details: { sessionId: 'sub-1' },
      },
      isError: false,
    });

    expect(normalizePiRpcEnvelope({
      type: 'response',
      id: 'req_1',
      command: 'prompt',
      success: true,
    })).toEqual({
      source: 'pi',
      envelope: 'command-response',
      eventType: 'response',
      id: 'req_1',
      command: 'prompt',
      success: true,
      data: null,
      error: null,
    });
  });
});
