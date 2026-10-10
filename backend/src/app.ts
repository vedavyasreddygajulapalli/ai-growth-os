import { embeddedCrawlerReady, stopEmbeddedCrawler } from "./crawler/embedded";
import { crawlSettings } from "./crawler/settings";
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
import { ThrottlerModule, ThrottlerGuard, SkipThrottle } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import express from "express";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { validateEnvironment } from "./environment";
import { rateLimitStore, closeRateLimitStore } from "./rate-limit";
import { AccountController } from "./account.controller";
import { AuthController } from "./auth.controller";
import {
  OrganizationsController,
  InvitationsController,
} from "./organizations.controller";
import { CrawlsController } from "./crawler/controller";
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
@SkipThrottle()
class HealthController {
  @Get("live") live() { return { status: "alive" }; }
  @Get("ready") async ready() {
    try {
      if (mongoose.connection.readyState !== 1) throw Error();
      await mongoose.connection.db!.admin().ping();
      if (process.env.RATE_LIMIT_STORE === "redis") await rateLimitStore()!.ready();
      return { status: "ready", ...(process.env.CRAWLER_ENABLED === "true" && crawlSettings().execution === "embedded" ? { crawler: { mode: "embedded", ready: embeddedCrawlerReady() } } : {}) };
    } catch { throw new HttpException({ code: "DEPENDENCY_UNAVAILABLE", message: "Service is not ready." }, 503); }
  }
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
  imports: [ThrottlerModule.forRootAsync({ useFactory: () => ({ throttlers: [{ ttl: 60000, limit: 120 }], storage: rateLimitStore() }) })],
  controllers: [
    HealthController,
    AuthController,
    AccountController,
    OrganizationsController,
    InvitationsController,
    WebsitesController,
    CrawlsController,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, {
    provide: "RESOURCE_LIFECYCLE", useValue: { async beforeApplicationShutdown() { await stopEmbeddedCrawler(); }, async onApplicationShutdown() { closeRateLimitStore(); await mongoose.disconnect(); } },
  }],
})
export class AppModule {}
export async function createApp() {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn"],
    bodyParser: false,
  });
  const allowed = (process.env.APP_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((x) => x.trim());
  if (process.env.TRUST_PROXY) app.getHttpAdapter().getInstance().set("trust proxy", process.env.TRUST_PROXY.split(",").map(s => s.trim()));
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    req.requestId = randomUUID();
    const started = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test") console.info(JSON.stringify({ event: "http.request", requestId: req.requestId, method: req.method, status: res.statusCode, durationMs: Date.now() - started }));
    });
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
  const originalClose = app.close.bind(app);
  app.close = async () => { await originalClose(); closeRateLimitStore(); await mongoose.disconnect(); };
  return app;
}
