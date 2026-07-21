import { type Env, json, requireAdmin } from "../../lib/api-helpers";
import { getPostHog } from "../../lib/posthog";

interface LiveFixture {
  id: string;
  date: string;
  time: string;
  home_team: string;
  away_team: string;
  team: string;
  home_away: "home" | "away";
  division: string;
}

interface ClubFeed {
  fixtures: LiveFixture[];
}

function inferFormat(teamName: string): string {
  if (/under.?(6|7|8|9)\b/i.test(teamName) || /\bu(6|7|8|9)\b/i.test(teamName)) return "5v5";
  if (/under.?(10|11|12)\b/i.test(teamName) || /\bu(10|11|12)\b/i.test(teamName)) return "7v7";
  if (/under.?(13|14)\b/i.test(teamName) || /\bu(13|14)\b/i.test(teamName)) return "9v9";
  return "11v11";
}

function getDurationByFormat(format: string): number {
  return format === "5v5" || format === "7v7" ? 1 : 2;
}

function addDuration(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const newH = (h + hours) % 24;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;
  const { session } = result;

  const body = await context.request.json() as { clubFeedSlug?: string };
  const { clubFeedSlug } = body;
  if (!clubFeedSlug) return json({ error: "clubFeedSlug is required" }, { status: 400 });

  const feedRes = await fetch(
    `https://fixtures.touchlinehq.co.uk/feeds/clubs/${clubFeedSlug}.json`
  );
  if (!feedRes.ok) return json({ error: "Failed to fetch club fixture feed" }, { status: 502 });

  const feed = await feedRes.json() as ClubFeed;
  const today = new Date().toISOString().slice(0, 10);

  const homeFixtures = (feed.fixtures ?? []).filter(
    f => f.home_away === "home" && f.date >= today && f.time && f.time !== "00:00" && f.team
  );

  if (homeFixtures.length === 0) {
    return json({ ok: true, created: 0, skipped: 0 });
  }

  const ts = Date.now();
  let created = 0;
  let skipped = 0;

  for (const fixture of homeFixtures) {
    const existing = await context.env.DB
      .prepare("SELECT id FROM booking_request WHERE teamName = ? AND date = ? AND timeStart = ?")
      .bind(fixture.team, fixture.date, fixture.time)
      .first<{ id: string }>();

    if (existing) { skipped++; continue; }

    const format = inferFormat(fixture.team);
    await context.env.DB
      .prepare(
        `INSERT INTO booking_request (id, userId, teamName, date, timeStart, timeEnd, format, notes, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(
        `req_${crypto.randomUUID()}`,
        session.user.id,
        fixture.team,
        fixture.date,
        fixture.time,
        addDuration(fixture.time, getDurationByFormat(format)),
        format,
        `Auto-imported · ${fixture.division}`,
        ts,
        ts
      )
      .run();

    created++;
  }

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: session.user.id,
      event: 'fixtures imported',
      properties: {
        club_feed_slug: clubFeedSlug,
        fixtures_created: created,
        fixtures_skipped: skipped,
      },
    });
  }

  return json({ ok: true, created, skipped });
};
