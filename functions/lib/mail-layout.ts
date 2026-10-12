/**
 * The shared footer every outbound message goes through (#135).
 *
 * Templates build the body; they never build the footer. getMailer() wraps
 * the provider so applyMailLayout() runs on every send, and OutboundMessage
 * makes `footer` a required field — a send path cannot leave it out.
 *
 * The footer names the sending club (the club is always the sender, #128) and
 * says what kind of message this is, so a parent stopping marketing does not
 * think they are also stopping safety notices — and vice versa.
 */

export type MailFooter =
  | {
      /** Account / activation mail. No unsubscribe: you cannot opt out of mail you asked for. */
      kind: "transactional";
      clubName: string;
      /** Where the recipient can see or change their contact preferences, when one exists. */
      preferencesUrl?: string;
    }
  | {
      kind: "operational" | "marketing";
      clubName: string;
      /** Absolute one-click unsubscribe URL (GET = preference page, POST = RFC 8058 one-click). */
      unsubscribeUrl: string;
    };

export interface LaidOutMessage {
  html: string;
  text: string;
  headers: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip CR/LF so a URL cannot inject extra headers. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, "").trim();
}

/** Marker used by tests and by the layout to prove the footer is present. */
export const FOOTER_MARKER = "data-mail-footer";

export function renderFooter(footer: MailFooter): LaidOutMessage {
  const club = footer.clubName.trim() || "Your club";
  const clubHtml = escapeHtml(club);
  const style = "max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#777;";
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color:#555;">${escapeHtml(label)}</a>`;

  if (footer.kind === "transactional") {
    const prefsHtml = footer.preferencesUrl
      ? ` ${link(footer.preferencesUrl, "See or change your contact preferences")}.`
      : "";
    const prefsText = footer.preferencesUrl
      ? `\nSee or change your contact preferences: ${footer.preferencesUrl}`
      : "";
    return {
      html: `<p ${FOOTER_MARKER}="transactional" style="${style}">Sent by ${clubHtml}. This is a service message about your account or contact details, so there is no unsubscribe — it only arrives because of something you or the club set up.${prefsHtml}</p>`,
      text: `--\nSent by ${club}. This is a service message about your account or contact details, so there is no unsubscribe.${prefsText}`,
      headers: {},
    };
  }

  const url = headerSafe(footer.unsubscribeUrl);
  const headers = {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  if (footer.kind === "marketing") {
    return {
      html: `<p ${FOOTER_MARKER}="marketing" style="${style}">Sent by ${clubHtml}. This is club news and offers (marketing), which you chose to receive. ${link(url, "Unsubscribe from club marketing")} in one click — fixture and safety messages from the club are not affected.</p>`,
      text: `--\nSent by ${club}. This is club news and offers (marketing), which you chose to receive.\nUnsubscribe from club marketing (fixture and safety messages are not affected): ${url}`,
      headers,
    };
  }

  return {
    html: `<p ${FOOTER_MARKER}="operational" style="${style}">Sent by ${clubHtml}. This is a club admin message (fixtures, safety, team updates) — not marketing. ${link(url, "Unsubscribe or change what you get")} in one click.</p>`,
    text: `--\nSent by ${club}. This is a club admin message (fixtures, safety, team updates) — not marketing.\nUnsubscribe or change what you get: ${url}`,
    headers,
  };
}

/**
 * Put the footer on a body. A full HTML document gets it just before </body>;
 * a fragment gets it appended. The text part always ends with it.
 */
export function applyMailLayout(body: { html: string; text: string; footer: MailFooter }): LaidOutMessage {
  const footer = renderFooter(body.footer);
  const closing = body.html.toLowerCase().lastIndexOf("</body>");
  const html = closing >= 0
    ? `${body.html.slice(0, closing)}${footer.html}\n${body.html.slice(closing)}`
    : `${body.html}\n${footer.html}`;
  const text = `${body.text.replace(/\s+$/, "")}\n\n${footer.text}\n`;
  return { html, text, headers: footer.headers };
}
