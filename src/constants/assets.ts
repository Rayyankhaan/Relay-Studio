export const STUDIO_ASSETS = {
  avatar: '/src/assets/images/avatar_creator_studio_1794766304710.jpg',
};

export function formatTier1Slot(iso: string): string {
  try {
    const d = new Date(iso);
    const est = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
    const aest = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
    return `${est} EST · ${aest} AEST`;
  } catch {
    return iso;
  }
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
