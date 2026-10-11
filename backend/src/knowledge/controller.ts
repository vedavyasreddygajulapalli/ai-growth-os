import { decodeAsset, storeAsset, mediaBucket } from "./media";
import { coverageCandidates } from "./analysis";
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, VerifiedGuard, access } from "../security";
import { Website, Membership, transaction, log } from "../database";
import { fail, parse, recordId, id } from "../contracts";
import { WebsiteUrl } from "../crawler/models";
import { catalog, dataSchema, statuses } from "./catalog";
import { KnowledgeRecord } from "./models";
const writers=["Owner","Admin","Marketing Manager","SEO Manager","Content Writer"];
const approvers=["Owner","Admin","Marketing Manager"];
const dto=z.object({title:z.string().trim().min(2).max(200),status:z.enum(statuses).default("draft"),data:z.record(z.string(),z.unknown()).default({}),references:z.array(id).max(50).default([])}).strict();
const queryDto=z.object({kind:z.enum(Object.keys(catalog) as [string,...string[]]),search:z.string().trim().max(160).optional(),status:z.enum(statuses).optional(),cursor:id.optional(),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
const literal=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
@Controller("organizations/:orgId/websites/:websiteId/knowledge")
@UseGuards(AuthGuard,VerifiedGuard)
export class KnowledgeController {
  async scope(req:any,orgId:string,websiteId:string,allowed?:string[],session?:any) {
    const member=await access(req,orgId,allowed,session);recordId(websiteId);
    const site=await Website.findOne({_id:websiteId,orgId,status:"active"}).session(session||null);
    if(!site)fail(404,"NOT_FOUND","Website unavailable.");
    if(session)await Website.updateOne({_id:websiteId,orgId,status:"active"},{$inc:{crawlRevision:1}},{session});
    return member;
  }
  @Post("upload") async upload(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Body() body:any){
    await this.scope(req,org,site,writers);
    const d=parse(z.object({name:z.string().trim().min(1).max(200),type:z.enum(["image/png","image/jpeg","image/webp","application/pdf"]),base64:z.string().max(2800000)}).strict(),body);
    const bytes=decodeAsset(d.base64,d.type),fileId=await storeAsset(bytes,d.name,org,site);
    try{return await transaction(async session=>{
      await this.scope(req,org,site,writers,session);
      if(await KnowledgeRecord.countDocuments({orgId:org,websiteId:site,fileId:{$exists:true}}).session(session)>=100)fail(422,"MEDIA_LIMIT","Development storage supports 100 files per website. Use linked assets for additional media.");
      const [r]=await KnowledgeRecord.create([{orgId:org,websiteId:site,kind:"media",title:d.name,source:"upload",fileId,fileName:d.name,fileType:d.type,fileBytes:bytes.length,data:{mediaType:d.type},updatedBy:req.user._id}],{session});
      await log(session,req,org,"media.uploaded","media",r._id,null,r);return r;
    });}catch(e){await mediaBucket().delete(fileId);throw e;}
  }
  @Get(":id/download") async download(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Param("id") key:string,@Res() res:any){
    await this.scope(req,org,site);recordId(key);const record=await KnowledgeRecord.findOne({_id:key,orgId:org,websiteId:site,kind:"media",status:{$ne:"archived"}}).lean();
    if(!record?.fileId)fail(404,"NOT_FOUND","File unavailable.");
    const bucket=mediaBucket();if(!await bucket.find({_id:record.fileId,"metadata.orgId":org,"metadata.websiteId":site}).hasNext())fail(404,"NOT_FOUND","File unavailable.");
    res.setHeader("Content-Type","application/octet-stream");res.setHeader("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(record.fileName||"asset"));res.setHeader("X-Content-Type-Options","nosniff");
    const stream=bucket.openDownloadStream(record.fileId);stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
  }
  @Get("catalog") async definitions(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string){await this.scope(req,org,site);return {catalog,statuses};}
  @Get("memory") async memory(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string){
    await this.scope(req,org,site);
    const now=new Date().toISOString().slice(0,10);
    const rows=await KnowledgeRecord.find({orgId:org,websiteId:site,kind:{$in:Object.keys(catalog).filter(k=>catalog[k].module==="brand")},status:"approved",$or:[{"data.reviewDate":{$exists:false}},{"data.reviewDate":{$gte:now}}]}).sort({_id:1}).limit(501).lean();
    return {items:rows.slice(0,500),truncated:rows.length>500,asOf:new Date().toISOString(),policy:"Approved, unexpired brand records only; source IDs and versions retained."};
  }
  @Get("context") async context(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string){
    await this.scope(req,org,site);
    const [memory,competitors,pages]=await Promise.all([this.memory(req,org,site),KnowledgeRecord.find({orgId:org,websiteId:site,kind:"competitors",status:{$ne:"archived"}}).limit(100).lean(),WebsiteUrl.find({orgId:org,websiteId:site}).select("url data.title data.description issues updatedAt").limit(100).lean()]);
    return {memory,competitors,pages,coverage:"Up to 100 competitors and crawled pages. Review evidence before recording a gap; no external keyword metrics are inferred."};
  }
  @Get("gaps") async gaps(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string){
    await this.scope(req,org,site);
    const [records,pages]=await Promise.all([KnowledgeRecord.find({orgId:org,websiteId:site,kind:{$in:["keywords","topics"]},status:{$ne:"archived"}}).limit(101).lean(),WebsiteUrl.find({orgId:org,websiteId:site,status:"crawled"}).select("url data.title data.description").limit(501).lean()]);
    return {items:pages.length?coverageCandidates(records.slice(0,100),pages.slice(0,500)):[],sampledPages:Math.min(500,pages.length),truncated:records.length>100||pages.length>500,method:"Exact phrase coverage candidates from saved topics/keywords and crawl metadata. Validate against Brand Memory and competitor context. Not a complete semantic or competitor audit."};
  }
  @Get("calendar") async calendar(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Query() query:any){
    await this.scope(req,org,site);const q=parse(z.object({from:z.iso.date(),to:z.iso.date()}).strict().refine(v=>v.from<=v.to),query);
    const rows=await KnowledgeRecord.find({orgId:org,websiteId:site,kind:"tasks",status:{$ne:"archived"},"data.dueDate":{$gte:q.from,$lte:q.to}}).sort({"data.dueDate":1,_id:1}).limit(501).lean();return {items:rows.slice(0,500),truncated:rows.length>500};
  }
  @Get() async list(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Query() query:any){
    await this.scope(req,org,site);const q=parse(queryDto,query);
    const rows=await KnowledgeRecord.find({orgId:org,websiteId:site,kind:q.kind,...(q.status?{status:q.status}:{}),...(q.search?{title:{$regex:literal(q.search),$options:"i"}}:{}),...(q.cursor?{_id:{$lt:q.cursor}}:{})}).sort({_id:-1}).limit(q.limit+1).lean();
    return {items:rows.slice(0,q.limit),nextCursor:rows.length>q.limit?String(rows[q.limit-1]._id):null};
  }
  @Get(":id") async detail(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Param("id") key:string){await this.scope(req,org,site);recordId(key);const r=await KnowledgeRecord.findOne({_id:key,orgId:org,websiteId:site}).lean();if(!r)fail(404,"NOT_FOUND","Record unavailable.");return r;}
  @Post("records/:kind") async create(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Param("kind") kind:string,@Body() body:any){
    await this.scope(req,org,site,writers);if(!catalog[kind])fail(404,"NOT_FOUND","Record type unavailable.");
    const d=parse(dto,body);d.data=parse(dataSchema(kind),d.data);
    return transaction(async session=>{const m=await this.scope(req,org,site,writers,session);await this.validateReferences(org,site,d,m.role!,session);
      const [r]=await KnowledgeRecord.create([{...d,orgId:org,websiteId:site,kind,updatedBy:req.user._id,...(catalog[kind].singleton?{singletonKey:kind}:{})}],{session});
      await log(session,req,org,"knowledge.created",kind,r._id,null,r);return r;
    });
  }
  @Patch(":id") async update(@Req() req:any,@Param("orgId") org:string,@Param("websiteId") site:string,@Param("id") key:string,@Body() body:any){
    await this.scope(req,org,site,writers);recordId(key);const {version,...d}=parse(dto.extend({version:z.number().int().nonnegative()}).strict(),body);
    return transaction(async session=>{const m=await this.scope(req,org,site,writers,session);const before=await KnowledgeRecord.findOne({_id:key,orgId:org,websiteId:site}).session(session);
      if(!before)fail(404,"NOT_FOUND","Record unavailable.");d.data=parse(dataSchema(before.kind!),d.data);await this.validateReferences(org,site,d,m.role!,session);
      if(before.status==="approved"&&!approvers.includes(m.role!)&&d.status!=="draft"&&d.status!=="in_review")fail(403,"FORBIDDEN","Edits to approved knowledge must return to review.");
      const r=await KnowledgeRecord.findOneAndUpdate({_id:key,orgId:org,websiteId:site,version},{$set:{...d,updatedBy:req.user._id},$inc:{version:1}},{new:true,session});
      if(!r)fail(409,"VERSION_CONFLICT","Record changed. Reload before saving.");await log(session,req,org,"knowledge.updated",before.kind!,key,before,r);return r;
    });
  }
  async validateReferences(org:string,site:string,d:any,role:string,session:any){
    if(d.status==="approved"&&!approvers.includes(role))fail(403,"FORBIDDEN","Only an owner, admin or marketing manager can approve.");
    const refs=[...new Set(d.references)];if(await KnowledgeRecord.countDocuments({_id:{$in:refs},orgId:org,websiteId:site,status:{$ne:"archived"}}).session(session)!==refs.length)fail(422,"INVALID_REFERENCE","Use active records from this website.");
    if(d.data.owner){recordId(d.data.owner);if(!await Membership.exists({orgId:org,userId:d.data.owner,status:"active"}).session(session))fail(422,"INVALID_OWNER","Owner must belong to this workspace.");}
  }
}
