'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export interface BoardFilters {
  search: string;
  priority: string[];
  assignee: string[];
  labels: string[];
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  search: '',
  priority: [],
  assignee: [],
  labels: [],
};

interface BoardFiltersProps {
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  issueCount: number;
  filteredCount: number;
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export function BoardFiltersBar({
  filters,
  onFiltersChange,
  issueCount,
  filteredCount,
}: BoardFiltersProps) {
  const t = useTranslations('kanban');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const activeFilterCount =
    filters.priority.length + filters.assignee.length + filters.labels.length;

  const hasAnyFilter = filters.search || activeFilterCount > 0;

  const clearFilters = () => {
    onFiltersChange(DEFAULT_BOARD_FILTERS);
    setSearchOpen(false);
  };

  const removeFilter = (type: keyof BoardFilters, value: string) => {
    if (type === 'search') {
      onFiltersChange({ ...filters, search: '' });
    } else {
      onFiltersChange({
        ...filters,
        [type]: (filters[type] as string[]).filter((v) => v !== value),
      });
    }
  };

  const togglePriority = (priority: string) => {
    const next = filters.priority.includes(priority)
      ? filters.priority.filter((p) => p !== priority)
      : [...filters.priority, priority];
    onFiltersChange({ ...filters, priority: next });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
      {/* Search */}
      {searchOpen ? (
        <div className="relative w-full min-w-0 sm:w-52">
          <Search className="text-muted-foreground absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            placeholder={t('filters.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="border-border/60 bg-background h-10 rounded-md ps-8 text-xs shadow-none sm:h-8"
            autoFocus
            onBlur={() => {
              if (!filters.search) setSearchOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onFiltersChange({ ...filters, search: '' });
                setSearchOpen(false);
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground absolute end-0.5 top-1/2 h-9 w-9 -translate-y-1/2 rounded-md sm:h-7 sm:w-7"
            onClick={() => {
              onFiltersChange({ ...filters, search: '' });
              setSearchOpen(false);
            }}
            aria-label={t('filters.clearSearch')}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground h-10 w-10 rounded-md sm:h-8 sm:w-8"
          onClick={() => setSearchOpen(true)}
          aria-label={t('filters.searchAria')}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Filter popover trigger */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'text-muted-foreground h-10 gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-150 sm:h-8',
              activeFilterCount > 0
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'hover:border-primary/30 hover:text-foreground'
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            {t('filters.filter')}
            {activeFilterCount > 0 && (
              <span className="bg-primary/15 text-primary flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[9px] font-semibold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="border-border w-64 rounded-lg p-3 shadow-sm" align="start">
          <div className="space-y-3">
            <p className="kicker">{t('filters.priority')}</p>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  aria-pressed={filters.priority.includes(priority)}
                  onClick={() => togglePriority(priority)}
                  className={cn(
                    'min-h-9 rounded-sm px-2.5 text-xs transition-colors duration-150',
                    filters.priority.includes(priority)
                      ? 'border-primary/30 bg-primary/10 text-primary border'
                      : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground border bg-transparent'
                  )}
                >
                  {t(`priority.${priority}`)}
                </button>
              ))}
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 w-full rounded-md text-xs"
                onClick={() => {
                  clearFilters();
                  setFilterOpen(false);
                }}
              >
                {t('filters.clearAll')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Issue count */}
      <span className="text-muted-foreground shrink-0 px-1 text-[11px] tabular-nums">
        {filteredCount !== issueCount
          ? `${filteredCount}/${issueCount}`
          : t('filters.issueCount', { count: issueCount })}
      </span>

      {/* Active filter pills */}
      {hasAnyFilter && (
        <>
          <div className="bg-border hidden h-3.5 w-px sm:block" />
          {filters.search && (
            <span className="border-border bg-muted/40 text-muted-foreground inline-flex min-h-8 max-w-full items-center gap-1 rounded-sm border px-2 text-[11px]">
              {`"${filters.search}"`}
              <button
                type="button"
                className="hover:bg-muted -me-1 ms-0.5 rounded-sm p-1"
                onClick={() => removeFilter('search', '')}
                aria-label={t('filters.removeSearch')}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {filters.priority.map((priority) => (
            <span
              key={priority}
              className="border-primary/20 bg-primary/10 text-primary inline-flex min-h-8 items-center gap-1 rounded-sm border px-2 text-[11px]"
            >
              {t(`priority.${priority}`)}
              <button
                type="button"
                className="hover:bg-primary/20 -me-1 ms-0.5 rounded-sm p-1"
                onClick={() => removeFilter('priority', priority)}
                aria-label={t('filters.removePriority', { priority: t(`priority.${priority}`) })}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground min-h-8 px-1 text-[11px] transition-colors duration-150"
            onClick={clearFilters}
          >
            {t('filters.clear')}
          </button>
        </>
      )}
    </div>
  );
}
