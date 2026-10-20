/**
 * Dev only. Laravel serves the pages from the site's origin while Vite serves
 * scripts from its own port, and browsers refuse to start a worker script from
 * another origin. A same-origin blob that imports the real script works (Vite
 * sends CORS headers). Production builds serve both from one origin, so this
 * module is empty there.
 *
 * Patching the global keeps the literal `new Worker(new URL(...))` call sites,
 * which is the pattern Vite looks for to bundle the worker.
 */
if (import.meta.env.DEV) {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const href = new URL(url, location.href);
      if (href.origin !== location.origin && options?.type === 'module') {
        const shim = new Blob([`import ${JSON.stringify(href.href)};`], { type: 'text/javascript' });
        url = URL.createObjectURL(shim);
      }
      super(url, options);
    }
  };
}
