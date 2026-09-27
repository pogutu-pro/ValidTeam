'use client';

import { useTranslations } from 'next-intl';
import { useRealtimeHealth } from '@/lib/hooks/use-chat';
import { cn } from '@/lib/utils';
import { Wifi } from 'lucide-react';
import { MetricStrip, type MetricStripItem } from '@/components/ui/metric-strip';

type ServiceTone = 'live' | 'warn' | 'danger';

export function RealtimeHealthPanel() {
  const t = useTranslations('adminPanels');
  const { data, isLoading, error } = useRealtimeHealth();

  if (isLoading) {
    return (
      <div className="surface-card text-muted-foreground p-6 text-sm">
        {t('realtimeHealth.loading')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="surface-card text-destructive p-6 text-sm">
        {t('realtimeHealth.loadError')}
      </div>
    );
  }

  const services: Array<{
    name: string;
    tone: ServiceTone;
    metric: string;
    detail: string;
  }> = [
    {
      name: t('realtimeHealth.redisName'),
      tone: data.services.redis.ready ? 'live' : 'warn',
      metric: data.services.redis.ready ? t('realtimeHealth.ready') : t('realtimeHealth.fallback'),
      detail: data.services.redis.ready
        ? t('realtimeHealth.redisReadyDetail')
        : t('realtimeHealth.redisFallbackDetail'),
    },
    {
      name: t('realtimeHealth.livekitName'),
      tone: data.services.livekit.ready ? 'live' : 'danger',
      metric: data.services.livekit.ready ? t('realtimeHealth.ready') : t('realtimeHealth.blocked'),
      detail: data.services.livekit.ready
        ? t('realtimeHealth.livekitReadyDetail', { url: data.services.livekit.url ?? '' })
        : t('realtimeHealth.livekitMissingDetail', {
            missing: data.services.livekit.missing.join(', '),
          }),
    },
  ];
  const metrics: MetricStripItem[] = [
    {
      id: 'channels',
      label: t('realtimeHealth.channels'),
      value: data.stats.channels,
    },
    {
      id: 'rooms',
      label: t('realtimeHealth.rooms'),
      value: data.stats.rooms,
    },
    {
      id: 'active-calls',
      label: t('realtimeHealth.activeCalls'),
      value: data.stats.activeCalls,
      hint: data.stats.activeCalls > 0 ? t('realtimeHealth.live') : undefined,
    },
    {
      id: 'read-states',
      label: t('realtimeHealth.readStates'),
      value: data.stats.readStates,
    },
  ];

  return (
    <div className="space-y-6">
      <MetricStrip items={metrics} />

      {/* Service status grid */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('realtimeHealth.services')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.name} {...service} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ServiceCard({
  name,
  tone,
  metric,
  detail,
}: {
  name: string;
  tone: ServiceTone;
  metric: string;
  detail: string;
}) {
  const dotClass =
    tone === 'live' ? 'status-live' : tone === 'warn' ? 'status-warn' : 'status-danger';
  const textClass =
    tone === 'live'
      ? 'text-accent-emerald'
      : tone === 'warn'
        ? 'text-accent-amber'
        : 'text-accent-rose';
  const containerClass =
    tone === 'danger' ? 'panel-danger p-4 space-y-2' : 'surface-card p-4 space-y-2';
  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {tone === 'danger' ? (
            <span className="realtime-ping shrink-0">
              <span className={cn('status-dot', dotClass)} />
            </span>
          ) : (
            <span
              className={cn(
                'status-dot shrink-0',
                dotClass,
                tone === 'live' && 'animate-dot-breathe'
              )}
            />
          )}
          <span className="truncate text-sm font-medium">{name}</span>
        </div>
        <span className={cn('text-xs font-medium', textClass)}>{metric}</span>
      </div>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Wifi className="h-3 w-3 shrink-0" />
        <span className="truncate">{detail}</span>
      </p>
    </div>
  );
}
