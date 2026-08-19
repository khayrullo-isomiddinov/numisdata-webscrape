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

/**
 * Builds a sixbid image-cdn URL from a lot's `googleBucketImagePath` at the given size. Defaults
 * to "o" (original) - confirmed live that "l" (large) is a meaningfully downsized/recompressed
 * variant (~41KB vs "o"'s ~107KB for the same lot), not full quality, and this archive should
 * preserve the same image quality sixbid itself shows.
 */
export function sixbidImageUrl(bucketPath: string, size: "s" | "m" | "l" | "o" = "o"): string {
  return `https://image-cdn.sixbid.com/v7/lots/${bucketPath}?p=lot_${size}`;
}
