import { Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';

/**
 * Agent Studio sub-routes — mirrors spec §1 exactly.
 *
 * All routes are lazy-loaded; the feature shell + sub-shells are tiny
 * components that exercise the backend. They are gated behind AuthGuard;
 * the entitlement check (`agentStudio`) lives in the nav layer + the
 * backend (`requireEntitlement` equivalent) so a deep-linked user without
 * the feature still gets a sensible "not available" message from the API.
 */
export const AGENT_STUDIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/studio-shell.component').then((m) => m.StudioShellComponent),
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/studio-overview.component').then((m) => m.StudioOverviewComponent),
      },
      {
        path: 'teams',
        loadComponent: () =>
          import('./pages/teams-list.component').then((m) => m.TeamsListComponent),
      },
      {
        path: 'teams/:teamId',
        loadComponent: () =>
          import('./pages/team-detail.component').then((m) => m.TeamDetailComponent),
      },
      {
        path: 'teams/:teamId/board',
        loadComponent: () =>
          import('./pages/team-board.component').then((m) => m.TeamBoardComponent),
      },
      {
        path: 'teams/:teamId/agents',
        loadComponent: () =>
          import('./pages/team-agents.component').then((m) => m.TeamAgentsComponent),
      },
      {
        path: 'teams/:teamId/context',
        loadComponent: () =>
          import('./pages/team-context.component').then((m) => m.TeamContextComponent),
      },
      {
        path: 'teams/:teamId/rules',
        loadComponent: () =>
          import('./pages/team-rules.component').then((m) => m.TeamRulesComponent),
      },
      {
        path: 'teams/:teamId/ide',
        loadComponent: () =>
          import('./pages/team-ide.component').then((m) => m.TeamIdeComponent),
      },
      {
        path: 'templates',
        loadComponent: () =>
          import('./pages/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'integrations',
        loadComponent: () =>
          import('./pages/integrations.component').then((m) => m.IntegrationsComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },
];
