import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Resolver } from "node:dns/promises";
const dnsResolver = new Resolver({ timeout: 5000, tries: 1 });
import { Website, transaction, log, publicRecord } from "./database";
import {
  fail,
  parse,
  recordId,
  websiteDto,
  websitePatchDto,
  paginate,
} from "./contracts";
import { AuthGuard, access, managers, randomToken } from "./security";
@Controller("organizations/:orgId/websites")
@UseGuards(AuthGuard)
export class WebsitesController {
  @Get() async list(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Query() query: any,
  ) {
    await access(req, orgId);
    return paginate(Website, { orgId }, query, "-verificationToken");
  }
  @Get(":id") async detail(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
  ) {
    await access(req, orgId);
    recordId(id);
    const site = await Website.findOne({ _id: id, orgId }).lean();
    if (!site) fail(404, "NOT_FOUND", "Website unavailable.");
    return publicRecord(site);
  }
  @Post() async create(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Body() body: unknown,
  ) {
    await access(req, orgId, managers);
    const dto = parse(websiteDto, body);
    return transaction(async (session) => {
      const [site] = await Website.create(
        [{ ...dto, orgId, verificationToken: randomToken() }],
        { session },
      );
      await log(
        session,
        req,
        orgId,
        "website.created",
        "website",
        site._id,
        null,
        site,
      );
      return publicRecord(site);
    });
  }
  @Patch(":id") async update(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    await access(req, orgId, managers);
    recordId(id);
    const { version, ...changes } = parse(websitePatchDto, body);
    return transaction(async (session) => {
      const before = await Website.findOne({ _id: id, orgId }).session(session);
      if (!before) fail(404, "NOT_FOUND", "Website unavailable.");
      const update: any = { ...changes };
      if (changes.domain && changes.domain !== before.domain) {
        update.verificationStatus = "unverified";
        update.verificationToken = randomToken();
        update.verifiedAt = null;
      }
      const site = await Website.findOneAndUpdate(
        { _id: id, orgId, version },
        { $set: update, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!site)
        fail(409, "VERSION_CONFLICT", "Website changed. Reload before saving.");
      await log(
        session,
        req,
        orgId,
        "website.updated",
        "website",
        id,
        before,
        site,
      );
      return publicRecord(site);
    });
  }
  @Get(":id/verification") async instructions(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
  ) {
    await access(req, orgId, managers);
    recordId(id);
    const site = await Website.findOne({
      _id: id,
      orgId,
      status: "active",
    }).lean();
    if (!site) fail(404, "NOT_FOUND", "Website unavailable.");
    return {
      type: "TXT",
      host: `_growth-os.${site.domain}`,
      value: `growth-os-verification=${site.verificationToken}`,
      status: site.verificationStatus,
    };
  }
  @Post(":id/verify") async verify(
    @Req() req: any,
    @Param("orgId") orgId: string,
    @Param("id") id: string,
  ) {
    await access(req, orgId, managers);
    recordId(id);
    const snapshot = await Website.findOne({
      _id: id,
      orgId,
      status: "active",
    }).lean();
    if (!snapshot) fail(404, "NOT_FOUND", "Website unavailable.");
    let values: string[][];
    try {
      values = await dnsResolver.resolveTxt(`_growth-os.${snapshot.domain}`);
    } catch {
      fail(
        409,
        "DNS_NOT_READY",
        "TXT record not found yet. Check your DNS settings and retry.",
      );
    }
    if (
      !values.some(
        (v) =>
          v.join("") === `growth-os-verification=${snapshot.verificationToken}`,
      )
    )
      fail(
        409,
        "DNS_NOT_READY",
        "TXT record does not match. Check its value and retry.",
      );
    return transaction(async (session) => {
      const site = await Website.findOneAndUpdate(
        {
          _id: id,
          orgId,
          status: "active",
          version: snapshot.version,
          verificationToken: snapshot.verificationToken,
        },
        {
          $set: { verificationStatus: "verified", verifiedAt: new Date() },
          $inc: { version: 1 },
        },
        { new: true, session },
      );
      if (!site)
        fail(
          409,
          "VERSION_CONFLICT",
          "Website changed during verification. Retry.",
        );
      await log(
        session,
        req,
        orgId,
        "website.verified",
        "website",
        id,
        snapshot,
        site,
      );
      return publicRecord(site);
    });
  }
}
