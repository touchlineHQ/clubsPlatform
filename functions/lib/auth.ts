import { betterAuth } from "better-auth";

const enc = new TextEncoder();

export async function hashPwd(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key, 256
  );
  const out = new Uint8Array(16 + 32);
  out.set(salt);
  out.set(new Uint8Array(bits), 16);
  return "pbkdf2$" + btoa(String.fromCharCode(...out));
}

async function verifyPwd({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (!hash.startsWith("pbkdf2$")) return false;
  try {
    const bytes = Uint8Array.from(atob(hash.slice(7)), c => c.charCodeAt(0));
    const salt = bytes.slice(0, 16);
    const stored = bytes.slice(16);
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      key, 256
    );
    const derived = new Uint8Array(bits);
    if (stored.length !== derived.length) return false;
    let diff = 0;
    for (let i = 0; i < stored.length; i++) diff |= stored[i] ^ derived[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function createAuth(
  env: { DB: D1Database; BETTER_AUTH_SECRET: string },
  opts?: { baseURL?: string }
) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: opts?.baseURL,
    trustedOrigins: [
      opts?.baseURL ?? "https://elbantams.pages.dev",
      "http://localhost:5173",
      "http://localhost:8788",
    ],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPwd,
        verify: verifyPwd,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "member",
          input: false,
        },
        clubSlug: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const count = await env.DB
              .prepare('SELECT COUNT(*) as c FROM "user"')
              .first<{ c: number }>();
            if (count && count.c === 1) {
              await env.DB
                .prepare('UPDATE "user" SET role = ? WHERE id = ?')
                .bind("admin", user.id)
                .run();
            }
          },
        },
      },
    },
  });
}
