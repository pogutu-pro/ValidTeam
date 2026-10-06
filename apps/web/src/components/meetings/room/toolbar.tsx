'use client';

import { useTranslations } from 'next-intl';
import {
  Camera,
  CameraOff,
  Check,
  ChevronUp,
  Hand,
  Link2,
  LayoutGrid,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Smile,
  Users,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ReactionButtons, type ReactionKey } from './reactions';
import type { StageLayout } from './stage';

type Tone = 'neutral' | 'off' | 'active';

const TONE: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground hover:bg-secondary/75',
  off: 'bg-destructive text-destructive-foreground hover:bg-destructive/85',
  active: 'bg-accent-blue text-white hover:bg-accent-blue/90 dark:text-slate-950',
};

const ROUND =
  'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 max-sm:h-11 max-sm:w-11 [&_svg]:h-5 [&_svg]:w-5';

export function RoundButton({
  label,
  tone = 'neutral',
  pressed,
  onClick,
  disabled,
  badge,
  className,
  children,
}: {
  label: string;
  tone?: Tone;
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  badge?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(ROUND, TONE[tone], className)}
        >
          {children}
          {badge ? (
            <span className="bg-accent-blue absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white dark:text-slate-950">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export interface ToolbarProps {
  mic: { enabled: boolean; pending: boolean; toggle: () => void };
  cam: { enabled: boolean; pending: boolean; toggle: () => void };
  share: { enabled: boolean; pending: boolean; toggle: () => void; supported: boolean };
  hand: { raised: boolean; toggle: () => void };
  onReaction: (key: ReactionKey) => void;
  panel: 'people' | 'chat' | null;
  onPanel: (panel: 'people' | 'chat' | null) => void;
  unread: number;
  participantCount: number;
  isHost: boolean;
  onLeave: () => void;
  onEndForAll: () => void;
  layout: StageLayout;
  onLayout: (layout: StageLayout) => void;
  onCopyLink: () => void;
  fullscreen: { active: boolean; toggle: () => void; supported: boolean };
}

export function Toolbar(p: ToolbarProps) {
  const t = useTranslations('meetings.room');
  return (
    <nav
      aria-label={t('controls')}
      className="flex shrink-0 items-center justify-center px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="bg-card border-border flex max-w-full items-center gap-1.5 rounded-full border p-1.5 shadow-lg sm:gap-2 sm:p-2">
        <RoundButton
          label={p.mic.enabled ? t('muteMic') : t('unmuteMic')}
          tone={p.mic.enabled ? 'neutral' : 'off'}
          pressed={p.mic.enabled}
          onClick={p.mic.toggle}
          disabled={p.mic.pending}
        >
          {p.mic.enabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
        </RoundButton>
        <RoundButton
          label={p.cam.enabled ? t('stopCamera') : t('startCamera')}
          tone={p.cam.enabled ? 'neutral' : 'off'}
          pressed={p.cam.enabled}
          onClick={p.cam.toggle}
          disabled={p.cam.pending}
        >
          {p.cam.enabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
        </RoundButton>
        {p.share.supported ? (
          <RoundButton
            className="max-sm:hidden"
            label={p.share.enabled ? t('stopShare') : t('shareScreen')}
            tone={p.share.enabled ? 'active' : 'neutral'}
            pressed={p.share.enabled}
            onClick={p.share.toggle}
            disabled={p.share.pending}
          >
            <MonitorUp aria-hidden="true" />
          </RoundButton>
        ) : null}

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t('reactions')}
                  className={cn(ROUND, TONE.neutral)}
                >
                  <Smile aria-hidden="true" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t('reactions')}</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" className="w-auto p-2">
            <ReactionButtons onPick={p.onReaction} />
          </PopoverContent>
        </Popover>

        <RoundButton
          className="max-sm:hidden"
          label={p.hand.raised ? t('lowerHand') : t('raiseHand')}
          tone={p.hand.raised ? 'active' : 'neutral'}
          pressed={p.hand.raised}
          onClick={p.hand.toggle}
        >
          <Hand aria-hidden="true" />
        </RoundButton>

        <RoundButton
          label={t('people')}
          tone={p.panel === 'people' ? 'active' : 'neutral'}
          pressed={p.panel === 'people'}
          onClick={() => p.onPanel(p.panel === 'people' ? null : 'people')}
        >
          <Users aria-hidden="true" />
        </RoundButton>
        <RoundButton
          label={t('chat')}
          tone={p.panel === 'chat' ? 'active' : 'neutral'}
          pressed={p.panel === 'chat'}
          badge={p.unread}
          onClick={() => p.onPanel(p.panel === 'chat' ? null : 'chat')}
        >
          <MessageSquare aria-hidden="true" />
        </RoundButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t('more')} className={cn(ROUND, TONE.neutral)}>
                  <MoreVertical aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t('more')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="end" className="w-60">
            <DropdownMenuItem onSelect={p.onCopyLink}>
              <Link2 className="me-2 h-4 w-4" aria-hidden="true" />
              {t('copyLink')}
            </DropdownMenuItem>
            {p.fullscreen.supported ? (
              <DropdownMenuItem onSelect={p.fullscreen.toggle}>
                {p.fullscreen.active ? (
                  <Minimize className="me-2 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize className="me-2 h-4 w-4" aria-hidden="true" />
                )}
                {p.fullscreen.active ? t('exitFullscreen') : t('fullscreen')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="sm:hidden" onSelect={p.hand.toggle}>
              <Hand className="me-2 h-4 w-4" aria-hidden="true" />
              {p.hand.raised ? t('lowerHand') : t('raiseHand')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              {t('layout')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={p.layout}
              onValueChange={(v) => p.onLayout(v as StageLayout)}
            >
              <DropdownMenuRadioItem value="grid">{t('layoutGrid')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="speaker">{t('layoutSpeaker')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-[11px] font-normal">
              {t('shortcutsHint')}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="bg-border mx-0.5 h-8 w-px" aria-hidden="true" />

        <div className="flex items-center">
          <button
            type="button"
            onClick={p.onLeave}
            aria-label={t('leave')}
            className={cn(
              'bg-destructive text-destructive-foreground hover:bg-destructive/85 focus-visible:ring-ring flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 max-sm:h-11 max-sm:px-3',
              p.isHost ? 'rounded-s-full' : 'rounded-full'
            )}
          >
            <PhoneOff className="h-5 w-5" aria-hidden="true" />
            <span className="max-sm:hidden">{t('leave')}</span>
          </button>
          {p.isHost ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('leaveOptions')}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/85 border-destructive-foreground/30 focus-visible:ring-ring flex h-12 w-8 items-center justify-center rounded-e-full border-s focus-visible:outline-none focus-visible:ring-2 max-sm:h-11"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-64">
                <DropdownMenuItem onSelect={p.onLeave}>
                  <Check className="me-2 h-4 w-4 opacity-0" aria-hidden="true" />
                  {t('leaveKeepOpen')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={p.onEndForAll}
                >
                  <PhoneOff className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('endForAll')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
