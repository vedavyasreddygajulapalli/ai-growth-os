import { z } from "zod";
import { HttpException } from "@nestjs/common";
import { roles } from "./database";
export function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
export const text = z.string().trim().min(2).max(160);
export const email = z.email().trim().toLowerCase().max(254);
export const password = z.string().min(12).max(128);
export const timezone = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA timezone");
export const currency = z
  .string()
  .refine(
    (v) => (Intl as any).supportedValuesOf("currency").includes(v),
    "Use an ISO currency code",
  );
export const registerDto = z.object({ name: text, email, password }).strict();
export const loginDto = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const orgDto = z.object({ name: text, timezone, currency }).strict();
export const orgPatchDto = orgDto
  .partial()
  .extend({ version: z.number().int().nonnegative() })
  .strict();
export const inviteDto = z
  .object({
    email,
    role: z.enum(roles.filter((r) => r !== "Owner") as ["Admin", ...string[]]),
  })
  .strict();
export const roleDto = z
  .object({
    role: z.enum(roles.filter((r) => r !== "Owner") as ["Admin", ...string[]]),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const tokenDto = z
  .object({ token: z.string().regex(/^[a-f\d]{64}$/) })
  .strict();
export function normalizeDomain(value: string) {
  let host = value.trim().toLowerCase();
  if (host.includes("://")) {
    const u = new URL(host);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw Error("Use a bare public domain or HTTPS origin");
    host = u.hostname;
  }
  host = host.replace(/\.$/, "");
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      host,
    ) ||
    /\.(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw Error("Use a public domain such as example.com");
  return host;
}
export const domain = z
  .string()
  .max(300)
  .transform((v, c) => {
    try {
      return normalizeDomain(v);
    } catch (e) {
      c.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });
export const websiteDto = z
  .object({
    name: text,
    domain,
    cmsType: z.enum(["WordPress", "Webflow", "Shopify", "Custom", "Other"]),
  })
  .strict();
export const websitePatchDto = websiteDto
  .partial()
  .extend({
    status: z.enum(["active", "archived"]).optional(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new HttpException(
      {
        code: "VALIDATION_FAILED",
        message: "Check the highlighted fields.",
        details: r.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      422,
    );
  return r.data;
}
export function recordId(value: string) {
  return parse(id, value);
}
export function pageQuery(query: any) {
  return parse(
    z
      .object({
        cursor: id.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict(),
    query,
  );
}
export async function paginate(
  model: any,
  filter: any,
  query: any,
  select?: string,
) {
  const { cursor, limit } = pageQuery(query);
  const q = model
    .find({ ...filter, ...(cursor ? { _id: { $lt: cursor } } : {}) })
    .sort({ _id: -1 })
    .limit(limit + 1);
  if (select) q.select(select);
  const rows = await q.lean();
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? String(rows[limit - 1]._id) : null,
  };
}
