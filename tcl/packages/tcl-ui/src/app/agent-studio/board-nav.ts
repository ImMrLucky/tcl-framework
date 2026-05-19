/** sessionStorage key for “Board” left-nav shortcut (last opened team board). */
export const LAST_BOARD_TEAM_STORAGE_KEY = 'tcl_agent_studio_last_board_team';

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

export function isBoardRouteActive(url: string): boolean {
  return url.includes('/board');
}
