import { betterAuth } from "better-auth";

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
