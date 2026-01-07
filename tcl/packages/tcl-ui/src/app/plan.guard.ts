import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanService, Capability } from './plan.service';

@Injectable({
  providedIn: 'root'
})
export class PlanGuard implements CanActivate {
  constructor(
    private planService: PlanService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    // Get required capability from route data
    const requiredCapability = route.data['cap'] as Capability | undefined;
    
    if (!requiredCapability) {
      // No capability required, allow access
      return true;
    }

    // Check if user has the required capability
    const hasCapability = this.planService.hasCapability(requiredCapability);
    
    if (!hasCapability) {
      // Show snackbar and redirect to account page
      const snackBarRef = this.snackBar.open(
        'Upgrade required to access this feature',
        'View Plans',
        { duration: 5000 }
      );
      
      snackBarRef.onAction().subscribe(() => {
        this.router.navigate(['/account'], { queryParams: { upgrade: '1' } });
      });
      
      // Redirect to account page
      this.router.navigate(['/account'], { queryParams: { upgrade: '1' } });
      return false;
    }

    return true;
  }
}

