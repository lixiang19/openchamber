import React from 'react';

import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { replaceAll } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { nord } from '@milkdown/theme-nord';

import { cn } from '@/lib/utils';
import '@/styles/milkdown.css';
import '@milkdown/kit/prose/tables/style/tables.css';
import '@milkdown/kit/prose/view/style/prosemirror.css';

export type MilkdownMarkdownEditorHandle = {
  focus: () => void;
};

type MilkdownMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  readOnly?: boolean;
};

const MilkdownMarkdownEditorInner = React.forwardRef<MilkdownMarkdownEditorHandle, MilkdownMarkdownEditorProps>(
  function MilkdownMarkdownEditorInner({ value, onChange, className, readOnly = false }, ref) {
    const shellRef = React.useRef<HTMLDivElement | null>(null);
    const onChangeRef = React.useRef(onChange);
    const lastSyncedValueRef = React.useRef(value);

    React.useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const { get, loading } = useEditor(
      (root) => {
        return Editor.make()
          .config((ctx) => {
            ctx.set(rootCtx, root);
            ctx.set(defaultValueCtx, value);
            ctx.update(editorViewOptionsCtx, (previous) => ({
              ...previous,
              editable: () => !readOnly,
            }));
            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
              lastSyncedValueRef.current = markdown;
              onChangeRef.current(markdown);
            });
          })
          .config(nord)
          .use(commonmark)
          .use(gfm)
          .use(history)
          .use(clipboard)
          .use(listener);
      },
      [],
    );

    React.useEffect(() => {
      if (loading) {
        return;
      }

      const editor = get();
      if (!editor) {
        return;
      }

      editor.action((ctx) => {
        ctx.update(editorViewOptionsCtx, (previous) => ({
          ...previous,
          editable: () => !readOnly,
        }));
      });
    }, [get, loading, readOnly]);

    React.useEffect(() => {
      if (loading) {
        return;
      }

      const editor = get();
      if (!editor) {
        return;
      }

      if (value === lastSyncedValueRef.current) {
        return;
      }

      lastSyncedValueRef.current = value;
      editor.action(replaceAll(value));
    }, [get, loading, value]);

    React.useImperativeHandle(ref, () => ({
      focus: () => {
        const editableElement = shellRef.current?.querySelector('[contenteditable="true"]');
        if (editableElement instanceof HTMLElement) {
          editableElement.focus();
        }
      },
    }), []);

    return (
      <div
        ref={shellRef}
        className={cn('oc-milkdown-editor-shell typography-markdown-body h-full w-full', className)}
      >
        <Milkdown />
      </div>
    );
  },
);

export const MilkdownMarkdownEditor = React.forwardRef<MilkdownMarkdownEditorHandle, MilkdownMarkdownEditorProps>(
  function MilkdownMarkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownMarkdownEditorInner {...props} ref={ref} />
      </MilkdownProvider>
    );
  },
);
