/**
 * Club-scoped permissions (#79).
 *
 * Route guards ask for what they need (a permission), never for which role
 * happens to hold it. The role → permission table below is the single place
 * that answers "why can this person do that?": a user's grants are exactly the
 * set listed against their `user.role`. The website keeps an identical copy in
 * `website/src/lib/permissions.ts`; a test asserts the two stay equal.
 *
 * Existing `admin`, `manager` and `member` values keep their meaning, so no
 * data migration is needed: `user.role` is free text and the new committee
 * roles are simply two more values of it.
 */

export const PERMISSIONS = [
  /** Payments, subscription levels, arrears, manual payments, merges. */
  "payments",
  /** Website content: news, pages, committee, gallery, teams, branding. */
  "content",
  /** Member data: imports, contacts, registrations, member email. */
  "members",
  /** Taking the club site live or offline. */
  "publish",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const COMMITTEE_ROLES = ["admin", "treasurer", "secretary", "manager", "member"] as const;
export type CommitteeRole = (typeof COMMITTEE_ROLES)[number];

export const ROLE_PERMISSIONS: Record<CommitteeRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  treasurer: ["payments"],
  secretary: ["content", "members"],
  manager: [],
  member: [],
};

export function isCommitteeRole(role: unknown): role is CommitteeRole {
  return typeof role === "string" && (COMMITTEE_ROLES as readonly string[]).includes(role);
}

/** The permissions a role grants. Unknown roles grant nothing. */
export function permissionsFor(role: unknown): readonly Permission[] {
  return isCommitteeRole(role) ? ROLE_PERMISSIONS[role] : [];
}

/** True when the role grants at least one of the permissions asked for. */
export function hasPermission(role: unknown, needed: Permission | readonly Permission[]): boolean {
  const granted = permissionsFor(role);
  const list = typeof needed === "string" ? [needed] : needed;
  return list.some((p) => granted.includes(p));
}
