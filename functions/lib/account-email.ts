/**
 * The wording and markup of the account emails.
 *
 * Kept apart from both the provider (lib/email.ts) and the flows that trigger
 * them (lib/auth.ts, api/admin/import-players.ts) so the copy can be read and
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
 */
function layout(clubName: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;">${escapeHtml(clubName)}</h1>
      ${bodyHtml}
    </div>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#777;">
      Sent by ${escapeHtml(clubName)}. If you weren't expecting this, you can ignore it.
    </p>
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
 * Sent when the player import creates an account for someone.
 *
 * The recipient did not ask for this and has never heard of the account, so
 * the message has to say where it came from before it asks for anything.
 */
export function invitationMessage(clubName: string, link: string, expiresInDays: number): BuiltMessage {
  const days = expiresInDays === 1 ? "1 day" : `${expiresInDays} days`;
  return {
    subject: `Set up your ${clubName} account`,
    html: layout(
      clubName,
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        ${escapeHtml(clubName)} has set up an account for you from its registration records, so you can see your players' registrations and subscriptions online.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
        Choose a password to finish setting it up. This link expires in ${escapeHtml(days)}.
      </p>
      ${button(link, "Set my password")}`,
    ),
    text: [
      `${clubName} has set up an account for you from its registration records,`,
      `so you can see your players' registrations and subscriptions online.`,
      ``,
      `Choose a password to finish setting it up. This link expires in ${days}:`,
      link,
    ].join("\n"),
  };
}
