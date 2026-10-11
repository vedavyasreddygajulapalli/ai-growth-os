import {access} from '../security';
import {Website,Membership,log} from '../database';
import {recordId,fail} from '../contracts';
import {KnowledgeRecord} from '../knowledge/models';
import {ContentVersion} from './models';
export const writers=['Owner','Admin','Marketing Manager','SEO Manager','Content Writer'];
export const publishers=['Owner','Admin','Marketing Manager'];
export async function scope(req:any,orgId:string,websiteId:string,roles?:string[],session?:any){await access(req,orgId,roles,session);recordId(websiteId);const s=await Website.findOne({_id:websiteId,orgId,status:'active'}).session(session||null);if(!s)fail(404,'NOT_FOUND','Website unavailable.');if(session)await Website.updateOne({_id:websiteId,orgId,status:'active'},{$inc:{crawlRevision:1}},{session});return s;}
export async function references(orgId:string,websiteId:string,data:any,session:any){if(data.ownerId&&!await Membership.exists({orgId,userId:data.ownerId,status:'active'}).session(session))fail(422,'INVALID_OWNER','Choose an active teammate.');for(const [ids,filter] of [[data.evidenceIds,{}],[data.mediaIds,{kind:'media'}]] as any){const unique=[...new Set(ids)];if(await KnowledgeRecord.countDocuments({_id:{$in:unique},orgId,websiteId,status:{$ne:'archived'},...filter}).session(session)!==unique.length)fail(422,'INVALID_REFERENCE','Choose records from this website.');}}
export async function snapshot(session:any,req:any,item:any,reason:string,before:any){await ContentVersion.create([{orgId:item.orgId,websiteId:item.websiteId,contentId:item._id,revision:item.revision,snapshot:item.toObject(),actorId:req.user._id,reason}],{session});await log(session,req,String(item.orgId),'content.'+reason,'content',item._id,before,item);}
