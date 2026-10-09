import { ensureTables } from "../../lib/ensure-tables";
import { clubPublicationUnavailable, isClubPublicationSchemaReady } from "../../lib/club-publication";
import { type Env, json, nowMs, randomId, requireAuth, isMultiClubMode, isClubSelfRegisterAllowed } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  parseSignoffTicks,
  parseSignoffPolicy,
  prepareEmailSignoff,
  requestIp,
  SignoffIncompleteError,
  SignoffPolicyMismatchError,
  validatePolicySubmission,
  EMAIL_SIGNOFF_POLICY_VERSION,
} from "../../lib/club-email-signoff";
import {
  parseDpaAcceptance,
  prepareDpaAcceptance,
  DpaPolicyMismatchError,
  DPA_POLICY_VERSION,
  validateDpaSubmission,
} from "../../lib/dpa";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Create a private club after validating all versioned signup acceptances. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!isMultiClubMode(context.env)) {
    return json({ error: "Multi-club mode is not enabled" }, { status: 403 });
  }
  if (!isClubSelfRegisterAllowed(context.env)) {
    return json({ error: "Club self-registration is not enabled" }, { status: 403 });
  }

  await ensureTables(context.env.DB);

  const result = await requireAuth(context);
  if ("error" in result) return result.error;

  const { session } = result;
  const userId = session.user.id as string;

  const body = (await context.request.json()) as Partial<{
    clubName: string;
    emailSignoff: unknown;
    dpaAcceptance: unknown;
  }>;
  const clubName = body.clubName?.trim() ?? "";

  if (!clubName) {
    return json({ error: "clubName is required" }, { status: 400 });
  }

  // Independent liabilities — no bundled accept-all. Required at
  // registration so a new club cannot collect contact emails unsigned (#130).
  const signoff = body.emailSignoff && typeof body.emailSignoff === "object"
    ? body.emailSignoff as Record<string, unknown>
    : null;
  const ticks = parseSignoffTicks(signoff?.liabilities);
  const policy = parseSignoffPolicy(signoff);
  if (!ticks || !policy) {
    return json(
      {
        error:
          "emailSignoff requires operational_split and right_to_object independently true",
      },
      { status: 400 },
    );
  }

  // UK GDPR Art. 28 processor agreement — signup cannot complete without it (#75).
  const dpa = parseDpaAcceptance(body.dpaAcceptance);
  if (!dpa) {
    return json(
      { error: "dpaAcceptance requires accepted=true with policyVersion and wordingHash" },
      { status: 400 },
    );
  }

  // Validate both versioned policies before any club/user write. A stale form
  // must not leave behind a private club without the acceptances required by
  // signup. The recording functions validate again before persisting.
  try {
    await validatePolicySubmission(policy);
    await validateDpaSubmission(dpa);
  } catch (err) {
    if (err instanceof SignoffPolicyMismatchError || err instanceof DpaPolicyMismatchError) {
      return json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  let slug = slugify(clubName);
  if (!slug) {
    return json({ error: "Club name could not be converted to a valid slug" }, { status: 400 });
  }

  if (!(await isClubPublicationSchemaReady(context.env.DB))) {
    return clubPublicationUnavailable();
  }

  // Ensure slug uniqueness — append a suffix if taken
  const existing = await context.env.DB
    .prepare(`SELECT slug FROM club_config WHERE slug LIKE ?`)
    .bind(`${slug}%`)
    .all<{ slug: string }>();

  const takenSlugs = new Set(existing.results.map(r => r.slug));
  if (takenSlugs.has(slug)) {
    let suffix = 2;
    while (takenSlugs.has(`${slug}-${suffix}`)) suffix++;
    slug = `${slug}-${suffix}`;
  }

  // published = 0: a brand-new club starts private, visible to the admin who
  // just created it and nobody else, until they go live from the Customise page.
  const id = randomId("club");
  const clubInsert = context.env.DB
    .prepare(`INSERT INTO club_config (id, slug, name, active, published, createdAt) VALUES (?, ?, ?, 1, 0, ?)`)
    .bind(id, slug, clubName, nowMs());

  // Grant the signing-up user admin access to this club
  const userUpdate = context.env.DB
    .prepare(`UPDATE user SET role = 'admin', clubSlug = ? WHERE id = ?`)
    .bind(slug, userId);

  const ip = requestIp(context.request);

  try {
    const signoffStatements = await prepareEmailSignoff(context.env.DB, {
      clubSlug: slug,
      userId,
      ipAddress: ip,
      ticks,
      policy,
    });
    const dpaStatement = await prepareDpaAcceptance(context.env.DB, {
      clubSlug: slug,
      userId,
      ipAddress: ip,
      policy: dpa,
    });
    await context.env.DB.batch([clubInsert, userUpdate, ...signoffStatements, dpaStatement]);
  } catch (err) {
    if (err instanceof SignoffIncompleteError) {
      return json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SignoffPolicyMismatchError || err instanceof DpaPolicyMismatchError) {
      return json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: userId,
      event: 'club registered',
      ...clubGroups(slug),
      properties: { club_slug: slug, club_name: clubName },
    });
    await posthog.captureImmediate({
      distinctId: userId,
      event: 'club email signoff accepted',
      ...clubGroups(slug),
      properties: {
        club_slug: slug,
        policy_version: EMAIL_SIGNOFF_POLICY_VERSION,
        source: 'registration',
      },
    });
    await posthog.captureImmediate({
      distinctId: userId,
      event: 'dpa accepted',
      ...clubGroups(slug),
      properties: {
        club_slug: slug,
        policy_version: DPA_POLICY_VERSION,
        source: 'registration',
      },
    });
  }

  return json({ ok: true, slug }, { status: 201 });
};
