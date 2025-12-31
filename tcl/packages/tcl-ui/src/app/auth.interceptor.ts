import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

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
    '/health',
    '/validate' // /validate endpoint might be public for some use cases
  ];

  constructor(
    private authService: AuthService,
    private router: Router
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

    // For authenticated endpoints, get the token and add it to the request
    // Use from() to convert Promise to Observable, then switchMap to add header
    return from(this.authService.getAccessToken()).pipe(
      switchMap(token => {
        // For authenticated endpoints, we MUST have a token
        if (!token || typeof token !== 'string' || token.trim().length === 0) {
          // No token available - user is not authenticated
          // Sign them out and return an error
          this.authService.signOut();
          return throwError(() => new HttpErrorResponse({
            error: 'Authentication required',
            status: 401,
            statusText: 'Unauthorized'
          }));
        }
        
        // Clone the request and add Authorization header
        const authReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });
        
        return next.handle(authReq).pipe(
          catchError((error: HttpErrorResponse) => {
            // Handle 401 Unauthorized responses
            if (error.status === 401) {
              // Clear session and redirect to login
              this.authService.signOut();
            }
            return throwError(() => error);
          })
        );
      }),
      catchError((error) => {
        // If token retrieval fails completely, sign out and return error
        this.authService.signOut();
        return throwError(() => new HttpErrorResponse({
          error: 'Authentication required',
          status: 401,
          statusText: 'Unauthorized'
        }));
      })
    );
  }
}

