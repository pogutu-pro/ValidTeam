-- Persist the interface font choice used by Settings -> Appearance.
-- NULL and 'brand' both mean the original ValidTeam brand stack.

ALTER TABLE "user_appearance_settings"
  ADD COLUMN IF NOT EXISTS "interface_font" text;
