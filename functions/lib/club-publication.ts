import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./api-helpers";

export async function isClubPublicationSchemaReady(db: D1Database): Promise<boolean> {
  try {
    const columns = await db
      .prepare(`PRAGMA table_info("club_config")`)
      .all<{ name: string }>();
    return columns.results.some((column) => column.name === "published");
  } catch {
    return false;
  }
}

export function clubPublicationUnavailable(): Response {
  return json(
    { error: "Club changes are temporarily unavailable while the database is being updated" },
    { status: 503 },
  );
}
