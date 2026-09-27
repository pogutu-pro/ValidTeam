-- First-class lifecycle actions for SAML identity-provider configuration.
ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'sso_config.created';
ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'sso_config.updated';
ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'sso_config.deleted';
