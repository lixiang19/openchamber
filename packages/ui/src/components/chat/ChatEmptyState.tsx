import React from 'react';
import { OpenChamberLogo } from '@/components/ui/OpenChamberLogo';
import { TextLoop } from '@/components/ui/TextLoop';
import { useThemeSystem } from '@/contexts/useThemeSystem';

const phrases = [
    "修复失败的测试",
    "重构代码使其更易读",
    "添加表单验证",
    "优化这个函数",
    "为这段代码编写测试",
    "解释这段代码的工作原理",
    "添加新功能",
    "帮我调试这个问题",
    "审查我的代码",
    "简化这个逻辑",
    "添加错误处理",
    "创建一个新组件",
    "更新文档",
    "找出这里的 bug",
    "提升性能",
    "添加类型定义",
];

const ChatEmptyState: React.FC = () => {
    const { currentTheme } = useThemeSystem();

    // Use theme's muted foreground for secondary text
    const textColor = currentTheme?.colors?.surface?.mutedForeground || 'var(--muted-foreground)';

    return (
        <div className="flex flex-col items-center justify-center min-h-full w-full gap-6">
            <OpenChamberLogo width={140} height={140} className="opacity-20" isAnimated />
            <TextLoop
                className="text-body-md"
                interval={4}
                transition={{ duration: 0.5 }}
            >
                {phrases.map((phrase) => (
                    <span key={phrase} style={{ color: textColor }}>"{phrase}…"</span>
                ))}
            </TextLoop>
        </div>
    );
};

export default React.memo(ChatEmptyState);
