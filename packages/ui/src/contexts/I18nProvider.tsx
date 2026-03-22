import React from 'react';

import { DEFAULT_LOCALE, translate } from '@/i18n/core';

import { I18nContext } from './i18n-context';

interface I18nProviderProps {
  children: React.ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const value = React.useMemo(() => ({
    locale: DEFAULT_LOCALE,
    t: translate,
  }), []);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
