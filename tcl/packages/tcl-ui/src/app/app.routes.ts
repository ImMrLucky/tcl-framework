import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./auth/onboarding.component').then(m => m.OnboardingComponent)
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
    path: '',
    redirectTo: '/call-center-qa',
    pathMatch: 'full'
  }
];

