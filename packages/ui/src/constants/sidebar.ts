import { RiBrainAi3Line, RiChatAi3Line, RiCommandLine, RiGitBranchLine, RiSettings3Line, RiStackLine, RiBookLine, RiBarChart2Line, RiPlugLine } from '@remixicon/react';
import type { ComponentType } from 'react';

import { translate } from '@/i18n/core';

export type SidebarSection = 'sessions' | 'agents' | 'commands' | 'skills' | 'mcp' | 'providers' | 'usage' | 'git-identities' | 'settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = ComponentType<any>;

export interface SidebarSectionConfig {
    id: SidebarSection;
    label: string;
    description: string;
    icon: IconComponent;
}

export const SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
    {
        id: 'sessions',
        label: translate('sidebar.sessions.label'),
        description: translate('sidebar.sessions.description'),
        icon: RiChatAi3Line,
    },
    {
        id: 'agents',
        label: translate('sidebar.agents.label'),
        description: translate('sidebar.agents.description'),
        icon: RiBrainAi3Line,
    },
    {
        id: 'commands',
        label: translate('sidebar.commands.label'),
        description: translate('sidebar.commands.description'),
        icon: RiCommandLine,
    },
    {
        id: 'skills',
        label: translate('sidebar.skills.label'),
        description: translate('sidebar.skills.description'),
        icon: RiBookLine,
    },
    {
        id: 'mcp',
        label: translate('sidebar.mcp.label'),
        description: translate('sidebar.mcp.description'),
        icon: RiPlugLine,
    },
    {
        id: 'providers',
        label: translate('sidebar.providers.label'),
        description: translate('sidebar.providers.description'),
        icon: RiStackLine,
    },
    {
        id: 'usage',
        label: translate('sidebar.usage.label'),
        description: translate('sidebar.usage.description'),
        icon: RiBarChart2Line,
    },
    {
        id: 'git-identities',
        label: translate('sidebar.gitIdentities.label'),
        description: translate('sidebar.gitIdentities.description'),
        icon: RiGitBranchLine,
    },
    {
        id: 'settings',
        label: translate('sidebar.settings.label'),
        description: translate('sidebar.settings.description'),
        icon: RiSettings3Line,
    },
];

const sidebarSectionLabels = {} as Record<SidebarSection, string>;
const sidebarSectionDescriptions = {} as Record<SidebarSection, string>;
const sidebarSectionConfigMap = {} as Record<SidebarSection, SidebarSectionConfig>;

SIDEBAR_SECTIONS.forEach((section) => {
    sidebarSectionLabels[section.id] = section.label;
    sidebarSectionDescriptions[section.id] = section.description;
    sidebarSectionConfigMap[section.id] = section;
});

export const SIDEBAR_SECTION_LABELS = sidebarSectionLabels;
export const SIDEBAR_SECTION_DESCRIPTIONS = sidebarSectionDescriptions;
export const SIDEBAR_SECTION_CONFIG_MAP = sidebarSectionConfigMap;
