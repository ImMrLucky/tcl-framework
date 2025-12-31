import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
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

    // For authenticated endpoints, get the token and add it to the request
    // Use from() to convert Promise to Observable, then switchMap to add header
    return from(this.authService.getAccessToken()).pipe(
      // Add timeout to prevent hanging if getAccessToken takes too long
      timeout(5000),
      switchMap(token => {
        // Clone the request
        let authReq = req;
        
        // If we have a valid token, add the Authorization header
        if (token && typeof token === 'string' && token.trim().length > 0) {
          authReq = req.clone({
            setHeaders: {
              Authorization: `Bearer ${token}`
            }
          });
        }
        // If no token, still proceed - backend will return 401 if needed
        
        return next.handle(authReq).pipe(
          catchError((error: HttpErrorResponse) => {
            // Handle 401 Unauthorized responses from the backend
            if (error.status === 401) {
              // Clear session and redirect to login
              this.authService.signOut();
            }
            return throwError(() => error);
          })
        );
      }),
      catchError((error) => {
        // If token retrieval fails or times out, proceed without token
        // Let the backend return 401 if auth is required
        return next.handle(req).pipe(
          catchError((err: HttpErrorResponse) => {
            if (err.status === 401) {
              this.authService.signOut();
            }
            return throwError(() => err);
          })
        );
      })
    );
  }
}

