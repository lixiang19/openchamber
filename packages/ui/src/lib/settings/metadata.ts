import type { SidebarSection } from '@/constants/sidebar';

export type SettingsPageSlug =
  | 'home'
  | 'projects'
  | 'remote-instances'
  | 'providers'
  | 'usage'
  | 'agents'
  | 'prompts'
  | 'mcp'
  | 'skills.installed'
  | 'skills.catalog'
  | 'git'
  | 'appearance'
  | 'chat'
  | 'shortcuts'
  | 'sessions'
  | 'notifications'
  | 'voice'
  | 'tunnel';

export type SettingsPageGroup =
  | 'appearance'
  | 'projects'
  | 'general'
  | 'opencode'
  | 'git'
  | 'skills'
  | 'usage'
  | 'advanced';

export interface SettingsRuntimeContext {
  isVSCode: boolean;
  isWeb: boolean;
  isDesktop: boolean;
}

export interface SettingsPageMeta {
  slug: SettingsPageSlug;
  title: string;
  group: SettingsPageGroup;
  kind: 'single' | 'split';
  description?: string;
  keywords?: string[];
  isAvailable?: (ctx: SettingsRuntimeContext) => boolean;
}

export const SETTINGS_GROUP_LABELS: Record<SettingsPageGroup, string> = {
  appearance: '外观',
  projects: '项目',
  general: '通用',
  opencode: 'OpenCode',
  git: 'Git',
  skills: '技能',
  usage: '用量',
  advanced: '高级',
};

export const SETTINGS_PAGE_METADATA: readonly SettingsPageMeta[] = [
  {
    slug: 'home',
    title: '设置',
    group: 'general',
    kind: 'single',
    description: '搜索并跳转到常用页面。',
    keywords: ['search', 'settings'],
  },
  {
    slug: 'projects',
    title: '项目',
    group: 'projects',
    kind: 'split',
    keywords: ['project', 'projects', 'worktree', 'worktrees', 'repo', 'repository', 'directory'],
  },
  {
    slug: 'remote-instances',
    title: '远程实例',
    group: 'projects',
    kind: 'split',
    keywords: ['ssh', 'remote', 'instances', 'tunnels', 'forwarding', 'connection'],
    isAvailable: (ctx) => ctx.isDesktop && !ctx.isWeb && !ctx.isVSCode,
  },
  {
    slug: 'providers',
    title: '提供商',
    group: 'opencode',
    kind: 'split',
    keywords: ['provider', 'providers', 'models', 'model', 'api key', 'api keys', 'openai', 'anthropic', 'ollama', 'credentials'],
  },
  {
    slug: 'usage',
    title: '用量',
    group: 'usage',
    kind: 'split',
    keywords: ['quota', 'billing', 'tokens', 'usage', 'limits'],
  },
  {
    slug: 'agents',
    title: '智能体',
    group: 'opencode',
    kind: 'split',
    keywords: ['agent', 'agents', 'prompts', 'tools', 'permissions'],
  },
  {
    slug: 'prompts',
    title: '提示词',
    group: 'opencode',
    kind: 'split',
    keywords: ['prompt', 'prompts', 'template', 'templates', 'slash', 'macros'],
  },
  {
    slug: 'mcp',
    title: 'MCP',
    group: 'opencode',
    kind: 'split',
    description: '配置由 pi-mcp-adapter 提供的 MCP 服务器与连接状态。',
    keywords: ['mcp', 'model context protocol', 'servers', 'tools', 'remote', 'stdio', 'pi-mcp-adapter'],
  },
  {
    slug: 'skills.installed',
    title: '技能',
    group: 'skills',
    kind: 'split',
    keywords: ['skill', 'skills', 'instructions', 'install', 'catalog'],
  },
  {
    slug: 'skills.catalog',
    title: '技能目录',
    group: 'skills',
    kind: 'single',
    keywords: ['install', 'catalog', 'external', 'repository', 'skills catalog'],
  },
  {
    slug: 'git',
    title: 'Git',
    group: 'git',
    kind: 'single',
    keywords: ['git', 'github', 'identity', 'identities', 'ssh', 'profiles', 'credentials', 'keys', 'commit', 'gitmoji', 'oauth', 'prs', 'issues'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'appearance',
    title: '外观',
    group: 'appearance',
    kind: 'single',
    keywords: ['theme', 'font', 'spacing', 'padding', 'corner radius', 'radius', 'input bar', 'terminal', 'pwa', 'install name', 'app shortcuts'],
  },
  {
    slug: 'chat',
    title: '聊天',
    group: 'general',
    kind: 'single',
    keywords: ['tools', 'diff', 'reasoning', 'dotfiles', 'draft', 'queue', 'output'],
  },
  {
    slug: 'shortcuts',
    title: '快捷键',
    group: 'general',
    kind: 'single',
    keywords: ['keyboard', 'hotkeys', 'shortcuts', 'bindings'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'sessions',
    title: '会话',
    group: 'general',
    kind: 'single',
    keywords: ['defaults', 'default agent', 'default model', 'retention', 'memory', 'limits', 'zen'],
  },

  { slug: 'notifications', title: '通知', group: 'general', kind: 'single', keywords: ['alerts', 'native', 'summary', 'summarization'], },
  { slug: 'voice', title: '语音', group: 'advanced', kind: 'single', keywords: ['tts', 'speech', 'voice'], isAvailable: (ctx) => !ctx.isVSCode },
  { slug: 'tunnel', title: '远程隧道', group: 'advanced', kind: 'single', keywords: ['tunnel', 'cloudflare', 'qr', 'remote', 'mobile', 'share'], isAvailable: (ctx) => !ctx.isVSCode },
] as const;

export const LEGACY_SIDEBAR_SECTION_TO_SETTINGS_SLUG: Record<SidebarSection, SettingsPageSlug> = {
  sessions: 'sessions',
  agents: 'agents',
  prompts: 'prompts',
  mcp: 'mcp',
  skills: 'skills.installed',
  providers: 'providers',
  usage: 'usage',
  'git-identities': 'git',
  settings: 'home',
};

export function getSettingsPageMeta(slug: string): SettingsPageMeta | null {
  const normalized = slug.trim().toLowerCase();
  return (SETTINGS_PAGE_METADATA as readonly SettingsPageMeta[]).find((page) => page.slug === normalized) ?? null;
}

export function resolveSettingsSlug(value: string | null | undefined): SettingsPageSlug {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) {
    return 'home';
  }

  const legacy = (LEGACY_SIDEBAR_SECTION_TO_SETTINGS_SLUG as Record<string, SettingsPageSlug>)[normalized];
  if (legacy) {
    return legacy;
  }

  const direct = getSettingsPageMeta(normalized);
  if (direct) {
    return direct.slug;
  }

  return 'home';
}
