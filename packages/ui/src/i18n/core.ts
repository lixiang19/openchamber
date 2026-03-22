import { zhCNMessages, type TranslationKey } from './zh-CN';

export type Locale = 'zh-CN';
export type TranslationParams = Record<string, string | number>;

export const DEFAULT_LOCALE: Locale = 'zh-CN';

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

export function translate(key: TranslationKey, params?: TranslationParams): string {
  const template = zhCNMessages[key];
  if (typeof template !== 'string') {
    throw new Error(`Missing translation for key: ${key}`);
  }

  if (!params) {
    return template;
  }

  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!(name in params)) {
      throw new Error(`Missing translation param "${name}" for key: ${key}`);
    }

    return String(params[name]);
  });
}

export type { TranslationKey };
