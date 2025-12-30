import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'pricing',
    loadComponent: () => import('./pricing/pricing.component').then(m => m.PricingComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./auth/onboarding.component').then(m => m.OnboardingComponent)
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent)
  },
  {
    path: 'call-center-qa',
    loadComponent: () => import('./call-center-qa/call-center-qa.component').then(m => m.CallCenterQaComponent)
  },
  {
    path: 'original-qa',
    loadComponent: () => import('./original-qa/original-qa.component').then(m => m.OriginalQaComponent)
  },
  {
    path: 'orgs/:orgId/members',
    loadComponent: () => import('./member-management/member-management.component').then(m => m.MemberManagementComponent)
  },
  {
    path: 'ingest',
    loadComponent: () => import('./ingestion/ingestion.component').then(m => m.IngestionComponent)
  },
  {
    path: 'evaluations/:id',
    loadComponent: () => import('./evaluation-results/evaluation-results.component').then(m => m.EvaluationResultsComponent)
  },
  {
    path: '',
    redirectTo: '/home',
    pathMatch: 'full'
  }
];

