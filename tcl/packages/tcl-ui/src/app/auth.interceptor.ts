import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError, of } from 'rxjs';
import { catchError, switchMap, timeout } from 'rxjs/operators';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthInterceptor implements HttpInterceptor {
  // Public endpoints that don't require authentication
  private publicEndpoints = [
    '/auth/login',
    '/auth/signup',
    '/auth/check-email',
    '/auth/provision',
    '/health'
  ];

  constructor(
    private authService: AuthService
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Check if this is a public endpoint
    const isPublicEndpoint = this.publicEndpoints.some(endpoint => 
      req.url.includes(endpoint)
    );

    // If it's a public endpoint, proceed without adding auth header
    if (isPublicEndpoint) {
      return next.handle(req);
    }

    const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;

    const attachAuthHeaders = (token: string | null) => {
      const headers: { [key: string]: string } = {};
      if (token && typeof token === 'string' && token.trim().length > 0) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (activeOrgId) {
        headers['X-Active-Org-Id'] = activeOrgId;
      }
      return Object.keys(headers).length > 0 ? req.clone({ setHeaders: headers }) : req;
    };

    // Prefer sync read from Supabase localStorage — avoids sending unauthenticated requests
    // while getSession() / LockManager is still resolving (common right after login).
    const syncToken = this.authService.getAccessTokenSync();
    if (syncToken) {
      return next.handle(attachAuthHeaders(syncToken));
    }

    return from(
      this.authService.getAccessToken().catch((err) => {
        console.warn('Token retrieval failed:', err?.message || err);
        return null;
      })
    ).pipe(
      timeout(5000),
      switchMap((token) => next.handle(attachAuthHeaders(token))),
      catchError((error) => {
        if (error.name === 'TimeoutError') {
          console.warn('Token retrieval timed out');
          const retrySync = this.authService.getAccessTokenSync();
          if (retrySync) {
            return next.handle(attachAuthHeaders(retrySync));
          }
        }
        return throwError(() => error);
      })
    );
  }
}

