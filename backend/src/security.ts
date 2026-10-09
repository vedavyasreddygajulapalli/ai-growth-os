import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import {
  createHash,
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { Membership, Organization, Session, User } from "./database";
import { fail, recordId } from "./contracts";
const scrypt = promisify(rawScrypt);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return key.length === 128 && timingSafeEqual(actual, Buffer.from(key, "hex"));
}
export const cookieName = "growth_session";
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v1",
  maxAge: 7 * 86400 * 1000,
});
export async function issueSession(userId: any, res: any) {
  const token = randomToken();
  await Session.create({
    userId,
    tokenHash: digest(token),
    expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
  });
  res.cookie(cookieName, token, cookieOptions());
}
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.[cookieName];
    if (typeof token !== "string" || !token)
      fail(401, "UNAUTHENTICATED", "Sign in to continue.");
    const s = await Session.findOne({
      tokenHash: digest(token),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!s) fail(401, "UNAUTHENTICATED", "Your session has expired.");
    const user = await User.findOne({ _id: s.userId, status: "active" }).lean();
    if (!user) fail(401, "UNAUTHENTICATED", "Sign in to continue.");
    req.user = user;
    req.sessionId = s._id;
    return true;
  }
}
export async function access(
  req: any,
  orgId: string,
  allowed?: readonly string[],
) {
  recordId(orgId);
  const m = await Membership.findOne({
    orgId,
    userId: req.user._id,
    status: "active",
  }).lean();
  if (!m) fail(404, "NOT_FOUND", "Workspace unavailable.");
  if (!(await Organization.exists({ _id: orgId, status: "active" })))
    fail(404, "NOT_FOUND", "Workspace unavailable.");
  if (allowed && !allowed.includes(m.role!))
    fail(403, "FORBIDDEN", "Your role cannot perform this action.");
  return m;
}
export const managers = ["Owner", "Admin"];
export function assignable(actor: string, role: string) {
  if (role === "Owner" || (actor !== "Owner" && role === "Admin"))
    fail(403, "FORBIDDEN", "Only the owner can assign administrator access.");
}
