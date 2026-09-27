import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  deleteMemberData,
  exportMemberData,
  LastAdminDeleteError,
} from "../../lib/member-data";
import { prepareAuditLog, writeAuditLog } from "../../lib/audit-log";

/**
 * Admin export (GET) and delete (DELETE) of a member's personal data (#75).
 * Query: ?userId=
 */

/** Export one club member's data and record the admin access. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const userId = new URL(context.request.url).searchParams.get("userId")?.trim() ?? "";
  if (!userId) return json({ error: "userId is required" }, { status: 400 });

  const bundle = await exportMemberData(context.env.DB, clubSlug, userId);
  if (!bundle) return json({ error: "Member not found in this club" }, { status: 404 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  await writeAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: "member_data_exported",
    targetTable: "user",
    targetId: userId,
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: "member data exported",
      ...clubGroups(clubSlug),
      properties: { club_slug: clubSlug, target_user_id: userId },
    });
  }

  return json(bundle);
};

/**
 * Correct a member's account name and email within the requested club.
 * Values are audited without copying the corrected PII into the audit note.
 */
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const userId = new URL(context.request.url).searchParams.get("userId")?.trim() ?? "";
  if (!userId) return json({ error: "userId is required" }, { status: 400 });

  let body: { name?: unknown; email?: unknown } | null;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (typeof body?.name !== "string" || !body.name.trim()) {
    return json({ error: "name is required" }, { status: 400 });
  }
  if (typeof body.email !== "string" || !body.email.trim()) {
    return json({ error: "email is required" }, { status: 400 });
  }
  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  if (name.length > 100) return json({ error: "name is too long" }, { status: 400 });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "email is invalid" }, { status: 400 });
  }

  const user = await context.env.DB
    .prepare(`SELECT id FROM "user" WHERE id = ? AND clubSlug = ?`)
    .bind(userId, clubSlug)
    .first<{ id: string }>();
  if (!user) return json({ error: "Member not found in this club" }, { status: 404 });

  const duplicate = await context.env.DB
    .prepare(`SELECT id FROM "user" WHERE lower(email) = lower(?) AND id <> ?`)
    .bind(email, userId)
    .first<{ id: string }>();
  if (duplicate) return json({ error: "Email is already in use" }, { status: 409 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const update = context.env.DB
    .prepare(`UPDATE "user" SET name = ?, email = ?, updatedAt = ? WHERE id = ? AND clubSlug = ?`)
    .bind(name, email, nowMs(), userId, clubSlug);
  const audit = prepareAuditLog(context.env.DB, {
    clubSlug,
    adminId,
    action: "member_data_corrected",
    targetTable: "user",
    targetId: userId,
    note: "fields=name,email",
  });
  await context.env.DB.batch([update, audit]);

  return json({ ok: true, user: { id: userId, name, email } });
};

/** Delete one member's direct PII, subject to last-admin and self-delete guards. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const userId = new URL(context.request.url).searchParams.get("userId")?.trim() ?? "";
  if (!userId) return json({ error: "userId is required" }, { status: 400 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  if (adminId === userId) {
    return json({ error: "Admins cannot delete their own data via this path" }, { status: 400 });
  }

  try {
    const deleted = await deleteMemberData(context.env.DB, {
      clubSlug,
      userId,
      adminId,
    });
    if (!deleted) return json({ error: "Member not found in this club" }, { status: 404 });

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "member data deleted",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          target_user_id: userId,
          deleted_contacts: deleted.deletedContacts,
        },
      });
    }

    return json({ ok: true, ...deleted });
  } catch (err) {
    if (err instanceof LastAdminDeleteError) {
      return json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
};
