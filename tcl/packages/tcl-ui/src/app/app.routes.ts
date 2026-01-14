import { Routes } from '@angular/router';
import { AuthGuard } from './auth.guard';
import { PlanGuard } from './plan.guard';

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
    path: 'account',
    loadComponent: () => import('./account/account.component').then(m => m.AccountComponent),
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
    path: 'evaluations',
    loadComponent: () => import('./evaluations/evaluations-list.component').then(m => m.EvaluationsListComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'evaluations/:id',
    loadComponent: () => import('./evaluation-results/evaluation-results.component').then(m => m.EvaluationResultsComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'issues',
    loadComponent: () => import('./issues/issues-list.component').then(m => m.IssuesListComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'compliance',
    loadComponent: () => import('./compliance/compliance-dashboard.component').then(m => m.ComplianceDashboardComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'audit-packs',
    loadComponent: () => import('./audit-packs/audit-packs.component').then(m => m.AuditPacksComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'evidence',
    loadComponent: () => import('./evidence-library/evidence-library.component').then(m => m.EvidenceLibraryComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'evidence/:id',
    loadComponent: () => import('./evidence-library/evidence-detail.component').then(m => m.EvidenceDetailComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'projects/:projectId/evidence',
    loadComponent: () => import('./project-evidence-library/project-evidence-library.component').then(m => m.ProjectEvidenceLibraryComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'templates',
    loadComponent: () => import('./templates/templates-library.component').then(m => m.TemplatesLibraryComponent),
    canActivate: [AuthGuard]
  },
  // Legacy policies routes - redirect to evidence
  {
    path: 'policies',
    redirectTo: '/evidence',
    pathMatch: 'full'
  },
  {
    path: 'policies/:id',
    redirectTo: '/evidence/:id',
    pathMatch: 'full'
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'admin/scoring',
    loadComponent: () => import('./admin/scoring/scoring-profiles.component').then(m => m.ScoringProfilesComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'admin/instructions',
    loadComponent: () => import('./admin/instructions.component').then(m => m.AdminInstructionsComponent),
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

