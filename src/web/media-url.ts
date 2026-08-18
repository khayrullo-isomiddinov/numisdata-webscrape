/** Maps a stored local_path (relative to data/, e.g. "images/123/0.jpg") to a servable URL. */
export function mediaUrl(localPath: string | null): string | null {
  if (!localPath) return null;
  return `/media/${localPath.split(/[\\/]/).join("/")}`;
}
