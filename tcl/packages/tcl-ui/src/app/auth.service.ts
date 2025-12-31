import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, AuthError } from '@supabase/supabase-js';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';

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

  constructor(private router: Router) {
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
        // Set basic user immediately so UI updates right away
        const basicUser: User = {
          id: session.user.id,
          email: session.user.email || undefined,
          fullName: session.user.user_metadata?.['full_name'] as string | undefined
        };
        this.currentUserSubject.next(basicUser);
        
        // Then load full profile in background
        try {
          await this.loadUserProfile(session.user.id);
        } catch (err: any) {
          console.error('Error loading user profile in auth state change:', err);
          // Keep the basic user even if profile load fails
          // User is still logged in, just without profile data
        }
      } else {
        // No session - clear user state
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

  async signUp(email: string, password: string): Promise<{ error: AuthError | null; duplicateAccount?: boolean }> {
    // Check if user already exists before attempting signup
    try {
      const apiUrl = this.getApiBaseUrl();
      const checkResponse = await fetch(`${apiUrl}/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      
      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
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
      }
    } catch (err) {
      console.error('Error checking email:', err);
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

    if (!error && data.user) {
      // Provision user (create profile + org)
      // The profile will be created with onboarding_completed = false by default
      try {
        // Use same API URL pattern as TclService
        const apiUrl = this.getApiBaseUrl();
        const response = await fetch(`${apiUrl}/auth/provision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: data.user.id, email })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Failed to provision user:', errorText);
          // Don't fail signup if provision fails - user can still log in
        } else {
          console.log('User provisioned successfully');
        }
      } catch (err) {
        console.error('Error provisioning user:', err);
        // Don't fail signup if provision fails
      }

      // Load profile after signup (will create basic profile if provision succeeded)
      if (data.user) {
        await this.loadUserProfile(data.user.id);
      }
    }

    return { error };
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
    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (!error) {
      const { data: { user } } = await this.supabase.auth.getUser();
      if (user) {
        await this.loadUserProfile(user.id);
      }
    }

    return { error, duplicateAccount: false };
  }

  async signOut(): Promise<void> {
    console.log('Signing out...');
    
    // STEP 1: Clear localStorage FIRST (before Supabase checks for session)
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
        console.log('Cleared auth tokens from localStorage');
      } catch (err) {
        console.error('Error clearing localStorage:', err);
      }
    }
    
    // STEP 2: Clear user state immediately (UI updates)
    this.currentUserSubject.next(null);
    
    // STEP 3: Sign out from Supabase (this should clear the session on server)
    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) {
        console.error('Error signing out from Supabase:', error);
      } else {
        console.log('Signed out from Supabase successfully');
      }
    } catch (err) {
      console.error('Exception during Supabase signOut:', err);
    }
    
    // STEP 4: Force a full page reload to ensure everything is reset
    // This ensures the AuthService re-initializes with no session
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
    // Check both: current user subject AND Supabase session
    const { data: { session } } = await this.supabase.auth.getSession();
    return session !== null && this.currentUserSubject.value !== null;
  }

  // Synchronous check (for quick UI checks)
  isAuthenticatedSync(): boolean {
    return this.currentUserSubject.value !== null;
  }

  /**
   * Get the current session access token for API requests
   */
  async getAccessToken(): Promise<string | null> {
    try {
      // Wait for auth to initialize if needed
      if (this.supabase.auth.initializePromise) {
        await this.supabase.auth.initializePromise;
      }
      
      const sessionResponse = await this.supabase.auth.getSession();
      if (sessionResponse.error) {
        return null;
      }
      return sessionResponse.data?.session?.access_token || null;
    } catch (error) {
      return null;
    }
  }
}

