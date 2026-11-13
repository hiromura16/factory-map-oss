import {cp,copyFile,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {build}=require('esbuild');
await mkdir(path.join(root,'cloudflare/dist'),{recursive:true});
await build({entryPoints:[path.join(root,'cloudflare/worker.mjs')],outfile:path.join(root,'cloudflare/dist/worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
const destination=path.join(root,'public');await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
const files=(await readdir(root)).filter(f=>/\.(js|css|html|json)$/.test(f)&&!f.startsWith('saas-config'));
for(const f of files)await copyFile(path.join(root,f),path.join(destination,f));
for(const dir of ['assets','samples','vendor'])await cp(path.join(root,dir),path.join(destination,dir),{recursive:true});
const manifest={},assets=[];
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream','.txt':'text/plain'};
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,entry.name);if(entry.isDirectory())await walk(f);else{const bytes=await readFile(f),url='/'+path.relative(destination,f).split(path.sep).join('/'),hash=createHash('sha256').update(bytes).digest('hex').slice(0,32);manifest[url]={hash,size:bytes.length};assets.push({path:url,hash,size:bytes.length,mime:mime[path.extname(f)]||'application/octet-stream',file:f});}}}
await walk(destination);await mkdir(path.join(root,'.deploy'),{recursive:true});await writeFile(path.join(root,'.deploy/manifest.json'),JSON.stringify(manifest));await writeFile(path.join(root,'.deploy/assets.json'),JSON.stringify(assets));
console.log(JSON.stringify({assets:assets.length,bytes:assets.reduce((n,a)=>n+a.size,0),worker:(await readFile(path.join(root,'cloudflare/dist/worker.mjs'))).length}));
