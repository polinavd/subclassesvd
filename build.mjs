import { compilePack } from '@foundryvtt/foundryvtt-cli';
import fs from 'node:fs/promises';
const manifest=JSON.parse(await fs.readFile(new URL('./module.json',import.meta.url),'utf8'));
for(const p of manifest.packs){
 const dest=new URL('./'+p.path,import.meta.url);
 await fs.rm(dest,{recursive:true,force:true});
 await compilePack(new URL('./source/'+p.name,import.meta.url).pathname,dest.pathname,{recursive:true,log:true});
}
