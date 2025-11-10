const IMAGE_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.heic', '.heif'];

export function looksLikeImage(input: { name?: string | null; type?: string | null }) {
  const type = (input.type ?? '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = (input.name ?? '').toLowerCase();
  if (!name) return false;
  return IMAGE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function formatBytes(bytes?: number | null) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
