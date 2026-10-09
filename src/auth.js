import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

const digest = s => createHash('sha256').update(s).digest('hex');
const hash = password => { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
const verify = (password, encoded) => { const [salt,key]=encoded.split(':'); return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64)); };
export function createAuth({root,onSettings=()=>{}}) {
  const dir=process.env.AUTH_DATA_DIR || path.join(root,'data','auth');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'store.json');
  let db;
  try { db=JSON.parse(readFileSync(file,'utf8')); } catch(e) { if(e.code!=='ENOENT')throw e; db={users:[],sessions:[],settings:{}}; }
  const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(db,null,2),{mode:0o600});renameSync(file+'.tmp',file);};
  if(!db.users.length){
    for(const [name,email,role,access] of [['Superadmin','admin@thterminal.test','superadmin','full'],['Full access','full@thterminal.test','user','full'],['Stocks only','stocks@thterminal.test','user','stocks'],['Crypto only','crypto@thterminal.test','user','crypto']]) db.users.push({id:randomBytes(12).toString('hex'),name,email,role,access,password:hash(process.env.TEST_ACCOUNT_PASSWORD || 'ThTerminal@123'),enabled:true,expiresAt:null,createdAt:new Date().toISOString()});
    save();
  }
  const publicUser=u=>{const {password,...rest}=u;return {...rest,expired:!!u.expiresAt&&Date.parse(u.expiresAt)<=Date.now(),markets:u.role==='superadmin'||u.access==='full'?['stocks','crypto']:[u.access]};};
  const active=u=>u&&u.enabled&&(u.role==='superadmin'||!u.expiresAt||Date.parse(u.expiresAt)>Date.now());
  const token=req=>{const c=req.headers.cookie||'';return c.split(';').map(x=>x.trim()).find(x=>x.startsWith('th_session='))?.slice(11);};
  const userFor=req=>{const t=token(req);if(!t)return null;const s=db.sessions.find(s=>s.hash===digest(t)&&s.expiresAt>Date.now());return s&&db.users.find(u=>u.id===s.userId);};
  const allowed=(u,mk)=>active(u)&&(u.role==='superadmin'||u.access==='full'||u.access===mk);
  const requireUser=(req,res,next)=>{req.user=userFor(req);if(!req.user)return res.status(401).json({error:'Please sign in.'});if(!active(req.user))return res.status(403).json({error:'Your access has expired or been disabled.',code:'ACCESS_INACTIVE'});next();};
  const market=mk=>(req,res,next)=>requireUser(req,res,()=>{req.recheckAccess=callback=>market(mk)(req,res,callback);return allowed(req.user,mk)?next():res.status(403).json({error:`Your account does not include ${mk}.`,code:'MARKET_DENIED'});});
  const router=Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method)){const origin=req.headers.origin;if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Invalid request origin.'});if(!req.is('application/json'))return res.status(415).json({error:'JSON required.'});}next();});
  // Temporary testing shortcut. Disable with TEST_LOGIN_BUTTONS=false before launch.
  router.get('/auth/test-accounts',(_req,res)=>{
    if(process.env.TEST_LOGIN_BUTTONS==='false')return res.status(404).json({error:'Test login shortcuts are disabled.'});
    const candidates=[process.env.TEST_ACCOUNT_PASSWORD,'ThTerminal@123'].filter(Boolean);
    const accounts=[['Superadmin','admin@thterminal.test','superadmin','full'],['Full access','full@thterminal.test','user','full'],['Stocks only','stocks@thterminal.test','user','stocks'],['Crypto only','crypto@thterminal.test','user','crypto']].map(([label,email,role,access])=>{
      const u=db.users.find(u=>u.email===email&&u.role===role&&u.access===access);
      const password=u&&active(u)?candidates.find(p=>verify(p,u.password)):undefined;
      return {label,email,available:!!password,...(password?{password}:{})};
    });
    res.json({accounts});
  });
  router.post('/auth/login',(req,res)=>{
    const now=Date.now();
    const {email,password}=req.body||{};const u=db.users.find(u=>u.email===String(email).trim().toLowerCase());
    if(typeof password!=='string'||password.length>256||!u||!verify(password,u.password)){return res.status(401).json({error:'Invalid email or password.'});}
    if(!active(u))return res.status(403).json({error:'Your access has expired or been disabled.'});
    const t=randomBytes(32).toString('hex');db.sessions=db.sessions.filter(s=>s.expiresAt>now);db.sessions.push({hash:digest(t),userId:u.id,expiresAt:now+86400000});save();
    res.cookie('th_session',t,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:86400000,path:'/'}).json({user:publicUser(u)});
  });
  router.post('/auth/logout',(req,res)=>{const t=token(req);db.sessions=db.sessions.filter(s=>s.hash!==digest(t||''));save();res.clearCookie('th_session',{path:'/'}).json({ok:true});});
  router.get('/auth/me',requireUser,(req,res)=>res.json({user:publicUser(req.user)}));
  router.use('/admin',requireUser,(req,res,next)=>req.user.role==='superadmin'?next():res.status(403).json({error:'Superadmin access required.'}));
  router.get('/admin/users',(_req,res)=>res.json(db.users.map(publicUser)));
  function validate(body,current){
    const u={...current};
    for(const k of ['name','email','role','access','enabled','expiresAt'])if(Object.hasOwn(body,k))u[k]=body[k];
    u.email=String(u.email||'').trim().toLowerCase();u.name=String(u.name||'').trim();
    if(!u.name||u.name.length>100||!/^\S+@\S+\.\S+$/.test(u.email)||!['superadmin','user'].includes(u.role)||!['full','stocks','crypto'].includes(u.access)||typeof u.enabled!=='boolean')throw new Error('Provide a name, valid email, role, market access and enabled status.');
    if(u.expiresAt!==null){if(typeof u.expiresAt!=='string'||!Number.isFinite(Date.parse(u.expiresAt)))throw new Error('Invalid expiry date.');u.expiresAt=new Date(u.expiresAt).toISOString();}
    if(db.users.some(x=>x.email===u.email&&x.id!==u.id))throw new Error('Email already exists.');
    if(body.password!==undefined&&body.password!==''){if(typeof body.password!=='string'||body.password.length<10||body.password.length>256)throw new Error('Password must have 10–256 characters.');u.password=hash(body.password);}
    if(!u.password)throw new Error('Password is required.');
    return u;
  }
  router.post('/admin/users',(req,res)=>{try{const u=validate(req.body,{id:randomBytes(12).toString('hex'),role:'user',access:'full',enabled:true,expiresAt:null,createdAt:new Date().toISOString()});db.users.push(u);save();res.status(201).json(publicUser(u));}catch(e){res.status(400).json({error:e.message});}});
  router.patch('/admin/users/:id',(req,res)=>{const i=db.users.findIndex(u=>u.id===req.params.id);if(i<0)return res.status(404).json({error:'User not found.'});try{const u=validate(req.body,db.users[i]);if(db.users[i].role==='superadmin'&&(!u.enabled||u.role!=='superadmin')&&!db.users.some(x=>x.id!==u.id&&x.role==='superadmin'&&x.enabled))throw new Error('Keep at least one enabled superadmin.');db.users[i]=u;db.sessions=db.sessions.filter(s=>s.userId!==u.id);save();res.json(publicUser(u));}catch(e){res.status(400).json({error:e.message});}});
  const settingsView=()=>({provider:'nasdaq',quotePollMs:db.settings.quotePollMs||Number(process.env.QUOTE_POLL_MS)||15000,finnhubConfigured:!!(db.settings.finnhubKey??process.env.FINNHUB_API_KEY),coingeckoConfigured:!!(db.settings.coingeckoKey??process.env.COINGECKO_API_KEY)});
  router.get('/admin/settings',(_req,res)=>res.json(settingsView()));
  router.put('/admin/settings',(req,res)=>{const b=req.body||{};if(b.provider!=='nasdaq'||!Number.isInteger(b.quotePollMs)||b.quotePollMs<5000||b.quotePollMs>3600000)return res.status(400).json({error:'Select a supported provider and polling interval from 5–3600 seconds.'});const s={...db.settings,provider:b.provider,quotePollMs:b.quotePollMs};for(const k of ['finnhubKey','coingeckoKey'])if(Object.hasOwn(b,k)){if(typeof b[k]!=='string'||b[k].length>512)return res.status(400).json({error:'Invalid API key.'});s[k]=b[k].trim();}db.settings=s;save();onSettings(s);res.json({...settingsView(),restartRequired:true});});
  return {router,requireUser,market,userFor,allowed,active,settings:db.settings};
}
