'use client';

/**
 * Settings page client for SSO + SCIM.
 *
 * Two tabs:
 *   - SAML: paste/upload IdP metadata XML or provide entryPoint + cert
 *           manually, edit attribute map, toggle enabled.
 *   - SCIM: list provisioning tokens, create new ones (shown once), revoke.
 *
 * IdP metadata parsing is done in the browser via DOMParser — we only need
 * the EntityID, SSO URL, and signing certificate from a standard SAML 2.0
 * IdP descriptor.
 */
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { SCIM_SCOPES, type ScimScope } from '@/lib/scim/scopes';
import { Copy, KeyRound, Trash2 } from 'lucide-react';

const DEFAULT_ATTRIBUTE_MAP = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  first_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  last_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
};

type SsoConfig = {
  id: string;
  workspaceId: string;
  provider: 'saml' | 'oidc';
  entryPointUrl: string;
  issuer: string;
  cert: string;
  audience: string;
  attributeMap: Record<string, string>;
  enabled: boolean;
  hasPrivateKey: boolean;
};

type ScimTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const SCIM_SCOPE_COPY: Record<
  ScimScope,
  {
    label:
      | 'sso.scope_users_read'
      | 'sso.scope_users_write'
      | 'sso.scope_groups_read'
      | 'sso.scope_groups_write';
    description:
      | 'sso.scope_users_read_desc'
      | 'sso.scope_users_write_desc'
      | 'sso.scope_groups_read_desc'
      | 'sso.scope_groups_write_desc';
  }
> = {
  'users:read': { label: 'sso.scope_users_read', description: 'sso.scope_users_read_desc' },
  'users:write': { label: 'sso.scope_users_write', description: 'sso.scope_users_write_desc' },
  'groups:read': { label: 'sso.scope_groups_read', description: 'sso.scope_groups_read_desc' },
  'groups:write': { label: 'sso.scope_groups_write', description: 'sso.scope_groups_write_desc' },
};

export function SsoSettingsClient({
  organizationId,
  organizationSlug,
}: {
  organizationId: string;
  organizationSlug: string;
}) {
  const t = useTranslations('settingsConfig');
  return (
    <Tabs defaultValue="saml" className="space-y-6">
      <TabsList>
        <TabsTrigger value="saml">{t('sso.tab_saml')}</TabsTrigger>
        <TabsTrigger value="scim">{t('sso.tab_scim')}</TabsTrigger>
      </TabsList>
      <TabsContent value="saml">
        <SamlSection organizationId={organizationId} organizationSlug={organizationSlug} />
      </TabsContent>
      <TabsContent value="scim">
        <ScimSection organizationId={organizationId} />
      </TabsContent>
    </Tabs>
  );
}

function parseIdpMetadataXml(xml: string): Partial<SsoConfig> {
  if (typeof window === 'undefined') return {};
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return {};
  const ed = doc.getElementsByTagNameNS('*', 'EntityDescriptor')[0];
  if (!ed) return {};
  const issuer = ed.getAttribute('entityID') ?? undefined;
  const ssoBindings = Array.from(doc.getElementsByTagNameNS('*', 'SingleSignOnService'));
  const ssoNode =
    ssoBindings.find(
      (n) => n.getAttribute('Binding') === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
    ) ?? ssoBindings[0];
  const entryPointUrl = ssoNode?.getAttribute('Location') ?? undefined;
  const certNode = doc.getElementsByTagNameNS('*', 'X509Certificate')[0];
  const cert = certNode?.textContent?.trim() ?? undefined;
  return {
    issuer: issuer ?? undefined,
    entryPointUrl: entryPointUrl ?? undefined,
    cert: cert ?? undefined,
  };
}

