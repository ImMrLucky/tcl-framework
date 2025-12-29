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
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Use a unique storage key
        storageKey: 'sb-uqwcmkyaskyduxuluqrm-auth-token',
        // Use localStorage
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce'
      }
    });
    
    // Suppress lock manager errors (they're usually harmless - just means another tab is managing auth)
    if (typeof window !== 'undefined' && 'navigator' in window && 'locks' in navigator) {
      // The error is logged but doesn't break functionality
      // Multiple tabs can safely use Supabase - the lock is just for coordination
    }
    
    // Listen for auth changes
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      if (session?.user) {
        await this.loadUserProfile(session.user.id);
      } else {
        this.currentUserSubject.next(null);
      }
    });

    // Load initial session
    this.supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        console.log('Loading initial session for user:', session.user.email);
        await this.loadUserProfile(session.user.id);
      } else {
        console.log('No active session found');
      }
    });
  }

  async signUp(email: string, password: string): Promise<{ error: AuthError | null }> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password
    });

    if (!error && data.user) {
      // Provision user (create profile + org)
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

  async signIn(email: string, password: string): Promise<{ error: AuthError | null }> {
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

    return { error };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.currentUserSubject.next(null);
    this.router.navigate(['/home']);
  }

  async updateProfile(updates: {
    companyRole?: string;
    companyIndustry?: string;
    callOperation?: string;
    primaryUseCase?: string;
  }): Promise<{ error: any }> {
    const user = this.currentUserSubject.value;
    if (!user) {
      return { error: { message: 'No user logged in' } };
    }

    const { error } = await this.supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (!error) {
      await this.loadUserProfile(user.id);
    }

    return { error };
  }

  private async loadUserProfile(userId: string): Promise<void> {
    console.log('Loading profile for user:', userId);
    
    // First, get the auth user to ensure we have email
    const { data: { user }, error: authError } = await this.supabase.auth.getUser();
    
    if (authError || !user) {
      console.error('Error getting auth user:', authError);
      this.currentUserSubject.next(null);
      return;
    }

    console.log('Auth user found:', user.email, 'Email confirmed:', user.email_confirmed_at ? 'yes' : 'no');

    // Try to load profile from database
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      // Profile might not exist yet (provision might have failed)
      // Still set user with basic info from auth so they can use the app
      console.warn('Profile not found in database (this is OK if user just signed up):', error.code, error.message);
      
      const basicUser: User = {
        id: userId,
        email: user.email || undefined,
        fullName: user.user_metadata?.full_name,
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
      primaryUseCase: data?.primary_use_case
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
}

