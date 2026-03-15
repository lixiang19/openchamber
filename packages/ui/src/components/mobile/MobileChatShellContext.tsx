import React from 'react';

const MobileChatShellContext = React.createContext(false);

export const MobileChatShellProvider: React.FC<{
  value?: boolean;
  children: React.ReactNode;
}> = ({ value = false, children }) => {
  return (
    <MobileChatShellContext.Provider value={value}>
      {children}
    </MobileChatShellContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useMobileChatShell = (): boolean => React.useContext(MobileChatShellContext);
