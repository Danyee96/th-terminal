import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAuth} from '../src/auth.js';

test('roles, expiry, administration, sessions and persistence',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'th-auth-test-'));process.env.AUTH_DATA_DIR=dir;
 const auth=createAuth({root:dir}),app=express();app.use(express.json());app.use('/api',auth.router);
 app.get('/stocks',auth.market('stocks'),(_q,r)=>r.json({ok:true}));app.get('/crypto',auth.market('crypto'),(_q,r)=>r.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(url,cookie='',method='GET',body){const r=await fetch(base+url,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=async email=>request('/api/auth/login','','POST',{email,password:'ThTerminal@123'});
 try{
 assert.equal((await request('/stocks')).status,401);
 const admin=await login('admin@thterminal.test');assert.equal(admin.status,200);
 for(const [email,stocks,crypto] of [['full@thterminal.test',200,200],['stocks@thterminal.test',200,403],['crypto@thterminal.test',403,200]]){const s=await login(email);assert.equal((await request('/stocks',s.cookie)).status,stocks);assert.equal((await request('/crypto',s.cookie)).status,crypto);assert.equal((await request('/api/admin/users',s.cookie)).status,403);assert.equal(auth.allowed(auth.userFor({headers:{cookie:s.cookie}}),'stocks'),stocks===200);}
 assert.equal((await request('/api/auth/login','','POST',{email:'full@thterminal.test',password:'incorrect'})).status,401);
 const brief=await request('/api/admin/users',admin.cookie,'POST',{name:'Brief trial',email:'brief@example.test',password:'Password@123',access:'full',expiresAt:new Date(Date.now()+500).toISOString()});
 const briefLogin=await request('/api/auth/login','','POST',{email:'brief@example.test',password:'Password@123'});assert.equal(briefLogin.status,200);
 await new Promise(r=>setTimeout(r,550));assert.equal((await request('/stocks',briefLogin.cookie)).status,403);assert.equal(auth.allowed(auth.userFor({headers:{cookie:briefLogin.cookie}}),'crypto'),false);
 for(let i=0;i<12;i++)assert.equal((await request('/api/auth/login','','POST',{email:'admin@thterminal.test',password:'incorrect'})).status,401);
 assert.equal((await login('admin@thterminal.test')).status,200);
 const body={name:'Trial',email:'trial@example.test',password:'Password@123',access:'stocks',expiresAt:new Date(Date.now()+86400000).toISOString()};
 const created=await request('/api/admin/users',admin.cookie,'POST',body);assert.equal(created.status,201);assert.ok(!('password' in created.data));
 assert.equal((await request('/api/admin/users',admin.cookie,'POST',body)).status,400);
 let session=await request('/api/auth/login','','POST',{email:body.email,password:body.password});assert.equal(session.status,200);
 let update=await request('/api/admin/users/'+created.data.id,admin.cookie,'PATCH',{expiresAt:new Date(Date.now()-1000).toISOString()});assert.equal(update.status,200);
 assert.equal((await request('/stocks',session.cookie)).status,401);
 assert.equal((await request('/api/auth/login','','POST',{email:body.email,password:body.password})).status,403);
 await request('/api/admin/users/'+created.data.id,admin.cookie,'PATCH',{expiresAt:null,access:'crypto'});
 session=await request('/api/auth/login','','POST',{email:body.email,password:body.password});assert.equal((await request('/crypto',session.cookie)).status,200);assert.equal((await request('/stocks',session.cookie)).status,403);
 await request('/api/admin/users/'+created.data.id,admin.cookie,'PATCH',{enabled:false});assert.equal((await request('/crypto',session.cookie)).status,401);
 assert.equal((await request('/api/admin/users/'+admin.data.user.id,admin.cookie,'PATCH',{enabled:false})).status,400);
 assert.equal((await request('/api/admin/settings',admin.cookie,'PUT',{provider:'nasdaq',quotePollMs:15000,finnhubKey:'test-secret'})).status,200);
 const settings=await request('/api/admin/settings',admin.cookie);assert.equal(settings.data.finnhubConfigured,true);assert.ok(!JSON.stringify(settings.data).includes('test-secret'));
 const persisted=createAuth({root:dir});assert.equal(persisted.settings.finnhubKey,'test-secret');assert.ok(persisted.userFor({headers:{cookie:admin.cookie}}));
 assert.equal((await request('/api/admin/users',admin.cookie,'POST',{...body,email:'x@example.test'},)).status,201);
 const cross=await fetch(base+'/api/admin/users',{method:'POST',headers:{cookie:admin.cookie,'Content-Type':'application/json',origin:'https://untrusted.test'},body:JSON.stringify(body)});assert.equal(cross.status,403);
 await request('/api/auth/logout',admin.cookie,'POST',{});assert.equal((await request('/api/admin/users',admin.cookie)).status,401);
 }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});delete process.env.AUTH_DATA_DIR;}
});
