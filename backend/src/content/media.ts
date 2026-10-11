import {createHash} from 'node:crypto';
import {KnowledgeRecord} from '../knowledge/models';
import {mediaBucket,decodeAsset} from '../knowledge/media';
import {CmsMedia} from './models';
import {wordpress} from './wordpress';
// MongoDB mapping is written before any external mutation. An interrupted upload
// can only be adopted by its deterministic slug; it is never blindly repeated.
export async function ensureFeaturedMedia(connection:any,assetId:string){
 const orgId=String(connection.orgId),websiteId=String(connection.websiteId);
 if(!connection.capabilities?.media)throw Error('CMS_MEDIA_PERMISSION_REQUIRED');
 const asset=await KnowledgeRecord.findOne({_id:assetId,orgId,websiteId,kind:'media',status:{$ne:'archived'}}).lean();
 if(!asset?.fileId||!['image/png','image/jpeg','image/webp'].includes(asset.fileType||''))throw Error('CMS_MEDIA_UNAVAILABLE');
 const bucket=mediaBucket();if(!await bucket.find({_id:asset.fileId,'metadata.orgId':orgId,'metadata.websiteId':websiteId}).hasNext())throw Error('CMS_MEDIA_UNAVAILABLE');
 const chunks:Buffer[]=[];let size=0;const stream=bucket.openDownloadStream(asset.fileId);
 for await(const chunk of stream){size+=chunk.length;if(size>2*1024*1024){stream.destroy();throw Error('CMS_MEDIA_TOO_LARGE');}chunks.push(chunk);}
 const bytes=decodeAsset(Buffer.concat(chunks).toString('base64'),asset.fileType!);
 const checksum=createHash('sha256').update(bytes).digest('hex'),slug='growth-'+websiteId+'-'+checksum;
 const filter={orgId,websiteId,origin:connection.origin,checksum};let mapping=await CmsMedia.findOne(filter);
 if(mapping?.status==='ready')return mapping.remoteId as number;
 const found=await wordpress(connection,'media?context=edit&slug='+slug);
 const matches=found.filter((r:any)=>r.slug===slug&&r.mime_type===asset.fileType&&Number.isInteger(r.id)&&r.id>0);
 if(matches.length===1){mapping=await CmsMedia.findOneAndUpdate(filter,{$set:{status:'ready',remoteId:matches[0].id,assetId,slug},$unset:{error:1}},{upsert:true,new:true});return mapping.remoteId as number;}
 if(mapping||found.length)throw Error('CMS_MEDIA_RECONCILIATION_REQUIRED');
 try{mapping=await CmsMedia.create({...filter,assetId,slug,status:'uploading'});}catch{throw Error('CMS_MEDIA_RECONCILIATION_REQUIRED');}
 try{const ext=asset.fileType==='image/png'?'png':asset.fileType==='image/webp'?'webp':'jpg';
  const remote=await wordpress(connection,'media','POST',{bytes,filename:slug+'.'+ext,contentType:asset.fileType});
  if(!Number.isInteger(remote.id)||remote.id<=0||remote.slug!==slug||remote.mime_type!==asset.fileType)throw Error('CMS_MEDIA_OUTCOME_UNKNOWN');
  await CmsMedia.updateOne({_id:mapping._id},{$set:{status:'ready',remoteId:remote.id}});return remote.id as number;
 }catch{await CmsMedia.updateOne({_id:mapping._id},{$set:{status:'needs_review',error:'CMS_MEDIA_OUTCOME_UNKNOWN'}});throw Error('CMS_MEDIA_OUTCOME_UNKNOWN');}
}
