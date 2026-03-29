import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { usePromptsStore, type PromptConfig, type PromptScope } from '@/stores/usePromptsStore';
import { RiFileTextLine, RiUser3Line, RiFolderLine } from '@remixicon/react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const PromptsPage: React.FC = () => {
  const { selectedPromptName, getPromptByName, createPrompt, updatePrompt, prompts, promptDraft, setPromptDraft } = usePromptsStore();

  const selectedPrompt = selectedPromptName ? getPromptByName(selectedPromptName) : null;
  const isNewPrompt = Boolean(promptDraft && promptDraft.name === selectedPromptName && !selectedPrompt);

  const [draftName, setDraftName] = React.useState('');
  const [draftScope, setDraftScope] = React.useState<PromptScope>('user');
  const [description, setDescription] = React.useState('');
  const [template, setTemplate] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const initialStateRef = React.useRef<{
    draftName: string;
    draftScope: PromptScope;
    description: string;
    template: string;
  } | null>(null);

  React.useEffect(() => {
    if (isNewPrompt && promptDraft) {
      const draftNameValue = promptDraft.name || '';
      const draftScopeValue = promptDraft.scope || 'user';
      const descriptionValue = promptDraft.description || '';
      const templateValue = promptDraft.template || '';
      setDraftName(draftNameValue);
      setDraftScope(draftScopeValue);
      setDescription(descriptionValue);
      setTemplate(templateValue);

      initialStateRef.current = {
        draftName: draftNameValue,
        draftScope: draftScopeValue,
        description: descriptionValue,
        template: templateValue,
      };
    } else if (selectedPrompt) {
      const descriptionValue = selectedPrompt.description || '';
      const templateValue = selectedPrompt.template || '';
      setDescription(descriptionValue);
      setTemplate(templateValue);

      initialStateRef.current = {
        draftName: '',
        draftScope: selectedPrompt.sourceScope || 'user',
        description: descriptionValue,
        template: templateValue,
      };
    }
  }, [selectedPrompt, isNewPrompt, selectedPromptName, prompts, promptDraft]);

  const isDirty = React.useMemo(() => {
    const initial = initialStateRef.current;
    if (!initial) {
      return false;
    }

    if (isNewPrompt) {
      if (draftName !== initial.draftName) return true;
      if (draftScope !== initial.draftScope) return true;
    }

    if (description !== initial.description) return true;
    if (template !== initial.template) return true;
    return false;
  }, [description, draftName, draftScope, isNewPrompt, template]);

  const handleSave = async () => {
    const promptName = isNewPrompt ? draftName.trim().replace(/\s+/g, '-') : selectedPromptName?.trim();
    
    if (!promptName) {
      toast.error('Prompt name is required');
      return;
    }

    if (!template.trim()) {
      toast.error('Prompt template is required');
      return;
    }

    if (isNewPrompt && prompts.some((p) => p.name === promptName)) {
      toast.error('A prompt with this name already exists');
      return;
    }

    setIsSaving(true);

    try {
      const config: PromptConfig = {
        name: promptName,
        description: description.trim() || undefined,
        template: template.trim(),
        scope: isNewPrompt ? draftScope : undefined,
      };

      let success: boolean;
      if (isNewPrompt) {
        success = await createPrompt(config);
        if (success) {
          setPromptDraft(null); 
        }
      } else {
        success = await updatePrompt(promptName, config);
      }

      if (success) {
        toast.success(isNewPrompt ? 'Prompt created successfully' : 'Prompt updated successfully');
      } else {
        toast.error(isNewPrompt ? 'Failed to create prompt' : 'Failed to update prompt');
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      toast.error('An error occurred while saving');
    } finally {
      setIsSaving(false);
    }
  };

  if (!selectedPromptName) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiFileTextLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">Select a prompt template from the sidebar</p>
          <p className="typography-meta mt-1 opacity-75">or create a new one</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollableOverlay keyboardAvoid outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {isNewPrompt ? 'New Prompt' : `/${selectedPromptName}`}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              {isNewPrompt ? 'Create a pi prompt template' : 'Edit prompt template'}
            </p>
          </div>
        </div>

        {/* Identity */}
        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">
              Identity
            </h3>
          </div>

          <section className="px-2 pb-2 pt-0 space-y-0">

            {isNewPrompt && (
              <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
                <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
                  <span className="typography-ui-label text-foreground">Prompt Name</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-fit sm:flex-initial">
                  <div className="flex items-center">
                    <span className="typography-ui-label text-muted-foreground mr-1">/</span>
                    <Input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="prompt-name"
                      className="h-7 w-40 px-2"
                    />
                  </div>
                  <Select value={draftScope} onValueChange={(v) => setDraftScope(v as PromptScope)}>
                    <SelectTrigger className="w-fit min-w-[100px]">
                      <SelectValue placeholder="范围" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="user">
                        <div className="flex items-center gap-2">
                          <RiUser3Line className="h-3.5 w-3.5" />
                          <span>Global</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="project">
                        <div className="flex items-center gap-2">
                          <RiFolderLine className="h-3.5 w-3.5" />
                          <span>Project</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="py-1.5">
              <span className="typography-ui-label text-foreground">Description</span>
              <div className="mt-1.5">
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="这个提示词是做什么的？"
                  className="h-7 w-full px-2"
                />
              </div>
            </div>

          </section>
        </div>

        {/* Prompt Template */}
        <div className="mb-2">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">
              Template
            </h3>
          </div>

          <section className="px-2 pb-2 pt-0">
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={`Your prompt template here...\n\nUse {{variable}} syntax for placeholders.\n\nExample:\nReview this code for bugs, security issues, and performance problems.\nFocus on: {{focus}}`}
              rows={15}
              className="w-full font-mono typography-meta min-h-[200px] max-h-[70vh] bg-transparent resize-y"
            />
          </section>

          <div className="mt-2 px-2">
            <p className="typography-meta text-muted-foreground">
              <code className="text-foreground">{'{{variable}}'}</code> placeholders will be replaced when using <code className="text-foreground">/prompt-name</code>
            </p>
          </div>
        </div>

        {/* Save action */}
        <div className="px-2 py-1">
          <Button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            size="xs"
            className="!font-normal"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

      </div>
    </ScrollableOverlay>
  );
};
