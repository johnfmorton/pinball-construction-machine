/**
 * What the server tells every page about the site, inlined by the Blade shell
 * (resources/views/partials/head.blade.php) so pages don't fetch it on load.
 */
export interface Session {
  features: { lab: boolean };
}

const FALLBACK: Session = { features: { lab: true } };

let cached: Session | null = null;

export function session(): Session {
  if (cached) return cached;
  try {
    const raw = document.getElementById('pcm-session')?.textContent;
    cached = raw ? { ...FALLBACK, ...(JSON.parse(raw) as Partial<Session>) } : FALLBACK;
  } catch {
    cached = FALLBACK;
  }
  return cached;
}
