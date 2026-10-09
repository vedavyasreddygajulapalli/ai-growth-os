import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
const out=new URL('../public/',import.meta.url);mkdirSync(out,{recursive:true});
for(const file of ['app.js','style.css','foundation.js'])copyFileSync(new URL('../../dist/'+file,import.meta.url),new URL(file,out));
writeFileSync(new URL('runtime-config.js',out),'window.GROWTH_CONFIG = { apiEnabled: true };\n');
