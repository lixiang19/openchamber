import { createContext } from 'react';

import { DEFAULT_LOCALE, type Locale, type TranslationKey, type TranslationParams } from '@/i18n/core';

export interface I18nContextValue {
  locale: Locale;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const DEFAULT_I18N_LOCALE = DEFAULT_LOCALE;
