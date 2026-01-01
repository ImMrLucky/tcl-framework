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

    // For authenticated endpoints, get the token and add it to the request
    // Use from() to convert Promise to Observable, then switchMap to add header
    // Wrap token retrieval in its own error handling to NOT catch HTTP errors
    return from(
      this.authService.getAccessToken()
        .then(token => token)
        .catch(err => {
          // Token retrieval failed - return null to proceed without token
          console.warn('Token retrieval failed:', err?.message || err);
          return null;
        })
    ).pipe(
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
        // If no token, still proceed - backend will return error if needed
        
        // Return the actual HTTP request - let HTTP errors propagate naturally
        return next.handle(authReq);
      }),
      catchError((error) => {
        // This only catches timeout errors from the token retrieval timeout
        // NOT HTTP errors from the actual request
        if (error.name === 'TimeoutError') {
          console.warn('Token retrieval timed out, proceeding without auth');
          return next.handle(req);
        }
        // Re-throw all other errors (including HTTP errors) - don't retry!
        return throwError(() => error);
      })
    );
  }
}

