function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

function hostFromUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** True if `itemUrl` (a vault item's stored URL) looks like it belongs to `tabUrl`'s site — same
 * registrable-ish host or one is a subdomain of the other (e.g. item "github.com" matches tab
 * "gist.github.com"). Best-effort; items without a URL simply never match. */
export function siteMatches(itemUrl: string | undefined, tabUrl: string | undefined): boolean {
  if (!itemUrl || !tabUrl) return false;
  const itemHost = hostFromUrl(itemUrl) ?? normalizeHost(itemUrl);
  const tabHost = hostFromUrl(tabUrl);
  if (!itemHost || !tabHost) return false;
  return itemHost === tabHost || tabHost.endsWith(`.${itemHost}`) || itemHost.endsWith(`.${tabHost}`);
}
