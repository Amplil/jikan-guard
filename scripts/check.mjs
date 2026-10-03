import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=new URL('../extension/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir),'utf8'));
if(manifest.manifest_version!==3) throw Error('Manifest must be V3');
const referenced = [
 manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page,
 ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
 ...manifest.content_scripts.flatMap(x=>[...(x.js || []),...(x.css || [])]),
 ...manifest.web_accessible_resources.flatMap(x=>x.resources)
];
for (const file of referenced) {
 if(typeof file!=='string' || !file || file.startsWith('/') || file.includes('..') || !fs.existsSync(new URL(file,dir))) throw Error(`Missing or unsafe manifest resource: ${file}`);
}
if (!manifest.web_accessible_resources.some(r=>r.resources.includes('blocked.html'))) throw Error('DNR redirect target must be web accessible');
if(manifest.background.type!=='module') throw Error('Worker imports require module type');

for(const file of fs.readdirSync(dir)) {
 if(file.endsWith('.js')) {
  execFileSync(process.execPath,['--check',fileURLToPath(new URL(file,dir))]);
  const source=fs.readFileSync(new URL(file,dir),'utf8');
  for(const [,relative] of source.matchAll(/\bimport\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) if(!fs.existsSync(new URL(relative,new URL(file,dir)))) throw Error(`Missing import ${relative} in ${file}`);
 }
 if(file.endsWith('.html')) {
  const text=fs.readFileSync(new URL(file,dir),'utf8');
  if(/<script(?![^>]*\bsrc=)[^>]*>/i.test(text) || /\son[a-z]+\s*=/i.test(text)) throw Error(`Inline script in ${file}`);
  for(const [,path] of text.matchAll(/(?:src|href)="([^"#:]+)"/g))if(!fs.existsSync(new URL(path,dir)))throw Error(`Missing ${path}`);
 }
}
for(const script of manifest.content_scripts.flatMap(x=>x.js))if(!fs.existsSync(new URL(script,dir)))throw Error(`Missing ${script}`);
console.log('PASS: manifest, packaged references, no inline scripts, all JavaScript syntax');
