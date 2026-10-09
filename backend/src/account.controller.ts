import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { AuthToken, User, Session, SecurityEvent, publicRecord, securityLog, transaction } from "./database";
import { changePasswordDto, emailDto, fail, paginate, parse, profileDto, recordId, resetDto, tokenDto } from "./contracts";
import { AuthGuard, checkPassword, cookieName, cookieOptions, digest, hashPassword, randomToken } from "./security";
import { assertEmailConfigured, sendAccountEmail } from "./email";
const accepted = { message: "If an eligible account exists, a reset link will be sent. Check your inbox or try again later." };
function clearSession(res: Response) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(cookieName, options);
}
async function sendToken(req: any, user: any, kind: "verify" | "reset") {
  // Per-account cooldown also limits distributed requests from multiple IPs.
  const cutoff = new Date(Date.now() - 60000);
  if (await AuthToken.exists({ userId: user._id, kind, createdAt: { $gt: cutoff } })) return;
  const token = randomToken();
  const tokenHash = digest(token);
  await AuthToken.create({ userId: user._id, kind, tokenHash, authVersion: user.authVersion || 0,
    expiresAt: new Date(Date.now() + (kind === "verify" ? 24 * 60 : 30) * 60000) });
  const link = `${process.env.PUBLIC_APP_URL || "http://localhost:3000"}/#settings?${kind}=${token}`;
  try {
    await sendAccountEmail({ to: user.email, subject: kind === "verify" ? "Verify your AI Growth OS email" : "Reset your AI Growth OS password",
      text: `${kind === "verify" ? "Verify your email" : "Reset your password"}: ${link}\nThis link expires in ${kind === "verify" ? "24 hours" : "30 minutes"} and works only once. If you did not request it, ignore this message.`,
      key: `${kind}-${tokenHash}` });
    await securityLog(req, user._id, `${kind}.email_requested`);
  } catch (error) {
    await AuthToken.deleteOne({ tokenHash });
    // Do not log recipients, credentials, tokens, or provider error bodies.
    console.error(JSON.stringify({ code: "EMAIL_DELIVERY_FAILED", requestId: req.requestId }));
    throw error;
  }
}
@Controller("auth")
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AccountController {
  @Post("email-verification") @HttpCode(202) @UseGuards(AuthGuard)
  async requestVerification(@Req() req: any) {
    if (req.user.emailVerifiedAt) return { message: "Email already verified." };
    assertEmailConfigured();
    await sendToken(req, req.user, "verify");
    return { message: "Check your inbox for a verification link. You can request another after one minute." };
  }
  @Post("email-verification/complete") @HttpCode(200)
  async verify(@Req() req: any, @Body() body: unknown) {
    const dto = parse(tokenDto, body);
    await transaction(async session => {
      const t = await AuthToken.findOneAndDelete({ tokenHash: digest(dto.token), kind: "verify", expiresAt: { $gt: new Date() } }, { session });
      if (!t) fail(409, "TOKEN_UNAVAILABLE", "This link is invalid, expired or already used. Request a new link.");
      const user = await User.findOneAndUpdate({ _id: t.userId, status: "active", authVersion: t.authVersion },
        { $set: { emailVerifiedAt: new Date() }, $inc: { version: 1 } }, { new: true, session });
      if (!user) fail(409, "TOKEN_UNAVAILABLE", "Account security changed. Request a new link.");
      await AuthToken.deleteMany({ userId: user._id, kind: "verify" }, { session });
      await securityLog(req, user._id, "email.verified", session);
    });
    return { message: "Email verified. You can now access your workspace." };
  }
  @Post("password-reset") @HttpCode(202)
  async requestReset(@Req() req: any, @Body() body: unknown) {
    const dto = parse(emailDto, body);
    assertEmailConfigured();
    const user = await User.findOne({ email: dto.email, status: "active" });
    if (user) {
      try { await sendToken(req, user, "reset"); }
      catch { /* Uniform response prevents account enumeration on provider failure. */ }
    }
    return accepted;
  }
  @Post("password-reset/complete") @HttpCode(200)
  async reset(@Req() req: any, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parse(resetDto, body);
    const passwordHash = await hashPassword(dto.newPassword);
    await transaction(async session => {
      const t = await AuthToken.findOneAndDelete({ tokenHash: digest(dto.token), kind: "reset", expiresAt: { $gt: new Date() } }, { session });
      if (!t) fail(409, "TOKEN_UNAVAILABLE", "This link is invalid, expired or already used. Request a new link.");
      const user = await User.findOneAndUpdate({ _id: t.userId, status: "active", authVersion: t.authVersion },
        { $set: { passwordHash }, $inc: { authVersion: 1, version: 1 } }, { new: true, session });
      if (!user) fail(409, "TOKEN_UNAVAILABLE", "Account security changed. Request a new link.");
      await Session.deleteMany({ userId: user._id }, { session });
      await AuthToken.deleteMany({ userId: user._id }, { session });
      await securityLog(req, user._id, "password.reset", session);
    });
    clearSession(res);
    return { message: "Password reset. Sign in again on each device." };
  }
  @Patch("account") @UseGuards(AuthGuard)
  async profile(@Req() req: any, @Body() body: unknown) {
    const dto = parse(profileDto, body);
    return transaction(async session => {
      const user = await User.findOneAndUpdate({ _id: req.user._id, version: dto.version },
        { $set: { name: dto.name }, $inc: { version: 1 } }, { new: true, session });
      if (!user) fail(409, "VERSION_CONFLICT", "Account changed. Reload before saving.");
      await securityLog(req, user._id, "account.updated", session);
      return publicRecord(user);
    });
  }
  @Post("password") @HttpCode(200) @UseGuards(AuthGuard)
  async changePassword(@Req() req: any, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const dto = parse(changePasswordDto, body);
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!user || !await checkPassword(dto.currentPassword, user.passwordHash)) fail(403, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect.");
    const passwordHash = await hashPassword(dto.newPassword);
    await transaction(async session => {
      const changed = await User.updateOne({ _id: user._id, authVersion: user.authVersion },
        { $set: { passwordHash }, $inc: { authVersion: 1, version: 1 } }, { session });
      if (!changed.matchedCount) fail(409, "VERSION_CONFLICT", "Account security changed. Sign in again.");
      await Session.deleteMany({ userId: user._id }, { session });
      await AuthToken.deleteMany({ userId: user._id }, { session });
      await securityLog(req, user._id, "password.changed", session);
    });
    clearSession(res);
    return { message: "Password changed. All sessions have been signed out." };
  }
  @Get("sessions") @UseGuards(AuthGuard)
  async sessions(@Req() req: any) {
    const items = await Session.find({ userId: req.user._id, authVersion: req.user.authVersion || 0, expiresAt: { $gt: new Date() } })
      .select("_id createdAt expiresAt userAgent").sort({ createdAt: -1 }).limit(100).lean();
    return { items: items.map(s => ({ ...s, current: String(s._id) === String(req.sessionId) })) };
  }
  @Delete("sessions/:id") @HttpCode(204) @UseGuards(AuthGuard)
  async revoke(@Req() req: any, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    recordId(id);
    await transaction(async session => {
      const result = await Session.deleteOne({ _id: id, userId: req.user._id }, { session });
      if (!result.deletedCount) fail(404, "NOT_FOUND", "Session unavailable.");
      await securityLog(req, req.user._id, "session.revoked", session);
    });
    if (id === String(req.sessionId)) clearSession(res);
  }
  @Post("logout-all") @HttpCode(204) @UseGuards(AuthGuard)
  async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    await transaction(async session => {
      await User.updateOne({ _id: req.user._id }, { $inc: { authVersion: 1 } }, { session });
      await Session.deleteMany({ userId: req.user._id }, { session });
      await securityLog(req, req.user._id, "sessions.revoked_all", session);
    });
    clearSession(res);
  }
  @Get("security-events") @UseGuards(AuthGuard)
  async events(@Req() req: any, @Query() query: any) {
    return paginate(SecurityEvent, { userId: req.user._id }, query);
  }
}
