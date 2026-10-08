import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

function module(path,globals={}) {
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../src/lib/'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Headers,FormData,Error,Intl,Date,CustomEvent,...globals});
 return exports;
}

test('upload activity survives late subscribers and independent cleanup',()=>{
 const events=[];
 const state=module('upload-activity.ts',{window:{dispatchEvent:event=>events.push(event.detail)}});
 const first={},second={};
 state.setUploadActivity(first,true);
 assert.equal(state.uploadIsActive(),true);
 state.setUploadActivity(second,true);
 state.setUploadActivity(first,false);
 assert.equal(state.uploadIsActive(),true);
 state.setUploadActivity(second,false);
 assert.equal(state.uploadIsActive(),false);
 assert.deepEqual(events,[true,true,true,false]);
});

test('query AbortSignal reaches fetch and abort is propagated',async()=>{
 const controller=new AbortController();
 let received;
 const {api}=module('api.ts',{fetch:async(path,options)=>{received=options.signal;options.signal.throwIfAborted();return new Response(JSON.stringify({ok:true}));}});
 assert.equal((await api('/synthetic',{signal:controller.signal})).ok,true);
 assert.equal(received,controller.signal);
 controller.abort();
 await assert.rejects(api('/synthetic',{signal:controller.signal}),{name:'AbortError'});
});

test('API failure retains safe technical error and request ID',async()=>{
 const {api}=module('api.ts',{fetch:async()=>new Response(JSON.stringify({error:{code:'not_found',message:'Нет данных',request_id:'synthetic'}}),{status:404})});
 await assert.rejects(api('/synthetic'),error=>error.code==='not_found'&&error.status===404&&error.requestId==='synthetic');
});

function worker(){
 const handlers={},cached=[];
 let skipped=0;
 vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,self:{location:{origin:'https://synthetic.test'},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:()=>skipped++},caches:{open:async()=>({addAll:async paths=>cached.push(...paths)}),keys:async()=>[],delete:async()=>true,match:async()=>({offline:true})},fetch:async()=>{throw new Error('synthetic offline');}});
 return {handlers,cached,skipped:()=>skipped};
}

test('PWA installation caches public assets and waits for explicit update approval',async()=>{
 const {handlers,cached,skipped}=worker();
 let installed;
 handlers.install({waitUntil:promise=>installed=promise});
 await installed;
 assert.deepEqual(cached,['/offline.html','/icon.svg']);
 assert.equal(skipped(),0);
 handlers.message({data:{type:'UNRELATED'}});
 assert.equal(skipped(),0);
 handlers.message({data:{type:'SKIP_WAITING'}});
 assert.equal(skipped(),1);
});

test('PWA excludes private API, external origins and mutations; navigation uses public offline fallback',async()=>{
 const {handlers}=worker();
 for(const request of [{url:'https://synthetic.test/api/v1/me',method:'GET',mode:'navigate'},{url:'https://foreign.test/icon.svg',method:'GET',mode:'navigate'},{url:'https://synthetic.test/app',method:'POST',mode:'navigate'}]){
  let intercepted=false;
  handlers.fetch({request,respondWith:()=>intercepted=true});
  assert.equal(intercepted,false);
 }
 let response;
 handlers.fetch({request:{url:'https://synthetic.test/app',method:'GET',mode:'navigate'},respondWith:value=>response=value});
 assert.equal((await response).offline,true);
});


test('auth schemas enforce email, password bounds and registration consent',()=>{
 const {authSchema}=module('form-schemas.ts',{require:createRequire(import.meta.url)});
 const value={email:'owner@example.org',password:'a-secure-password',remember:false,terms:true};
 assert.equal(authSchema('register').safeParse(value).success,true);
 assert.equal(authSchema('register').safeParse({...value,terms:false}).success,false);
 assert.equal(authSchema('login').safeParse({...value,email:'invalid'}).success,false);
 assert.equal(authSchema('reset-password').safeParse({...value,password:'short'}).success,false);
 assert.equal(authSchema('register').safeParse({...value,password:'x'.repeat(257)}).success,false);
 assert.equal(authSchema('forgot-password').safeParse({...value,password:''}).success,true);
 assert.equal(authSchema('verify-email').safeParse({...value,email:'',password:''}).success,true);
 assert.equal(authSchema('verify-email',true).safeParse({...value,email:'owner@example.org',verification_code:'1234'}).success,true);
 assert.equal(authSchema('verify-email',true).safeParse({...value,email:'owner@example.org',verification_code:'bad'}).success,false);
});

test('settings schema validates form fields and preserves notification booleans',()=>{
 const {settingsSchema}=module('form-schemas.ts',{require:createRequire(import.meta.url)});
 const result=settingsSchema.safeParse({email:'owner@example.org',interval:'24',label:'Мой круг',email_sync_failures:true});
 assert.equal(result.success,true);
 assert.equal(result.data.interval,24);
 assert.equal(result.data.email_sync_failures,true);
 assert.equal(settingsSchema.safeParse({interval:'1.5'}).success,false);
 assert.equal(settingsSchema.safeParse({interval:'0'}).success,false);
 assert.equal(settingsSchema.safeParse({label:'x'.repeat(81)}).success,false);
 assert.equal(settingsSchema.safeParse({password:'short'}).success,false);
 assert.equal(settingsSchema.safeParse({theme:'unknown'}).success,false);
});
