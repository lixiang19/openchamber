import { describe, expect, it } from 'bun:test';

import { createQuestionToolDefinition } from './question.js';

describe('question tool', () => {
  it('normalizes UI-shaped question params before opening the request', async () => {
    const calls = [];
    const tool = createQuestionToolDefinition(async (_method, payload) => {
      calls.push(payload);
      return [['staging'], ['Need CAB approval']];
    });

    const result = await tool.execute('tool-call-1', {
      questions: [
        {
          header: 'Rollout',
          question: 'Where should we deploy first?',
          options: [
            { label: 'staging', description: 'Smoke test first' },
            { label: 'production' },
          ],
          allowCustom: false,
        },
        {
          header: 'Notes',
          question: 'Anything else to mention?',
        },
      ],
    });

    expect(calls).toEqual([
      {
        title: 'Rollout',
        message: 'Where should we deploy first?',
        questions: [
          {
            header: 'Rollout',
            question: 'Where should we deploy first?',
            options: [
              { label: 'staging', description: 'Smoke test first' },
              { label: 'production' },
            ],
            multiple: false,
            allowCustom: false,
          },
          {
            header: 'Notes',
            question: 'Anything else to mention?',
            options: [],
            multiple: false,
            allowCustom: true,
          },
        ],
        bridgeKind: 'question',
        webSupport: 'supported',
      },
    ]);

    expect(result.details).toEqual({
      questions: [
        {
          header: 'Rollout',
          question: 'Where should we deploy first?',
          options: [
            { label: 'staging', description: 'Smoke test first' },
            { label: 'production' },
          ],
          multiple: false,
          allowCustom: false,
        },
        {
          header: 'Notes',
          question: 'Anything else to mention?',
          options: [],
          multiple: false,
          allowCustom: true,
        },
      ],
      answer: [['staging'], ['Need CAB approval']],
    });
  });

  it('treats dismissed requests as cancellation', async () => {
    const tool = createQuestionToolDefinition(async () => undefined);

    const result = await tool.execute('tool-call-2', {
      questions: [{ question: 'Proceed?' }],
    });

    expect(result.isError).toBe(true);
    expect(result.details).toEqual({
      questions: [{ question: 'Proceed?', options: [], multiple: false, allowCustom: true }],
      answer: null,
      cancelled: true,
    });
  });
});
