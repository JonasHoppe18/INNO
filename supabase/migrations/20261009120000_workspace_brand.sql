-- Workspace brand: one logo and accent color shared by the email designs.
alter table public.workspaces
  add column if not exists brand_logo_url text,
  add column if not exists brand_accent_color text;

alter table public.workspaces
  drop constraint if exists workspaces_brand_accent_color_check;

alter table public.workspaces
  add constraint workspaces_brand_accent_color_check
  check (brand_accent_color is null or brand_accent_color ~ '^#[0-9a-fA-F]{6}$');
