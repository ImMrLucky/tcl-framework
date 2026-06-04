import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthError } from '@supabase/supabase-js';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

function readWindowSupabaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const u = (window as unknown as { __SUPABASE_URL?: string }).__SUPABASE_URL;
  return typeof u === 'string' ? u.trim() : '';
}

function readWindowSupabaseAnonKey(): string {
  if (typeof window === 'undefined') return '';
  const k = (window as unknown as { __SUPABASE_ANON_KEY?: string }).__SUPABASE_ANON_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

function supabaseStorageKeyFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0] || 'project';
    return `sb-${ref}-auth-token`;
  } catch {
    return 'sb-auth-token';
  }
}

export interface User {
  id: string;
  email?: string;
  fullName?: string;
  companyRole?: string;
  companyIndustry?: string;
  callOperation?: string;
  primaryUseCase?: string;
  onboardingCompleted?: boolean;
  orgId?: string; // Organization ID (from org_members or profile)
  projectId?: string; // Current project ID (from user context)
}

export interface AuthenticatedSession {
  userId: string;
  email?: string;
  accessToken: string;
}

export interface AuthResult {
  error: AuthError | null;
  duplicateAccount?: boolean;
  authenticated?: AuthenticatedSession;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient;
  /** Must match `createClient` `auth.storageKey` for the lifetime of this service (never re-read URL per call). */
  private readonly authStorageKey: string;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  private inactivityTimer: any = null;
  
  // Session duration constants
  private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout
  private readonly SESSION_DURATION = 15 * 60 * 60 * 1000; // 15 hours active session
  private readonly REAUTH_WINDOW = 5 * 60 * 1000; // 5 minutes - recent auth window for sensitive actions
  
  private lastActivityTime = Date.now();
  private sessionStartTime = Date.now();
  private lastReauthTime: number | null = null;
  /** Same-tab password login: storage can lag behind in-memory session; brief guard bypass. */
  private loginSessionGraceUntil: { userId: string; until: number } | null = null;
  /** While true, ignore transient SIGNED_OUT / null-session events during password login. */
  private loginInProgressUntil = 0;
  /**
   * Bumped after successful credential login/signup so the deferred constructor `getSession()` probe
   * cannot clear `currentUser` if that probe started before login (same counter was incorrectly used
   * for both "probe id" and "login bump", which let the probe stay "current" and wipe the user).
   */
  private authStateEpoch = 0;
  /** Survives full page reload after password login (sessionStorage). */
  private static readonly POST_LOGIN_STORAGE_KEY = 'tcl_post_login_session';

  constructor(private router: Router, private http: HttpClient) {
    const supabaseUrl = readWindowSupabaseUrl();
    const supabaseAnonKey = readWindowSupabaseAnonKey();
    this.authStorageKey = supabaseUrl ? supabaseStorageKeyFromUrl(supabaseUrl) : 'sb-auth-token';
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn(
        '[Auth] Missing window.__SUPABASE_URL or window.__SUPABASE_ANON_KEY. For Netlify set SUPABASE_URL + SUPABASE_ANON_KEY env vars (build generates src/assets/supabase-env.js). Locally use packages/tcl-ui/.env.supabase or export those vars before npm start. See packages/tcl-ui/README.md.'
      );
    }

