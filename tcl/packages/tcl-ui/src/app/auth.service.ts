import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthError } from '@supabase/supabase-js';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

export interface User {
  id: string;
  email?: string;
  fullName?: string;
  companyRole?: string;
  companyIndustry?: string;
  callOperation?: string;
  primaryUseCase?: string;
  onboardingCompleted?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient;
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

  constructor(private router: Router, private http: HttpClient) {
    // Use environment variables if available, fallback to hardcoded for development
    const supabaseUrl = (typeof window !== 'undefined' && (window as any).__SUPABASE_URL) 
      || 'https://uqwcmkyaskyduxuluqrm.supabase.co';
    const supabaseAnonKey = (typeof window !== 'undefined' && (window as any).__SUPABASE_ANON_KEY)
      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxd2Nta3lhc2t5ZHV4dWx1cXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NjA4MTQsImV4cCI6MjA4MjUzNjgxNH0.hmH7rX3ujck-3zBj1OsWXE2QB_we2xXlBWCzXr_WOB0';
    
    // Configure Supabase client to handle lock manager gracefully
    // The lock manager error is usually harmless - it just means another tab is managing the session
    // Using localStorage for persistent sessions (survives browser close)
    // Use sessionStorage if you want session-only (cleared on browser close)
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Use a unique storage key
        storageKey: 'sb-uqwcmkyaskyduxuluqrm-auth-token',
        // Use localStorage for persistent sessions (recommended for better UX)
        // Change to sessionStorage if you want session-only auth
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce',
        // Suppress lock manager warnings
        debug: false
      }
    });
    
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

    this.supabase.auth.onAuthStateChange(async (event, session) => {
      // Handle SIGNED_OUT event explicitly
      if (event === 'SIGNED_OUT' || !session) {
        this.currentUserSubject.next(null);
        return;
      }
      
      if (session?.user) {
        // User is logged in, start inactivity timer
        this.resetInactivityTimer();
        
        // Set basic user immediately so UI updates right away
        const basicUser: User = {
          id: session.user.id,
          email: session.user.email || undefined,
          fullName: session.user.user_metadata?.['full_name'] as string | undefined
        };
        this.currentUserSubject.next(basicUser);
        
        // Ensure session is persisted to localStorage
        // Supabase should do this automatically, but we'll verify
        if (session.access_token) {
          // Session is available, it should be in localStorage
          // The getAccessToken() method will retrieve it from there
        }
        
        // Then load full profile in background
        try {
          await this.loadUserProfile(session.user.id);
        } catch (err: any) {
          // Keep the basic user even if profile load fails
          // User is still logged in, just without profile data
        }
      } else {
        // No session - clear user state and timer
        this.clearInactivityTimer();
        this.currentUserSubject.next(null);
      }
    });

    // Load initial session - set user immediately if session exists
    // Use a small delay to ensure localStorage is checked after any signOut operations
    setTimeout(() => {
      // Clear expired session first to prevent hanging
      this.clearExpiredSession();
      
      // Add timeout to getSession to prevent hanging
      const sessionPromise = this.supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session check timeout')), 3000)
      );
      
      Promise.race([sessionPromise, timeoutPromise]).then(async (result: any) => {
        const { data: { session }, error: sessionError } = result || { data: { session: null }, error: null };
        if (sessionError) {
          this.currentUserSubject.next(null);
          return;
        }
        
        // Double-check localStorage - if auth token was cleared, don't restore session
        if (typeof window !== 'undefined' && window.localStorage) {
          const authToken = localStorage.getItem('sb-uqwcmkyaskyduxuluqrm-auth-token');
          if (!authToken && session) {
            await this.supabase.auth.signOut();
            this.currentUserSubject.next(null);
            return;
          }
        }
        
        if (session?.user) {
          this.resetInactivityTimer();
          
          const basicUser: User = {
            id: session.user.id,
            email: session.user.email || undefined,
            fullName: session.user.user_metadata?.['full_name'] as string | undefined
          };
          this.currentUserSubject.next(basicUser);
          
          try {
            await this.loadUserProfile(session.user.id);
          } catch {
            // Keep the basic user even if profile load fails
          }
        } else {
          this.currentUserSubject.next(null);
        }
      }).catch((err) => {
        console.warn('[Auth] Session check failed or timed out:', err?.message);
        // Clear expired session on timeout
        this.clearExpiredSession();
        this.currentUserSubject.next(null);
      });
    }, 100);
  }

  /**
   * Check if there's a valid session - used by AuthGuard
   * Returns true if user has a valid session, false otherwise
   */
  async checkSession(): Promise<boolean> {
    // Check localStorage first - this is synchronous and avoids race conditions
    const storageKey = 'sb-uqwcmkyaskyduxuluqrm-auth-token';
    const storedSession = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
    
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed.access_token && parsed.user) {
          // Check expiry
          const expiresAt = parsed.expires_at;
          if (expiresAt && expiresAt * 1000 < Date.now()) {
            // Token expired
            return false;
          }
          
          // Valid token found - update user subject if needed
          if (!this.currentUserSubject.value) {
            this.currentUserSubject.next({
              id: parsed.user.id,
              email: parsed.user.email || undefined
            });
            // Load full profile in background
            this.loadUserProfileAsync(parsed.user.id);
          }
          return true;
        }
      } catch {
        // Invalid JSON in storage - fall through
      }
    }
    
    // Fallback: Try Supabase getSession (handles refresh tokens, etc.)
    // Add timeout to prevent hanging
    try {
      const sessionPromise = this.supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session check timeout')), 3000)
      );
      
      const result = await Promise.race([sessionPromise, timeoutPromise]) as any;
      const { data: { session } } = result || { data: { session: null } };
      
      if (session?.access_token) {
        const expiresAt = session.expires_at;
        if (expiresAt && expiresAt * 1000 < Date.now()) {
          return false;
        }
        
        if (!this.currentUserSubject.value && session.user) {
          this.currentUserSubject.next({
            id: session.user.id,
            email: session.user.email || undefined
          });
          this.loadUserProfileAsync(session.user.id);
        }
        
        return true;
      }
    } catch (err) {
      // Supabase error or timeout - already checked localStorage, so return false
      console.warn('[Auth] Session check failed or timed out in checkSession:', err);
    }
    
    return false;
  }

  async signUp(email: string, password: string): Promise<{ error: AuthError | null; duplicateAccount?: boolean }> {
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

    // Load profile after signup
    await this.loadUserProfile(data.user.id);

    return { error: null, duplicateAccount: false };
  }

  private getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return apiUrl;
      }
    }
    // Fallback to relative path (will use proxy in dev, or direct in production)
    return '/api';
  }

  async signIn(email: string, password: string): Promise<{ error: AuthError | null; duplicateAccount?: boolean }> {
    // Clear any expired sessions before attempting login
    // This prevents hanging on getSession() calls with expired tokens
    this.clearExpiredSession();
    
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return { error, duplicateAccount: false };
    }

    // Check if we got a valid session
    if (!data.session || !data.session.access_token) {
      return { 
        error: { 
          message: 'Login succeeded but no session was created. Please try again.', 
          name: 'SessionError',
          status: 500
        } as AuthError, 
        duplicateAccount: false 
      };
    }

    // User is authenticated - set user state immediately
    const user = data.user;
    if (!user) {
      await this.supabase.auth.signOut();
      return { 
        error: { 
          message: 'Could not retrieve user information. Please try again.', 
          name: 'UserError',
          status: 500
        } as AuthError, 
        duplicateAccount: false 
      };
    }

    // Set user state immediately so the UI updates
    this.currentUserSubject.next({
      id: user.id,
      email: user.email
    });

    // Reset session timers for new login
    this.resetSessionTimer();

    // Do background tasks without blocking the login flow
    this.ensureUserProvisioned(user.id, user.email || '');
    this.loadUserProfileAsync(user.id);

    return { error: null, duplicateAccount: false };
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
    this.currentUserSubject.next(null);
    
    // STEP 3: Clear all localStorage (including Supabase auth tokens)
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // Clear the Supabase auth token
        localStorage.removeItem('sb-uqwcmkyaskyduxuluqrm-auth-token');
        // Also clear any other Supabase-related keys (in case of variations)
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      } catch (err) {
        // Ignore errors when clearing storage
      }
    }
    
    // STEP 4: Sign out from Supabase (this clears the session on server)
    try {
      await this.supabase.auth.signOut();
    } catch (err) {
      // Continue even if Supabase signOut fails
    }
    
    // STEP 5: Redirect to homepage with full page reload
    // This ensures all components re-initialize and check auth state fresh
    if (typeof window !== 'undefined') {
      // Use window.location.href for a full page reload (not router navigation)
      // This ensures all components re-initialize and check auth state fresh
      window.location.href = '/home';
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
    const user = this.currentUserSubject.value;
    if (!user) {
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

    const { error } = await this.supabase
      .from('profiles')
      .update(dbUpdates)
      .eq('id', user.id);

    // If error is about missing column, try again without onboarding_completed
    if (error && error.code === 'PGRST204' && updates.onboardingCompleted !== undefined) {
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
      // Handle AuthSessionMissingError gracefully - don't clear user if session might still exist
      if (authError?.name === 'AuthSessionMissingError' || authError?.message?.includes('session')) {
        return;
      }
      // Only clear user if it's a real error, not a session timing issue
      if (authError && !authError.message?.includes('session')) {
        this.currentUserSubject.next(null);
      }
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

  /**
   * Validate and get session from localStorage
   */
  private getValidSessionFromStorage(): { access_token: string; expires_at?: number } | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    const storageKey = 'sb-uqwcmkyaskyduxuluqrm-auth-token';
    const stored = window.localStorage.getItem(storageKey);
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

      // Check if token is expired
      if (this.isTokenExpired(expiresAt)) {
        // Token expired, clear storage
        window.localStorage.removeItem(storageKey);
        return null;
      }

      return {
        access_token: session.access_token,
        expires_at: expiresAt ? (typeof expiresAt === 'string' ? parseInt(expiresAt, 10) : expiresAt) : undefined
      };
    } catch (e) {
      // Invalid JSON - clear corrupted storage
      window.localStorage.removeItem(storageKey);
      return null;
    }
  }

  /**
   * Get the current session access token for API requests
   * Uses Supabase's built-in session management which handles refresh automatically
   */
  async getAccessToken(): Promise<string | null> {
    // Update last activity time
    this.lastActivityTime = Date.now();
    this.resetInactivityTimer();

    // Check localStorage first for faster access
    const storageKey = 'sb-uqwcmkyaskyduxuluqrm-auth-token';
    const storedSession = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
    
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed.access_token) {
          // Check expiry
          const expiresAt = parsed.expires_at;
          if (!expiresAt || expiresAt * 1000 > Date.now()) {
            return parsed.access_token;
          }
        }
      } catch {
        // Invalid JSON - fall through to getSession
      }
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
      // Error getting session or timeout - clear expired session
      console.warn('[Auth] getSession failed or timed out in getAccessToken:', err?.message);
      this.clearExpiredSession();
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
    
    const storageKey = 'sb-uqwcmkyaskyduxuluqrm-auth-token';
    const storedSession = localStorage.getItem(storageKey);
    
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        const expiresAt = parsed?.expires_at || parsed?.session?.expires_at;
        
        // Check if token is expired
        if (expiresAt) {
          const expiryTime = typeof expiresAt === 'string' ? parseInt(expiresAt, 10) : expiresAt;
          if (expiryTime * 1000 < Date.now()) {
            console.log('[Auth] Clearing expired session from localStorage');
            localStorage.removeItem(storageKey);
            // Also clear user state
            this.currentUserSubject.next(null);
          }
        }
      } catch (e) {
        // Invalid JSON - clear it
        console.log('[Auth] Clearing invalid session from localStorage');
        localStorage.removeItem(storageKey);
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
      window.localStorage.removeItem('sb-uqwcmkyaskyduxuluqrm-auth-token');
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

