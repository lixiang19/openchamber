import { Type } from '@sinclair/typebox';

const QuestionOptionSchema = Type.Object({
  label: Type.String({ description: 'Option label shown in the UI' }),
  description: Type.Optional(Type.String({ description: 'Optional helper text shown under the option' })),
});

const QuestionItemSchema = Type.Object({
  header: Type.Optional(Type.String({ description: 'Header or topic of the question' })),
  question: Type.String({ description: 'The question text to ask the user' }),
  options: Type.Optional(Type.Array(QuestionOptionSchema, { description: 'Optional list of structured choices for the user' })),
  multiple: Type.Optional(Type.Boolean({ description: 'Whether the user can select multiple options' })),
  allowCustom: Type.Optional(Type.Boolean({ description: 'Whether the user may answer with free-form text' })),
});

const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionItemSchema, { description: 'A list of questions to ask the user.' }),
});

const normalizeQuestionOptions = (options) => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') {
      return [];
    }

    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label) {
      return [];
    }

    const description = typeof option.description === 'string' ? option.description : undefined;
    return [{ label, ...(description ? { description } : {}) }];
  });
};

const normalizeQuestions = (questions) => questions.flatMap((question) => {
  if (!question || typeof question !== 'object') {
    return [];
  }

  const prompt = typeof question.question === 'string' ? question.question.trim() : '';
  if (!prompt) {
    return [];
  }

  const options = normalizeQuestionOptions(question.options);
  const allowCustom = options.length === 0
    ? true
    : question.allowCustom === true;

  return [{
    ...(typeof question.header === 'string' && question.header.trim() ? { header: question.header.trim() } : {}),
    question: prompt,
    options,
    multiple: question.multiple === true,
    allowCustom,
  }];
});

const normalizeQuestionAnswers = (response) => {
  if (Array.isArray(response) && Array.isArray(response[0])) {
    return response.map((group) => Array.isArray(group) ? group.filter((value) => typeof value === 'string') : []);
  }
  if (Array.isArray(response)) {
    return [response.filter((value) => typeof value === 'string')];
  }
  if (typeof response === 'string' && response.trim()) {
    return [[response.trim()]];
  }
  return [];
};

const buildQuestionOutput = (questions, response) => {
  const answers = normalizeQuestionAnswers(response);
  let output = 'User has answered your questions:\n';

  questions.forEach((question, index) => {
    const fallback = answers[0] || [];
    const answerGroup = answers[index] !== undefined ? answers[index] : fallback;
    const answerText = answerGroup.length > 0 ? answerGroup.join(', ') : 'No answer';
    output += `"${question.question}"="${answerText}"\n`;
  });

  output += 'You can now proceed.';
  return output;
};

export function createQuestionToolDefinition(createInteractiveRequest) {
  return {
    name: 'question',
    label: 'Question',
    description: 'Ask the user questions to gather missing information or clarify ambiguities before proceeding.',
    promptSnippet: 'question: Ask the user questions when you need clarification or additional information.',
    promptGuidelines: [
      'Use the question tool when you cannot proceed without user input.',
      'Ask clear, concise questions.',
      'Model the prompt exactly as the UI should render it: options, multi-select, and free-form answers are explicit.',
    ],
    parameters: QuestionParamsSchema,

    async execute(_toolCallId, params) {
      const normalizedQuestions = normalizeQuestions(Array.isArray(params.questions) ? params.questions : []);
      if (normalizedQuestions.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: No questions provided.' }],
          details: { questions: [], answer: null },
          isError: true,
        };
      }

      try {
        const response = await createInteractiveRequest('question', {
          title: normalizedQuestions[0].header || 'Input Needed',
          message: normalizedQuestions[0].question,
          questions: normalizedQuestions,
          bridgeKind: 'question',
          webSupport: 'supported',
        });

        if (response === undefined || response === null) {
          return {
            content: [{ type: 'text', text: 'User cancelled or dismissed the question.' }],
            details: { questions: normalizedQuestions, answer: null, cancelled: true },
            isError: true,
          };
        }

        const answers = normalizeQuestionAnswers(response);
        return {
          content: [{ type: 'text', text: buildQuestionOutput(normalizedQuestions, answers) }],
          details: {
            questions: normalizedQuestions,
            answer: answers,
          },
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'Failed to ask question.' }],
          details: { questions: normalizedQuestions, answer: null },
          isError: true,
        };
      }
    },
  };
}
