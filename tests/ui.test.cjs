// Dependency-free UI function and navigation-guard checks; not a browser layout test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '../extension');
const options = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
function section(start, end) {return options.slice(options.indexOf(start), options.indexOf(end));}
const list = {children: []};
const sandbox = {URL, list};
vm.createContext(sandbox);
vm.runInContext(section('function clearError(', 'function addRow(') + section('function normalizeDomain(', 'function setBusy('), sandbox);
for (const [input, result] of [[' YouTube.COM ', 'youtube.com'], ['https://www.youtube.com/watch?v=123', 'www.youtube.com'], ['example.com.', 'example.com'], ['例え.jp', 'xn--r8jz45g.jp']]) assert.equal(sandbox.normalizeDomain(input), result);
for (const input of ['', '*.example.com', 'localhost', '192.168.0.1', '2130706433', 'http://u:p@example.com/', 'https://example.com:8443/', 'example.com/path', '-example.com', 'example..com', 'example.com?q=1', 'ftp://example.com/', '<script>.com']) assert.throws(() => sandbox.normalizeDomain(input), input);
function row(domain, limit = '30', mode = 'video', enabled = true) {
 const controls = {};
 for (const [name, value] of Object.entries({'domain-input':domain,'limit-input':limit,'mode-input':mode})) controls[`.${name}`] = {value, attrs:{}, setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){this.focused=true;}};
 controls['.enabled-input'] = {checked:enabled};
 controls['.rule-error'] = {hidden:true,textContent:''};
 return {controls,querySelector(selector){return controls[selector];},querySelectorAll(){return Object.values(controls).filter(x=>x.attrs?.['aria-invalid']);}};
}
list.children = [row('youtube.com'), row('tiktok.com', '0', 'foreground', false)];
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.collectRules())), [{domain:'youtube.com',limitMinutes:30,mode:'video',enabled:true},{domain:'tiktok.com',limitMinutes:0,mode:'foreground',enabled:false}]);
for (const names of [['youtube.com','youtube.com'],['youtube.com','www.youtube.com'],['www.youtube.com','youtube.com']]) {
 list.children = names.map(name=>row(name));
 assert.equal(sandbox.collectRules(), null);
 assert.match(list.children[1].controls['.rule-error'].textContent, /重複/);
 assert.equal(list.children[1].controls['.domain-input'].focused, true);
}
for (const limit of ['', '-1', '1.5', '1441', '1e3']) {list.children=[row('example.com',limit)]; assert.equal(sandbox.collectRules(),null,limit);}
for (const limit of ['0','1440']) {list.children=[row('example.com',limit)]; assert.equal(sandbox.collectRules()[0].limitMinutes,Number(limit));}
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
vm.runInContext(popup.slice(popup.indexOf('function duration('), popup.indexOf('function showStatus(')),sandbox);
assert.equal(sandbox.duration(0),'0秒'); assert.equal(sandbox.duration(1),'1秒'); assert.equal(sandbox.duration(61000),'1分 1秒'); assert.equal(sandbox.duration(3600000),'1時間');
for(const page of ['popup','options','blocked']) {
 const html=fs.readFileSync(path.join(root,`${page}.html`),'utf8');
 assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),false,`${page}: no inline scripts`);
 assert.equal(/\son(?:click|load|submit|error)=/i.test(html),false,`${page}: no inline event handlers`);
 assert.equal(/innerHTML\s*=/.test(fs.readFileSync(path.join(root,`${page}.js`),'utf8')),false,`${page}: no innerHTML assignment`);
}
function blockedSandbox(domain) {
 const elements={};
 const fakeElement=()=>({textContent:'',hidden:false,disabled:false,classList:{values:new Set(),toggle(name,on){on?this.values.add(name):this.values.delete(name);},contains(name){return this.values.has(name);}},addEventListener(){}});
 const context={URLSearchParams,location:{search:`?domain=${encodeURIComponent(domain)}`,replace(url){this.destination=url;}},document:{getElementById(id){if (!elements[id]) {elements[id]=fakeElement(); if(id==='check-again') elements[id].disabled=true;} return elements[id];}},window:{addEventListener(){}},setInterval(){},clearInterval(){},chrome:{runtime:{sendMessage:async()=>({ok:true,rules:[{domain:'example.com',enabled:true,blocked:true,limitMinutes:30}]})}}};
 vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root,'blocked.js'),'utf8'),context);
 return context;
}
for (const bad of ['','example.com/path','<script>.com','localhost','192.168.0.1','user@example.com']) {const c=blockedSandbox(bad);assert.equal(c.document.getElementById('check-again').disabled,true);assert.equal(c.location.destination,undefined);assert.match(c.document.getElementById('blocked-title').textContent,/確認できません/);}
const c=blockedSandbox('www.example.com');
c.render({rules:[{domain:'example.com',enabled:true,blocked:true,limitMinutes:30}]},true);assert.equal(c.location.destination,undefined);
c.render({rules:[{domain:'example.com',enabled:false,blocked:true,limitMinutes:30}]},true);assert.equal(c.location.destination,'https://www.example.com/');
const d=blockedSandbox('other.example.org');d.render({rules:[]},true);assert.equal(d.location.destination,'https://other.example.org/');
console.log('PASS: domain normalization/rejection, IDN, overlapping rules, integer/zero/max caps, first-invalid focus, duration formatting, static CSP/XSS checks, blocked-page matching and navigation guards');
