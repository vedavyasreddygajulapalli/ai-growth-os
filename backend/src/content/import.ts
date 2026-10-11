import {load} from 'cheerio';
import {editDto} from './contracts';
import {fail} from '../contracts';
export function importWordPress(remote:any,type:'post'|'page'){
 const $=load(String(remote.content?.raw||''));$('script,style,iframe,object,embed,form,svg').remove();
 const blocks:any[]=[];
 $('h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol').each((_i,el)=>{const node=$(el);if(node.parents('blockquote,ul,ol').length)return;const tag=el.tagName;const text=['ul','ol'].includes(tag)?node.find('li').map((_i,x)=>$(x).text().trim()).get().join('\n'):node.text().trim();if(!text)return;blocks.push(/^h[1-6]$/.test(tag)?{type:'heading',level:Math.max(2,Number(tag[1])),text}: {type:tag==='blockquote'?'quote':['ul','ol'].includes(tag)?'list':'paragraph',text});});
 if(!blocks.length&&$('body').text().trim())blocks.push({type:'paragraph',text:$('body').text().trim()});
 const title=load(String(remote.title?.raw||remote.title?.rendered||''))('body').text();
 const description=load(String(remote.excerpt?.raw||''))('body').text();
 const parsed=editDto.safeParse({title,slug:remote.slug,type,blocks,description,categories:type==='post'?remote.categories||[]:[],tags:type==='post'?remote.tags||[]:[]});
 if(!parsed.success)fail(422,'CMS_IMPORT_REQUIRES_EDIT','Remote content exceeds supported safe-block limits. Import a smaller edited copy.');return parsed.data;
}
