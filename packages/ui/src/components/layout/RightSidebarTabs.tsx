import React from 'react';
import { RiCheckboxMultipleLine, RiFolder3Line, RiGitBranchLine } from '@remixicon/react';

import { SortableTabsStrip } from '@/components/ui/sortable-tabs-strip';
import { GitView, TodoView } from '@/components/views';
import { useUIStore } from '@/stores/useUIStore';
import { SidebarFilesTree } from './SidebarFilesTree';

type RightTab = 'git' | 'files' | 'todo';

export const RightSidebarTabs: React.FC = () => {
  const rightSidebarTab = useUIStore((state) => state.rightSidebarTab);
  const rightSidebarTabVisibility = useUIStore((state) => state.rightSidebarTabVisibility);
  const setRightSidebarTab = useUIStore((state) => state.setRightSidebarTab);

  const tabItems = React.useMemo(() => {
    const items: Array<{ id: RightTab; label: string; icon: React.ReactNode }> = [];

    if (rightSidebarTabVisibility.git) {
      items.push({
        id: 'git',
        label: 'Git',
        icon: <RiGitBranchLine className="h-3.5 w-3.5" />,
      });
    }
    if (rightSidebarTabVisibility.files) {
      items.push({
        id: 'files',
        label: 'Files',
        icon: <RiFolder3Line className="h-3.5 w-3.5" />,
      });
    }
    if (rightSidebarTabVisibility.todo) {
      items.push({
        id: 'todo',
        label: 'Todo',
        icon: <RiCheckboxMultipleLine className="h-3.5 w-3.5" />,
      });
    }

    return items;
  }, [rightSidebarTabVisibility.files, rightSidebarTabVisibility.git, rightSidebarTabVisibility.todo]);

  React.useEffect(() => {
    if (tabItems.length === 0) {
      return;
    }

    if (!tabItems.some((item) => item.id === rightSidebarTab)) {
      setRightSidebarTab(tabItems[0].id);
    }
  }, [rightSidebarTab, setRightSidebarTab, tabItems]);

  const hasVisibleTabs = tabItems.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      {hasVisibleTabs ? (
        <div className="h-9 bg-transparent pt-1 px-2">
          <SortableTabsStrip
            items={tabItems}
            activeId={rightSidebarTab}
            onSelect={(tabID) => setRightSidebarTab(tabID as RightTab)}
            layoutMode="fit"
            variant="active-pill"
            className="h-full"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!hasVisibleTabs ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="typography-meta text-muted-foreground">No right sidebar tabs are enabled.</p>
          </div>
        ) : null}
        {hasVisibleTabs && rightSidebarTab === 'git' && rightSidebarTabVisibility.git ? <GitView /> : null}
        {hasVisibleTabs && rightSidebarTab === 'files' && rightSidebarTabVisibility.files ? <SidebarFilesTree /> : null}
        {hasVisibleTabs && rightSidebarTab === 'todo' && rightSidebarTabVisibility.todo ? <TodoView /> : null}
      </div>
    </div>
  );
};
