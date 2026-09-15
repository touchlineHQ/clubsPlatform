/**
 * Canonical form of a team name for comparison only.
 *
 * Team names in the FA exports are not typed consistently — the same team comes
 * back as "Under 13 Reds" one month and "Under  13   Reds" the next. Matching
 * the raw strings makes a registration look like it has vanished from the file
 * when nothing has changed but the whitespace.
 *
 * Never store the result: "player_registration"."teamName" holds the name as the
 * FA report spells it, and the UNIQUE(clubSlug, playerId, teamName) constraint is
 * on that raw value.
 */
export function normaliseTeamName(teamName: string): string {
  return teamName.trim().toLowerCase().replace(/\s+/g, ' ');
}
