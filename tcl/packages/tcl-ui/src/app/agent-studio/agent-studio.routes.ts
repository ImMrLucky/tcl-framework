import { Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';

/**
 * Agent Studio sub-routes — mirrors spec §1 exactly.
 *
 * All routes are lazy-loaded; the feature shell + sub-shells are tiny
 * components that exercise the backend. They use AuthGuard; per-route RBAC
 * (staff / analyst / owner) is enforced on the server.
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
        path: 'board',
        loadComponent: () =>
          import('./pages/board-hub.component').then((m) => m.BoardHubComponent),
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
        path: 'teams/:teamId/jarvis',
        loadComponent: () =>
          import('./pages/team-jarvis.component').then((m) => m.TeamJarvisComponent),
      },
      {
        path: 'tcl',
        loadComponent: () =>
          import('./pages/tcl-live.component').then((m) => m.TclLiveComponent),
      },
      {
        path: 'teams/:teamId/tcl',
        loadComponent: () =>
          import('./pages/tcl-live.component').then((m) => m.TclLiveComponent),
      },
      {
        path: 'vendors',
        loadComponent: () =>
          import('./pages/vendors-runtime.component').then((m) => m.VendorsRuntimeComponent),
      },
      {
        path: 'templates/packs',
        loadComponent: () =>
          import('./pages/manage-template-packs.component').then((m) => m.ManageTemplatePacksComponent),
      },
      {
        path: 'templates/roles',
        loadComponent: () =>
          import('./pages/manage-roles.component').then((m) => m.ManageRolesComponent),
      },
      {
        path: 'templates/personas',
        loadComponent: () =>
          import('./pages/manage-personas.component').then((m) => m.ManagePersonasComponent),
      },
      {
        path: 'templates/files',
        loadComponent: () =>
          import('./pages/manage-agent-files.component').then((m) => m.ManageAgentFilesComponent),
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
