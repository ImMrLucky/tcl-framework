import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, filter, take, from, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    // First check if there's a session in localStorage directly
    // This handles the case where the page loads before onAuthStateChange fires
    return from(this.authService.checkSession()).pipe(
      switchMap(hasSession => {
        if (hasSession) {
          // Valid session exists, allow access
          return of(true as boolean | UrlTree);
        }
        // No valid session, redirect to login
        return of(this.router.createUrlTree(['/login']));
      })
    );
  }
}

