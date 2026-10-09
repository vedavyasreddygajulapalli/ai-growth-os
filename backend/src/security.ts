import { ClientSession } from "mongoose";
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
export async function issueSession(userId: any, res: any, authVersion = 0, userAgent = "Unknown device") {
  const token = randomToken();
  await Session.create({
    userId,
    authVersion,
    userAgent: userAgent.slice(0, 250),
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
    if (!user || (user.authVersion || 0) !== (s.authVersion || 0)) fail(401, "UNAUTHENTICATED", "Sign in to continue.");
    req.user = user;
    req.sessionId = s._id;
    return true;
  }
}
export async function access(
  req: any,
  orgId: string,
  allowed?: readonly string[],
  session?: ClientSession,
) {
  recordId(orgId);
  const m = await Membership.findOne({
    orgId,
    userId: req.user._id,
    status: "active",
  }).session(session || null).lean();
  if (!m) fail(404, "NOT_FOUND", "Workspace unavailable.");
  if (!(await Organization.exists({ _id: orgId, status: "active" }).session(session || null)))
    fail(404, "NOT_FOUND", "Workspace unavailable.");
  if (allowed && !allowed.includes(m.role!))
    fail(403, "FORBIDDEN", "Your role cannot perform this action.");
  if (session) {
    // This write serializes a protected mutation against role changes/removal.
    const locked = await Membership.updateOne({ _id: m._id, status: "active", role: m.role, version: m.version },
      { $inc: { authorizationRevision: 1 } }, { session });
    if (!locked.matchedCount) fail(409, "PERMISSION_CHANGED", "Your permissions changed. Reload before continuing.");
  }
  return m;
}
export const managers = ["Owner", "Admin"];
export function assignable(actor: string, role: string) {
  if (role === "Owner" || (actor !== "Owner" && role === "Admin"))
    fail(403, "FORBIDDEN", "Only the owner can assign administrator access.");
}

@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.user?.emailVerifiedAt)
      fail(403, "EMAIL_UNVERIFIED", "Verify your email before accessing workspace data.");
    return true;
  }
}
