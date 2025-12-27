import { Routes } from '@angular/router';

export const routes: Routes = [
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