    // Configure Supabase client to handle lock manager gracefully
    // The lock manager error is usually harmless - it just means another tab is managing the session
    // Using localStorage for persistent sessions (survives browser close)
    // Use sessionStorage if you want session-only (cleared on browser close)
    this.supabase = createClient(
      supabaseUrl || 'https://missing-supabase-config.invalid',
      supabaseAnonKey || 'missing-anon-key',
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storageKey: this.authStorageKey,
          // Use localStorage for persistent sessions (recommended for better UX)
          // Change to sessionStorage if you want session-only auth
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
          flowType: 'pkce',
          // Suppress lock manager warnings
          debug: false
        }
      }
    );
    
    // Suppress lock manager console errors (they're informational, not errors)
    if (typeof window !== 'undefined' && 'navigator' in window && 'locks' in navigator) {
      // Override console.error temporarily to filter lock manager messages
      const originalError = console.error;
      console.error = (...args: any[]) => {
        const message = args[0]?.toString() || '';
        // Filter out Navigator LockManager messages
        if (message.includes('Navigator LockManager') || message.includes('lock:sb-')) {
          // Suppress these - they're just informational
          return;
        }
        originalError.apply(console, args);
      };
      
      // Restore after a short delay (Supabase initializes quickly)
      setTimeout(() => {
        console.error = originalError;
      }, 2000);
    }
    
    // Listen for auth changes
    // Set up activity tracking for inactivity timeout
    this.setupActivityTracking();

    // Hydrate immediately so AuthGuard works on first navigation (before the deferred probe).
    this.restoreLoginGraceFromStorage();
    this.ensureAuthHintsApplied();

    this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        this.resetInactivityTimer();
        this.authStateEpoch++;
        const basicUser: User = {
          id: session.user.id,
          email: session.user.email || undefined,
          fullName: session.user.user_metadata?.['full_name'] as string | undefined,
        };
        this.currentUserSubject.next(basicUser);
        this.markPostLoginSession(
          session.user.id,
          session.user.email ?? undefined,
          session.access_token
        );
        try {
          await this.loadUserProfile(session.user.id);
        } catch {
          /* keep basic user */
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        this.clearInactivityTimer();
        // Supabase can emit SIGNED_OUT while swapping sessions on password login. Clearing
        // `currentUser` synchronously races AuthGuard and blocks /dashboard navigation.
        queueMicrotask(() => {
          if (this.shouldPreserveSessionAfterAuthEvent()) {
            this.restoreUserFromLoginHints();
            return;
          }
          this.currentUserSubject.next(null);
        });
        return;
      }

      if (!session) {
        // Only treat INITIAL_SESSION + no session as logged out. Other events can briefly pass null;
        // clearing here races with password login and breaks AuthGuard / redirect.
        if (event === 'INITIAL_SESSION') {
          this.clearInactivityTimer();
          if (this.hydrateUserFromStorageIfPresent()) {
            return;
          }
          if (this.applyPostLoginSessionHint()) {
            return;
          }
          if (this.shouldPreserveSessionAfterAuthEvent()) {
            this.restoreUserFromLoginHints();
            return;
          }
          this.currentUserSubject.next(null);
        }
        return;
      }

      if (session.user) {
        this.resetInactivityTimer();

        const basicUser: User = {
          id: session.user.id,
          email: session.user.email || undefined,
          fullName: session.user.user_metadata?.['full_name'] as string | undefined,
        };
        this.currentUserSubject.next(basicUser);

        try {
          await this.loadUserProfile(session.user.id);
        } catch {
          /* keep basic user */
        }
      } else if (session.access_token) {
        const who = this.userFromAccessToken(session.access_token);
        if (who) {
          this.resetInactivityTimer();
          this.currentUserSubject.next({ id: who.id, email: who.email });
          try {
            await this.loadUserProfile(who.id);
          } catch {
            /* keep minimal user */
          }
        }
      }
    });

    // Load initial session - set user immediately if session exists
    // Use a small delay to ensure localStorage is checked after any signOut operations
    setTimeout(() => {
      this.clearExpiredSession();

      if (this.hydrateUserFromStorageIfPresent()) {
        this.clearPostLoginSessionHint();
        return;
      }

      if (this.applyPostLoginSessionHint()) {
        return;
      }

      // Password login can finish during this debounce; never run a stale no-session probe
      // that would clear `currentUser` after a successful token response.
      if (this.currentUserSubject.value?.id) {
        return;
      }

      const epochWhenProbeBegan = this.authStateEpoch;
      const sessionPromise = this.supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), 12000)
      );

      Promise.race([sessionPromise, timeoutPromise])
        .then(async (result: any) => {
          if (this.authStateEpoch !== epochWhenProbeBegan) {
            return;
          }
          const {
            data: { session },
            error: sessionError,
          } = result || { data: { session: null }, error: null };
          if (sessionError) {
            if (!this.hydrateUserFromStorageIfPresent() && !this.shouldPreserveSessionAfterAuthEvent()) {
              this.currentUserSubject.next(null);
            }
            return;
          }

          if (session?.user) {
            this.resetInactivityTimer();

            const basicUser: User = {
              id: session.user.id,
              email: session.user.email || undefined,
              fullName: session.user.user_metadata?.['full_name'] as string | undefined,
            };
            this.currentUserSubject.next(basicUser);

            try {
              await this.loadUserProfile(session.user.id);
            } catch {
              /* keep basic user */
            }
          } else if (this.hydrateUserFromStorageIfPresent()) {
            return;
          } else if (this.applyPostLoginSessionHint()) {
            return;
          } else if (this.shouldPreserveSessionAfterAuthEvent()) {
            this.restoreUserFromLoginHints();
          } else {
            this.currentUserSubject.next(null);
          }
        })
        .catch((err) => {
          if (this.authStateEpoch !== epochWhenProbeBegan) {
            return;
          }
          console.warn('[Auth] Session check failed or timed out:', err?.message);
          if (this.hydrateUserFromStorageIfPresent()) {
            return;
          }
          if (this.applyPostLoginSessionHint()) {
            return;
          }
          if (this.shouldPreserveSessionAfterAuthEvent()) {
            this.restoreUserFromLoginHints();
            return;
          }
          this.clearExpiredSession();
          this.currentUserSubject.next(null);
        });
    }, 100);
  }

  /** Same key the Supabase client was constructed with. */
  private getAuthStorageKey(): string {
    return this.authStorageKey;
  }

  /**
   * Best-effort sync after password login. `signInWithPassword` already persists the session;
   * `getSession()` can hang on Navigator LockManager — never block the login button on it.
   */
  private async syncSupabaseSessionProbe(timeoutMs: number): Promise<void> {
    try {
      await Promise.race([
        this.supabase.auth.getSession(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getSession timeout')), timeoutMs)
        ),
      ]);
    } catch {
      /* session already in client + localStorage from signInWithPassword */
    }
  }

  /** Restore `currentUser` from persisted Supabase session (handles nested `currentSession` / `session` blobs). */
  private hydrateUserFromStorageIfPresent(): boolean {
    const found = this.findSessionInLocalStorage();
    if (!found?.access_token) return false;

    const storageKey = found.storageKey;
    let who: { id: string; email?: string } | null = null;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        who = this.readUserFromSplitStorage(storageKey, parsed) ?? this.userFromAccessToken(found.access_token);
      } else {
        who = this.userFromAccessToken(found.access_token);
      }
    } catch {
      who = this.userFromAccessToken(found.access_token);
    }

    if (!who?.id) return false;

    if (!this.currentUserSubject.value || this.currentUserSubject.value.id !== who.id) {
      this.currentUserSubject.next({ id: who.id, email: who.email });
      this.loadUserProfileAsync(who.id);
    }
    this.resetInactivityTimer();
    return true;
  }

  /**
   * Supabase auth-js may store `user` in a sibling key (`{storageKey}-user`) and omit it from the
   * main session blob. AuthGuard must still recognize a valid access_token.
   */
  private readUserFromSplitStorage(storageKey: string, sessionJson: Record<string, unknown>): { id: string; email?: string } | null {
    const embedded = sessionJson['user'] as { id?: string; email?: string } | undefined;
    if (embedded?.id) {
      return { id: embedded.id, email: embedded.email };
    }
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(`${storageKey}-user`);
      if (!raw) return null;
      const wrap = JSON.parse(raw) as { user?: { id?: string; email?: string } };
      if (wrap?.user?.id) {
        return { id: wrap.user.id, email: wrap.user.email };
      }
    } catch {
      /* noop */
    }
    return null;
  }

  /** Best-effort JWT payload decode for `sub` / `email` when user object is not persisted locally. */
  private userFromAccessToken(accessToken: string): { id: string; email?: string } | null {
    try {
      const parts = accessToken.split('.');
      if (parts.length !== 3) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = decodeURIComponent(
        atob(padded)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(json) as { sub?: string; email?: string };
      if (payload?.sub) {
        return { id: payload.sub, email: payload.email };
      }
    } catch {
      /* noop */
    }
    return null;
  }

  /**
   * Check if there's a valid session - used by AuthGuard and dashboard.
   *
   * Important: after `signInWithPassword`, the token request can succeed while `getSession()`
   * still returns null (Navigator LockManager) and our localStorage parser may not match every
   * Supabase storage shape yet. If `currentUser` already has an id, we **must** return true so
   * the router can reach `/dashboard`.
   */
  /**
   * Fast path for AuthGuard / login page — no async Supabase calls.
   */
  hasValidSessionSync(): boolean {
    if (this.currentUserSubject.value?.id) {
      return true;
    }
    if (this.hydrateUserFromStorageIfPresent()) {
      return true;
    }
    if (this.applyPostLoginSessionHint()) {
      return true;
    }
    if (this.getValidSessionFromStorage()?.access_token) {
      return true;
    }
    const hint = this.peekPostLoginSessionHint();
    return !!(hint?.userId && hint.accessToken);
  }

  /** Call after successful sign-in so the next navigation (including full reload) is authenticated. */
  prepareLoginRedirect(userId: string, email?: string, accessToken?: string): void {
    this.markPostLoginSession(userId, email, accessToken);
  }

  /**
   * Apply sessionStorage / localStorage hints so AuthGuard passes on the next tick.
   * Returns true if the user can be treated as signed in.
   */
  ensureAuthHintsApplied(): boolean {
    if (this.currentUserSubject.value?.id) {
      return true;
    }
    if (this.hydrateUserFromStorageIfPresent()) {
      return true;
    }
    if (this.applyPostLoginSessionHint()) {
      return true;
    }
    return this.hasValidSessionSync();
  }

  /**
   * Reliable post-login navigation: wait until session is visible in storage, then hard-navigate.
   * Avoids router + AuthGuard races with Supabase LockManager and transient SIGNED_OUT events.
   */
  async finishLoginRedirect(
    targetPath = '/dashboard',
    credentials?: AuthenticatedSession
  ): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    if (credentials?.userId && credentials.accessToken) {
      this.markPostLoginSession(credentials.userId, credentials.email, credentials.accessToken);
      if (!this.currentUserSubject.value?.id) {
        this.currentUserSubject.next({ id: credentials.userId, email: credentials.email });
      }
    } else {
      const user = this.currentUserSubject.value;
      const token = this.getAccessTokenSync();
      if (user?.id) {
        this.markPostLoginSession(user.id, user.email, token ?? undefined);
      }
    }

    this.ensureAuthHintsApplied();

    const ready =
      !!(credentials?.userId && credentials.accessToken) ||
      this.hasValidSessionSync() ||
      !!this.peekPostLoginSessionHint()?.accessToken;

    if (ready) {
      window.location.replace(targetPath);
      return;
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      this.ensureAuthHintsApplied();
      if (this.hasValidSessionSync()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    window.location.replace(targetPath);
  }

  private beginLoginAttempt(): void {
    this.loginInProgressUntil = Date.now() + 90_000;
  }

  private isLoginInProgress(): boolean {
    return Date.now() < this.loginInProgressUntil;
  }

  private shouldPreserveSessionAfterAuthEvent(): boolean {
    if (this.isLoginInProgress()) {
      return true;
    }
    if (this.loginSessionGraceUntil && Date.now() < this.loginSessionGraceUntil.until) {
      return true;
    }
    const hint = this.peekPostLoginSessionHint();
    if (hint?.userId && hint.until != null && Date.now() < hint.until) {
      return true;
    }
    if (this.getValidSessionFromStorage()?.access_token) {
      return true;
    }
    return !!(hint?.userId && (hint.accessToken || this.getValidSessionFromStorage()?.access_token));
  }

  /** Restore in-memory grace window from sessionStorage after a full page reload. */
  private restoreLoginGraceFromStorage(): void {
    const hint = this.peekPostLoginSessionHint();
    if (hint?.userId && hint.until != null && Date.now() < hint.until) {
      this.loginSessionGraceUntil = { userId: hint.userId, until: hint.until };
    }
  }

  private restoreUserFromLoginHints(): void {
    if (this.hydrateUserFromStorageIfPresent()) {
      return;
    }
    if (this.applyPostLoginSessionHint()) {
      return;
    }
    const hint = this.peekPostLoginSessionHint();
    if (hint?.userId && !this.currentUserSubject.value?.id) {
      this.currentUserSubject.next({ id: hint.userId, email: hint.email });
    }
  }

  private peekPostLoginSessionHint(): {
    userId?: string;
    email?: string;
    until?: number;
    accessToken?: string;
  } | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    try {
      const raw = sessionStorage.getItem(AuthService.POST_LOGIN_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const hint = JSON.parse(raw) as {
        userId?: string;
        email?: string;
        until?: number;
        accessToken?: string;
      };
      if (!hint?.userId || (hint.until != null && Date.now() > hint.until)) {
        return null;
      }
      return hint;
    } catch {
      return null;
    }
  }

  async checkSession(): Promise<boolean> {
    if (this.hasValidSessionSync()) {
      return true;
    }

    try {
      const sessionPromise = this.supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), 12000)
      );

      const result = (await Promise.race([sessionPromise, timeoutPromise])) as any;
      const { data: { session } } = result || { data: { session: null } };

      if (session?.access_token) {
        const expiresAt = session.expires_at;
        if (expiresAt && expiresAt * 1000 < Date.now()) {
          return false;
        }

        if (!this.currentUserSubject.value && session.user) {
          this.currentUserSubject.next({
            id: session.user.id,
            email: session.user.email || undefined,
          });
          this.loadUserProfileAsync(session.user.id);
        } else if (!this.currentUserSubject.value && session.access_token) {
          const who = this.userFromAccessToken(session.access_token);
          if (who) {
            this.currentUserSubject.next({ id: who.id, email: who.email });
            this.loadUserProfileAsync(who.id);
          }
        }

        return true;
      }
    } catch (err) {
      console.warn('[Auth] Session check failed or timed out in checkSession:', err);
      if (this.hydrateUserFromStorageIfPresent()) {
        return true;
      }
    }

    if (this.applyPostLoginSessionHint()) {
      return true;
    }

    return false;
  }

  /** Write session to localStorage in the shape `getValidSessionFromStorage` expects. */
  private persistSignInSession(session: {
    access_token: string;
    refresh_token?: string | null;
    expires_at?: number;
    expires_in?: number;
    token_type?: string;
    user?: { id: string; email?: string | null } | null;
  }): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const storageKey = this.getAuthStorageKey();
    const expiresAt =
      session.expires_at ??
      (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : undefined);
    const blob: Record<string, unknown> = {
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? '',
      expires_at: expiresAt,
      expires_in: session.expires_in,
      token_type: session.token_type ?? 'bearer',
      user: session.user ?? undefined,
    };
    localStorage.setItem(storageKey, JSON.stringify(blob));
    if (session.user?.id) {
      try {
        localStorage.setItem(`${storageKey}-user`, JSON.stringify({ user: session.user }));
      } catch {
        /* noop */
      }
    }
  }

  /**
   * Persist session, hydrate in-memory user, and stamp post-login hints — shared by signIn/signUp.
   */
  private finalizeCredentialAuth(
    session: {
      access_token: string;
      refresh_token?: string | null;
      expires_at?: number;
      expires_in?: number;
      token_type?: string;
      user?: { id: string; email?: string | null } | null;
    },
    emailFallback: string
  ): AuthenticatedSession | null {
    this.persistSignInSession(session);

    const embeddedUser = session.user;
    let userId = embeddedUser?.id;
    let userEmail = embeddedUser?.email ?? emailFallback;

    if (!userId && session.access_token) {
      const fromJwt = this.userFromAccessToken(session.access_token);
      if (fromJwt?.id) {
        userId = fromJwt.id;
        userEmail = fromJwt.email ?? emailFallback;
      }
    }

    if (!userId) {
      return null;
    }

    this.currentUserSubject.next({
      id: userId,
      email: userEmail || undefined,
    });
    this.authStateEpoch++;
    this.markPostLoginSession(userId, userEmail || undefined, session.access_token);
    this.resetSessionTimer();
    this.resetInactivityTimer();
    this.ensureUserProvisioned(userId, userEmail || emailFallback);
    this.loadUserProfileAsync(userId);
    void this.syncSupabaseSessionProbe(5000);

    return {
      userId,
      email: userEmail || undefined,
      accessToken: session.access_token,
    };
  }

  private markPostLoginSession(userId: string, email?: string, accessToken?: string): void {
    this.loginSessionGraceUntil = { userId, until: Date.now() + 120_000 };
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    sessionStorage.setItem(
      AuthService.POST_LOGIN_STORAGE_KEY,
      JSON.stringify({
        userId,
        email,
        accessToken: accessToken ?? this.getAccessTokenSync() ?? undefined,
        until: Date.now() + 120_000,
      })
    );
  }

  private applyPostLoginSessionHint(): boolean {
    const hint = this.peekPostLoginSessionHint();
    if (!hint?.userId) {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(AuthService.POST_LOGIN_STORAGE_KEY);
      }
      return false;
    }
    const hasToken =
      !!this.getValidSessionFromStorage()?.access_token || !!hint.accessToken;
    if (!hasToken) {
      return false;
    }
    if (!this.currentUserSubject.value?.id) {
      this.currentUserSubject.next({ id: hint.userId, email: hint.email });
      this.resetInactivityTimer();
    }
    return true;
  }

  clearPostLoginSessionHint(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(AuthService.POST_LOGIN_STORAGE_KEY);
    }
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    // Check if user already exists before attempting signup
    try {
      const apiUrl = this.getApiBaseUrl();
      const checkData = await firstValueFrom(
        this.http.post<{ exists: boolean }>(`${apiUrl}/auth/check-email`, { email })
      );
      
      if (checkData.exists) {
        // User already exists - return special error
        return { 
          error: { 
            message: 'An account with this email already exists. Please sign in or reset your password.',
            name: 'UserAlreadyExists',
            status: 400
          } as AuthError,
          duplicateAccount: true
        };
      }
    } catch (err) {
      // Continue with signup attempt if check fails
    }

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password
    });

    // Check for duplicate signup error from Supabase
    if (error) {
      // Supabase may return an error if user already exists
      if (error.message?.toLowerCase().includes('already registered') || 
          error.message?.toLowerCase().includes('user already exists') ||
          error.message?.toLowerCase().includes('already been registered')) {
        return { 
          error: { 
            message: 'An account with this email already exists. Please sign in or reset your password.',
            name: 'UserAlreadyExists',
            status: 400
          } as AuthError,
          duplicateAccount: true
        };
      }
      return { error, duplicateAccount: false };
    }

    if (!data.user) {
      return { 
        error: { 
          message: 'Sign up failed. Please try again.',
          name: 'SignUpError',
          status: 500
        } as AuthError,
        duplicateAccount: false
      };
    }

    // Check if email confirmation is required
    // If session is null but user exists, email confirmation is needed
    if (!data.session) {
      // Still provision the user so their profile is ready when they confirm
      try {
        const apiUrl = this.getApiBaseUrl();
        await firstValueFrom(
          this.http.post(`${apiUrl}/auth/provision`, { userId: data.user.id, email })
        );
      } catch (err) {
        // Don't fail - user will be provisioned on first login if needed
      }
      
      // Return a special message - user needs to confirm email
      return { 
        error: { 
          message: 'Please check your email to confirm your account before signing in.',
          name: 'EmailConfirmationRequired',
          status: 200 // Not really an error
        } as AuthError,
        duplicateAccount: false
      };
    }

    // Session exists - user is logged in, provision and load profile
    try {
      const apiUrl = this.getApiBaseUrl();
      await firstValueFrom(
        this.http.post(`${apiUrl}/auth/provision`, { userId: data.user.id, email })
      );
    } catch (err) {
      // Don't fail signup if provision fails
    }

    this.beginLoginAttempt();
    const authenticated = this.finalizeCredentialAuth(
      {
        ...data.session,
        user: data.user ?? data.session.user ?? undefined,
      },
      email
    );

    if (!authenticated) {
      this.loginInProgressUntil = 0;
      return {
        error: {
          message: 'Could not retrieve user information. Please try again.',
          name: 'UserError',
          status: 500,
        } as AuthError,
        duplicateAccount: false,
      };
    }

    return { error: null, duplicateAccount: false, authenticated };
  }

  public getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return apiUrl;
      }
    }
    // Fallback to relative path (will use proxy in dev, or direct in production)
    return '/api';
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    this.beginLoginAttempt();
    // Clear any expired sessions before attempting login
    // This prevents hanging on getSession() calls with expired tokens
    this.clearExpiredSession();
    
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      this.loginInProgressUntil = 0;
      return { error, duplicateAccount: false };
    }

    // Check if we got a valid session
    if (!data.session || !data.session.access_token) {
      this.loginInProgressUntil = 0;
      return { 
        error: { 
          message: 'Login succeeded but no session was created. Please try again.', 
          name: 'SessionError',
          status: 500
        } as AuthError, 
        duplicateAccount: false 
      };
    }

    const authenticated = this.finalizeCredentialAuth(
      {
        ...data.session,
        user: data.user ?? data.session.user ?? undefined,
      },
      email
    );

    if (!authenticated) {
      this.loginInProgressUntil = 0;
      await this.supabase.auth.signOut();
      return {
        error: {
          message: 'Could not retrieve user information. Please try again.',
          name: 'UserError',
          status: 500,
        } as AuthError,
        duplicateAccount: false,
      };
    }

    return { error: null, duplicateAccount: false, authenticated };
  }

  /**
   * Ensure user is provisioned (has profile, org, etc.) - runs in background
   */
  private async ensureUserProvisioned(userId: string, email: string): Promise<void> {
    try {
      // Check if user has a profile
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      
      if (!profile) {
        // No profile - try to provision
        const apiUrl = this.getApiBaseUrl();
        await firstValueFrom(
          this.http.post(`${apiUrl}/auth/provision`, { userId, email })
        );
      }
    } catch {
      // Don't throw - this is background work
    }
  }

  /**
   * Load user profile in background
   */
  private async loadUserProfileAsync(userId: string): Promise<void> {
    try {
      await this.loadUserProfile(userId);
    } catch {
      // Don't throw - user is already set with minimal data
    }
  }

  /**
   * Set up activity tracking for inactivity timeout
   */
  private setupActivityTracking(): void {
    if (typeof window === 'undefined') return;

    // Track user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
      window.addEventListener(event, () => {
        this.lastActivityTime = Date.now();
        // Only reset timer if user is authenticated
        if (this.currentUserSubject.value) {
          this.resetInactivityTimer();
        }
      }, { passive: true });
    });
  }

  async signOut(): Promise<void> {
    // STEP 1: Clear inactivity timer
    this.clearInactivityTimer();
    
    // STEP 2: Clear user state immediately (UI updates)
    this.loginSessionGraceUntil = null;
    this.loginInProgressUntil = 0;
    this.clearPostLoginSessionHint();
    this.currentUserSubject.next(null);
    
    // STEP 3: Clear all localStorage (including Supabase auth tokens and user-specific data)
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // Clear the Supabase auth token
        localStorage.removeItem(this.getAuthStorageKey());
        // Also clear any other Supabase-related keys (in case of variations)
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
        // Clear user-specific organization context
        localStorage.removeItem('activeOrgId');
      } catch (err) {
        // Ignore errors when clearing storage
      }
    }
    
    // STEP 4: Clear sessionStorage (entitlements, etc.)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        sessionStorage.removeItem('orgEntitlements');
      } catch (err) {
        // Ignore errors when clearing storage
      }
    }
    
    // STEP 5: Clear in-memory services (plan context, entitlements)
    // Note: We can't inject these services here to avoid circular dependencies,
    // but they will be cleared when components re-initialize after redirect.
    // The services should check auth state and clear themselves if user is null.
    
    // STEP 6: Sign out from Supabase (this clears the session on server)
    try {
      await this.supabase.auth.signOut();
    } catch (err) {
      // Continue even if Supabase signOut fails
    }
    
    // STEP 7: Redirect to login page with full page reload
    // This ensures all components re-initialize and check auth state fresh
    if (typeof window !== 'undefined') {
      // Use window.location.href for a full page reload (not router navigation)
      // This ensures all components re-initialize and check auth state fresh
      window.location.href = '/login';
    }
  }

  /**
   * Re-authenticate user for sensitive actions
   * Returns true if re-authentication was successful
   */
  async reAuthenticate(password: string): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUserSubject.value;
    if (!user || !user.email) {
      return { success: false, error: 'No user logged in' };
    }

    try {
      // Verify password by signing in again
      const { error } = await this.supabase.auth.signInWithPassword({
        email: user.email,
        password
      });

      if (error) {
        return { success: false, error: 'Invalid password' };
      }

      // Update last re-auth time
      this.lastReauthTime = Date.now();
      
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Re-authentication failed' };
    }
  }

  /**
   * Check if user has recently re-authenticated (within REAUTH_WINDOW)
   */
  hasRecentReauth(): boolean {
    if (!this.lastReauthTime) {
      return false;
    }
    return (Date.now() - this.lastReauthTime) < this.REAUTH_WINDOW;
  }

  /**
   * Check if the current session is still valid (within SESSION_DURATION)
   */
  isSessionValid(): boolean {
    const now = Date.now();
    
    // Check session duration (15 hours)
    if ((now - this.sessionStartTime) > this.SESSION_DURATION) {
      return false;
    }
    
    // Check inactivity timeout (30 minutes)
    if ((now - this.lastActivityTime) > this.INACTIVITY_TIMEOUT) {
      return false;
    }
    
    return true;
  }

  /**
   * Reset session start time (call after successful login)
   */
  resetSessionTimer(): void {
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
  }

  /**
   * List of sensitive actions that require re-authentication
   */
  readonly SENSITIVE_ACTIONS = [
    'delete_evaluation',
    'export_audit_packet',
    'change_org_settings',
    'manage_api_keys',
    'modify_integrations',
    'delete_organization',
    'transfer_ownership'
  ] as const;

  /**
   * Check if an action requires re-authentication
   */
  requiresReauth(action: string): boolean {
    return this.SENSITIVE_ACTIONS.includes(action as any);
  }

  async updateProfile(updates: {
    companyRole?: string;
    companyIndustry?: string;
    callOperation?: string;
    primaryUseCase?: string;
    onboardingCompleted?: boolean;
  }): Promise<{ error: any }> {
    // Try to get user from currentUserSubject first
    let user = this.currentUserSubject.value;
    
    // If not available, try to get from session
    if (!user) {
      try {
        const { data: { user: authUser }, error: authError } = await this.supabase.auth.getUser();
        if (authUser && !authError) {
          // Create a basic user object from auth user
          user = {
            id: authUser.id,
            email: authUser.email,
            fullName: authUser.user_metadata?.['full_name']
          };
        }
      } catch (e) {
        console.warn('Failed to get user from session:', e);
      }
    }
    
    if (!user || !user.id) {
      return { error: { message: 'No user logged in' } };
    }

    // Map camelCase to snake_case for database
    const dbUpdates: any = {};
    if (updates.companyRole !== undefined) dbUpdates.company_role = updates.companyRole;
    if (updates.companyIndustry !== undefined) dbUpdates.company_industry = updates.companyIndustry;
    if (updates.callOperation !== undefined) dbUpdates.call_operation = updates.callOperation;
    if (updates.primaryUseCase !== undefined) dbUpdates.primary_use_case = updates.primaryUseCase;
    
    // Only include onboarding_completed if the column exists (handle schema cache issues)
    // If the column doesn't exist, we'll skip it and log a warning
    if (updates.onboardingCompleted !== undefined) {
      dbUpdates.onboarding_completed = updates.onboardingCompleted;
    }

    // Try to update with retry logic for network errors
    let error: any = null;
    let retries = 2;
    
    while (retries >= 0) {
      try {
        const result = await this.supabase
          .from('profiles')
          .update(dbUpdates)
          .eq('id', user.id);
        
        error = result.error;
        
        // If successful or non-network error, break
        if (!error || (error.message && !error.message.includes('Failed to fetch'))) {
          break;
        }
        
        // If it's a network error and we have retries left, wait and retry
        if (retries > 0 && error.message && error.message.includes('Failed to fetch')) {
          console.warn(`Profile update failed, retrying... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          retries--;
          continue;
        }
        
        break;
      } catch (e: any) {
        // Handle exceptions (like network errors)
        if (retries > 0 && (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError'))) {
          console.warn(`Profile update exception, retrying... (${retries} retries left):`, e.message);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          retries--;
          error = e;
          continue;
        }
        error = e;
        break;
      }
    }

    // Handle specific error cases
    if (error) {
      // If error is about missing column, try again without onboarding_completed
      if (error.code === 'PGRST204' && updates.onboardingCompleted !== undefined) {
        const dbUpdatesWithoutOnboarding = { ...dbUpdates };
        delete dbUpdatesWithoutOnboarding.onboarding_completed;
        
        const { error: retryError } = await this.supabase
          .from('profiles')
          .update(dbUpdatesWithoutOnboarding)
          .eq('id', user.id);
        
        if (!retryError) {
          await this.loadUserProfile(user.id);
        }
        
        // Return a warning but not an error - the update succeeded for other fields
        return { error: { message: 'onboarding_completed column not available. Please refresh Supabase schema cache.' } };
      }
      
      // Handle network errors more gracefully
      if (error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
        // Check if session is still valid
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) {
          return { error: { message: 'Session expired. Please log in again.' } };
        }
        
        // Return a more user-friendly error message
        return { 
          error: { 
            message: 'Network error. Please check your connection and try again.',
            details: error.message,
            code: 'NETWORK_ERROR'
          } 
        };
      }
    }

    if (!error) {
      await this.loadUserProfile(user.id);
    }

    return { error };
  }

  async markOnboardingCompleted(): Promise<{ error: any }> {
    return this.updateProfile({ onboardingCompleted: true });
  }

  private async loadUserProfile(userId: string): Promise<void> {
    // Get the auth user first (this also validates the session)
    const { data: { user }, error: authError } = await this.supabase.auth.getUser();

    if (authError || !user) {
      // NEVER clear the in-memory user from this enrichment path.
      // Network blips / Navigator LockManager / transient `getUser` failures must not
      // log the user out and bounce them back to /login right after a successful sign-in.
      // Authoritative session invalidation happens in `signOut()` and `onAuthStateChange('SIGNED_OUT')`.
      return;
    }

    // Verify the user matches the requested userId
    if (user.id !== userId) {
      return;
    }

    // Try to load profile from database
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      // Database error - still set user with basic info from auth
      const basicUser: User = {
        id: userId,
        email: user.email || undefined,
        fullName: user.user_metadata?.['full_name'] as string | undefined,
        companyRole: undefined,
        companyIndustry: undefined,
        callOperation: undefined,
        primaryUseCase: undefined
      };
      this.currentUserSubject.next(basicUser);
      return;
    }

    if (!data) {
      // Profile doesn't exist yet - set basic info from auth
      const basicUser: User = {
        id: userId,
        email: user.email || undefined,
        fullName: user.user_metadata?.['full_name'] as string | undefined,
        companyRole: undefined,
        companyIndustry: undefined,
        callOperation: undefined,
        primaryUseCase: undefined
      };
      
      this.currentUserSubject.next(basicUser);
      return;
    }

    // Profile exists, use it
    this.currentUserSubject.next({
      id: userId,
      email: user.email || data.email || undefined,
      fullName: data?.full_name,
      companyRole: data?.company_role,
      companyIndustry: data?.company_industry,
      callOperation: data?.call_operation,
      primaryUseCase: data?.primary_use_case,
      onboardingCompleted: data?.onboarding_completed ?? false
    });
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  async isAuthenticated(): Promise<boolean> {
    // Use checkSession which has localStorage fallback and timeout protection
    return await this.checkSession();
  }

  // Synchronous check (for quick UI checks)
  isAuthenticatedSync(): boolean {
    return this.currentUserSubject.value !== null;
  }

  /**
   * Check if a session token is expired
   */
  private isTokenExpired(expiresAt: number | string | null | undefined): boolean {
    // If no expiration provided, assume token is valid (let backend validate)
    if (!expiresAt) return false;
    const expiryTime = typeof expiresAt === 'string' ? parseInt(expiresAt, 10) : expiresAt;
    // Check if expiryTime is valid
    if (isNaN(expiryTime) || expiryTime <= 0) return false;
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    return expiryTime < now;
  }

  /** Try primary Supabase storage key, then any `sb-*-auth-token` entry (handles key drift across deploys). */
  private findSessionInLocalStorage(): {
    access_token: string;
    expires_at?: number;
    storageKey: string;
  } | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    const keysToTry: string[] = [this.getAuthStorageKey()];
    const url = readWindowSupabaseUrl();
    if (url) {
      const derived = supabaseStorageKeyFromUrl(url);
      if (!keysToTry.includes(derived)) {
        keysToTry.push(derived);
      }
    }

    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('sb-') && k.includes('auth-token') && !keysToTry.includes(k)) {
        keysToTry.push(k);
      }
    }

    for (const storageKey of keysToTry) {
      const parsed = this.parseStoredSessionBlob(window.localStorage.getItem(storageKey));
      if (parsed) {
        return { ...parsed, storageKey };
      }
    }
    return null;
  }

  private parseStoredSessionBlob(
    stored: string | null
  ): { access_token: string; expires_at?: number } | null {
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      let session: any = null;
      let expiresAt: number | string | null = null;

      // Supabase stores session in different structures
      // Most common: { currentSession: { access_token, expires_at, ... } }
      // Also possible: { session: { access_token, ... } }
      // Or direct: { access_token, expires_at, ... }
      
      // Check for currentSession (most common Supabase format)
      if (parsed?.currentSession) {
        session = parsed.currentSession;
        expiresAt = session.expires_at;
      } 
      // Check for session
      else if (parsed?.session) {
        session = parsed.session;
        expiresAt = session.expires_at;
      } 
      // Check for direct access_token
      else if (parsed?.access_token) {
        session = parsed;
        expiresAt = parsed.expires_at;
      }
      // Check for nested value.currentSession
      else if (parsed?.value?.currentSession) {
        session = parsed.value.currentSession;
        expiresAt = session.expires_at;
      }
      // Check for nested value.session
      else if (parsed?.value?.session) {
        session = parsed.value.session;
        expiresAt = session.expires_at;
      }
      // Check for Supabase v2 format: { access_token, expires_at, ... } at root
      else if (parsed?.access_token && typeof parsed.access_token === 'string') {
        session = parsed;
        expiresAt = parsed.expires_at;
      }

      if (!session || !session.access_token || typeof session.access_token !== 'string') {
        return null;
      }

      const expires =
        expiresAt != null
          ? typeof expiresAt === 'string'
            ? parseInt(expiresAt, 10)
            : expiresAt
          : undefined;

      // Check if token is expired (skip purge during active login — clock skew / race)
      if (this.isTokenExpired(expires) && !this.shouldPreserveSessionAfterAuthEvent()) {
        return null;
      }

      return {
        access_token: session.access_token,
        expires_at: expires,
      };
    } catch {
      return null;
    }
  }

  /**
   * Validate and get session from localStorage
   */
  private getValidSessionFromStorage(): { access_token: string; expires_at?: number } | null {
    const found = this.findSessionInLocalStorage();
    if (!found) {
      return null;
    }
    return { access_token: found.access_token, expires_at: found.expires_at };
  }

  /**
   * Read access token from localStorage only (sync). Used by HttpInterceptor so API
   * calls are not sent without Authorization while getSession() is still pending.
   */
  getAccessTokenSync(): string | null {
    return this.getValidSessionFromStorage()?.access_token ?? null;
  }

  /**
   * Get the current session access token for API requests
   * Uses Supabase's built-in session management which handles refresh automatically
   */
  async getAccessToken(): Promise<string | null> {
    // Update last activity time
    this.lastActivityTime = Date.now();
    this.resetInactivityTimer();

    const cached = this.getValidSessionFromStorage();
    if (cached?.access_token) {
      return cached.access_token;
    }

    // Fallback to Supabase getSession - handles token refresh
    // Add timeout to prevent hanging
    try {
      const sessionPromise = this.supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session check timeout')), 3000)
      );
      
      const result = await Promise.race([sessionPromise, timeoutPromise]) as any;
      const { data: { session } } = result || { data: { session: null } };
      
      if (session?.access_token) {
        return session.access_token;
      }
    } catch (err: any) {
      console.warn('[Auth] getSession failed or timed out in getAccessToken:', err?.message);
      const cached = this.getValidSessionFromStorage();
      if (cached?.access_token) {
        return cached.access_token;
      }
    }
    
    return null;
  }

  /**
   * Clear expired session from localStorage
   * Call this before login attempts to prevent hanging on expired tokens
   */
  private clearExpiredSession(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const storageKey = this.getAuthStorageKey();
    const cached = this.getValidSessionFromStorage();
    if (!cached) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          JSON.parse(stored);
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
    }
  }

  /**
   * Handle expired or invalid session
   */
  private handleSessionExpired(): void {
    // Clear user state
    this.currentUserSubject.next(null);
    
    // Clear storage
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.getAuthStorageKey());
    }

    // Clear inactivity timer
    this.clearInactivityTimer();

    // Redirect to login
    this.router.navigate(['/login']);
  }

  /**
   * Reset inactivity timer
   */
  private resetInactivityTimer(): void {
    this.clearInactivityTimer();
    
    this.inactivityTimer = setTimeout(() => {
      // User inactive for timeout period, sign them out
      this.signOut();
    }, this.INACTIVITY_TIMEOUT);
  }

  /**
   * Clear inactivity timer
   */
  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

