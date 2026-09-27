'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { IssueDetailView } from './issue-detail-view';

// Local VisuallyHidden replacement - renders children in sr-only span
const VisuallyHidden = ({ children }: { children: React.ReactNode }) => (
  <span className="sr-only">{children}</span>
);

interface IssueDetailModalProps {
  issueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueDetailModal({ issueId, open, onOpenChange }: IssueDetailModalProps) {
  const t = useTranslations('issuePanels');
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement && activeElement !== document.body) {
            returnFocusRef.current = activeElement;
          }
        }}
        onCloseAutoFocus={(event) => {
          const returnTarget = returnFocusRef.current;
          returnFocusRef.current = null;

          if (returnTarget?.isConnected) {
            event.preventDefault();
            returnTarget.focus({ preventScroll: true });
          }
        }}
        className="border-border !left-1/2 !top-1/2 flex h-dvh max-h-none w-screen !max-w-none !-translate-x-1/2 !-translate-y-1/2 !transform flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:h-[88vh] sm:max-h-[920px] sm:w-[92vw] sm:!max-w-6xl sm:rounded-lg sm:border sm:shadow-lg"
      >
        <VisuallyHidden>
          <DialogTitle>{t('modal.title')}</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden>
          <DialogDescription>{t('modal.description')}</DialogDescription>
        </VisuallyHidden>
        <IssueDetailView issueId={issueId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
