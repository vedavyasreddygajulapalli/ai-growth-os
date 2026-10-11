import {z} from 'zod';
import {id} from '../contracts';
export const issueQuery=z.object({jobId:id,status:z.enum(['open','in_progress','ignored','resolved']).optional(),severity:z.enum(['Critical','High','Medium','Low','Opportunity']).optional(),search:z.string().trim().max(100).optional(),assigneeId:id.optional(),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
const url=z.url().max(2048).refine(v=>{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;},'Use an HTTP(S) URL');
// Deliberately limited initial vocabulary; no arbitrary scripts, contexts or remote fetching.
export const jsonLd=z.object({'@context':z.literal('https://schema.org'),'@type':z.enum(['Organization','WebPage','Article']),name:z.string().trim().min(2).max(200),url,description:z.string().max(2000).optional(),headline:z.string().trim().min(2).max(200).optional()}).strict().refine(v=>v['@type']!=='Article'||!!v.headline,'Article requires a headline');
export const schemaDto=z.object({name:z.string().trim().min(2).max(160),jsonLd,version:z.number().int().nonnegative().optional()}).strict();
