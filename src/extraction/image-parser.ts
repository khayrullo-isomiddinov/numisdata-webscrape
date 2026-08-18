/**
 * Biddr image URLs follow a `{id}_{token}.l.jpg` (large thumbnail) vs `{id}_{token}.jpg`
 * (full resolution, used as the PhotoSwipe lightbox target) convention. Given either form,
 * derive the other so callers can choose thumbnail vs full-size without a second request.
 */
export function deriveFullSizeUrl(url: string): string {
  return url.replace(/\.l\.(jpe?g|png|webp)$/i, ".$1");
}

export function deriveThumbnailUrl(url: string): string {
  if (/\.l\.(jpe?g|png|webp)$/i.test(url)) return url;
  return url.replace(/\.(jpe?g|png|webp)$/i, ".l.$1");
}

export function isLikelyImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
}
