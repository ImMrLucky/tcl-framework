import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

@Injectable()
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
    return from(this.authService.getAccessToken()).pipe(
      switchMap(token => {
        // If no token, proceed without auth header (backend will return 401)
        if (!token) {
          return next.handle(req);
        }

        // Clone the request and add the Authorization header
        const authReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });

        return next.handle(authReq);
      }),
      catchError((error: HttpErrorResponse) => {
        // Handle 401 Unauthorized responses
        if (error.status === 401) {
          // Clear session and redirect to login
          this.authService.signOut();
        }
        return throwError(() => error);
      })
    );
  }
}

