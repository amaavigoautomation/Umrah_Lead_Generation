import type { AppUser } from '../types';

/**
 * Browser-side session: the signed token issued by POST /api/auth/login plus the (password-free) user profile.
 * installAuthFetch() adds the token to every same-origin /api request, so existing fetch() calls keep working.
 */

const TOKEN_KEY = 'umrah360_auth_token';
const USER_KEY = 'umrah360_user_session';
export const AUTH_EXPIRED_EVENT = 'umrah360-auth-expired';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionUser(): AppUser | null {
  try {
    if (!getAuthToken()) return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && u.userId ? (u as AppUser) : null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AppUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // storage unavailable
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

let installed = false;

export function installAuthFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlStr = '';
    try {
      urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    } catch {
      urlStr = '';
    }

    let isApi = false;
    try {
      const u = new URL(urlStr, window.location.origin);
      isApi = u.origin === window.location.origin && u.pathname.startsWith('/api/');
    } catch {
      isApi = false;
    }

    if (!isApi) return originalFetch(input, init);

    const token = getAuthToken();
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (token && !headers.has('x-auth-token')) headers.set('x-auth-token', token);

    const res = await originalFetch(input, { ...init, headers });

    if (res.status === 401 && token && !urlStr.includes('/api/auth/login')) {
      clearSession();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return res;
  };
}
