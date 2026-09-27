export const SCIM_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write'] as const;

export type ScimScope = (typeof SCIM_SCOPES)[number];

export function isScimScope(value: string): value is ScimScope {
  return (SCIM_SCOPES as readonly string[]).includes(value);
}

/** Empty scopes only mean full access for tokens created before scope enforcement. */
export function hasScimScope(scopes: readonly string[], required: ScimScope): boolean {
  return scopes.length === 0 || scopes.includes(required);
}
