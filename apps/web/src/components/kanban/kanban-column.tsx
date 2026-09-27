'use client';

import { Plus, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { useTranslations } from 'next-intl';

interface KanbanColumnProps {
  column: {
    id: string;
    name: string;
    color: string;
    category: string;
  };
  issueCount: number;
  projectId: string;
  statusId?: string;
  issueIds?: string[];
  children: React.ReactNode;
}

export function KanbanColumn({
  column,
  issueCount,
  projectId,
  statusId = column.id,
  issueIds = [],
  children,
}: KanbanColumnProps) {
  const t = useTranslations('kanban');
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', statusId, category: column.category },
  });
  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <>
      <div
        ref={setNodeRef}
        className={cn(
          'kanban-column group flex h-full min-h-[28rem] w-[calc(100vw-1.5rem)] max-w-72 shrink-0 touch-manipulation flex-col overflow-hidden sm:w-72',
          isOver && 'kanban-column-drop-active'
        )}
      >
        {/* Header: name + count + add */}
        <div className="kanban-column-header border-border/70 bg-surface/80 flex min-h-10 items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-foreground/80 truncate text-[11px] font-semibold uppercase tracking-[0.12em]">
              {column.name}
            </h3>
            <span className="chip tabular-nums">{issueCount}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-9 w-9 p-0 sm:h-8 sm:w-8"
            onClick={() => setCreateModalOpen(true)}
            aria-label={t('column.addIssue')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Content */}
        <div className="custom-scrollbar min-h-[24rem] flex-1 overflow-y-auto px-2 py-2.5">
          <SortableContext items={issueIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">{children}</div>
          </SortableContext>
          {issueCount === 0 ? (
            <div className="border-border/70 mx-1 mt-2 flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-6 text-center">
              <Inbox className="text-muted-foreground h-5 w-5" aria-hidden />
              <div className="space-y-0.5">
                <p className="text-foreground text-xs font-medium">{t('column.emptyTitle')}</p>
                <p className="text-muted-foreground text-[11px]">
                  {t.rich('column.emptyBody', {
                    name: column.name,
                    strong: (chunks) => (
                      <span className="text-foreground/80 font-medium">{chunks}</span>
                    ),
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-full text-xs sm:h-8"
                onClick={() => setCreateModalOpen(true)}
              >
                <Plus className="me-1 h-3 w-3" />
                {t('column.newIssue')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <CreateIssueModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        projectId={projectId}
        defaultStatusId={statusId}
      />
    </>
  );
}
