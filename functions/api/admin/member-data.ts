import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  deleteMemberData,
  exportMemberData,
  LastAdminDeleteError,
} from "../../lib/member-data";
import { writeAuditLog } from "../../lib/audit-log";

/**
 * Admin export (GET) and delete (DELETE) of a member's personal data (#75).
 * Query: ?userId=
 */

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
