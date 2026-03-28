import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUIStore } from "@/stores/useUIStore";
import {
  RiAddLine,
  RiAiAgentLine,
  RiAiGenerate2,
  RiBrainAi3Line,
  RiCheckboxMultipleLine,
  RiCloseCircleLine,
  RiCommandLine,
  RiGitBranchLine,
  RiLayoutLeftLine,
  RiLayoutRightLine,
  RiPaletteLine,
  RiQuestionLine,
  RiSettings3Line,
  RiStackLine,
  RiText,
  RiTimeLine,
  RiWindowLine,
} from "@remixicon/react";
import {
  getEffectiveShortcutCombo,
  getShortcutAction,
  getModifierLabel,
  formatShortcutForDisplay,
} from "@/lib/shortcuts";

type ShortcutIcon = React.ComponentType<{ className?: string }>;

type ShortcutItem = {
  id?: string;
  keys: string | string[];
  description: string;
  icon: ShortcutIcon | null;
};

type ShortcutSection = {
  category: string;
  items: ShortcutItem[];
};

const renderShortcut = (id: string, fallbackCombo: string, overrides: Record<string, string>) => {
  const action = getShortcutAction(id);
  return action ? formatShortcutForDisplay(getEffectiveShortcutCombo(id, overrides)) : fallbackCombo;
};

export const HelpDialog: React.FC = () => {
  const { isHelpDialogOpen, setHelpDialogOpen, shortcutOverrides } = useUIStore();
  const mod = getModifierLabel();

  const shortcuts: ShortcutSection[] = [
    {
      category: "导航与命令",
      items: [
        {
          id: 'open_command_palette',
          description: "打开命令面板",
          icon: RiCommandLine,
          keys: '',
        },
        {
          id: 'open_help',
          description: "显示键盘快捷键（本对话框）",
          icon: RiQuestionLine,
          keys: '',
        },
        {
          id: 'toggle_sidebar',
          description: "切换会话侧边栏",
          icon: RiLayoutLeftLine,
          keys: '',
        },
        {
          keys: ["Tab"],
          description: "切换智能体（聊天输入）",
          icon: RiAiAgentLine,
        },
        {
          id: 'open_model_selector',
          description: "打开模型选择器",
          icon: RiAiGenerate2,
          keys: '',
        },
        {
          id: 'cycle_thinking_variant',
          description: "切换思考模式",
          icon: RiBrainAi3Line,
          keys: '',
        },
        {
          keys: [`Shift + Alt + ${mod} + N`],
          description: "新建窗口（仅桌面版）",
          icon: RiWindowLine,
        },
      ],
    },
    {
      category: "会话管理",
      items: [
        {
          id: 'new_chat',
          description: "创建新会话",
          icon: RiAddLine,
          keys: '',
        },
        {
          id: 'new_chat_worktree',
          description: "在工作树中创建新会话",
          icon: RiGitBranchLine,
          keys: '',
        },
        { id: 'focus_input', description: "聚焦聊天输入", icon: RiText, keys: '' },
        {
          id: 'abort_run',
          description: "中止当前运行（双击）",
          icon: RiCloseCircleLine,
          keys: '',
        },
      ],
    },
    {
      category: "面板",
      items: [
        {
          id: 'toggle_right_sidebar',
          description: '切换右侧边栏',
          icon: RiLayoutRightLine,
          keys: '',
        },
        {
          id: 'open_right_sidebar_git',
          description: '打开右侧边栏 Git 标签',
          icon: RiGitBranchLine,
          keys: '',
        },
        {
          id: 'open_right_sidebar_files',
          description: '打开右侧边栏文件标签',
          icon: RiLayoutRightLine,
          keys: '',
        },
        {
          id: 'open_right_sidebar_todo',
          description: '打开右侧边栏待办标签',
          icon: RiCheckboxMultipleLine,
          keys: '',
        },
        {
          id: 'cycle_right_sidebar_tab',
          description: '切换右侧边栏标签',
          icon: RiLayoutRightLine,
          keys: '',
        },
        {
          id: 'toggle_terminal',
          description: '切换终端面板',
          icon: RiWindowLine,
          keys: '',
        },
        {
          id: 'toggle_terminal_expanded',
          description: '切换终端展开状态',
          icon: RiWindowLine,
          keys: '',
        },
        {
          id: 'toggle_context_plan',
          description: '切换计划上下文面板',
          icon: RiTimeLine,
          keys: '',
        },
      ],
    },
    {
      category: "界面",
      items: [
        {
          id: 'cycle_theme',
          description: "切换主题（浅色 → 深色 → 系统）",
          icon: RiPaletteLine,
          keys: '',
        },
        {
          keys: [`${mod} + 1...9`],
          description: "切换项目",
          icon: RiLayoutLeftLine,
        },
        {
          id: 'open_timeline',
          description: "打开时间线",
          icon: RiTimeLine,
          keys: '',
        },
        {
          id: 'toggle_services_menu',
          description: '切换服务菜单',
          icon: RiStackLine,
          keys: '',
        },
        {
          id: 'cycle_services_tab',
          description: '切换服务标签',
          icon: RiStackLine,
          keys: '',
        },
        {
          id: 'open_settings',
          description: "打开设置",
          icon: RiSettings3Line,
          keys: '',
        },
      ],
    },
  ];

  return (
      <Dialog open={isHelpDialogOpen} onOpenChange={setHelpDialogOpen}>
      <DialogContent className="max-w-2xl w-[min(42rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiSettings3Line className="h-5 w-5" />
            键盘快捷键
          </DialogTitle>
          <DialogDescription>
            使用这些键盘快捷键高效地操作 ridge
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-3 pr-1">
          <div className="space-y-4">
            {shortcuts.map((section) => (
              <div key={section.category}>
                <h3 className="typography-meta font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {section.category}
                </h3>
                <div className="space-y-1">
                  {section.items.map((shortcut, index) => {
                    const displayKeys = shortcut.id
                      ? renderShortcut(shortcut.id, Array.isArray(shortcut.keys) ? shortcut.keys[0] : shortcut.keys, shortcutOverrides)
                      : (Array.isArray(shortcut.keys) ? shortcut.keys : shortcut.keys.split(" / "));

                    return (
                      <div
                        key={index}
                        className="flex items-center justify-between py-1 px-2"
                      >
                        <div className="flex items-center gap-2">
                          {shortcut.icon && (
                            <shortcut.icon className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="typography-meta">
                            {shortcut.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {(Array.isArray(displayKeys) ? displayKeys : [displayKeys]).map((keyCombo: string, i: number) => (
                            <React.Fragment key={`${keyCombo}-${i}`}>
                              {i > 0 && (
                                <span className="typography-meta text-muted-foreground mx-1">
                                  or
                                </span>
                              )}
                              <kbd className="inline-flex items-center gap-1 px-1.5 py-0.5 typography-meta font-mono bg-muted rounded border border-border/20">
                                {keyCombo}
                              </kbd>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-2 bg-muted/30 rounded-xl">
            <div className="flex items-start gap-2">
              <RiQuestionLine className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
              <div className="typography-meta text-muted-foreground">
                <p className="font-medium mb-1">Pro Tips:</p>
                <ul className="space-y-0.5 typography-meta">
                  <li>
                    • Use Command Palette ({renderShortcut('open_command_palette', `${mod} K`, shortcutOverrides)}) to quickly access all
                    actions
                  </li>
                  <li>
                    • The 5 most recent sessions appear in the Command Palette
                  </li>
                  <li>
                    • Theme cycling remembers your preference across sessions
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
