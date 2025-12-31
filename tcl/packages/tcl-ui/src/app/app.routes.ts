import { Routes } from '@angular/router';
import { AuthGuard } from './auth.guard';

export const routes: Routes = [
  // Public routes (no auth required)
  {
    path: 'home',
    loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'pricing',
    loadComponent: () => import('./pricing/pricing.component').then(m => m.PricingComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent)
  },
  
  // Protected routes (auth required)
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./auth/onboarding.component').then(m => m.OnboardingComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'call-center-qa',
    loadComponent: () => import('./call-center-qa/call-center-qa.component').then(m => m.CallCenterQaComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'original-qa',
    loadComponent: () => import('./original-qa/original-qa.component').then(m => m.OriginalQaComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'orgs/:orgId/members',
    loadComponent: () => import('./member-management/member-management.component').then(m => m.MemberManagementComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'ingest',
    loadComponent: () => import('./ingestion/ingestion.component').then(m => m.IngestionComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'evaluations/:id',
    loadComponent: () => import('./evaluation-results/evaluation-results.component').then(m => m.EvaluationResultsComponent),
    canActivate: [AuthGuard]
  },
  
  // Default route
  {
    path: '',
    redirectTo: '/home',
    pathMatch: 'full'
  },
  // Wildcard route - redirect unknown routes to home
  {
    path: '**',
    redirectTo: '/home'
  }
];

