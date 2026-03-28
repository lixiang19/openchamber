import React from 'react';

import { Editor, defaultValueCtx, rootCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { nord } from '@milkdown/theme-nord';

import { cn } from '@/lib/utils';

export type MarkdownMilkdownEditorProps = {
  documentKey: string;
  value: string;
  onChange: (markdown: string) => void;
  className?: string;
};

type MarkdownMilkdownEditorInnerProps = {
  initialValue: string;
  onChange: (markdown: string) => void;
  className?: string;
};

const MarkdownMilkdownEditorInner: React.FC<MarkdownMilkdownEditorInnerProps> = ({
  initialValue,
  onChange,
  className,
}) => {
  const onChangeRef = React.useRef(onChange);
  const canEmitRef = React.useRef(false);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    canEmitRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      canEmitRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialValue);
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (!canEmitRef.current) {
            return;
          }
          onChangeRef.current(markdown);
        });
      })
      .config(nord)
      .use(commonmark)
      .use(gfm)
      .use(listener);
  }, [initialValue]);

  return (
    <div className={cn('ridge-markdown-editor h-full min-h-0 min-w-0', className)}>
      <Milkdown />
    </div>
  );
};

export const MarkdownMilkdownEditor: React.FC<MarkdownMilkdownEditorProps> = ({
  documentKey,
  value,
  onChange,
  className,
}) => {
  const currentValueRef = React.useRef(value);
  const currentDocumentKeyRef = React.useRef(documentKey);
  const [resetToken, setResetToken] = React.useState(0);

  if (currentDocumentKeyRef.current !== documentKey) {
    currentDocumentKeyRef.current = documentKey;
    currentValueRef.current = value;
  }

  React.useEffect(() => {
    if (value === currentValueRef.current) {
      return;
    }

    currentValueRef.current = value;
    setResetToken((token) => token + 1);
  }, [documentKey, value]);

  const handleChange = React.useCallback((markdown: string) => {
    if (markdown === currentValueRef.current) {
      return;
    }

    currentValueRef.current = markdown;
    onChange(markdown);
  }, [onChange]);

  return (
    <MilkdownProvider>
      <MarkdownMilkdownEditorInner
        key={`${documentKey}:${resetToken}`}
        initialValue={currentValueRef.current}
        onChange={handleChange}
        className={className}
      />
    </MilkdownProvider>
  );
};