function SamlSection({
  organizationId,
  organizationSlug,
}: {
  organizationId: string;
  organizationSlug: string;
}) {
  const t = useTranslations('settingsConfig');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sso-config', organizationId],
    queryFn: async () => {
      const r = await fetch(`/api/sso/configs?organizationId=${organizationId}`);
      if (!r.ok) throw new Error(t('sso.load_config_failed'));
      return (await r.json()) as { ssoConfig: SsoConfig | null };
    },
  });

  const [form, setForm] = useState<SsoConfig>({
    id: '',
    workspaceId: organizationId,
    provider: 'saml',
    entryPointUrl: '',
    issuer: '',
    cert: '',
    audience: '',
    attributeMap: DEFAULT_ATTRIBUTE_MAP,
    enabled: false,
    hasPrivateKey: false,
  });
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [clearPrivateKey, setClearPrivateKey] = useState(false);

  useEffect(() => {
    if (data?.ssoConfig) {
      setForm(data.ssoConfig);
      setPrivateKey('');
      setClearPrivateKey(false);
    }
  }, [data]);

  useEffect(() => {
    const url = `${window.location.origin}/api/auth/saml/${encodeURIComponent(organizationSlug)}/metadata.xml`;
    setMetadataUrl(url);
    setForm((current) => (current.audience ? current : { ...current, audience: url }));
  }, [organizationSlug]);

  function applyMetadata(xml: string) {
    const parsed = parseIdpMetadataXml(xml);
    if (!parsed.issuer && !parsed.entryPointUrl && !parsed.cert) {
      toast({
        title: t('sso.metadata_invalid'),
        description: t('sso.metadata_invalid_desc'),
        variant: 'destructive',
      });
      return;
    }
    setForm((current) => ({
      ...current,
      issuer: parsed.issuer ?? current.issuer,
      entryPointUrl: parsed.entryPointUrl ?? current.entryPointUrl,
      cert: parsed.cert ?? current.cert,
    }));
    toast({ title: t('sso.parsed_metadata') });
  }

  const formComplete = Boolean(
    form.entryPointUrl.trim() &&
      form.issuer.trim() &&
      form.cert.trim() &&
      form.audience.trim() &&
      form.attributeMap.email?.trim()
  );

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/sso/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          provider: form.provider,
          entryPointUrl: form.entryPointUrl,
          issuer: form.issuer,
          cert: form.cert,
          audience: form.audience,
          attributeMap: form.attributeMap,
          enabled: form.enabled,
          ...(privateKey.trim() ? { privateKey: privateKey.trim() } : {}),
          clearPrivateKey,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? t('sso.save_failed'));
      }
    },
    onSuccess: () => {
      toast({ title: t('sso.config_saved') });
      setPrivateKey('');
      setClearPrivateKey(false);
      queryClient.invalidateQueries({ queryKey: ['sso-config', organizationId] });
    },
    onError: (mutationError) =>
      toast({
        title: t('sso.config_save_failed'),
        description:
          mutationError instanceof Error && mutationError.message === 'unsafe_entry_point'
            ? t('sso.entry_point_invalid')
            : mutationError instanceof Error && mutationError.message === 'invalid_certificate'
              ? t('sso.cert_invalid')
              : mutationError instanceof Error && mutationError.message === 'invalid_private_key'
                ? t('sso.private_key_invalid')
                : t('sso.save_failed'),
        variant: 'destructive',
      }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/sso/configs?organizationId=${encodeURIComponent(organizationId)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error(t('sso.config_delete_failed'));
    },
    onSuccess: () => {
      setForm({
        id: '',
        workspaceId: organizationId,
        provider: 'saml',
        entryPointUrl: '',
        issuer: '',
        cert: '',
        audience: metadataUrl,
        attributeMap: DEFAULT_ATTRIBUTE_MAP,
        enabled: false,
        hasPrivateKey: false,
      });
      setPrivateKey('');
      setClearPrivateKey(false);
      setMetadataXml('');
      queryClient.invalidateQueries({ queryKey: ['sso-config', organizationId] });
      toast({
        title: t('sso.config_deleted'),
        description: t('sso.config_deleted_desc'),
      });
    },
    onError: () =>
      toast({
        title: t('sso.config_delete_failed'),
        description: t('sso.config_delete_failed_desc'),
        variant: 'destructive',
      }),
  });

  return (
    <div className="border-border bg-card space-y-6 rounded-md border p-6">
      <div>
        <h2 className="text-lg font-semibold">{t('sso.saml_heading')}</h2>
        <div className="text-muted-foreground text-sm">
          <p>{t('sso.saml_metadata_prefix')}</p>
          {metadataUrl ? (
            <code className="bg-muted mt-1 block max-w-full break-all rounded-sm px-1.5 py-1 font-mono text-[0.85em] leading-relaxed">
              {metadataUrl}
            </code>
          ) : null}
          <p className="mt-1">{t('sso.saml_metadata_suffix')}</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('sso.config_loading')}</p>
      ) : error ? (
        <div className="panel-warn text-sm">{t('sso.load_config_failed')}</div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="metadata-upload">{t('sso.idp_metadata_label')}</Label>
        <Textarea
          id="metadata-upload"
          rows={4}
          value={metadataXml}
          onChange={(event) => setMetadataXml(event.target.value)}
          placeholder={t('sso.idp_metadata_placeholder')}
          onBlur={(e) => {
            if (e.currentTarget.value.trim()) applyMetadata(e.currentTarget.value);
          }}
        />
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="metadata-file" className="text-xs">
            {t('sso.idp_metadata_file_label')}
          </Label>
          <Input
            id="metadata-file"
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                toast({
                  title: t('sso.metadata_invalid'),
                  description: t('sso.metadata_too_large'),
                  variant: 'destructive',
                });
                event.target.value = '';
                return;
              }
              void file.text().then((xml) => {
                setMetadataXml(xml);
                applyMetadata(xml);
              });
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="issuer">{t('sso.entity_id_label')}</Label>
          <Input
            id="issuer"
            value={form.issuer}
            onChange={(e) => setForm({ ...form, issuer: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="entry">{t('sso.sso_url_label')}</Label>
          <Input
            id="entry"
            value={form.entryPointUrl}
            onChange={(e) => setForm({ ...form, entryPointUrl: e.target.value })}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="cert">{t('sso.cert_label')}</Label>
          <Textarea
            id="cert"
            rows={6}
            value={form.cert}
            onChange={(e) => setForm({ ...form, cert: e.target.value })}
            placeholder={t('sso.cert_placeholder')}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="private-key">{t('sso.private_key_label')}</Label>
            {form.hasPrivateKey && !clearPrivateKey ? (
              <Badge variant="success">{t('sso.private_key_configured')}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{t('sso.private_key_desc')}</p>
          <Textarea
            id="private-key"
            rows={5}
            value={privateKey}
            disabled={clearPrivateKey}
            onChange={(event) => {
              setPrivateKey(event.target.value);
              if (event.target.value) setClearPrivateKey(false);
            }}
            placeholder={
              form.hasPrivateKey
                ? t('sso.private_key_keep_placeholder')
                : t('sso.private_key_placeholder')
            }
          />
          {form.hasPrivateKey ? (
            <label
              htmlFor="clear-private-key"
              className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs"
            >
              <Checkbox
                id="clear-private-key"
                checked={clearPrivateKey}
                onCheckedChange={(checked) => {
                  setClearPrivateKey(checked === true);
                  if (checked === true) setPrivateKey('');
                }}
              />
              {t('sso.private_key_remove')}
            </label>
          ) : null}
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="audience">{t('sso.audience_label')}</Label>
          <Input
            id="audience"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('sso.attribute_mapping')}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(['email', 'first_name', 'last_name', 'groups'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`attr-${k}`} className="text-xs">
                {k}
              </Label>
              <Input
                id={`attr-${k}`}
                value={form.attributeMap[k] ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    attributeMap: {
                      ...form.attributeMap,
                      [k]: e.target.value,
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-border flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Switch
            id="sso-enabled"
            checked={form.enabled}
            onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
          />
          <Label htmlFor="sso-enabled" className="text-muted-foreground text-sm">
            {t('sso.enable_label')}
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.ssoConfig?.enabled ? (
            <Button asChild variant="outline">
              <a
                href={`/api/auth/saml/${encodeURIComponent(organizationSlug)}/init`}
                target="_blank"
                rel="noreferrer"
              >
                {t('sso.test_sso')}
              </a>
            </Button>
          ) : null}
          {data?.ssoConfig ? (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(t('sso.config_delete_confirm'))) remove.mutate();
              }}
            >
              <Trash2 className="me-2 h-4 w-4" />
              {t('sso.delete_config')}
            </Button>
          ) : null}
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending || remove.isPending || isLoading || Boolean(error) || !formComplete
            }
          >
            {t('sso.save_config')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScimSection({ organizationId }: { organizationId: string }) {
  const tr = useTranslations('settingsConfig');
  const formatter = useFormatter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['scim-tokens', organizationId],
    queryFn: async () => {
      const r = await fetch(`/api/sso/tokens?organizationId=${organizationId}`);
      if (!r.ok) throw new Error(tr('sso.load_tokens_failed'));
      return (await r.json()) as { tokens: ScimTokenRow[] };
    },
  });
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<ScimScope[]>([...SCIM_SCOPES]);

  const create = useMutation({
    mutationFn: async ({ tokenName, scopes }: { tokenName: string; scopes: ScimScope[] }) => {
      const r = await fetch('/api/sso/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, name: tokenName, scopes }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? tr('sso.token_create_failed'));
      }
      return (await r.json()) as { token: string };
    },
    onSuccess: (resp) => {
      setCreatedToken(resp.token);
      setName('');
      setSelectedScopes([...SCIM_SCOPES]);
      queryClient.invalidateQueries({
        queryKey: ['scim-tokens', organizationId],
      });
      toast({
        title: tr('sso.token_created_toast'),
        description: tr('sso.token_created_toast_desc'),
      });
    },
    onError: () =>
      toast({
        title: tr('sso.token_create_failed'),
        description: tr('sso.token_create_failed'),
        variant: 'destructive',
      }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/sso/tokens/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(tr('sso.token_revoke_failed'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['scim-tokens', organizationId],
      });
      toast({
        title: tr('sso.token_revoked_toast'),
        description: tr('sso.token_revoked_toast_desc'),
      });
    },
    onError: () =>
      toast({
        title: tr('sso.token_revoke_failed'),
        description: tr('sso.token_revoke_failed'),
        variant: 'destructive',
      }),
  });

  function toggleScope(scope: ScimScope, checked: boolean) {
    setSelectedScopes((current) =>
      checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope)
    );
  }

  async function copyCreatedToken() {
    if (!createdToken || !navigator.clipboard?.writeText) {
      toast({
        title: tr('sso.token_copy_failed'),
        description: tr('sso.token_copy_failed_desc'),
        variant: 'destructive',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(createdToken);
      toast({
        title: tr('sso.token_copied'),
        description: tr('sso.token_copied_desc'),
      });
      setCreatedToken(null);
    } catch {
      toast({
        title: tr('sso.token_copy_failed'),
        description: tr('sso.token_copy_failed_desc'),
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="border-border bg-card space-y-6 rounded-lg border p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">{tr('sso.scim_heading')}</h2>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          {tr('sso.scim_desc_prefix')} <code>{'/api/scim/v2/'}</code>
          {tr('sso.scim_desc_suffix')}
        </p>
      </div>

      <form
        className="bg-surface space-y-5 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && selectedScopes.length > 0) {
            create.mutate({ tokenName: name.trim(), scopes: selectedScopes });
          }
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="token-name">{tr('sso.token_name_label')}</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('sso.token_name_placeholder')}
            />
          </div>
          <Button
            type="submit"
            disabled={!name.trim() || selectedScopes.length === 0 || create.isPending}
          >
            <KeyRound className="me-2 h-4 w-4" />
            {tr('sso.generate_token')}
          </Button>
        </div>

        <fieldset className="space-y-2.5">
          <legend className="text-sm font-medium">{tr('sso.token_scopes_label')}</legend>
          <p className="text-muted-foreground text-xs">{tr('sso.token_scopes_desc')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCIM_SCOPES.map((scope) => {
              const copy = SCIM_SCOPE_COPY[scope];
              const inputId = `scim-scope-${scope.replace(':', '-')}`;
              return (
                <label
                  key={scope}
                  htmlFor={inputId}
                  className="border-border bg-card hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors"
                >
                  <Checkbox
                    id={inputId}
                    className="mt-0.5"
                    checked={selectedScopes.includes(scope)}
                    onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tr(copy.label)}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {tr(copy.description)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {selectedScopes.length === 0 ? (
            <p className="text-destructive text-xs" role="alert">
              {tr('sso.token_scope_required')}
            </p>
          ) : null}
        </fieldset>
      </form>

      {createdToken && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">{tr('sso.token_copy_warning')}</p>
          <code className="bg-background mt-2 block break-all rounded px-2 py-1 text-xs">
            {createdToken}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void copyCreatedToken()}
          >
            <Copy className="me-2 h-4 w-4" />
            {tr('sso.copy_token')}
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground py-6 text-center text-sm">{tr('sso.tokens_loading')}</p>
      ) : error ? (
        <div className="panel-warn text-sm">{tr('sso.load_tokens_failed')}</div>
      ) : (data?.tokens ?? []).length === 0 ? (
        <div className="border-border flex flex-col items-center rounded-lg border border-dashed py-10 text-center">
          <KeyRound className="text-muted-foreground/50 mb-3 h-7 w-7" />
          <p className="text-muted-foreground text-sm">{tr('sso.no_tokens')}</p>
        </div>
      ) : (
        <ul className="divide-border border-border divide-y rounded-lg border">
          {(data?.tokens ?? []).map((tokenRow) => (
            <li
              key={tokenRow.id}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{tokenRow.name}</span>
                  {tokenRow.revokedAt ? (
                    <Badge variant="muted">{tr('sso.token_revoked')}</Badge>
                  ) : (
                    <Badge variant="success">{tr('sso.token_active')}</Badge>
                  )}
                  {!tokenRow.tokenPrefix ? (
                    <Badge variant="warning">{tr('sso.token_legacy')}</Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {tokenRow.tokenPrefix ? (
                    <code className="bg-muted rounded px-1.5 py-0.5">{tokenRow.tokenPrefix}…</code>
                  ) : null}
                  <span>
                    {tr('sso.token_created', {
                      date: formatter.dateTime(new Date(tokenRow.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                  {tokenRow.lastUsedAt
                    ? ` · ${tr('sso.token_last_used', {
                        date: formatter.dateTime(new Date(tokenRow.lastUsedAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}`
                    : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(tokenRow.scopes.length === 0 ? SCIM_SCOPES : tokenRow.scopes).map((scope) => (
                    <Badge key={scope} variant="outline" size="sm">
                      {scope}
                    </Badge>
                  ))}
                  {tokenRow.scopes.length === 0 ? (
                    <span className="text-accent-amber text-xs">
                      {tr('sso.token_legacy_full_access')}
                    </span>
                  ) : null}
                </div>
              </div>
              {!tokenRow.revokedAt ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0 self-end sm:self-auto"
                  onClick={() => {
                    if (window.confirm(tr('sso.token_revoke_confirm', { name: tokenRow.name }))) {
                      revoke.mutate(tokenRow.id);
                    }
                  }}
                  disabled={revoke.isPending}
                  aria-label={tr('sso.token_revoke_aria', { name: tokenRow.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
