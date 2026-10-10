import mongoose, { Schema, ClientSession } from "mongoose";
const oid = Schema.Types.ObjectId;
export const roles = [
  "Owner",
  "Admin",
  "Marketing Manager",
  "SEO Manager",
  "Content Writer",
  "Sales User",
  "Viewer",
] as const;
const schema = (fields: Record<string, unknown>) =>
  new Schema(fields as any, {
    timestamps: true,
    strict: "throw",
    versionKey: false,
  });
const user = schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, default: "active" },
  emailVerifiedAt: { type: Date, default: null },
  authVersion: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
});
const session = schema({
  userId: { type: oid, required: true },
  tokenHash: { type: String, unique: true, required: true, select: false },
  authVersion: { type: Number, default: 0 },
  userAgent: { type: String, default: "Unknown device" },
  expiresAt: { type: Date, required: true },
});
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
session.index({ userId: 1 });
const emailCooldown = schema({ _id: String, expiresAt: { type: Date, required: true } });
emailCooldown.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const authToken = schema({
  userId: { type: oid, required: true },
  kind: { type: String, enum: ["verify", "reset"], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  authVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});
authToken.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authToken.index({ userId: 1, kind: 1 });
const securityEvent = schema({
  userId: { type: oid, required: true },
  action: { type: String, required: true },
  requestId: { type: String, required: true },
});
securityEvent.index({ userId: 1, _id: -1 });
const org = schema({
  name: { type: String, required: true },
  timezone: { type: String, required: true },
  currency: { type: String, required: true },
  version: { type: Number, default: 0 },
  status: { type: String, default: "active" },
});
const membership = schema({
  authorizationRevision: { type: Number, default: 0 },
  orgId: { type: oid, required: true },
  userId: { type: oid, required: true },
  role: { type: String, enum: roles, required: true },
  status: { type: String, default: "active" },
  version: { type: Number, default: 0 },
});
membership.index({ orgId: 1, userId: 1 }, { unique: true });
membership.index(
  { orgId: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "Owner", status: "active" },
  },
);
const invitation = schema({
  orgId: { type: oid, required: true },
  email: { type: String, required: true },
  role: { type: String, enum: roles, required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true },
  status: { type: String, default: "pending" },
  createdBy: { type: oid, required: true },
});
invitation.index(
  { orgId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);
const website = schema({
  orgId: { type: oid, required: true },
  crawlRevision: { type: Number, default: 0 },
  name: { type: String, required: true },
  domain: { type: String, required: true },
  cmsType: {
    type: String,
    enum: ["WordPress", "Webflow", "Shopify", "Custom", "Other"],
    required: true,
  },
  status: { type: String, enum: ["active", "archived"], default: "active" },
  verificationStatus: {
    type: String,
    enum: ["unverified", "verified"],
    default: "unverified",
  },
  verificationToken: { type: String, required: true },
  verifiedAt: Date,
  version: { type: Number, default: 0 },
});
website.index({ orgId: 1, domain: 1 }, { unique: true });
website.index({ orgId: 1, _id: -1 });
const audit = schema({
  orgId: { type: oid, required: true },
  actorId: { type: oid, required: true },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: oid, required: true },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  requestId: { type: String, required: true },
  occurredAt: { type: Date, default: Date.now },
});
audit.index({ orgId: 1, _id: -1 });
type Id = mongoose.Types.ObjectId;
interface Base {
  _id: Id;
  createdAt: Date;
  updatedAt: Date;
}
interface UserDoc extends Base {
  emailVerifiedAt: Date | null;
  authVersion: number;
  version: number;
  name: string;
  email: string;
  passwordHash: string;
  status: string;
}
interface SessionDoc extends Base {
  authVersion: number;
  userAgent: string;
  userId: Id;
  tokenHash: string;
  expiresAt: Date;
}
interface OrgDoc extends Base {
  name: string;
  timezone: string;
  currency: string;
  version: number;
  status: string;
}
interface MembershipDoc extends Base {
  orgId: Id;
  userId: Id;
  role: string;
  status: string;
  version: number;
}
interface InvitationDoc extends Base {
  orgId: Id;
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  status: string;
  createdBy: Id;
}
interface WebsiteDoc extends Base {
  orgId: Id;
  name: string;
  domain: string;
  cmsType: string;
  status: string;
  verificationStatus: string;
  verificationToken: string;
  verifiedAt: Date | null;
  version: number;
}
interface AuditDoc extends Base {
  orgId: Id;
  actorId: Id;
  action: string;
  entityType: string;
  entityId: Id;
  before: unknown;
  after: unknown;
  requestId: string;
  occurredAt: Date;
}
export const EmailCooldown = mongoose.model("EmailCooldown", emailCooldown, "email_cooldowns");
export const AuthToken = mongoose.model("AuthToken", authToken, "auth_tokens");
export const SecurityEvent = mongoose.model("SecurityEvent", securityEvent, "security_events");
export async function securityLog(req: any, userId: any, action: string, session?: ClientSession) {
  await SecurityEvent.create([{ userId, action, requestId: req.requestId }], { session });
}
export const User = mongoose.model<UserDoc>("User", user, "users");
export const Session = mongoose.model<SessionDoc>(
  "Session",
  session,
  "sessions",
);
export const Organization = mongoose.model<OrgDoc>(
  "Organization",
  org,
  "organizations",
);
export const Membership = mongoose.model<MembershipDoc>(
  "Membership",
  membership,
  "memberships",
);
export const Invitation = mongoose.model<InvitationDoc>(
  "Invitation",
  invitation,
  "invitations",
);
export const Website = mongoose.model<WebsiteDoc>(
  "Website",
  website,
  "websites",
);
export const Audit = mongoose.model<AuditDoc>("Audit", audit, "audit_logs");
export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
    maxPoolSize: 10,
    socketTimeoutMS: 10000,
  });
}
export async function initializeIndexes() {
  for (const model of [
    User,
    Session,
    AuthToken,
    EmailCooldown,
    SecurityEvent,
    Organization,
    Membership,
    Invitation,
    Website,
    Audit,
  ])
    await model.createIndexes();
}
export const transaction = <T>(fn: (session: ClientSession) => Promise<T>) =>
  mongoose.connection.transaction(fn);
export function publicRecord(doc: any) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.passwordHash;
  delete obj.authVersion;
  delete obj.authorizationRevision;
  delete obj.tokenHash;
  delete obj.verificationToken;
  return obj;
}
export async function log(
  session: ClientSession,
  req: any,
  orgId: string,
  action: string,
  entityType: string,
  entityId: any,
  before: any,
  after: any,
) {
  await Audit.create(
    [
      {
        orgId,
        actorId: req.user._id,
        action,
        entityType,
        entityId,
        before: publicRecord(before),
        after: publicRecord(after),
        requestId: req.requestId,
      },
    ],
    { session },
  );
}
