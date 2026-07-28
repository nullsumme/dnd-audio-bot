export const ASSET_ICONS = [
  'audio-lines',
  'bell',
  'cloud-lightning',
  'door-open',
  'flame',
  'music',
  'skull',
  'sparkles',
  'swords',
  'waves',
  'wind',
  'zap'
] as const;

export type AssetIcon = (typeof ASSET_ICONS)[number];
export type ArtworkMimeType = 'image/jpeg' | 'image/png';
