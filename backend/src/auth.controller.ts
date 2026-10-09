import { Throttle } from "@nestjs/throttler";
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { Request, Response } from "express";
import { User, Session, publicRecord, securityLog, transaction } from "./database";
import { fail, parse, registerDto, loginDto } from "./contracts";
import {
  AuthGuard,
  hashPassword,
  checkPassword,
  issueSession,
  cookieName,
  cookieOptions,
} from "./security";
@Controller("auth")
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  @Post("register") async register(
    @Req() req: any,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto = parse(registerDto, body);
    const u = await User.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await hashPassword(dto.password),
    }).catch((e) => {
      if (e.code === 11000)
        fail(
          409,
          "ACCOUNT_UNAVAILABLE",
          "Unable to create this account. Try signing in.",
        );
      throw e;
    });
    await issueSession(u._id, res, u.authVersion || 0, req.headers["user-agent"]);
    await securityLog(req, u._id, "account.signed_in");
    return publicRecord(u);
  }
  @Post("login") @HttpCode(200) async login(
    @Req() req: any,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto = parse(loginDto, body);
    const u = await User.findOne({ email: dto.email, status: "active" }).select(
      "+passwordHash",
    );
    const valid = await checkPassword(
      dto.password,
      u?.passwordHash || `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!u || !valid)
      fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    await issueSession(u._id, res, u.authVersion || 0, req.headers["user-agent"]);
    await securityLog(req, u._id, "account.signed_in");
    return publicRecord(u);
  }
  @Get("me") @UseGuards(AuthGuard) me(@Req() req: any) {
    return publicRecord(req.user);
  }
  @Post("logout") @HttpCode(204) @UseGuards(AuthGuard) async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await transaction(async session => {
      await Session.deleteOne({ _id: req.sessionId, userId: req.user._id }, { session });
      await securityLog(req, req.user._id, "account.signed_out", session);
    });
    const { maxAge, ...options } = cookieOptions();
    res.clearCookie(cookieName, options);
  }
}
