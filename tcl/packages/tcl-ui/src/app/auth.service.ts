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
  private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  private lastActivityTime = Date.now();

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
      // Only log non-INITIAL_SESSION events to reduce noise
      if (event !== 'INITIAL_SESSION') {
        console.log('Auth state changed:', event, session?.user?.email);
      }
      
      // Handle SIGNED_OUT event explicitly
      if (event === 'SIGNED_OUT' || !session) {
        console.log('User signed out, clearing user state');
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
      this.supabase.auth.getSession().then(async ({ data: { session }, error: sessionError }) => {
        if (sessionError) {
          console.warn('Error getting initial session:', sessionError);
          this.currentUserSubject.next(null);
          return;
        }
        
        // Double-check localStorage - if auth token was cleared, don't restore session
        if (typeof window !== 'undefined' && window.localStorage) {
          const authToken = localStorage.getItem('sb-uqwcmkyaskyduxuluqrm-auth-token');
          if (!authToken && session) {
            console.log('Session exists but localStorage token is missing - clearing session');
            // Session exists but token was cleared - sign out to be safe
            await this.supabase.auth.signOut();
            this.currentUserSubject.next(null);
            return;
          }
        }
        
        if (session?.user) {
          // User is logged in, start inactivity timer
          this.resetInactivityTimer();
          console.log('Initial session found for user:', session.user.email);
          
          // Set basic user immediately so UI shows logged in state
          const basicUser: User = {
            id: session.user.id,
            email: session.user.email || undefined,
            fullName: session.user.user_metadata?.['full_name'] as string | undefined
          };
          this.currentUserSubject.next(basicUser);
          console.log('Set initial user from session:', basicUser);
          
          // Then load full profile in background
          try {
            await this.loadUserProfile(session.user.id);
          } catch (err: any) {
            console.error('Error loading initial user profile:', err);
            // Keep the basic user even if profile load fails
            // User is still logged in, just without profile data
          }
        } else {
          // Only log if we're in development mode to reduce noise
          if (process.env['NODE_ENV'] === 'development') {
            console.log('No active session found');
          }
          this.currentUserSubject.next(null);
        }
      }).catch((err: any) => {
        console.error('Error in getSession promise:', err);
        this.currentUserSubject.next(null);
      });
    }, 100);
  }

  /**
   * Check if there's a valid session - used by AuthGuard
   * Returns true if user has a valid session, false otherwise
   */
  async checkSession(): Promise<boolean> {
    try {
      // First try to get session from Supabase
      const { data: { session } } = await this.supabase.auth.getSession();
      
      if (session?.access_token) {
        // Check if token is expired
        const expiresAt = session.expires_at;
        if (expiresAt && expiresAt * 1000 < Date.now()) {
          return false;
        }
        
        // Valid session - update user subject if needed
        if (!this.currentUserSubject.value && session.user) {
          this.currentUserSubject.next({
            id: session.user.id,
            email: session.user.email || undefined
          });
          // Load full profile in background
          this.loadUserProfileAsync(session.user.id);
        }
        
        return true;
      }
      
      // Fallback: Check localStorage directly for Supabase token
      const storageKey = 'sb-uqwcmkyaskyduxuluqrm-auth-token';
      const storedSession = localStorage.getItem(storageKey);
      if (storedSession) {
        try {
          const parsed = JSON.parse(storedSession);
          if (parsed.access_token && parsed.user) {
            // Check expiry
            const expiresAt = parsed.expires_at;
            if (expiresAt && expiresAt * 1000 < Date.now()) {
              return false;
            }
            
            // Update user subject
            if (!this.currentUserSubject.value) {
              this.currentUserSubject.next({
                id: parsed.user.id,
                email: parsed.user.email || undefined
              });
            }
            return true;
          }
        } catch {
          // Invalid JSON in storage
        }
      }
      
      return false;
    } catch {
      return false;
    }
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
        console.warn('User has no profile, attempting to provision...');
        const apiUrl = this.getApiBaseUrl();
        await firstValueFrom(
          this.http.post(`${apiUrl}/auth/provision`, { userId, email })
        );
        console.log('User provisioned successfully');
      }
    } catch (err: any) {
      console.warn('Background provisioning failed:', err.message);
      // Don't throw - this is background work
    }
  }

  /**
   * Load user profile in background
   */
  private async loadUserProfileAsync(userId: string): Promise<void> {
    try {
      await this.loadUserProfile(userId);
    } catch (err: any) {
      console.warn('Background profile load failed:', err.message);
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
      console.warn('onboarding_completed column not found, retrying without it. Please refresh Supabase schema cache.');
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
    console.log('Loading profile for user:', userId);
    
    // Get the auth user first (this also validates the session)
    const { data: { user }, error: authError } = await this.supabase.auth.getUser();
    
    if (authError || !user) {
      // Handle AuthSessionMissingError gracefully - don't clear user if session might still exist
      if (authError?.name === 'AuthSessionMissingError' || authError?.message?.includes('session')) {
        console.warn('Auth session missing during profile load, but keeping basic user state');
        // Don't clear user - session might be temporarily unavailable
        return;
      }
      console.error('Error getting auth user:', authError);
      // Only clear user if it's a real error, not a session timing issue
      if (authError && !authError.message?.includes('session')) {
        this.currentUserSubject.next(null);
      }
      return;
    }

    // Verify the user matches the requested userId
    if (user.id !== userId) {
      console.warn(`Auth user ID (${user.id}) does not match requested ID (${userId})`);
      return;
    }

    console.log('Auth user found:', user.email, 'Email confirmed:', user.email_confirmed_at ? 'yes' : 'no');

    // Try to load profile from database
    // Use .maybeSingle() instead of .single() to handle missing profiles gracefully
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      // Database error (not just missing profile)
      console.error('Error loading profile from database:', error);
      // Still set user with basic info from auth so they can use the app
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
      // Profile doesn't exist yet (provision might have failed or is in progress)
      // Still set user with basic info from auth so they can use the app
      console.warn('Profile not found in database (this is OK if user just signed up)');
      
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
      console.log('Set basic user info from auth:', basicUser);
      return;
    }

    // Profile exists, use it
    console.log('Profile loaded from database:', data);
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
    // Check Supabase session - this is the source of truth
    const { data: { session } } = await this.supabase.auth.getSession();
    
    if (!session) {
      return false;
    }
    
    // If we have a session but no user subject, populate it
    if (!this.currentUserSubject.value && session.user) {
      this.currentUserSubject.next({
        id: session.user.id,
        email: session.user.email
      });
      // Also trigger background profile load
      this.loadUserProfileAsync(session.user.id);
    }
    
    return true;
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

    // Use Supabase getSession - it handles localStorage and token refresh automatically
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      
      if (error) {
        console.warn('Error getting session:', error.message);
        return null;
      }
      
      if (!session) {
        // No session - user is not logged in
        return null;
      }
      
      if (!session.access_token) {
        console.warn('Session exists but no access token');
        return null;
      }

      // Return the token - Supabase handles refresh automatically
      return session.access_token;
    } catch (error: any) {
      console.warn('Exception getting session:', error?.message || error);
      return null;
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

