'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Check, ChevronsUpDown, Plus, Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { fetchAllAdminUserOptions } from '@/lib/admin/user-options';

type OrganizationPlan = 'free' | 'starter' | 'growth' | 'enterprise';

export function CreateOrganizationAdminDialog() {
  const t = useTranslations('adminDialogs');
  const errorT = useTranslations('componentErrors.admin');
  const [open, setOpen] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    ownerId: '',
    plan: 'free' as OrganizationPlan,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: ownerOptions = [],
    isLoading: ownerOptionsLoading,
    isError: ownerOptionsError,
    refetch: refetchOwnerOptions,
  } = useQuery({
    queryKey: ['admin-all-users'],
    queryFn: () => fetchAllAdminUserOptions(),
    enabled: open,
  });
  const selectedOwner = ownerOptions.find((user) => user.id === formData.ownerId);

  const createOrgMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('createOrg.toastFailedTitle'));
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('createOrg.toastCreatedTitle'),
        description: t('createOrg.toastCreatedDescription'),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      setOpen(false);
      setOwnerPickerOpen(false);
      setFormData({ name: '', slug: '', ownerId: '', plan: 'free' });
    },
    onError: () => {
      toast({
        title: t('createOrg.toastFailedTitle'),
        description: t('createOrg.toastFailedTitle'),
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.slug || !formData.ownerId) {
      toast({
        title: t('common.missingFields'),
        description: t('createOrg.missingFieldsDescription'),
        variant: 'destructive',
      });
      return;
    }
    createOrgMutation.mutate(formData);
  };

  const generateSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="me-1.5 h-4 w-4" />
          {t('createOrg.trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('createOrg.title')}</DialogTitle>
            <DialogDescription>{t('createOrg.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('orgForm.name')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setFormData({
                    ...formData,
                    name,
                    slug: formData.slug || generateSlug(name),
                  });
                }}
                placeholder={t('orgForm.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">{t('orgForm.slug')}</Label>
              <Input
                id="slug"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                placeholder={t('orgForm.slugPlaceholder')}
              />
              <p className="text-muted-foreground text-xs">{t('orgForm.slugHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">{t('createOrg.owner')}</Label>
              <Popover open={ownerPickerOpen} onOpenChange={setOwnerPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="owner"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={ownerPickerOpen}
                    aria-label={t('createOrg.owner')}
                    className="w-full justify-between px-3 font-normal"
                    disabled={ownerOptionsLoading || ownerOptionsError || ownerOptions.length === 0}
                  >
                    <span className="truncate">
                      {ownerOptionsLoading
                        ? t('createOrg.ownerLoading')
                        : selectedOwner
                          ? selectedOwner.name
                            ? `${selectedOwner.name} (${selectedOwner.email})`
                            : selectedOwner.email
                          : t('createOrg.ownerPlaceholder')}
                    </span>
                    {ownerOptionsLoading ? (
                      <Loader2 className="ms-2 h-4 w-4 shrink-0 animate-spin opacity-60" />
                    ) : (
                      <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('createOrg.ownerSearchPlaceholder')} />
                    <CommandList>
                      <CommandEmpty>{t('createOrg.ownerEmpty')}</CommandEmpty>
                      <CommandGroup>
                        {ownerOptions.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={`${user.name ?? ''} ${user.email}`}
                            onSelect={() => {
                              setFormData({ ...formData, ownerId: user.id });
                              setOwnerPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'me-2 h-4 w-4',
                                formData.ownerId === user.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="min-w-0 truncate">
                              {user.name ? `${user.name} (${user.email})` : user.email}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {ownerOptionsError && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-destructive text-xs">{errorT('fetchUsers')}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void refetchOwnerOptions()}
                  >
                    {t('createOrg.ownerRetry')}
                  </Button>
                </div>
              )}
              {!ownerOptionsLoading && !ownerOptionsError && ownerOptions.length === 0 && (
                <p className="text-muted-foreground text-xs">{t('createOrg.ownerEmpty')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan">{t('orgForm.plan')}</Label>
              <Select
                value={formData.plan}
                onValueChange={(value: OrganizationPlan) =>
                  setFormData({ ...formData, plan: value })
                }
              >
                <SelectTrigger id="plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">{t('orgForm.planFree')}</SelectItem>
                  <SelectItem value="starter">{t('orgForm.planStarter')}</SelectItem>
                  <SelectItem value="growth">{t('orgForm.planGrowth')}</SelectItem>
                  <SelectItem value="enterprise">{t('orgForm.planEnterprise')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={createOrgMutation.isPending}>
              {createOrgMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('createOrg.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
