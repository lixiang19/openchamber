import { RiBrainAi3Line, RiChatAi3Line, RiCommandLine, RiGitBranchLine, RiSettings3Line, RiStackLine, RiBookLine, RiBarChart2Line, RiPlugLine } from '@remixicon/react';
import type { ComponentType } from 'react';

export type SidebarSection = 'sessions' | 'agents' | 'prompts' | 'skills' | 'mcp' | 'providers' | 'usage' | 'git-identities' | 'settings';

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
        label: '会话',
        description: '浏览和管理当前目录下的聊天会话。',
        icon: RiChatAi3Line,
    },
    {
        id: 'agents',
        label: '智能体',
        description: '配置 Pi 原生智能体、提示词和工具权限。',
        icon: RiBrainAi3Line,
    },
    {
        id: 'prompts',
        label: '提示词',
        description: '为 Pi 创建和维护自定义提示词模板。',
        icon: RiCommandLine,
    },
    {
        id: 'skills',
        label: '技能',
        description: '创建可复用的指令文件供智能体按需加载。',
        icon: RiBookLine,
    },
    {
        id: 'mcp',
        label: 'MCP',
        description: '管理模型上下文协议服务器及其配置。',
        icon: RiPlugLine,
    },
    {
        id: 'providers',
        label: '提供商',
        description: '配置 AI 模型提供商和 API 凭证。',
        icon: RiStackLine,
    },
    {
        id: 'usage',
        label: '用量',
        description: '监控各提供商的 API 配额和使用情况。',
        icon: RiBarChart2Line,
    },
    {
        id: 'git-identities',
        label: 'Git 身份',
        description: '管理具有不同凭证和 SSH 密钥的 Git 配置文件。',
        icon: RiGitBranchLine,
    },
    {
        id: 'settings',
        label: 'Ridge',
        description: 'Ridge 应用设置：主题、字体和首选项。',
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
