/**
 * The wording and markup of the account emails.
 *
 * Kept apart from both the provider (lib/email.ts) and the flow that triggers
 * them (lib/auth.ts) so the copy can be read and
 * changed without touching either.
 */

export interface BuiltMessage {
  subject: string;
  html: string;
  text: string;
}

/** Escape text being interpolated into the HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * One plain, single-column layout for every message.
 *
 * No images and no external stylesheet: club mail goes to parents on phones,
 * through filters that distrust both, and a link that survives is worth more
 * than a design that might not render.
 *
 * The footer is not here: lib/mail-layout.ts adds it on every send (#135).
 */
function layout(clubName: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;">${escapeHtml(clubName)}</h1>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

function button(link: string, label: string): string {
  return `<p style="margin:0 0 24px;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">${escapeHtml(label)}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#555;">Or paste this into your browser:</p>
      <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${escapeHtml(link)}" style="color:#1a1a1a;">${escapeHtml(link)}</a></p>`;
}

/** Sent when someone asks to reset a password they have forgotten. */
export function resetPasswordMessage(clubName: string, link: string): BuiltMessage {
  return {
    subject: `Reset your ${clubName} password`,
    html: layout(
      clubName,
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        Someone asked to reset the password for this email address. Choose a new one using the link below — it works once, and expires in an hour.
      </p>
      ${button(link, "Choose a new password")}
      <p style="margin:24px 0 0;font-size:13px;color:#555;">If it wasn't you, nothing has changed and you can ignore this email.</p>`,
    ),
    text: [
      `Someone asked to reset the password for this email address at ${clubName}.`,
      ``,
      `Choose a new one here — the link works once and expires in an hour:`,
      link,
      ``,
      `If it wasn't you, nothing has changed and you can ignore this email.`,
    ].join("\n"),
  };
}

/** Sent on sign-up, to confirm the address belongs to whoever typed it. */
export function verifyEmailMessage(clubName: string, link: string): BuiltMessage {
  return {
    subject: `Confirm your email for ${clubName}`,
    html: layout(
      clubName,
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        Thanks for signing up. Confirm this is your email address and you're all set — the link expires in an hour.
      </p>
      ${button(link, "Confirm my email")}`,
    ),
    text: [
      `Thanks for signing up to ${clubName}.`,
      ``,
      `Confirm this is your email address — the link expires in an hour:`,
      link,
    ].join("\n"),
  };
}

/**
 * Activation mail to a parent whose address a club has entered (#132).
 *
 * The only mail a `pending` contact ever receives (plus at most one reminder).
 * Names the club and identifies the player by FAN and team — we hold no name.
 * Nothing here is consent: the parent gives it on the page the link opens.
 * `declineLink` lets them say "I did not agree to this" without contacting
 * anyone.
 */
export function activationMessage(
  clubName: string,
  player: { fanId: string; teamName: string | null },
  links: { activate: string; decline: string },
  reminder = false,
): BuiltMessage {
  const who = player.teamName
    ? `FAN ${player.fanId} (${player.teamName})`
    : `FAN ${player.fanId}`;
  const lead = reminder
    ? `A reminder: ${clubName} entered this email address as a contact for ${who}, and it has not been activated. If you don't activate it, the address will be deleted after a while.`
    : `${clubName} entered this email address as a contact for ${who}. Nothing will be sent to you until you activate it.`;
  return {
    subject: reminder
      ? `Reminder: activate your contact details for ${clubName}`
      : `Activate your contact details for ${clubName}`,
    html: layout(
      clubName,
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(lead)}</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        You'll see what you're agreeing to, and you can choose whether to also hear about club news and offers (that's a separate, optional tick). You don't need a password.
      </p>
      ${button(links.activate, "Activate & accept")}
      <p style="margin:0;font-size:13px;color:#555;">
        Didn't agree to this? <a href="${escapeHtml(links.decline)}" style="color:#1a1a1a;">I did not agree to this</a> — we'll stop using the address and tell the club.
      </p>`,
    ),
    text: [
      lead,
      ``,
      `Activate & accept (no password needed):`,
      links.activate,
      ``,
      `Didn't agree to this? Tell us here and we'll stop using the address and tell the club:`,
      links.decline,
    ].join("\n"),
  };
}
