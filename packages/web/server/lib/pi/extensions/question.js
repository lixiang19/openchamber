export function createQuestionToolDefinition(createInteractiveRequest) {
  return {
    name: 'question',
    label: 'Question',
    description: 'Ask the user questions to gather missing information or clarify ambiguities before proceeding.',
    promptSnippet: 'question: Ask the user questions when you need clarification or additional information.',
    promptGuidelines: [
      'Use the question tool when you cannot proceed without user input.',
      'Ask clear, concise questions.',
      'Group multiple related questions into a single tool call when possible.'
    ],
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string', description: 'Header or topic of the question' },
              question: { type: 'string', description: 'The question text to ask the user' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of choices for the user'
              },
              multiple: { type: 'boolean', description: 'Whether the user can select multiple options' }
            },
            required: ['question']
          },
          description: 'A list of questions to ask the user.'
        }
      },
      required: ['questions']
    },

    async execute(params, signal, onUpdate, ctx) {
      if (!Array.isArray(params.questions) || params.questions.length === 0) {
        return {
          output: '',
          isError: true,
          errorMessage: 'No questions provided.',
        };
      }

      // We use createInteractiveRequest which will be passed down to link to the SDK host's request system
      try {
        const response = await createInteractiveRequest('question', {
          title: params.questions[0].header || 'Input Needed',
          message: params.questions[0].question,
          questions: params.questions,
          bridgeKind: 'question'
        });

        if (response === undefined || response === null) {
          return {
            output: 'User cancelled or dismissed the question.',
            isError: true,
            errorMessage: 'Question was rejected by the user.'
          };
        }

        // Output matches the format expected by ToolPart.tsx parsing:
        // "User has answered your questions: "Q1"="A1", "Q2"="A2". You can now..."
        const answers = Array.isArray(response) ? response : [response];
        let outputString = 'User has answered your questions:\n';

        params.questions.forEach((q, i) => {
           // Provide answers in order if they're grouped together
           const answerText = answers[i] !== undefined ? answers[i] : (answers[0] || 'No answer');
           // Format: "question"="answer"
           outputString += `"${q.question}"="${answerText}"\n`;
        });
        outputString += 'You can now proceed.';

        return {
          output: outputString,
          isError: false,
        };
      } catch (err) {
        return {
          output: '',
          isError: true,
          errorMessage: err.message || 'Failed to ask question.'
        };
      }
    }
  };
}
