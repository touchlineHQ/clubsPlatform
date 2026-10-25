import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "./api-helpers";
import { ensureTables } from "./ensure-tables";

/**
 * Per-club feature switches (#83).
 *
 * Resolution, per feature:
 * 1. The deployment env var is a platform-wide kill switch when set to "off"
 *    (or "disabled" / "never"): the feature is off for every club, whatever the
 *    club's own setting says.
 * 2. Otherwise the club's own `club_feature` row decides.
 * 3. A club with no row gets the deployment default: on when the env var is
 *    truthy ("1" / "true" / "enabled" ...), off when it is unset, "0" or "false".
 *
 * So the env var keeps meaning what it meant before for clubs that have not
 * chosen, and production (var commented out) stays off on migration.
 *
 * #82's paid-tier entitlements are meant to plug into this same lookup.
 */

export const CLUB_FEATURES = ["pitchBookings"] as const;
export type ClubFeature = (typeof CLUB_FEATURES)[number];
export type ClubFeatures = Record<ClubFeature, boolean>;

export function isClubFeature(v: unknown): v is ClubFeature {
  return typeof v === "string" && (CLUB_FEATURES as readonly string[]).includes(v);
}

const ENV_VAR: Record<ClubFeature, keyof Env> = {
  pitchBookings: "PITCH_BOOKINGS",
};

const KILL_VALUES = new Set(["off", "disabled", "never"]);
const DEFAULT_OFF_VALUES = new Set(["", "0", "false", "no"]);

export type FeatureDefault = "on" | "off" | "killed";

/** What the deployment says about a feature before any club setting applies. */
export function deploymentDefault(env: Env, feature: ClubFeature): FeatureDefault {
  const raw = env[ENV_VAR[feature]];
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (KILL_VALUES.has(v)) return "killed";
  if (DEFAULT_OFF_VALUES.has(v)) return "off";
  return "on";
}

export function resolveFeature(def: FeatureDefault, clubSetting: boolean | undefined): boolean {
  if (def === "killed") return false;
  if (clubSetting !== undefined) return clubSetting;
  return def === "on";
}

type FeatureRow = { clubSlug: string; feature: string; enabled: number };

/** Every explicit club setting, grouped by club. One read for the whole registry. */
export async function loadAllClubFeatureSettings(
  db: D1Database,
): Promise<Map<string, Partial<ClubFeatures>>> {
  const res = await db
    .prepare(`SELECT clubSlug, feature, enabled FROM "club_feature"`)
    .all<FeatureRow>();
  const byClub = new Map<string, Partial<ClubFeatures>>();
  for (const row of res.results ?? []) {
    if (!isClubFeature(row.feature)) continue;
    const entry = byClub.get(row.clubSlug) ?? {};
    entry[row.feature] = row.enabled === 1;
    byClub.set(row.clubSlug, entry);
  }
  return byClub;
}

export function resolveClubFeatures(env: Env, settings: Partial<ClubFeatures> | undefined): ClubFeatures {
  const out = {} as ClubFeatures;
  for (const f of CLUB_FEATURES) out[f] = resolveFeature(deploymentDefault(env, f), settings?.[f]);
  return out;
}

/** One club's resolved features. */
export async function getClubFeatures(env: Env, db: D1Database, clubSlug: string): Promise<ClubFeatures> {
  const res = await db
    .prepare(`SELECT clubSlug, feature, enabled FROM "club_feature" WHERE clubSlug = ?`)
    .bind(clubSlug)
    .all<FeatureRow>();
  const settings: Partial<ClubFeatures> = {};
  for (const row of res.results ?? []) {
    if (isClubFeature(row.feature)) settings[row.feature] = row.enabled === 1;
  }
  return resolveClubFeatures(env, settings);
}

/**
 * Guard for a feature's API routes: null when the request's club has the
 * feature on, otherwise a 404 to return as-is. A request with no club (a
 * single-club deployment that sends no X-Club-Slug) gets the deployment default.
 */
export async function requireClubFeature(
  env: Env,
  clubSlug: string | null,
  feature: ClubFeature,
): Promise<Response | null> {
  // Some handlers run this before their own ensureTables; it is a singleton.
  await ensureTables(env.DB);
  const enabled = clubSlug
    ? (await getClubFeatures(env, env.DB, clubSlug))[feature]
    : resolveClubFeatures(env, undefined)[feature];
  if (enabled) return null;
  return new Response(JSON.stringify({ error: "This feature is not enabled for this club" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/** The club's own stored setting, or undefined when it has never chosen. */
export async function getStoredClubFeature(
  db: D1Database,
  clubSlug: string,
  feature: ClubFeature,
): Promise<boolean | undefined> {
  const row = await db
    .prepare(`SELECT enabled FROM "club_feature" WHERE clubSlug = ? AND feature = ?`)
    .bind(clubSlug, feature)
    .first<{ enabled: number }>();
  return row ? row.enabled === 1 : undefined;
}
