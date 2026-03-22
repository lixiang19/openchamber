import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RiFolderOpenLine,
  RiSparklingLine,
} from '@remixicon/react';

import { useI18n } from '@/contexts/useI18n';

type ProjectCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenExistingFolder: () => void;
  onOpenTemplateCreate: () => void;
};

type ProjectCreateOptionCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
};

const ProjectCreateOptionCard: React.FC<ProjectCreateOptionCardProps> = ({
  icon,
  title,
  description,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-2xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-4 py-4 text-left transition-colors hover:bg-[var(--interactive-hover)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--surface-foreground)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block typography-ui-label text-foreground">{title}</span>
        <span className="mt-1 block typography-meta text-muted-foreground">{description}</span>
      </span>
    </button>
  );
};

export const ProjectCreateDialog: React.FC<ProjectCreateDialogProps> = ({
  open,
  onOpenChange,
  onOpenExistingFolder,
  onOpenTemplateCreate,
}) => {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(680px,100vw-2rem)] overflow-hidden rounded-3xl border border-[var(--interactive-border)] bg-[var(--surface-background)] p-0">
        <div className="border-b border-[var(--interactive-border)] bg-[var(--surface-muted)]/70 px-6 py-5">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="typography-ui-header font-semibold text-foreground">{t('projectCreate.title')}</DialogTitle>
            <DialogDescription className="typography-meta text-muted-foreground">
              {t('projectCreate.description')}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-3 p-5 md:grid-cols-2">
          <ProjectCreateOptionCard
            icon={<RiFolderOpenLine className="h-5 w-5" />}
            title={t('projectCreate.openExistingFolder.title')}
            description={t('projectCreate.openExistingFolder.description')}
            onClick={onOpenExistingFolder}
          />

          <ProjectCreateOptionCard
            icon={<RiSparklingLine className="h-5 w-5" />}
            title={t('projectCreate.useTemplate.title')}
            description={t('projectCreate.useTemplate.description')}
            onClick={onOpenTemplateCreate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
