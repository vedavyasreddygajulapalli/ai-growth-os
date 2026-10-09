import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { z } from "zod";
import {
  Organization,
  Membership,
  Invitation,
  User,
  Audit,
  transaction,
  log,
  publicRecord,
} from "./database";
import {
  fail,
  parse,
  orgDto,
  orgPatchDto,
  inviteDto,
  roleDto,
  tokenDto,
  recordId,
  paginate,
} from "./contracts";
import {
  AuthGuard,
  VerifiedGuard,
  access,
  managers,
  assignable,
  randomToken,
  digest,
} from "./security";
@Controller("organizations")
@UseGuards(AuthGuard, VerifiedGuard)
export class OrganizationsController {
  @Get() async list(@Req() req: any) {
    const memberships = await Membership.find({
      userId: req.user._id,
      status: "active",
    }).lean();
    const orgs = await Organization.find({
      _id: { $in: memberships.map((m) => m.orgId) },
      status: "active",
    }).lean();
    return {
      items: orgs.map((o) => ({
        ...o,
        role: memberships.find((m) => String(m.orgId) === String(o._id))!.role,
      })),
    };
  }
  @Post() async create(@Req() req: any, @Body() body: unknown) {
    const dto = parse(orgDto, body);
    return transaction(async (session) => {
      const [org] = await Organization.create([dto], { session });
      await Membership.create(
        [{ orgId: org._id, userId: req.user._id, role: "Owner" }],
        { session },
      );
      await log(
        session,
        req,
        String(org._id),
        "organization.created",
        "organization",
        org._id,
        null,
        org,
      );
      return { ...publicRecord(org), role: "Owner" };
    });
  }
  @Patch(":orgId") async update(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    await access(req, orgId, managers);
    const { version, ...changes } = parse(orgPatchDto, body);
    return transaction(async (session) => {
      await access(req, orgId, managers, session);
      const before = await Organization.findById(orgId).session(session);
      const org = await Organization.findOneAndUpdate(
        { _id: orgId, version },
        { $set: changes, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!org)
        fail(
          409,
          "VERSION_CONFLICT",
          "This workspace changed. Reload before saving.",
        );
      await log(
        session,
        req,
        orgId,
        "organization.updated",
        "organization",
        orgId,
        before,
        org,
      );
      return publicRecord(org);
    });
  }
  @Get(":orgId/memberships") async members(
    @Req() req: any,
    @Param("orgId") orgId: string,
  ) {
    await access(req, orgId, managers);
    const list = await Membership.find({ orgId, status: "active" }).lean();
    const users = await User.find({ _id: { $in: list.map((m) => m.userId) } })
      .select("name email")
      .lean();
    return {
      items: list.map((m) => ({
        ...m,
        user: users.find((u) => String(u._id) === String(m.userId)),
      })),
    };
  }
  @Get(":orgId/invitations") async invites(
    @Req() req: any,
    @Param("orgId") orgId: string,
  ) {
    await access(req, orgId, managers);
    return {
      items: await Invitation.find({
        orgId,
        status: "pending",
        expiresAt: { $gt: new Date() },
      })
        .select("-tokenHash")
        .lean(),
    };
  }
  @Post(":orgId/invitations") async invite(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    const actor = await access(req, orgId, managers);
    const dto = parse(inviteDto, body);
    assignable(actor.role!, dto.role);
    const user = await User.findOne({ email: dto.email }).lean();
    if (
      user &&
      (await Membership.exists({ orgId, userId: user._id, status: "active" }))
    )
      fail(409, "ALREADY_MEMBER", "This person is already a member.");
    const token = randomToken();
    const result = await transaction(async (session) => {
      const actor = await access(req, orgId, managers, session);
      assignable(actor.role!, dto.role);
      await Invitation.updateMany(
        {
          orgId,
          email: dto.email,
          status: "pending",
          expiresAt: { $lte: new Date() },
        },
        { $set: { status: "revoked" } },
        { session },
      );
      const [inv] = await Invitation.create(
        [
          {
            ...dto,
            orgId,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
            createdBy: req.user._id,
          },
        ],
        { session },
      );
      await log(
        session,
        req,
        orgId,
        "invitation.created",
        "invitation",
        inv._id,
        null,
        inv,
      );
      return publicRecord(inv);
    });
    return { ...result, token };
  }
  @Delete(":orgId/invitations/:id") @HttpCode(204) async revoke(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
  ) {
    const actor = await access(req, orgId, managers);
    recordId(id);
    await transaction(async (session) => {
      const actor = await access(req, orgId, managers, session);
      const inv = await Invitation.findOne({
        _id: id,
        orgId,
        status: "pending",
      }).session(session);
      if (!inv) fail(404, "NOT_FOUND", "Invitation unavailable.");
      assignable(actor.role!, inv.role!);
      const before = inv.toObject();
      inv.status = "revoked";
      await inv.save({ session });
      await log(
        session,
        req,
        orgId,
        "invitation.revoked",
        "invitation",
        id,
        before,
        inv,
      );
    });
  }
  @Patch(":orgId/memberships/:id") async role(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const actor = await access(req, orgId, managers);
    recordId(id);
    const dto = parse(roleDto, body);
    assignable(actor.role!, dto.role);
    return transaction(async (session) => {
      const actor = await access(req, orgId, managers, session);
      const m = await Membership.findOne({
        _id: id,
        orgId,
        status: "active",
      }).session(session);
      if (!m) fail(404, "NOT_FOUND", "Member unavailable.");
      if (m.role === "Owner" || (actor.role !== "Owner" && m.role === "Admin"))
        fail(403, "FORBIDDEN", "This role cannot be changed here.");
      if (m.version !== dto.version)
        fail(409, "VERSION_CONFLICT", "Membership changed. Reload first.");
      assignable(actor.role!, dto.role);
      const before = m.toObject();
      m.role = dto.role;
      m.version!++;
      await m.save({ session });
      await log(
        session,
        req,
        orgId,
        "membership.role_changed",
        "membership",
        id,
        before,
        m,
      );
      return publicRecord(m);
    });
  }
  @Delete(":orgId/memberships/:id") @HttpCode(204) async remove(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
  ) {
    const actor = await access(req, orgId, managers);
    recordId(id);
    await transaction(async (session) => {
      const actor = await access(req, orgId, managers, session);
      const m = await Membership.findOne({
        _id: id,
        orgId,
        status: "active",
      }).session(session);
      if (!m) fail(404, "NOT_FOUND", "Member unavailable.");
      if (m.role === "Owner" || (actor.role !== "Owner" && m.role === "Admin"))
        fail(
          403,
          "FORBIDDEN",
          "Transfer ownership before removing the owner; only owner can remove an admin.",
        );
      const before = m.toObject();
      m.status = "removed";
      m.version!++;
      await m.save({ session });
      await log(
        session,
        req,
        orgId,
        "membership.removed",
        "membership",
        id,
        before,
        m,
      );
    });
  }
  @Post(":orgId/transfer") async transfer(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    const actor = await access(req, orgId, ["Owner"]);
    const dto = parse(
      z
        .object({
          membershipId: z.string(),
          version: z.number().int().nonnegative(),
        })
        .strict(),
      body,
    );
    recordId(dto.membershipId);
    return transaction(async (session) => {
      const actor = await access(req, orgId, ["Owner"], session);
      const target = await Membership.findOne({
        _id: dto.membershipId,
        orgId,
        status: "active",
      }).session(session);
      if (!target || target.role === "Owner")
        fail(409, "INVALID_TARGET", "Choose another active member.");
      const old = await Membership.findOneAndUpdate(
        { _id: actor._id, role: "Owner", version: dto.version },
        { $set: { role: "Admin" }, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!old)
        fail(409, "VERSION_CONFLICT", "Ownership changed. Reload first.");
      target.role = "Owner";
      target.version!++;
      await target.save({ session });
      await log(
        session,
        req,
        orgId,
        "organization.ownership_transferred",
        "organization",
        orgId,
        { owner: actor.userId },
        { owner: target.userId },
      );
      return { transferred: true };
    });
  }
  @Get(":orgId/audit-logs") async audits(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Query() query: any,
  ) {
    await access(req, orgId, managers);
    return paginate(Audit, { orgId }, query);
  }
}
@Controller("invitations")
@UseGuards(AuthGuard, VerifiedGuard)
export class InvitationsController {
  @Post("accept") async accept(@Req() req: any, @Body() body: unknown) {
    const { token } = parse(tokenDto, body);
    return transaction(async (session) => {
      const inv = await Invitation.findOneAndUpdate(
        {
          tokenHash: digest(token),
          email: req.user.email,
          status: "pending",
          expiresAt: { $gt: new Date() },
        },
        { $set: { status: "accepted" } },
        { new: true, session },
      );
      if (!inv)
        fail(
          409,
          "INVITATION_UNAVAILABLE",
          "Invitation is invalid, expired, used, or belongs to another email.",
        );
      const org = await Organization.findOne({
        _id: inv.orgId,
        status: "active",
      }).session(session);
      if (!org) fail(404, "NOT_FOUND", "Workspace unavailable.");
      const issuer = await Membership.findOne({
        orgId: inv.orgId,
        userId: inv.createdBy,
        status: "active",
      }).session(session);
      if (!issuer || !managers.includes(issuer.role!))
        fail(
          409,
          "INVITATION_UNAVAILABLE",
          "The inviter no longer has permission.",
        );
      assignable(issuer.role!, inv.role!);
      await access({ user: { _id: issuer.userId } }, String(inv.orgId), managers, session);
      if (
        await Membership.exists({
          orgId: inv.orgId,
          userId: req.user._id,
          status: "active",
        }).session(session)
      )
        fail(409, "ALREADY_MEMBER", "You are already a member.");
      const m = await Membership.findOneAndUpdate(
        { orgId: inv.orgId, userId: req.user._id },
        { $set: { role: inv.role, status: "active" }, $inc: { version: 1 } },
        { upsert: true, new: true, session },
      );
      await log(
        session,
        req,
        String(inv.orgId),
        "invitation.accepted",
        "membership",
        m!._id,
        null,
        m,
      );
      return { orgId: String(inv.orgId) };
    });
  }
}
