import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Code splitting helpers.
 *
 * Screens that are not needed on first paint are loaded only when opened (or in idle time after
 * sign-in, see prefetchLazy). Vite turns each `import()` below into its own small JS file.
 */

const RELOAD_FLAG = 'chunk-reload-attempted';

/**
 * After a new deploy, a tab that was opened BEFORE the deploy still asks for the old file names,
 * which no longer exist (404). Then reload the page once to get the new build. If it still fails
 * after that reload, let the error reach the ErrorBoundary instead of reloading forever.
 */
function withRetry<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err) => {
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyTried) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        alreadyTried = true; // storage blocked: never risk a reload loop
      }
      if (!alreadyTried && typeof window !== 'undefined') {
        window.location.reload();
        return new Promise<T>(() => {}); // the page is reloading
      }
      throw err;
    });
}

/** Call once the app has started fine, so a future failed chunk may reload again. */
export function markAppLoaded() {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {}
}

const prefetchers: Array<() => Promise<unknown>> = [];

/**
 * React.lazy for a NAMED export: lazyNamed(() => import('./X'), 'X').
 * The loader is also registered for prefetchLazy().
 */
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K
): LazyExoticComponent<M[K] extends ComponentType<any> ? M[K] : never> {
  type T = M[K] extends ComponentType<any> ? M[K] : never;
  // One shared download per screen (prefetch and render reuse it); a failure clears it for a retry.
  let pending: Promise<M> | null = null;
  const loadOnce = () =>
    (pending ||= load().catch((e) => {
      pending = null;
      throw e;
    }));
  // Prefetch never reloads the page on failure (it is only a background optimisation).
  prefetchers.push(loadOnce);
  // Rendering the screen does: a missing file after a deploy -> one reload to the new build.
  return lazy(() => withRetry(loadOnce)().then((m) => ({ default: m[name] as unknown as T })));
}

/**
 * Download every lazy screen in the background when the browser is idle, so opening a tab later is
 * instant (no spinner). Runs at most once.
 */
let prefetched = false;
export function prefetchLazy() {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  const run = () => {
    // One at a time, so prefetching never competes with what the user is doing.
    prefetchers.reduce<Promise<unknown>>((p, f) => p.then(() => f().catch(() => {})), Promise.resolve());
  };
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}
