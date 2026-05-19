/** sessionStorage key for “Board” left-nav shortcut (last opened team board). */
export const LAST_BOARD_TEAM_STORAGE_KEY = 'tcl_agent_studio_last_board_team';

/** Match options for leaf rail links (no prefix/subset activation). */
export const RAIL_LINK_ACTIVE_EXACT = {
  paths: 'exact' as const,
  queryParams: 'exact' as const,
  fragment: 'exact' as const,
  matrixParams: 'exact' as const,
};

export function rememberBoardTeam(teamId: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(LAST_BOARD_TEAM_STORAGE_KEY, teamId);
  }
}

export function boardNavLink(): string[] {
  if (typeof sessionStorage === 'undefined') {
    return ['board'];
  }
  const last = sessionStorage.getItem(LAST_BOARD_TEAM_STORAGE_KEY);
  if (last) {
    return ['teams', last, 'board'];
  }
  return ['board'];
}

/** Path under `/agent-studio` without leading slash, e.g. `teams/uuid/board`. */
export function agentStudioSubPath(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const m = path.match(/\/agent-studio\/?(.*)$/i);
  return (m?.[1] ?? '').replace(/\/$/, '');
}

export function isOverviewRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === '';
}

/** Teams list or team command center — not board/agents/ide/etc. */
export function isTeamsRouteActive(url: string): boolean {
  const p = agentStudioSubPath(url);
  if (p === 'teams') return true;
  return /^teams\/[^/]+$/.test(p);
}

export function isBoardRouteActive(url: string): boolean {
  const p = agentStudioSubPath(url);
  if (p === 'board') return true;
  return /^teams\/[^/]+\/board$/.test(p);
}

export function isVendorsRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'vendors';
}

export function isTclLiveRouteActive(url: string): boolean {
  const p = agentStudioSubPath(url);
  if (p === 'tcl') return true;
  return /^teams\/[^/]+\/tcl$/.test(p);
}

export function isIntegrationsRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'integrations';
}

export function isSettingsRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'settings';
}

export function isTemplatesCatalogRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'templates';
}

export function isTemplatePacksRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'templates/packs';
}

export function isTemplateRolesRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'templates/roles';
}

export function isTemplatePersonasRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'templates/personas';
}

export function isTemplateFilesRouteActive(url: string): boolean {
  return agentStudioSubPath(url) === 'templates/files';
}
