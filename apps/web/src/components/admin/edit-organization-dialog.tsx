'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

type EditOrganizationDialogProps = {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type OrganizationPlan = 'free' | 'starter' | 'growth' | 'enterprise';
type OrganizationStatus = 'active' | 'trial' | 'suspended';

export function EditOrganizationDialog({
  organizationId,
  open,
  onOpenChange,
}: EditOrganizationDialogProps) {
  const t = useTranslations('adminDialogs');
  const errorT = useTranslations('componentErrors.admin');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    plan: 'free' as OrganizationPlan,
    status: 'active' as OrganizationStatus,
    domain: '',
  });
  const [hydratedOrganizationId, setHydratedOrganizationId] = useState<string | null>(null);

  const {
    data: org,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-organization', organizationId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/organizations/${organizationId}`);
      if (!response.ok) throw new Error(errorT('fetchOrganization'));
      return response.json();
    },
    enabled: !!organizationId && open,
  });

  useEffect(() => {
    if (!open) {
      setHydratedOrganizationId(null);
      return;
    }

    if (org) {
      setFormData({
        name: org.name || '',
        slug: org.slug || '',
        plan: org.plan || 'free',
        status: org.status || 'active',
        domain: org.domain || '',
      });
      setHydratedOrganizationId(organizationId);
    }
  }, [open, org, organizationId]);

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch(`/api/admin/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(t('editOrg.toastFailedTitle'));
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-organization', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast({
        title: t('editOrg.toastUpdatedTitle'),
        description: t('editOrg.toastUpdatedDescription'),
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: t('editOrg.toastFailedTitle'),
        description: t('editOrg.toastFailedTitle'),
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editOrg.title')}</DialogTitle>
          <DialogDescription>{t('editOrg.description')}</DialogDescription>
        </DialogHeader>

        {isLoading || (!isError && hydratedOrganizationId !== organizationId) ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-muted-foreground text-sm">{t('editOrg.loadFailed')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              {t('editOrg.retry')}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">{t('orgForm.name')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">{t('orgForm.slug')}</Label>
              <Input
                id="slug"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                pattern="[a-z0-9-]+"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan">{t('orgForm.plan')}</Label>
                <Select
                  value={formData.plan}
                  onValueChange={(value: OrganizationPlan) =>
                    setFormData({ ...formData, plan: value })
                  }
                >
                  <SelectTrigger id="plan" aria-label={t('orgForm.plan')}>
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

              <div className="space-y-2">
                <Label htmlFor="status">{t('editOrg.status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: OrganizationStatus) =>
                    setFormData({ ...formData, status: value })
                  }
                >
                  <SelectTrigger id="status" aria-label={t('editOrg.status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('editOrg.statusActive')}</SelectItem>
                    <SelectItem value="trial">{t('editOrg.statusTrial')}</SelectItem>
                    <SelectItem value="suspended">{t('editOrg.statusSuspended')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">{t('editOrg.domain')}</Label>
              <Input
                id="domain"
                value={formData.domain}
                onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                placeholder={t('editOrg.domainPlaceholder')}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t('common.saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
