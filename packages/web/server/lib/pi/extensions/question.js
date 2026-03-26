import { Type } from '@sinclair/typebox';

const QuestionItemSchema = Type.Object({
  header: Type.Optional(Type.String({ description: 'Header or topic of the question' })),
  question: Type.String({ description: 'The question text to ask the user' }),
  options: Type.Optional(Type.Array(Type.String(), { description: 'Optional list of choices for the user' })),
  multiple: Type.Optional(Type.Boolean({ description: 'Whether the user can select multiple options' })),
});

const QuestionParamsSchema = Type.Object({
  questions: Type.Array(QuestionItemSchema, { description: 'A list of questions to ask the user.' }),
});

const buildQuestionOutput = (questions, response) => {
  const answers = Array.isArray(response) ? response : [response];
  let output = 'User has answered your questions:\n';

  questions.forEach((question, index) => {
    const fallback = answers[0] || 'No answer';
    const answerText = answers[index] !== undefined ? answers[index] : fallback;
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
      'Group multiple related questions into a single tool call when possible.',
    ],
    parameters: QuestionParamsSchema,

    async execute(_toolCallId, params) {
      if (!Array.isArray(params.questions) || params.questions.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: No questions provided.' }],
          details: { questions: [], answer: null },
          isError: true,
        };
      }

      try {
        const response = await createInteractiveRequest('question', {
          title: params.questions[0].header || 'Input Needed',
          message: params.questions[0].question,
          questions: params.questions,
          options: Array.isArray(params.questions[0].options) ? params.questions[0].options : [],
          bridgeKind: 'question',
        });

        if (response === undefined || response === null) {
          return {
            content: [{ type: 'text', text: 'User cancelled or dismissed the question.' }],
            details: { questions: params.questions, answer: null, cancelled: true },
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: buildQuestionOutput(params.questions, response) }],
          details: {
            questions: params.questions,
            answer: response,
          },
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'Failed to ask question.' }],
          details: { questions: params.questions, answer: null },
          isError: true,
        };
      }
    },
  };
}
