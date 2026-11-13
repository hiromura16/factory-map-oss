#!/usr/bin/env node
// Offline only. Reads an exported JSON file, never connects to either database.
import fs from 'node:fs';
import { importPreview } from '../cloudflare/core.mjs';
const [path,plan='free']=process.argv.slice(2);
if(!path){console.error('Usage: node scripts/preview-d1-import.mjs export.json [free|pro|enterprise]');process.exit(2);}
try {
 const payload=JSON.parse(fs.readFileSync(path,'utf8'));
 const result=importPreview(payload,{},plan);
 const {state,...report}=result;
 console.log(JSON.stringify(report,null,2));
 if(!report.canApply) process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
