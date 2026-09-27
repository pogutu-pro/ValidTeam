'use client';

import { useId, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowStatus {
  id: string;
  name: string;
  category: string;
  color: string;
}

interface StatusPickerProps {
  projectId: string;
  value: string; // statusId
  onChange: (statusId: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function StatusPicker({
  projectId,
  value,
  onChange,
  disabled,
  ariaLabel,
}: StatusPickerProps) {
  const t = useTranslations('issueMisc');
  const tRows = useTranslations('issueSidebar.rows');
  const [open, setOpen] = useState(false);
  const triggerLabelId = useId();
  const triggerValueId = useId();
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatuses() {
      try {
        const response = await fetch(`/api/projects/${projectId}/workflow-statuses`);
        if (response.ok) {
          const data = await response.json();
          setStatuses(data.statuses || []);
        }
      } catch (error) {
        console.error('Error fetching statuses:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchStatuses();
  }, [projectId]);

  const selectedStatus = statuses.find((s) => s.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={`${triggerLabelId} ${triggerValueId}`}
          className="hover:bg-accent ease-snap h-8 w-full justify-between rounded-md px-2 text-sm transition-colors duration-150"
          disabled={disabled || loading}
        >
          <span id={triggerLabelId} className="sr-only">
            {ariaLabel ?? tRows('state')}
          </span>
          {selectedStatus ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: selectedStatus.color }}
              />
              <span id={triggerValueId} className="truncate">
                {selectedStatus.name}
              </span>
            </div>
          ) : (
            <span id={triggerValueId} className="text-muted-foreground truncate">
              {t('select_status_placeholder')}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-40" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder={t('search_status_placeholder')} />
          <CommandEmpty>{t('no_status_found')}</CommandEmpty>
          <CommandGroup>
            {statuses.map((status) => (
              <CommandItem
                key={status.id}
                value={status.name}
                onSelect={() => {
                  onChange(status.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn('mr-2 h-4 w-4', value === status.id ? 'opacity-100' : 'opacity-0')}
                />
                <div
                  className="mr-2 h-2 w-2 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
