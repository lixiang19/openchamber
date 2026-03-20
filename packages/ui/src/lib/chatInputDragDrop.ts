export const CHAT_INPUT_FILE_REFERENCE_MIME = 'application/x-openaurora-chat-file-reference';

export type ChatInputFileReferencePayload = {
  kind: 'file';
  path: string;
  relativePath?: string;
};

const parsePayload = (raw: string): ChatInputFileReferencePayload | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChatInputFileReferencePayload>;
    if (parsed.kind !== 'file' || typeof parsed.path !== 'string' || parsed.path.trim().length === 0) {
      return null;
    }

    return {
      kind: 'file',
      path: parsed.path,
      relativePath: typeof parsed.relativePath === 'string' && parsed.relativePath.trim().length > 0
        ? parsed.relativePath
        : undefined,
    };
  } catch {
    return null;
  }
};

export const hasChatInputFileReferenceType = (dataTransfer: Pick<DataTransfer, 'types'> | null | undefined): boolean => {
  if (!dataTransfer?.types) {
    return false;
  }

  return Array.from(dataTransfer.types).includes(CHAT_INPUT_FILE_REFERENCE_MIME);
};

export const getChatInputFileReferenceFromDataTransfer = (
  dataTransfer: Pick<DataTransfer, 'getData'> | null | undefined,
): ChatInputFileReferencePayload | null => {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') {
    return null;
  }

  return parsePayload(dataTransfer.getData(CHAT_INPUT_FILE_REFERENCE_MIME));
};

export const setChatInputFileReferenceOnDataTransfer = (
  dataTransfer: Pick<DataTransfer, 'setData'>,
  payload: ChatInputFileReferencePayload,
): void => {
  const serialized = JSON.stringify({
    kind: 'file',
    path: payload.path,
    ...(payload.relativePath ? { relativePath: payload.relativePath } : {}),
  } satisfies ChatInputFileReferencePayload);

  dataTransfer.setData(CHAT_INPUT_FILE_REFERENCE_MIME, serialized);
  dataTransfer.setData('text/plain', payload.relativePath || payload.path);
};
