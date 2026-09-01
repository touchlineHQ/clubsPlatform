import { DEFAULT_FROM_NAME } from "./email";

/**
 * The three transactional emails the platform sends.
 *
 * Each returns subject, HTML and plain text together so the two bodies cannot
 * drift apart. Styling is inline and there are no images: club mail goes to
 * parents on every mail client there is, and a remote asset is the fastest way
 * into a spam folder.
 */

export interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

/** Escape text for interpolation into HTML. Club names and links are untrusted. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(opts: { clubName: string; heading: string; paragraphs: string[]; cta: { url: string; label: string }; footer: string }): string {
  const paragraphs = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#222;">${p}</p>`)
    .join("");
  const url = escapeHtml(opts.cta.url);
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">`,
    `<p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#666;">${escapeHtml(opts.clubName)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111;">${escapeHtml(opts.heading)}</h1>`,
    paragraphs,
    `<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;">${escapeHtml(opts.cta.label)}</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#666;">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;">${url}</span></p>`,
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#888;">${escapeHtml(opts.footer)}</p>`,
    `</div>`,
  ].join("");
}

function plain(lines: string[], url: string, footer: string): string {
  return [...lines, "", url, "", footer].join("\n");
}

/** Sent by better-auth's forget-password flow. */
export function resetPasswordEmail(opts: { clubName?: string | null; url: string; expiresInHours: number }): EmailBody {
  const clubName = opts.clubName || DEFAULT_FROM_NAME;
  const expiry = `This link can only be used once and expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? "" : "s"}.`;
  const footer = "If you did not ask to reset your password you can ignore this email — your password will not change.";
  return {
    subject: `Reset your ${clubName} password`,
    html: layout({
      clubName,
      heading: "Reset your password",
      paragraphs: [
        `Someone asked to reset the password for your ${escapeHtml(clubName)} account.`,
        escapeHtml(expiry),
      ],
      cta: { url: opts.url, label: "Choose a new password" },
      footer,
    }),
    text: plain(
      [
        `Reset your ${clubName} password`,
        "",
        `Someone asked to reset the password for your ${clubName} account.`,
        expiry,
      ],
      opts.url,
      footer,
    ),
  };
}

/** Sent on sign-up so an address is confirmed to belong to whoever claimed it. */
export function verifyAddressEmail(opts: { clubName?: string | null; url: string }): EmailBody {
  const clubName = opts.clubName || DEFAULT_FROM_NAME;
  const footer = "If you did not create this account you can ignore this email.";
  return {
    subject: `Confirm your email for ${clubName}`,
    html: layout({
      clubName,
      heading: "Confirm your email address",
      paragraphs: [
        `Please confirm this address so ${escapeHtml(clubName)} can send you club updates and payment reminders.`,
      ],
      cta: { url: opts.url, label: "Confirm my email" },
      footer,
    }),
    text: plain(
      [
        `Confirm your email for ${clubName}`,
        "",
        `Please confirm this address so ${clubName} can send you club updates and payment reminders.`,
      ],
      opts.url,
      footer,
    ),
  };
}

/**
 * Sent to a parent whose account was created by the FA player import.
 *
 * They never signed up, so this has to explain where the account came from
 * before it asks them to do anything.
 */
export function importWelcomeEmail(opts: { clubName?: string | null; url: string; expiresInDays: number }): EmailBody {
  const clubName = opts.clubName || DEFAULT_FROM_NAME;
  const expiry = `This link expires in ${opts.expiresInDays} days. If it runs out, use "Forgot your password?" on the sign-in page to get a new one.`;
  const footer = "You are receiving this because your email address is on your club's FA player registration record.";
  return {
    subject: `Set up your ${clubName} account`,
    html: layout({
      clubName,
      heading: `Your ${clubName} account is ready`,
      paragraphs: [
        `${escapeHtml(clubName)} has set up an account for you so you can see your player's registration and manage subscription payments.`,
        "Choose a password to finish setting it up.",
        escapeHtml(expiry),
      ],
      cta: { url: opts.url, label: "Set my password" },
      footer,
    }),
    text: plain(
      [
        `Your ${clubName} account is ready`,
        "",
        `${clubName} has set up an account for you so you can see your player's registration and manage subscription payments.`,
        "Choose a password to finish setting it up.",
        expiry,
      ],
      opts.url,
      footer,
    ),
  };
}
