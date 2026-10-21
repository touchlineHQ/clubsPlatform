/**
 * Announcements (#74): written once, published to the club site, optionally
 * emailed, and rendered as a plain-text block for pasting into WhatsApp.
 */

/** True for an absolute https:// URL. Invite links are only ever https. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/** Site base for a club, matching how the other mail links are built. */
export function clubSiteBase(origin: string, clubSlug: string, multiClub: boolean): string {
  const root = origin.replace(/\/$/, "");
  return multiClub ? `${root}/${clubSlug}/` : `${root}/`;
}

export type AnnouncementCopyInput = {
  clubName: string;
  title: string;
  text: string;
  body?: string | null;
  link?: string | null;
};

/**
 * Plain text for WhatsApp. WhatsApp renders *bold*, so the title is wrapped;
 * nothing else is formatted, and there is no HTML. Blank lines are kept as
 * paragraph breaks but runs of them collapse to one.
 */
export function whatsappCopyText(input: AnnouncementCopyInput): string {
  const clean = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const title = input.title.replace(/\*/g, "").trim();
  const parts = [`*${input.clubName}: ${title}*`, clean(input.text)];
  if (input.body?.trim()) parts.push(clean(input.body));
  if (input.link?.trim()) parts.push(input.link.trim());
  return parts.join("\n\n");
}

/** Escape text for an HTML email body, keeping line breaks. */
export function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n|\r|\n/g, "<br>\n");
}
