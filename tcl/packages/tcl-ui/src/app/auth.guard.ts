import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
    if (this.authService.hasValidSessionSync()) {
      return true;
    }
    const hasSession = await this.authService.checkSession();
    if (hasSession) {
      return true;
    }
    return this.router.createUrlTree(['/login']);
  }
}

