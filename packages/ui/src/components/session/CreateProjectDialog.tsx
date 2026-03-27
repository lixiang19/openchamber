import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { formatPathForDisplay } from '@/lib/utils';
import {
  createManagedProject,
  listManagedProjectTemplates,
} from '@/lib/managedProjects';
import type { ManagedProjectTemplateSummary, ProjectEntry } from '@/lib/api/types';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: ProjectEntry) => void;
}

const buildManagedProjectsRoot = (homeDirectory?: string | null): string => {
  const normalizedHome = typeof homeDirectory === 'string' ? homeDirectory.trim().replace(/\/+$/, '') : '';
  if (!normalizedHome) {
    return '~/ridge/projects';
  }
  return `${normalizedHome}/ridge/projects`;
};

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const [projectName, setProjectName] = React.useState('');
  const [templateId, setTemplateId] = React.useState('');
  const [templates, setTemplates] = React.useState<ManagedProjectTemplateSummary[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const managedProjectsRoot = React.useMemo(
    () => buildManagedProjectsRoot(homeDirectory),
    [homeDirectory],
  );
  const managedProjectsRootLabel = React.useMemo(
    () => formatPathForDisplay(managedProjectsRoot, homeDirectory),
    [homeDirectory, managedProjectsRoot],
  );
  const selectedTemplate = React.useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  );
  const trimmedProjectName = projectName.trim();

  React.useEffect(() => {
    if (!open) {
      setProjectName('');
      setTemplateId('');
      setTemplates([]);
      setLoadError(null);
      setIsLoadingTemplates(false);
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;
    setIsLoadingTemplates(true);
    setLoadError(null);

    listManagedProjectTemplates()
      .then((nextTemplates) => {
        if (cancelled) {
          return;
        }
        setTemplates(nextTemplates);
        setTemplateId(nextTemplates[0]?.id ?? '');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : '加载项目模板失败');
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTemplates(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSubmit = React.useCallback(async () => {
    if (!trimmedProjectName) {
      toast.error('请输入项目名称');
      return;
    }
    if (!templateId) {
      toast.error('请选择一个模板');
      return;
    }

    setIsSubmitting(true);
    const result = await createManagedProject({
      projectName: trimmedProjectName,
      templateId,
    });
    setIsSubmitting(false);

    if (!result.success || !result.project) {
      toast.error('创建项目失败', {
        description: result.error || '请稍后重试。',
      });
      return;
    }

    toast.success('项目已创建', {
      description: result.targetDirectory
        ? formatPathForDisplay(result.targetDirectory, homeDirectory)
        : undefined,
    });
    onCreated?.(result.project);
    onOpenChange(false);
  }, [homeDirectory, onCreated, onOpenChange, templateId, trimmedProjectName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
          <DialogDescription>
            新项目会创建在固定目录下，并立即加入项目列表。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="typography-meta text-muted-foreground">创建位置</p>
            <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground">
              {managedProjectsRootLabel}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="typography-meta text-muted-foreground">项目名称</p>
            <Input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="例如：landing page"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isSubmitting) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <p className="typography-meta text-muted-foreground">模板</p>
            <Select value={templateId} onValueChange={setTemplateId} disabled={isLoadingTemplates || templates.length === 0}>
              <SelectTrigger size="lg" className="w-full justify-between">
                <SelectValue placeholder={isLoadingTemplates ? '加载模板中...' : '选择模板'} />
              </SelectTrigger>
              <SelectContent align="start">
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id} className="pr-2 [&>span:first-child]:hidden">
                    <div className="flex flex-col items-start gap-0.5 py-0.5">
                      <span className="text-sm text-foreground">{template.label}</span>
                      <span className="text-xs text-muted-foreground">{template.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadError ? (
              <p className="text-sm text-[var(--status-error)]">{loadError}</p>
            ) : selectedTemplate ? (
              <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || isLoadingTemplates || !trimmedProjectName || !templateId}
          >
            {isSubmitting ? '创建中...' : '创建项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
