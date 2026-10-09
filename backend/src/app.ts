import "reflect-metadata";
import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Module,
  Get,
  Controller,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import express from "express";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { AuthController } from "./auth.controller";
import {
  OrganizationsController,
  InvitationsController,
} from "./organizations.controller";
import { WebsitesController } from "./websites.controller";
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    let status =
      error instanceof HttpException
        ? error.getStatus()
        : error.code === 11000
          ? 409
          : 500;
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const data = typeof payload === "object" && payload ? (payload as any) : {};
    if (status === 500)
      console.error(
        JSON.stringify({
          level: "error",
          requestId: req.requestId,
          name: error.name,
        }),
      );
    res
      .status(status)
      .json({
        error: {
          code:
            data.code ||
            (status === 409
              ? "DUPLICATE_RECORD"
              : status === 429
                ? "RATE_LIMITED"
                : "REQUEST_FAILED"),
          message:
            data.message ||
            (status === 409
              ? "A record with these details already exists."
              : status === 500
                ? "The request could not be completed."
                : "Request rejected."),
          ...(data.details ? { details: data.details } : {}),
          requestId: req.requestId,
        },
      });
  }
}
@Controller("health")
class HealthController {
  @Get() health() {
    if (mongoose.connection.readyState !== 1)
      throw new HttpException(
        { code: "DATABASE_UNAVAILABLE", message: "Database unavailable." },
        503,
      );
    return { status: "ok", database: "connected" };
  }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
  controllers: [
    HealthController,
    AuthController,
    OrganizationsController,
    InvitationsController,
    WebsitesController,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn"],
    bodyParser: false,
  });
  const allowed = (process.env.APP_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((x) => x.trim());
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
      (!allowed.includes(req.headers.origin) ||
        req.headers["x-growth-client"] !== "web")
    )
      return res
        .status(403)
        .json({
          error: {
            code: "ORIGIN_REJECTED",
            message: "This request origin is not allowed.",
            requestId: req.requestId,
          },
        });
    next();
  });
  app.enableCors({
    origin: allowed,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-Growth-Client"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
