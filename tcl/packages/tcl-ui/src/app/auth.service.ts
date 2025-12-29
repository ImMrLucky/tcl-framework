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
    const supabaseUrl = 'https://uqwcmkyaskyduxuluqrm.supabase.co';
    const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxd2Nta3lhc2t5ZHV4dWx1cXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NjA4MTQsImV4cCI6MjA4MjUzNjgxNH0.hmH7rX3ujck-3zBj1OsWXE2QB_we2xXlBWCzXr_WOB0';
    
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Listen for auth changes
    this.supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        this.loadUserProfile(session.user.id);
      } else {
        this.currentUserSubject.next(null);
      }
    });

    // Load initial session
    this.supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        this.loadUserProfile(session.user.id);
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
        const response = await fetch('http://localhost:8787/auth/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: data.user.id, email })
        });
        if (!response.ok) {
          console.error('Failed to provision user:', await response.text());
        }
      } catch (err) {
        console.error('Error provisioning user:', err);
      }

      // Load profile after signup
      if (data.user) {
        await this.loadUserProfile(data.user.id);
      }
    }

    return { error };
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
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error loading profile:', error);
      return;
    }

    const { data: { user } } = await this.supabase.auth.getUser();
    
    this.currentUserSubject.next({
      id: userId,
      email: user?.email,
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

  isAuthenticated(): boolean {
    return this.currentUserSubject.value !== null;
  }
}

