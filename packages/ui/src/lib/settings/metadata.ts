import type { SidebarSection } from '@/constants/sidebar';
import { translate } from '@/i18n/core';

export type SettingsPageSlug =
  | 'home'
  | 'projects'
  | 'remote-instances'
  | 'providers'
  | 'config-install'
  | 'usage'
  | 'agents'
  | 'commands'
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
  appearance: translate('settings.groups.appearance'),
  projects: translate('settings.groups.projects'),
  general: translate('settings.groups.general'),
  opencode: translate('settings.groups.opencode'),
  git: translate('settings.groups.git'),
  skills: translate('settings.groups.skills'),
  usage: translate('settings.groups.usage'),
  advanced: translate('settings.groups.advanced'),
};

export const SETTINGS_PAGE_METADATA: readonly SettingsPageMeta[] = [
  {
    slug: 'home',
    title: translate('settings.pages.home.title'),
    group: 'general',
    kind: 'single',
    description: translate('settings.pages.home.description'),
    keywords: ['search', 'settings', '搜索', '设置'],
  },
  {
    slug: 'projects',
    title: translate('settings.pages.projects.title'),
    group: 'projects',
    kind: 'split',
    keywords: ['project', 'projects', 'worktree', 'worktrees', 'repo', 'repository', 'directory', '项目', '工作树', '仓库', '目录'],
  },
  {
    slug: 'remote-instances',
    title: translate('settings.pages.remoteInstances.title'),
    group: 'projects',
    kind: 'split',
    keywords: ['ssh', 'remote', 'instances', 'tunnels', 'forwarding', 'connection', '远程', '实例', '隧道', '转发', '连接'],
    isAvailable: (ctx) => ctx.isDesktop && !ctx.isWeb && !ctx.isVSCode,
  },
  {
    slug: 'providers',
    title: translate('settings.pages.providers.title'),
    group: 'opencode',
    kind: 'split',
    keywords: ['provider', 'providers', 'models', 'model', 'api key', 'api keys', 'openai', 'anthropic', 'ollama', 'credentials', '提供商', '模型', '凭证', '密钥'],
  },
  {
    slug: 'config-install',
    title: translate('settings.pages.configInstall.title'),
    group: 'opencode',
    kind: 'single',
    keywords: ['config', 'install', 'template', 'upload', 'opencode', 'agents', 'skills', '配置', '安装', '模板', '上传', '智能体', '技能'],
  },
  {
    slug: 'usage',
    title: translate('settings.pages.usage.title'),
    group: 'usage',
    kind: 'split',
    keywords: ['quota', 'billing', 'tokens', 'usage', 'limits', '配额', '计费', '令牌', '用量', '限制'],
  },
  {
    slug: 'agents',
    title: translate('settings.pages.agents.title'),
    group: 'opencode',
    kind: 'split',
    keywords: ['agent', 'agents', 'prompts', 'tools', 'permissions', '智能体', '提示词', '工具', '权限'],
  },
  {
    slug: 'commands',
    title: translate('settings.pages.commands.title'),
    group: 'opencode',
    kind: 'split',
    keywords: ['command', 'commands', 'slash', 'macros', 'automation', '命令', '斜杠命令', '宏', '自动化'],
  },
  {
    slug: 'mcp',
    title: translate('settings.pages.mcp.title'),
    group: 'opencode',
    kind: 'split',
    keywords: ['mcp', 'model context protocol', 'servers', 'tools', 'remote', 'stdio', '服务器', '工具', '远程'],
  },
  {
    slug: 'skills.installed',
    title: translate('settings.pages.skillsInstalled.title'),
    group: 'skills',
    kind: 'split',
    keywords: ['skill', 'skills', 'instructions', 'install', 'catalog', '技能', '指令', '安装', '目录'],
  },
  {
    slug: 'skills.catalog',
    title: translate('settings.pages.skillsCatalog.title'),
    group: 'skills',
    kind: 'single',
    keywords: ['install', 'catalog', 'external', 'repository', 'skills catalog', '安装', '目录', '外部', '仓库', '技能目录'],
  },
  {
    slug: 'git',
    title: translate('settings.pages.git.title'),
    group: 'git',
    kind: 'single',
    keywords: ['git', 'github', 'identity', 'identities', 'ssh', 'profiles', 'credentials', 'keys', 'commit', 'gitmoji', 'oauth', 'prs', 'issues', '身份', '配置', '凭证', '密钥', '提交'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'appearance',
    title: translate('settings.pages.appearance.title'),
    group: 'appearance',
    kind: 'single',
    keywords: ['theme', 'font', 'spacing', 'padding', 'corner radius', 'radius', 'input bar', 'terminal', 'pwa', 'install name', 'app shortcuts', '主题', '字体', '间距', '圆角', '输入栏', '终端'],
  },
  {
    slug: 'chat',
    title: translate('settings.pages.chat.title'),
    group: 'general',
    kind: 'single',
    keywords: ['tools', 'diff', 'reasoning', 'dotfiles', 'draft', 'queue', 'output', '聊天', '工具', '推理', '草稿', '队列', '输出'],
  },
  {
    slug: 'shortcuts',
    title: translate('settings.pages.shortcuts.title'),
    group: 'general',
    kind: 'single',
    keywords: ['keyboard', 'hotkeys', 'shortcuts', 'bindings', '键盘', '快捷键', '热键', '按键绑定'],
    isAvailable: (ctx) => !ctx.isVSCode,
  },
  {
    slug: 'sessions',
    title: translate('settings.pages.sessions.title'),
    group: 'general',
    kind: 'single',
    keywords: ['defaults', 'default agent', 'default model', 'retention', 'memory', 'limits', 'zen', '会话', '默认', '保留', '记忆', '限制'],
  },

  { slug: 'notifications', title: translate('settings.pages.notifications.title'), group: 'general', kind: 'single', keywords: ['alerts', 'native', 'summary', 'summarization', '通知', '提醒', '摘要'], },
  { slug: 'voice', title: translate('settings.pages.voice.title'), group: 'advanced', kind: 'single', keywords: ['tts', 'speech', 'voice', '语音', '朗读', '语音合成'], isAvailable: (ctx) => !ctx.isVSCode },
  { slug: 'tunnel', title: translate('settings.pages.tunnel.title'), group: 'advanced', kind: 'single', keywords: ['tunnel', 'cloudflare', 'qr', 'remote', 'mobile', 'share', '隧道', '远程', '移动端', '分享'], isAvailable: (ctx) => !ctx.isVSCode },
] as const;

export const LEGACY_SIDEBAR_SECTION_TO_SETTINGS_SLUG: Record<SidebarSection, SettingsPageSlug> = {
  sessions: 'sessions',
  agents: 'agents',
  commands: 'commands',
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
