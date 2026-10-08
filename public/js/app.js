
/* =====================================================================
   TH TERMINAL — browser app
   Two markets: stocks (/api/bootstrap) and crypto (/api/crypto/bootstrap); live updates over /ws.
   Indicator maths lives in /shared/indicators.js, the same file the server uses.
   ===================================================================== */
import { computeStock as engineStock, computeCore, toWeekly } from "/shared/indicators.js";

const sessionResponse = await fetch("/api/auth/me");
if (!sessionResponse.ok) { location.replace("/login.html"); throw new Error("Sign in required"); }
const SESSION = (await sessionResponse.json()).user;
/* ---------- utils ---------- */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const store={get(k,d){try{const v=localStorage.getItem("thT:"+SESSION.id+":"+k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem("thT:"+SESSION.id+":"+k,JSON.stringify(v))}catch{}}};
const fmtP=v=>{if(v==null||!isFinite(v))return"—";const a=Math.abs(v);if(a>=1000)return v.toLocaleString(undefined,{maximumFractionDigits:0});if(a>=1)return v.toFixed(2);if(!a)return"0";return v.toFixed(Math.min(10,3-Math.floor(Math.log10(a))))};
const fmtPct=v=>`${v>=0?"+":""}${v.toFixed(2)}%`;
const fmtH=v=>isNaN(v)?"—":`${v>0?"+":v<0?"−":""}${Math.abs(v).toFixed(2)}`;
const fmtCap=b=>b==null||!isFinite(b)||!b?"—":b>=1000?`$${(b/1000).toFixed(2)}T`:b>=1?`$${b.toFixed(b>=100?0:1)}B`:`$${(b*1000).toFixed(0)}M`;
const fmtUsd=v=>v==null||!isFinite(v)?"—":v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:`$${v.toFixed(0)}`;
const fmtFund=f=>f==null||!isFinite(f)?"—":`${f>=0?"+":""}${(f*100).toFixed(4)}%`;
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1000);return s<60?`${s|0}s ago`:s<3600?`${(s/60)|0}m ago`:`${(s/3600)|0}h ago`};
const pc=v=>v>=0?"up":"dn";
const HEX={bg:"#070708",card:"#101015",card2:"#15151c",card3:"#1b1b24",text:"#f5f3ec",muted:"#8b8b95",dim:"#5f5f68",gold:"#f5c542",gold2:"#c99f34",green:"#4bd07f",red:"#e5484d",orange:"#f08a3c",lime:"#a6cf57"};
function rgb(h){const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255]}
const rgba=(h,a)=>{const[r,g,b]=rgb(h);return`rgba(${r},${g},${b},${a})`};
function mix(a,b,t){const A=rgb(a),B=rgb(b);return`rgb(${A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(",")})`}
function hciHue(h){const stops=[[-5,HEX.green],[-2.2,HEX.lime],[0,HEX.gold],[2.2,HEX.orange],[5,HEX.red]];
  for(let i=1;i<stops.length;i++)if(h<=stops[i][0]){const[a,ca]=stops[i-1],[b,cb]=stops[i];return mix(ca,cb,clamp((h-a)/(b-a),0,1))}return HEX.red}

/* ---------- settings & state ---------- */
const CFG0={hi:3,lo:-3,prox:1.5,tol:1.5,sound:false,density:"comfy"};
const CFG={...CFG0,...store.get("cfg",{})};
const mkScr=sel=>({group:"All",sig:new Set(),q:"",hmin:-5,hmax:5,cap:0,sort:"cap",dir:-1,sel,list:[]});
const mkChart=tk=>({tk,tf:"D",type:"candle",ov:{zones:true,golden:true,heat:true,div:true,fib:false,sma20:false,sma50:true},v:null,hover:null});
function migrateLists(ls){ls=ls||[{id:1,name:"Core watchlist",tks:["NVDA","AAPL","MSFT","TSLA","JPM","XOM"]},{id:2,name:"AI leaders",tks:["NVDA","AVGO","AMD","PLTR","META","GOOGL"]}];
  ls.forEach(l=>l.mk||="stocks");
  if(!ls.some(l=>l.mk==="crypto"))ls.push({id:101,name:"Crypto majors",mk:"crypto",tks:["BTC","ETH","SOL","XRP","BNB","DOGE"]},{id:102,name:"AI & DeFi coins",mk:"crypto",tks:["TAO","RENDER","FET","NEAR","AAVE","UNI","ENA"]});
  return ls}
/** Per-market state lives in *By maps; the getters below always point at the market on screen. */
const S={
  view:store.get("view","overview"),mk:"stocks",
  mapBy:{stocks:{mode:store.get("mapMode","hci"),period:"1D",size:"cap",focus:null},crypto:{mode:"hci",period:"1D",size:"cap",focus:null}},
  scrBy:{stocks:mkScr("NVDA"),crypto:mkScr("BTC")},
  chartBy:{stocks:mkChart("NVDA"),crypto:mkChart("BTC")},
  cmpBy:{stocks:new Set(),crypto:new Set()},
  feedBy:{stocks:[],crypto:[]},unreadBy:{stocks:0,crypto:0},
  lists:migrateLists(store.get("lists",null)),
  listIds:store.get("listIds",{stocks:store.get("listId",1),crypto:101}),
  alerts:store.get("alerts",[{id:1,mk:"stocks",tk:"NVDA",type:"hciBelow",v:-3,note:"Example alert",on:true,armed:true,fired:null},{id:2,mk:"stocks",tk:"TSLA",type:"buyerZone",note:"",on:true,armed:true,fired:null},
    {id:3,mk:"crypto",tk:"BTC",type:"hciBelow",v:-3,note:"Example alert",on:true,armed:true,fired:null},{id:4,mk:"crypto",tk:"ETH",type:"fundingBelow",v:-0.01,note:"",on:true,armed:true,fired:null}]),
  hist:store.get("hist",[]),
  dv:{sort:"oi",dir:-1},wh:{kind:"all",min:0,coin:""},
  live:true,drawer:null,
  get map(){return this.mapBy[this.mk]},get scr(){return this.scrBy[this.mk]},get chart(){return this.chartBy[this.mk]},get cmp(){return this.cmpBy[this.mk]},
  get feed(){return this.feedBy[this.mk]},set feed(v){this.feedBy[this.mk]=v},
  get unread(){return this.unreadBy[this.mk]},set unread(v){this.unreadBy[this.mk]=v},
  get listId(){return this.listIds[this.mk]},set listId(v){this.listIds[this.mk]=v},
};
const saveLists=()=>{store.set("lists",S.lists);store.set("listIds",S.listIds)};
const saveAlerts=()=>{store.set("alerts",S.alerts);store.set("hist",S.hist.slice(0,100))};
const activeList=()=>{const ls=S.lists.filter(l=>l.mk===S.mk);return ls.find(l=>l.id===S.listId)||ls[0]};

/* ---------- data from the server ---------- */
const pd=d=>{const[y,m,dd]=d.split("-");return new Date(+y,+m-1,+dd)};
const unpack=a=>a.map(([d,o,h,l,c,v])=>({d,o,h,l,c,v}));
const CONN={state:"connecting",retry:0};
const MARKETS={};
let MK="stocks",ASSETS=[],BY={},SECTORS=[],THEMES=[],STATUS={};
function calc(s){engineStock(s,CFG);s.dates=s.bars.map(b=>pd(b.d));return s}
function weekly(s){if(!s.w){s.w={bars:toWeekly(s.bars)};s.w.dates=s.w.bars.map(b=>pd(b.d));computeCore(s.w,CFG)}return s.w}
async function getJSON(url){const r=await fetch(url);if(r.status===401){location.replace("/login.html");throw new Error("Sign in required")}if(!r.ok)throw Object.assign(new Error(`server replied ${r.status}`),{status:r.status});return r.json()}
async function loadBootstrap(){
  const poll=setInterval(async()=>{try{const[a,b]=await Promise.all([(SESSION.markets.includes("stocks")?getJSON("/api/status"):Promise.resolve({loaded:0,total:0})),(SESSION.markets.includes("crypto")?getJSON("/api/crypto/status").catch(()=>({loaded:0,total:0})):Promise.resolve({loaded:0,total:0}))]);
    const done=a.loaded+b.loaded,all=a.total+b.total;$("bootBar").style.width=`${done/all*100}%`;$("bootMsg").textContent=`Loading price history · ${done} of ${all} stocks and coins`}catch{}},600);
  for(let attempt=0;;attempt++){
    try{const[st,cr]=await Promise.all([(SESSION.markets.includes("stocks")?getJSON("/api/bootstrap"):Promise.resolve(null)),(SESSION.markets.includes("crypto")?getJSON("/api/crypto/bootstrap").catch(e=>e.status===404?null:Promise.reject(e)):Promise.resolve(null))]);clearInterval(poll);return{st,cr}}
    catch(e){$("bootMsg").textContent=`Can't reach the TH Terminal server (${e.message}). Retrying…`;await new Promise(res=>setTimeout(res,Math.min(10000,1500*(attempt+1))))}}
}
const BOOT=await loadBootstrap();
if(!BOOT.st&&!BOOT.cr){$("bootMsg").textContent="Your permitted market is currently unavailable. Contact your administrator.";const back=document.createElement("a");back.href="/login.html";back.className="btn";back.textContent="Back to sign in";$("boot").append(back);throw new Error("No available market");}
if(BOOT.st)MARKETS.stocks={id:"stocks",label:"Stocks",noun:"stocks",groupWord:"Sector",status:BOOT.st.status,lastAt:null,
  sectors:["Semiconductors","Software","Technology","Communication","Consumer","Financials","Healthcare","Energy","Industrials"],themes:["AI","Fintech","Crypto","Defense","Clean energy","EV"],
  items:BOOT.st.stocks.map(x=>calc({...x,mk:"stocks",bars:unpack(x.bars)}))};
if(BOOT.cr)MARKETS.crypto={id:"crypto",label:"Crypto",noun:"coins",groupWord:"Category",status:BOOT.cr.status,lastAt:null,research:BOOT.cr.research,whales:BOOT.cr.whales,liqSince:BOOT.cr.liqSince,
  sectors:["Layer 1","Layer 2","DeFi","AI","Payments","Exchange","Infrastructure","Meme"],themes:["AI","RWA","DePIN","Perps DEX","DEX","Solana memes","Staking"],
  items:BOOT.cr.coins.map(x=>calc({...x,mk:"crypto",bars:unpack(x.bars)}))};
for(const m of Object.values(MARKETS))m.by=Object.fromEntries(m.items.map(s=>[s.tk,s]));
function setMarket(mk){MK=mk;S.mk=mk;const m=MARKETS[mk];ASSETS=m.items;BY=m.by;SECTORS=m.sectors;THEMES=m.themes;STATUS=m.status}
setMarket(MARKETS[store.get("market","stocks")]?store.get("market","stocks"):Object.keys(MARKETS)[0]);
const recomputeAll=()=>Object.values(MARKETS).forEach(m=>m.items.forEach(calc));

/* ---------- signals, presets, alerts ---------- */
const SIGS=[
  {id:"os",l:()=>`HCI too low ≤ ${fmtH(CFG.lo)}`,c:"var(--green)",t:s=>s.h<=CFG.lo},
  {id:"ob",l:()=>`HCI too high ≥ ${fmtH(CFG.hi)}`,c:"var(--red)",t:s=>s.h>=CFG.hi},
  {id:"bz",l:()=>"Buyer zone",c:"var(--green)",t:s=>s.zone.status==="buyer"},
  {id:"sz",l:()=>"Seller zone",c:"var(--red)",t:s=>s.zone.status==="seller"},
  {id:"bd",l:()=>"Bullish divergence",c:"var(--green)",t:s=>s.div?.type==="bull"},
  {id:"brd",l:()=>"Bearish divergence",c:"var(--red)",t:s=>s.div?.type==="bear"},
  {id:"gz",l:()=>"Golden zone",c:"var(--gold)",t:s=>s.golden.inZone},
  {id:"cb",l:()=>"Bull confluence ≥ 3",c:"var(--green)",t:s=>s.setup.bull>=3},
  {id:"cs",l:()=>"Bear confluence ≥ 3",c:"var(--red)",t:s=>s.setup.bear>=3},
  {id:"up50",l:()=>"Above 50-day",c:"var(--muted)",t:s=>s.above50},
  {id:"wl",l:()=>"★ In active watchlist",c:"var(--gold)",t:s=>activeList()?.tks.includes(s.tk)},
  {id:"fh",mk:"crypto",l:()=>"Funding hot ≥ 0.03%",c:"var(--red)",t:s=>s.deriv?.funding>=3e-4},
  {id:"fn",mk:"crypto",l:()=>"Negative funding",c:"var(--green)",t:s=>s.deriv?.funding<0},
  {id:"oiu",mk:"crypto",l:()=>"OI up ≥ 5% · 24h",c:"var(--gold)",t:s=>s.deriv?.oiChg24h>=5},
  {id:"cl",mk:"crypto",l:()=>"Crowded longs · L/S ≥ 2",c:"var(--red)",t:s=>s.deriv?.ls?.ratio>=2},
  {id:"wh",mk:"crypto",l:()=>"Whale activity · 1h",c:"var(--gold)",t:s=>s.lastWhaleAt&&Date.now()-s.lastWhaleAt<3600e3},
];
const sigsFor=()=>SIGS.filter(x=>!x.mk||x.mk===MK);
const SIG=Object.fromEntries(SIGS.map(x=>[x.id,x]));
const PRESETS=[
  {l:"Bounce setups",sig:["os","bz"]},{l:"Exhaustion",sig:["ob","sz"]},{l:"Golden dips",sig:["gz"],hmax:0},
  {l:"Bullish divergences",sig:["bd"]},{l:"High confluence (bull)",sig:["cb"]},{l:"High confluence (bear)",sig:["cs"]},
  {mk:"crypto",l:"Squeeze watch",sig:["fn"],hmax:0},{mk:"crypto",l:"Overheated longs",sig:["fh"],hmin:1},{mk:"crypto",l:"OI building",sig:["oiu"]},{mk:"crypto",l:"Whale activity",sig:["wh"]},
];
const AT={
  hciBelow:{l:v=>`HCI at or below ${fmtH(+v)}`,v:-3,t:(s,v)=>s.h<=v},
  hciAbove:{l:v=>`HCI at or above ${fmtH(+v)}`,v:3,t:(s,v)=>s.h>=v},
  buyerZone:{l:()=>"Enters a buyer zone",t:s=>s.zone.status==="buyer"},
  sellerZone:{l:()=>"Enters a seller zone",t:s=>s.zone.status==="seller"},
  bullDiv:{l:()=>"Bullish divergence prints",t:s=>s.div?.type==="bull"},
  bearDiv:{l:()=>"Bearish divergence prints",t:s=>s.div?.type==="bear"},
  golden:{l:()=>"Trades into the golden zone",t:s=>s.golden.inZone},
  setupBull:{l:v=>`Bull confluence reaches ${v}/5`,v:3,t:(s,v)=>s.setup.bull>=v},
  setupBear:{l:v=>`Bear confluence reaches ${v}/5`,v:3,t:(s,v)=>s.setup.bear>=v},
  priceAbove:{l:v=>`Price at or above ${fmtP(+v)}`,v:"price",t:(s,v)=>s.price>=v},
  priceBelow:{l:v=>`Price at or below ${fmtP(+v)}`,v:"price",t:(s,v)=>s.price<=v},
  fundingAbove:{mk:"crypto",l:v=>`Funding at or above ${(+v).toFixed(3)}%`,v:0.03,t:(s,v)=>s.deriv?.funding!=null&&s.deriv.funding*100>=v},
  fundingBelow:{mk:"crypto",l:v=>`Funding at or below ${(+v).toFixed(3)}%`,v:-0.01,t:(s,v)=>s.deriv?.funding!=null&&s.deriv.funding*100<=v},
  oiJump:{mk:"crypto",l:v=>`Open interest up ${v}%+ in 24h`,v:5,t:(s,v)=>s.deriv?.oiChg24h>=v},
  bigLiq:{mk:"crypto",l:v=>`Liquidations over $${v}M in 24h`,v:10,t:(s,v)=>(s.deriv?.liq?.long||0)+(s.deriv?.liq?.short||0)>=v*1e6},
  whale:{mk:"crypto",l:()=>"Whale activity (last 15 min)",t:s=>s.lastWhaleAt&&Date.now()-s.lastWhaleAt<15*60e3},
};

/* ---------- small renderers ---------- */
const hciCls=h=>h<=CFG.lo?"up":h>=CFG.hi?"dn":"";
const hciWord=h=>h<=CFG.lo?"Too low":h>=CFG.hi?"Too high":h<-1?"Leaning low":h>1?"Leaning high":"Neutral";
const hm=h=>`<span class="hm"><i><b style="left:${(clamp(h,-5,5)+5)*10}%"></b></i><span class="mono ${hciCls(h)}">${fmtH(h)}</span></span>`;
const zoneP=s=>s.zone.status==="buyer"?`<span class="pill buy"><i></i>Buyer</span>`:s.zone.status==="seller"?`<span class="pill sell"><i></i>Seller</span>`:`<span class="pill"><i></i>Neutral</span>`;
const divP=s=>s.div?(s.div.type==="bull"?`<span class="pill buy"><i></i>Bullish</span>`:`<span class="pill sell"><i></i>Bearish</span>`):`<span class="mut">—</span>`;
const goldP=s=>s.golden.inZone?`<span class="pill gz"><i></i>${s.golden.dir==="bull"?"Dip zone":"Rally zone"}</span>`:`<span class="mut">—</span>`;
const dots=s=>{const st=s.setup;if(st.side==="flat")return`<span class="dots"><i></i><i></i><i></i><i></i><i></i><em>flat</em></span>`;
  const k=st.side==="bull"?st.bull:st.bear;return`<span class="dots ${st.side}">${[0,1,2,3,4].map(i=>`<i class="${i<k?"on":""}"></i>`).join("")}<em>${st.side==="bull"?"Bull":"Bear"} ${k}/5</em></span>`};
function spark(a,w=88,h=26){const lo=Math.min(...a),hi=Math.max(...a),r=hi-lo||1;const pts=a.map((v,i)=>`${(i/(a.length-1)*w).toFixed(1)},${(h-2-(v-lo)/r*(h-4)).toFixed(1)}`);
  const c=a[a.length-1]>=a[0]?HEX.green:HEX.red;const[lx,ly]=pts[pts.length-1].split(",");
  return`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="${rgba(c,.12)}"/><polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="2.2" fill="${c}"/></svg>`}

/* ---------- navigation ---------- */
const ICONS={
  overview:'<path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-4H3z"/>',
  map:'<rect x="3" y="3" width="10" height="11" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="11" width="6" height="10" rx="1"/><rect x="3" y="16" width="10" height="5" rx="1"/>',
  screener:'<path d="M3 5h18M6 12h12M10 19h4"/>',
  chart:'<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  watch:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  alerts:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  deriv:'<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  whales:'<path d="M2 13c3-4 7-6 12-6 3 0 6 2 8 4-2 2-5 4-8 4-2 0-3-1-4-2"/><path d="M2 13c2 2 3 4 3 7"/><circle cx="17" cy="10" r=".9"/>',
  defi:'<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
};
const VIEWS=[["overview","Overview"],["map","Heat Map"],["screener","Screener"],["chart","Chart"],["deriv","Derivatives","crypto"],["whales","Whales","crypto"],["defi","DeFi & DEX","crypto"],["watch","Watchlists"],["alerts","Alerts"]];
if(SESSION.role==="superadmin")VIEWS.push(["admin-users","Users"],["admin-api","API settings"]);
const viewsFor=()=>VIEWS.filter(v=>!v[2]||v[2]===MK);
function renderAdmin(){const users=S.view==="admin-users",frame=$(users?"usersFrame":"apiFrame");if(!frame.getAttribute("src"))frame.src="/admin.html?embed=1#"+(users?"users":"api");}

function renderNav(){$("nav").innerHTML=viewsFor().filter(v=>!v[0].startsWith("admin-")).map(([id,l],i)=>`<button data-act="view" data-view="${id}" id="nav-${id}" title="${l}" aria-label="${l}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${ICONS[id]}</svg><span>${l}</span>${id==="alerts"?`<span class="badge" id="navAl" hidden></span>`:`<kbd>${i+1}</kbd>`}</button>`).join("");
  const sideMarkets=$("sidebarMarkets");sideMarkets.hidden=SESSION.role!=="superadmin";
  if(SESSION.role==="superadmin")sideMarkets.innerHTML=["stocks","crypto"].filter(mk=>MARKETS[mk]).map(mk=>`<button data-act="market" data-mk="${mk}" aria-pressed="${mk===MK&&!S.view.startsWith("admin-")}" title="${MARKETS[mk].label}" aria-label="${MARKETS[mk].label}"><span class="market-full">${MARKETS[mk].label}</span><span class="market-short" aria-hidden="true">${mk==="stocks"?"S":"C"}</span></button>`).join("");
  $("mkSwitch").hidden=SESSION.role==="superadmin"||Object.keys(MARKETS).length<2;$("mkSwitch").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mk===MK))}
function go(v){if(!viewsFor().some(x=>x[0]===v))v="overview";S.view=v;store.set("view",v);if(v.startsWith("admin-")&&$("adminSettings"))$("adminSettings").open=true;$("sidebarMarkets").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mk===MK&&!v.startsWith("admin-")));
  for(const[id]of VIEWS){$("v-"+id).hidden=id!==v;$("nav-"+id)?.setAttribute("aria-current",id===v?"page":"false")}
  try{history.replaceState(null,"","#"+v)}catch{}
  $("content").scrollTop=0;hideTip();enter(v)}
function enter(v){({overview:renderOverview,map:renderMap,screener:enterScreener,chart:enterChart,deriv:renderDeriv,whales:renderWhales,defi:renderDefi,watch:enterWatch,alerts:enterAlerts,"admin-users":renderAdmin,"admin-api":renderAdmin})[v]()}
function refresh(){if(!$("landing").hidden){renderLanding();return}
  ({overview:renderOverview,map:renderMap,screener:renderRows,chart:refreshChart,deriv:renderDeriv,whales:renderWhales,defi:renderDefi,watch:renderWatchBody,alerts:renderAlertLists,"admin-users":()=>{},"admin-api":()=>{}})[S.view]();
  if(S.drawer)renderDrawer();if(!$("cmpModal").hidden)drawCompare();renderTape();renderBadges()}

/* ---------- ticker tape & top bar ---------- */
function renderTape(){const items=ASSETS.slice().sort((a,b)=>b.capNow-a.capNow).map(s=>`<button data-act="drawer" data-tk="${s.tk}"><b>${s.tk}</b><span>${fmtP(s.price)}</span><span class="${pc(s.chg)}">${fmtPct(s.chg)}</span><span style="color:${hciHue(s.h)}">HCI ${fmtH(s.h)}</span></button>`).join("");
  $("tape").innerHTML=items+items}
function renderBadges(){const n=S.unread;$("bellN").hidden=!n;$("bellN").textContent=n>99?"99+":n;
  const f=S.alerts.filter(a=>a.fired&&!a.seen).length;$("navAl").hidden=!f;$("navAl").textContent=f}
function marketClock(){if(MK==="crypto"){const t=new Date(),z=n=>String(n).padStart(2,"0");$("mktState").innerHTML=`<span style="color:var(--green)">● Crypto · trading 24/7</span>`;$("mktTime").textContent=`${z(t.getUTCHours())}:${z(t.getUTCMinutes())} UTC · daily candle closes 00:00 UTC`;return}
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const ses=STATUS.session||"closed",lab={open:"US market open",pre:"Pre-market",post:"After hours",closed:"US market closed"}[ses]||ses;
  $("mktState").innerHTML=`<span style="color:${ses==="open"?"var(--green)":ses==="closed"?"var(--muted)":"var(--gold)"}">● ${lab}</span>`;
  $("mktTime").textContent=`${p.hour}:${p.minute} ET${ses==="open"?"":" · showing last close"}`}
function setLive(on){S.live=on;const b=$("liveBtn");b.className="live "+(on?"on":"off");b.setAttribute("aria-pressed",on);b.querySelector("span").textContent=on?"Live":"Paused";
  b.title=on?"Pause screen updates":"Resume screen updates";if(on&&pendingRefresh){pendingRefresh=false;refresh()}}
let sidebarCollapsed=store.get("sidebarCollapsed",false);
function setSidebarCollapsed(collapsed){sidebarCollapsed=collapsed;document.querySelector(".app").classList.toggle("sidebar-collapsed",collapsed);const b=$("sidebarToggle");b.setAttribute("aria-expanded",!collapsed);b.setAttribute("aria-label",collapsed?"Expand sidebar":"Collapse sidebar");b.title=collapsed?"Expand sidebar":"Collapse sidebar";store.set("sidebarCollapsed",collapsed);}
$("sidebarToggle").onclick=()=>setSidebarCollapsed(!sidebarCollapsed);
setSidebarCollapsed(sidebarCollapsed);
let sourceExpanded=false;
function renderSource(){const m=MARKETS[MK],st=STATUS,p=st.provider||{},c=CONN.state,admin=SESSION.role==="superadmin";
  const label=`<i class="cdot ${c}"></i><span class="feed-name">${m.label} feed</span><span class="feed-state ${c}">${c}</span>`;
  let html=admin?`<button class="lbl feed-status-toggle" data-act="feed-details" aria-expanded="${sourceExpanded}" aria-controls="feedDetails">${label}<span class="feed-chevron" aria-hidden="true">${sourceExpanded?"⌃":"⌄"}</span></button>`:`<div class="lbl">${label}</div>`;
  if(admin){let rows;
    if(MK==="crypto")rows=`<dt>Prices</dt><dd>Binance · ${st.streams?.spot?"streaming":"polling"}</dd><dt>Derivatives</dt><dd>${esc(st.derivatives?.source||"loading")}</dd><dt>Whales</dt><dd>${st.streams?.bybit?"live":"connecting"}</dd>`;
    else{const fh=st.finnhub||{};rows=`<dt>Source</dt><dd>${esc(p.label||"—")}</dd><dt>Updates</dt><dd>${p.mode==="simulated"?"Simulated prices":fh.connected?"Streaming trades":`Polled every ${Math.round((st.pollMs||15000)/1000)}s`}</dd><dt>Real-time</dt><dd>${fh.enabled?(fh.connected?`Finnhub · ${fh.symbols}`:"Finnhub connecting"):"Off"}</dd>`;}
    html+=`<dl class="srcdl" id="feedDetails" ${sourceExpanded?"":"hidden"}>${rows}<dt>Last price</dt><dd>${m.lastAt?ago(m.lastAt):"waiting"}</dd>${st.fallbacks?.length?`<dt>Simulated</dt><dd class="dn">${st.fallbacks.length} stocks</dd>`:""}</dl>`;
  }
  const focused=$("srcBox").contains(document.activeElement);$("srcBox").innerHTML=html;if(focused)$("srcBox").querySelector("button")?.focus({preventScroll:true});
}


/* ---------- overview ---------- */
function renderOverview(){const M=MARKETS[MK];
  $("ovCrypto").hidden=MK!=="crypto";if(MK==="crypto")renderCryptoOverview();
  $("ovKick").textContent=`TH Terminal · ${M.label} overview`;$("ovSecT").textContent=`${M.groupWord} conviction`;$("ovMovT").textContent=MK==="crypto"?"Top movers today (UTC)":"Top movers today";
  const avg=ASSETS.reduce((a,s)=>a+s.h,0)/ASSETS.length,hr=new Date().getHours();
  const lean=avg>=1.5?"leaning <em>too high</em>":avg<=-1.5?"leaning <em>too low</em>":avg>0.5?"tilting <em>high</em>":avg<-0.5?"tilting <em>low</em>":"sitting <em>neutral</em>";
  $("ovTitle").innerHTML=`${MK==="crypto"?"Crypto is":"The market is"} ${lean}`;
  $("ovSub").textContent=`${hr<12?"Good morning":hr<18?"Good afternoon":"Good evening"}. ${ASSETS.length} ${M.noun} read by the toolkit · data from ${esc(STATUS.provider?.label||"server")} · ${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}`;
  // gauge
  const cx=150,cy=150,r=118,ang=h=>Math.PI*(1-(h+5)/10),pt=(h,rr)=>[cx+rr*Math.cos(ang(h)),cy-rr*Math.sin(ang(h))];
  const[nx,ny]=pt(avg,r-26);const ticks=[-5,-3,0,3,5].map(t=>{const[x1,y1]=pt(t,r+12),[x2,y2]=pt(t,r+20);const[lx,ly]=pt(t,r+34);return`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${HEX.dim}" stroke-width="1.5"/><text x="${lx}" y="${ly+4}" text-anchor="middle" font-family="IBM Plex Mono" font-size="11" fill="${HEX.muted}">${t>0?"+":""}${t}</text>`}).join("");
  $("ovGauge").innerHTML=`<svg viewBox="-20 -20 340 205" role="img" aria-label="Average HCI ${fmtH(avg)}"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="${HEX.green}"/><stop offset=".28" stop-color="${HEX.lime}"/><stop offset=".5" stop-color="${HEX.gold}"/><stop offset=".72" stop-color="${HEX.orange}"/><stop offset="1" stop-color="${HEX.red}"/></linearGradient>
    <filter id="gl"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <path d="M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}" fill="none" stroke="url(#gg)" stroke-width="18" stroke-linecap="round" opacity=".25" filter="url(#gl)"/>
    <path d="M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round"/>${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${HEX.text}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="9" fill="${HEX.bg}" stroke="${HEX.text}" stroke-width="3"/>
    <text x="${cx}" y="${cy-38}" text-anchor="middle" font-family="Anton" font-size="44" fill="${hciHue(avg)}">${fmtH(avg)}</text>
    <text x="26" y="180" font-family="IBM Plex Mono" font-size="10" letter-spacing="1.5" fill="${HEX.green}">TOO LOW</text><text x="274" y="180" text-anchor="end" font-family="IBM Plex Mono" font-size="10" letter-spacing="1.5" fill="${HEX.red}">TOO HIGH</text></svg>
    <div class="state" style="color:${hciHue(avg)}">${hciWord(avg)}</div>`;
  // breadth
  const adv=ASSETS.filter(s=>s.chg>0).length,dec=ASSETS.length-adv,a50=ASSETS.filter(s=>s.above50).length,bz=ASSETS.filter(SIG.bz.t).length,sz=ASSETS.filter(SIG.sz.t).length,lo=ASSETS.filter(s=>s.h<0).length,N=ASSETS.length;
  const split=(a,b,ca,cb)=>`<div class="split"><i style="width:${a/(a+b||1)*100}%;background:${ca}"></i><i style="width:${b/(a+b||1)*100}%;background:${cb}"></i></div>`;
  $("ovBreadth").innerHTML=`
    <div><div class="lab"><span>Advancers <b class="up">${adv}</b></span><span>Decliners <b class="dn">${dec}</b></span></div>${split(adv,dec,HEX.green,HEX.red)}</div>
    <div><div class="lab"><span>Above 50-day avg</span><b>${Math.round(a50/N*100)}%</b></div>${split(a50,N-a50,HEX.gold,HEX.card3)}</div>
    <div><div class="lab"><span>In buyer zones <b class="up">${bz}</b></span><span>In seller zones <b class="dn">${sz}</b></span></div>${split(bz,sz,HEX.green,HEX.red)}</div>
    <div><div class="lab"><span>HCI below zero <b class="up">${lo}</b></span><span>Above zero <b class="dn">${N-lo}</b></span></div>${split(lo,N-lo,HEX.green,HEX.red)}</div>`;
  // tiles
  $("ovTiles").innerHTML=["os","ob","bz","sz","bd","gz"].map(id=>{const x=SIG[id],m=ASSETS.filter(x.t).sort((a,b)=>b.capNow-a.capNow);
    return`<button class="tile2" style="--c:${x.c}" data-act="sig" data-sig="${id}"><b>${m.length}</b><span>${x.l()}</span><small>${m.slice(0,4).map(s=>s.tk).join(" · ")||"none right now"}</small></button>`}).join("");
  // sectors
  const sec=SECTORS.map(n=>{const m=ASSETS.filter(s=>s.sector===n);return{n,h:m.reduce((a,s)=>a+s.h,0)/m.length,c:m.reduce((a,s)=>a+s.chg,0)/m.length}}).sort((a,b)=>a.h-b.h);
  $("ovSectors").innerHTML=sec.map(x=>{const w=Math.abs(x.h)/5*50;return`<button class="sbar" data-act="group" data-g="${x.n}"><span>${x.n}</span><span class="trk"><b style="${x.h<0?`right:50%`:`left:50%`};width:${w}%;background:${hciHue(x.h)};box-shadow:0 0 10px ${rgba(x.h<0?HEX.green:HEX.red,.35)}"></b></span><span class="mono" style="color:${hciHue(x.h)};text-align:right">${fmtH(x.h)}</span><span class="mono c4 ${pc(x.c)}" style="text-align:right">${fmtPct(x.c)}</span></button>`}).join("");
  // histogram
  const bins=[...Array(10)].map((_,i)=>({a:i-5,b:i-4,n:0}));ASSETS.forEach(s=>bins[clamp(Math.floor(s.h+5),0,9)].n++);
  const mx=Math.max(...bins.map(b=>b.n),1),W=460,Hh=200,bw=W/10;
  $("ovHist").innerHTML=`<svg viewBox="0 0 ${W} ${Hh+26}" role="img" aria-label="HCI distribution">${bins.map((b,i)=>{const h=b.n/mx*(Hh-26),x=i*bw+4,y=Hh-h;
    return`<rect class="bar" data-act="hbin" data-min="${b.a}" data-max="${b.b}" x="${x}" y="${y}" width="${bw-8}" height="${Math.max(h,2)}" rx="4" fill="${hciHue(b.a+.5)}" opacity="${b.n?0.9:0.25}"><title>${b.n} stocks with HCI ${b.a} to ${b.b}</title></rect>${b.n?`<text x="${x+(bw-8)/2}" y="${y-6}" text-anchor="middle" font-family="IBM Plex Mono" font-size="11" fill="${HEX.text}">${b.n}</text>`:""}`}).join("")}
    ${[-5,-3,0,3,5].map(t=>`<text x="${(t+5)*bw}" y="${Hh+18}" text-anchor="${t===-5?"start":t===5?"end":"middle"}" font-family="IBM Plex Mono" font-size="11" fill="${HEX.muted}">${t>0?"+":""}${t}</text>`).join("")}
    <line x1="${5*bw}" y1="0" x2="${5*bw}" y2="${Hh}" stroke="${HEX.dim}" stroke-dasharray="3 4"/></svg>`;
  // setups
  const top=side=>ASSETS.filter(s=>s.setup.side===side).sort((a,b)=>b.setup[side]-a.setup[side]||(side==="bull"?a.h-b.h:b.h-a.h)).slice(0,6);
  const lst=(arr,label,c)=>`<div><div class="ct" style="--c:${c};margin-bottom:6px">${label}</div><div class="mini-l">${arr.map(s=>`<button data-act="drawer" data-tk="${s.tk}"><span class="tkb">${s.tk}</span>${dots(s)}<span class="mono" style="color:${hciHue(s.h)}">${fmtH(s.h)}</span></button>`).join("")||`<p class="mut">None right now.</p>`}</div></div>`;
  $("ovSetups").innerHTML=lst(top("bull"),"Bullish confluence",HEX.green)+lst(top("bear"),"Bearish confluence",HEX.red);
  // feed
  renderFeed($("ovFeed"),14);
  // movers
  const srt=ASSETS.slice().sort((a,b)=>b.chg-a.chg);
  const mv=(arr,label,c)=>`<div><div class="ct" style="--c:${c};margin-bottom:6px">${label}</div><div class="mini-l">${arr.map(s=>`<button data-act="drawer" data-tk="${s.tk}"><span class="tkb">${s.tk}</span><span class="mut" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)} · ${fmtP(s.price)}</span><span class="mono ${pc(s.chg)}">${fmtPct(s.chg)}</span></button>`).join("")}</div></div>`;
  $("ovMovers").innerHTML=mv(srt.slice(0,5),"Gainers",HEX.green)+mv(srt.slice(-5).reverse(),"Decliners",HEX.red);
}
let feedSeen=0;
function renderFeed(el,max){el.innerHTML=S.feed.slice(0,max).map(e=>`<button class="ev ${e.t>feedSeen?"new":""}" style="--c:${e.side==="bull"?HEX.green:e.side==="bear"?HEX.red:HEX.gold}" data-act="drawer" data-tk="${e.tk}"><i></i><span class="tkb">${e.tk}</span><span>${esc(e.text)}</span><small>${e.seed?"active":ago(e.t)}</small></button>`).join("")||`<p class="mut">Signals will appear here as the toolkit spots them.</p>`;
  if(S.view==="overview")setTimeout(()=>feedSeen=Date.now(),900)}

/* ---------- heat map ---------- */
function renderMap(){
  const M=S.map;
  if(M.mode==="fund"&&MK!=="crypto")M.mode="hci";
  $("mapMode").innerHTML=[["chg","Price"],["hci","HCI"],["zone","Hill Zones"],["setup","Confluence"],...(MK==="crypto"?[["fund","Funding"]]:[])].map(([k,l])=>`<button data-act="map-mode" data-v="${k}" aria-pressed="${M.mode===k}">${l}</button>`).join("");
  $("mapPeriod").hidden=M.mode!=="chg";
  $("mapPeriod").innerHTML=["1D","1W","1M","3M"].map(k=>`<button data-act="map-period" data-v="${k}" aria-pressed="${M.period===k}">${k}</button>`).join("");
  $("mapSize").innerHTML=[["cap","Market cap"],["eq","Equal"]].map(([k,l])=>`<button data-act="map-size" data-v="${k}" aria-pressed="${M.size===k}">${l}</button>`).join("");
  $("mapCrumb").innerHTML=M.focus?`<button data-act="map-focus" data-v="">All sectors</button> / <span>${M.focus}</span>`:`<span>All sectors</span>`;
  const rng={"1D":3,"1W":6,"1M":12,"3M":20}[M.period];
  const legends={chg:[`−${rng}%`,`linear-gradient(90deg,${HEX.red},${HEX.card3},${HEX.green})`,`+${rng}%`],hci:["Too low",`linear-gradient(90deg,${HEX.green},${HEX.card3},${HEX.red})`,"Too high"],
    zone:["Buyer zone",`linear-gradient(90deg,${HEX.green} 33%,${HEX.card3} 33% 66%,${HEX.red} 66%)`,"Seller zone"],setup:["Bear 5/5",`linear-gradient(90deg,${HEX.red},${HEX.card3},${HEX.green})`,"Bull 5/5"],fund:["−0.05%",`linear-gradient(90deg,${HEX.green},${HEX.card3},${HEX.red})`,"+0.05%"]};
  const lg=legends[M.mode];$("mapLegend").innerHTML=`<span>${lg[0]}</span><i style="background:${lg[1]}"></i><span>${lg[2]}</span>`;
  const el=$("map"),W=el.clientWidth,H=el.clientHeight;if(!W||!H)return;
  if(typeof d3==="undefined"){el.innerHTML=`<div class="empty">The heat map library didn't load. Check your connection and reload the page.</div>`;return}
  const per=s=>({"1D":s.chg,"1W":s.chgW,"1M":s.chgM,"3M":s.chg3M})[M.period];
  const col=s=>{if(M.mode==="chg"){const t=clamp(per(s)/rng,-1,1);return mix(HEX.card3,t>=0?HEX.green:HEX.red,Math.pow(Math.abs(t),.8))}
    if(M.mode==="hci"){const t=clamp(s.h/4.5,-1,1);return mix(HEX.card3,t<=0?HEX.green:HEX.red,Math.pow(Math.abs(t),.8))}
    if(M.mode==="fund"){const f=s.deriv?.funding;if(f==null)return HEX.card2;const t=clamp(f/5e-4,-1,1);return mix(HEX.card3,t<=0?HEX.green:HEX.red,Math.pow(Math.abs(t),.7))}
    if(M.mode==="zone")return s.zone.status==="buyer"?mix(HEX.card3,HEX.green,.8):s.zone.status==="seller"?mix(HEX.card3,HEX.red,.8):HEX.card3;
    const st=s.setup;return st.side==="flat"?HEX.card3:mix(HEX.card3,st.side==="bull"?HEX.green:HEX.red,st.score/5)};
  const val=s=>M.mode==="fund"?fmtFund(s.deriv?.funding):M.mode==="chg"?fmtPct(per(s)):M.mode==="hci"?fmtH(s.h):M.mode==="zone"?(s.zone.status==="neutral"?"neutral":s.zone.status):(s.setup.side==="flat"?"flat":`${s.setup.side} ${s.setup.score}/5`);
  const secs=M.focus?[M.focus]:SECTORS;
  const root=d3.hierarchy({children:secs.map(n=>({name:n,children:ASSETS.filter(s=>s.sector===n).map(s=>({s}))}))}).sum(d=>d.s?(M.size==="eq"?1:Math.pow(d.s.capNow,.68)):0).sort((a,b)=>b.value-a.value);
  d3.treemap().size([W,H]).paddingOuter(3).paddingTop(22).paddingInner(2).tile(d3.treemapSquarify.ratio(1.15))(root);
  let html="";
  for(const sc of root.children){html+=`<button class="sec" data-act="map-focus" data-v="${M.focus?"":sc.data.name}" style="left:${sc.x0}px;top:${sc.y0+2}px;width:${sc.x1-sc.x0}px">${sc.data.name}${M.focus?"":" ›"}</button>`;
    for(const lf of sc.children){const s=lf.data.s,w=lf.x1-lf.x0,h=lf.y1-lf.y0,fs=clamp(Math.min(w/3.4,h/2.6),9,M.focus?44:34);
      html+=`<button class="tl" data-act="drawer" data-tk="${s.tk}" data-tip="${s.tk}" style="left:${lf.x0}px;top:${lf.y0}px;width:${w}px;height:${h}px;background:${col(s)};color:${HEX.text}" aria-label="${esc(s.name)} ${val(s)}">
        ${w>30&&h>20?`<span class="t" style="font-size:${fs}px">${s.tk}</span>`:""}${w>48&&h>40?`<span class="v" style="font-size:${clamp(fs*.42,9,15)}px">${val(s)}</span>`:""}${w>120&&h>90?`<span class="n">${esc(s.name)}</span>`:""}</button>`}}
  el.innerHTML=html;
}
function showTip(s,e){const tp=$("tip");tp.hidden=false;
  tp.innerHTML=`<div class="hd"><b>${s.tk}</b><span class="mono ${pc(s.chg)}">${fmtPct(s.chg)}</span></div><div class="mut" style="font-size:11.5px">${esc(s.name)} · ${s.sector}</div>
    <div style="margin-top:8px">${spark(s.spark,222,40)}</div>
    <dl><dt>Price</dt><dd>${fmtP(s.price)}</dd><dt>HCI</dt><dd style="color:${hciHue(s.h)}">${fmtH(s.h)} · ${hciWord(s.h)}</dd><dt>Hill zone</dt><dd>${s.zone.status}</dd>
    <dt>Divergence</dt><dd>${s.div?s.div.type+"ish":"none"}</dd><dt>Golden zone</dt><dd>${s.golden.inZone?"inside":"no"}</dd><dt>Confluence</dt><dd>${s.setup.side} ${s.setup.score}/5</dd>${s.deriv?.funding!=null?`<dt>Funding</dt><dd>${fmtFund(s.deriv.funding)}</dd><dt>OI 24h</dt><dd>${s.deriv.oiChg24h!=null?fmtPct(s.deriv.oiChg24h):"—"}</dd>`:""}</dl>`;
  tp.style.left=Math.min(e.clientX+16,innerWidth-tp.offsetWidth-10)+"px";tp.style.top=Math.min(e.clientY+16,innerHeight-tp.offsetHeight-10)+"px"}
const hideTip=()=>$("tip").hidden=true;
$("map").addEventListener("mousemove",e=>{const t=e.target.closest("[data-tip]");t?showTip(BY[t.dataset.tip],e):hideTip()});
$("map").addEventListener("mouseleave",hideTip);

/* ---------- screener ---------- */
const COLS=[
  {k:"tk",l:"Ticker",r:s=>`<div class="tkc"><span class="tk">${s.tk}${s.source==="simulated"?` <span class="pill" title="Real data unavailable, showing simulated prices">SIM</span>`:""}</span><span class="nm">${esc(s.name)}</span></div>`},
  {k:"chgM",l:"30D trend",r:s=>spark(s.spark)},
  {k:"price",l:"Price",n:1,r:s=>fmtP(s.price),cls:"mono price"},
  {k:"chg",l:"1D",n:1,r:s=>`<span class="${pc(s.chg)}">${fmtPct(s.chg)}</span>`,cls:"mono"},
  {k:"chgW",l:"1W",n:1,r:s=>`<span class="${pc(s.chgW)}">${fmtPct(s.chgW)}</span>`,cls:"mono"},
  {k:"cap",l:"Mkt cap",n:1,r:s=>fmtCap(s.capNow),cls:"mono"},
  {k:"h",l:"HCI",r:s=>hm(s.h)},
  {k:"zone",l:"Hill zone",r:zoneP},{k:"div",l:"Divergence",r:divP},{k:"gold",l:"Golden zone",r:goldP},{k:"setup",l:"Confluence",r:dots},
];
const CCOLS=[
  {k:"tk",l:"Coin",r:s=>coinCell(s)},
  {k:"chgM",l:"30D trend",r:s=>spark(s.spark)},
  {k:"price",l:"Price",n:1,r:s=>fmtP(s.price),cls:"mono price"},
  {k:"chg",l:"1D",n:1,r:s=>`<span class="${pc(s.chg)}">${fmtPct(s.chg)}</span>`,cls:"mono"},
  {k:"chgW",l:"7D",n:1,r:s=>`<span class="${pc(s.chgW)}">${fmtPct(s.chgW)}</span>`,cls:"mono"},
  {k:"cap",l:"Mkt cap",n:1,r:s=>fmtCap(s.capNow),cls:"mono"},
  {k:"fund",l:"Funding",n:1,r:s=>fundCell(s),cls:"mono"},
  {k:"oi",l:"OI 24h",n:1,r:s=>s.deriv?.oiChg24h!=null?`<span class="${pc(s.deriv.oiChg24h)}">${fmtPct(s.deriv.oiChg24h)}</span>`:`<span class="mut">—</span>`,cls:"mono"},
  {k:"h",l:"HCI",r:s=>hm(s.h)},
  {k:"zone",l:"Hill zone",r:zoneP},{k:"div",l:"Divergence",r:divP},{k:"gold",l:"Golden zone",r:goldP},{k:"setup",l:"Confluence",r:dots},
];
const cols=()=>MK==="crypto"?CCOLS:COLS;
const SV={fund:s=>s.deriv?.funding??-9,oi:s=>s.deriv?.oiChg24h??-999,tk:s=>s.tk,chgM:s=>s.chgM,price:s=>s.price,chg:s=>s.chg,chgW:s=>s.chgW,cap:s=>s.capNow,h:s=>s.h,zone:s=>({buyer:0,neutral:1,seller:2})[s.zone.status],
  div:s=>s.div?(s.div.type==="bull"?0:1):2,gold:s=>s.golden.inZone?0:1,setup:s=>s.setup.bull-s.setup.bear};
function filtered(){const F=S.scr;return ASSETS.filter(s=>(F.group==="All"||s.sector===F.group||s.themes.includes(F.group))&&[...F.sig].every(id=>SIG[id].t(s))
  &&s.h>=F.hmin-1e-9&&s.h<=F.hmax+1e-9&&s.capNow>=F.cap&&(!F.q||s.tk.toLowerCase().includes(F.q)||s.name.toLowerCase().includes(F.q)))
  .sort((a,b)=>{const x=SV[F.sort](a),y=SV[F.sort](b);return(x<y?-1:x>y?1:0)*F.dir})}
function enterScreener(){const F=S.scr;
  $("presets").innerHTML=PRESETS.map((p,i)=>!p.mk||p.mk===MK?`<button class="chip" data-act="preset" data-i="${i}">${p.l}</button>`:"").join("");
  $("scrGroups").innerHTML=["All",...THEMES,...SECTORS].map(g=>{const n=g==="All"?ASSETS.length:ASSETS.filter(s=>s.sector===g||s.themes.includes(g)).length;
    return`<button class="chip" data-act="scr-group" data-g="${esc(g)}" aria-pressed="${F.group===g}">${g==="All"?`All ${MARKETS[MK].noun}`:esc(g)} <span class="n">${n}</span></button>`}).join("");
  $("scrSigs").innerHTML=sigsFor().map(x=>`<button class="chip" style="--c:${x.c}" data-act="scr-sig" data-sig="${x.id}" aria-pressed="${F.sig.has(x.id)}"><i></i>${x.l()} <span class="n">${ASSETS.filter(x.t).length}</span></button>`).join("")
    +(F.sig.size||F.hmin>-5||F.hmax<5||F.cap||F.q||F.group!=="All"?`<button class="chip" data-act="scr-clear">Clear all filters</button>`:"");
  $("scrQ").value=F.q;$("scrCap").value=F.cap;syncRange();
  $("densSeg").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",CFG.density===b.dataset.d));
  $("scrHead").innerHTML=`<th style="width:34px"><span class="sr" style="position:absolute;left:-9999px">Compare</span></th><th style="width:30px"></th>`+cols().map(c=>`<th class="${c.n?"num":""}" ${F.sort===c.k?`aria-sort="${F.dir>0?"ascending":"descending"}"`:""}><button data-act="sort" data-k="${c.k}">${c.l}${F.sort===c.k?(F.dir>0?" ▲":" ▼"):""}</button></th>`).join("");
  renderRows()}
let lastPx={};
function renderRows(){const F=S.scr,rows=filtered(),wl=activeList()?.tks||[];F.list=rows.map(s=>s.tk);
  $("scrCount").textContent=`${rows.length} of ${ASSETS.length} ${MARKETS[MK].noun} match · sorted by ${(cols().find(c=>c.k===F.sort)||cols()[0]).l.toLowerCase()}`;
  $("scrWrap").classList.toggle("dense",CFG.density==="dense");
  $("scrBody").innerHTML=rows.length?rows.map(s=>{const lp=lastPx[s.tk],fl=lp==null||Math.abs(lp-s.price)<1e-9?"":s.price>lp?"flash-up":"flash-dn";
    return`<tr data-act="drawer" data-tk="${s.tk}" class="${F.sel===s.tk?"sel":""}" id="r-${CSS.escape(s.tk)}">
      <td><button class="cbx" data-act="cmp" data-tk="${s.tk}" aria-pressed="${S.cmp.has(s.tk)}" aria-label="Compare ${s.tk}"></button></td>
      <td><button class="star" data-act="watch" data-tk="${s.tk}" aria-pressed="${wl.includes(s.tk)}" aria-label="Watch ${s.tk}">★</button></td>
      ${cols().map(c=>`<td class="${c.n?"num ":""}${c.cls||""} ${c.k==="price"?fl:""}">${c.r(s)}</td>`).join("")}</tr>`}).join("")
    :`<tr><td colspan="${cols().length+2}" class="empty">No ${MARKETS[MK].noun} match every filter right now. Remove a filter or widen the HCI range.</td></tr>`;
  ASSETS.forEach(s=>lastPx[s.tk]=s.price)}
function syncRange(){const F=S.scr;$("hrMin").value=F.hmin;$("hrMax").value=F.hmax;$("hrLbl").textContent=`${fmtH(F.hmin)} to ${fmtH(F.hmax)}`;
  const a=(F.hmin+5)*10,b=(F.hmax+5)*10;$("hrFill").style.cssText=`left:calc(8px + (100% - 16px) * ${a/100});width:calc((100% - 16px) * ${(b-a)/100});background-size:${100/((b-a)/100||1)}% 100%;background-position:${a/((100-(b-a))||1)*100}% 0`}
$("hrMin").addEventListener("input",e=>{S.scr.hmin=Math.min(+e.target.value,S.scr.hmax);syncRange();renderRows()});
$("hrMax").addEventListener("input",e=>{S.scr.hmax=Math.max(+e.target.value,S.scr.hmin);syncRange();renderRows()});
$("hrMin").addEventListener("change",enterScreener);$("hrMax").addEventListener("change",enterScreener);
$("scrQ").addEventListener("input",e=>{S.scr.q=e.target.value.trim().toLowerCase();renderRows()});
$("scrCap").addEventListener("change",e=>{S.scr.cap=+e.target.value;enterScreener()});
$("densSeg").addEventListener("click",e=>{const b=e.target.closest("[data-d]");if(!b)return;CFG.density=b.dataset.d;store.set("cfg",CFG);enterScreener()});
function moveSel(d){const L=S.scr.list;if(!L.length)return;let i=L.indexOf(S.scr.sel);i=clamp(i<0?0:i+d,0,L.length-1);S.scr.sel=L[i];renderRows();$("r-"+CSS.escape(L[i]))?.scrollIntoView({block:"nearest"})}
function csv(){const rows=filtered();const head=["Ticker","Company","Sector","Price","Chg1D%","Chg1W%","MktCapB","HCI","HillZone","Divergence","GoldenZone","BullScore","BearScore"];
  return[head.join(","),...rows.map(s=>[s.tk,`"${s.name}"`,s.sector,fmtP(s.price).replace(/,/g,""),s.chg.toFixed(2),s.chgW.toFixed(2),s.capNow.toFixed(0),s.h.toFixed(2),s.zone.status,s.div?.type||"",s.golden.inZone?"yes":"",s.setup.bull,s.setup.bear].join(","))].join("\n")}

/* ---------- chart ---------- */
const chCv=$("chCv");let chInfo=null;
function chartSrc(){const s=BY[S.chart.tk];return S.chart.tf==="W"?weekly(s):s}
const RANGES={D:[["3M",63],["6M",126],["1Y",252],["2Y",504]],W:[["6M",26],["1Y",52],["2Y",104]]};
function resetView(cnt){const src=chartSrc(),n=src.bars.length;cnt=cnt||(S.chart.tf==="W"?52:126);S.chart.v={count:Math.min(cnt,n),end:n+3}}
function enterChart(){const C=S.chart;if(!BY[C.tk])C.tk=ASSETS[0].tk;if(!C.v)resetView();
  $("chTf").innerHTML=[["D","Daily"],["W","Weekly"]].map(([k,l])=>`<button data-act="ch-tf" data-v="${k}" aria-pressed="${C.tf===k}">${l}</button>`).join("");
  $("chRange").innerHTML=RANGES[C.tf].map(([l,n])=>`<button data-act="ch-range" data-v="${n}" aria-pressed="${Math.round(C.v.count)===n}">${l}</button>`).join("");
  $("chType").innerHTML=[["candle","Candles"],["line","Line"]].map(([k,l])=>`<button data-act="ch-type" data-v="${k}" aria-pressed="${C.type===k}">${l}</button>`).join("");
  const OV=[["zones","Hill Zones",HEX.green],["golden","Golden Zone",HEX.gold],["heat","HCI Heatmap",HEX.orange],["div","Divergence",HEX.red],["fib","Fib levels",HEX.gold2],["sma20","SMA 20","#7aa7ff"],["sma50","SMA 50","#b58cff"]];
  $("chOv").innerHTML=OV.map(([k,l,c])=>`<button class="chip" style="--c:${c}" data-act="ch-ov" data-v="${k}" aria-pressed="${C.ov[k]}"><i></i>${l}</button>`).join("");
  refreshChart()}
function refreshChart(){const s=BY[S.chart.tk];
  $("chTk").textContent=s.tk;$("chName").textContent=s.name;$("chPx").innerHTML=`${fmtP(s.price)} <span class="${pc(s.chg)}">${fmtPct(s.chg)}</span>`;
  drawMain();renderChartSide()}
function drawMain(){const C=S.chart,src=chartSrc();
  chInfo=drawChart(chCv,src,{start:C.v.end-C.v.count,end:C.v.end,ov:C.ov,type:C.type,hover:C.hover});
  const i=chInfo?.idx??src.bars.length-1,b=src.bars[i],h=src.hci[i],d=src.dates[i];
  $("chRead").innerHTML=`<span><b>${d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</b></span><span>O <b>${fmtP(b.o)}</b></span><span>H <b>${fmtP(b.h)}</b></span><span>L <b>${fmtP(b.l)}</b></span><span>C <b>${fmtP(b.c)}</b></span>
    <span>Chg <b class="${pc(b.c-b.o)}">${fmtPct((b.c/(src.bars[i-1]||b).c-1)*100)}</b></span><span>HCI <b style="color:${isNaN(h)?"":hciHue(h)}">${fmtH(h)}</b></span>${C.ov.sma50?`<span>SMA50 <b>${isNaN(src.sma50[i])?"—":fmtP(src.sma50[i])}</b></span>`:""}`}
function renderChartSide(){const s=BY[S.chart.tk],src=chartSrc(),z=src.zone,g=src.golden,h=src.hci[src.hci.length-1],last=src.bars[src.bars.length-1].c,wl=activeList();
  const dist=l=>fmtPct((l/last-1)*100);
  $("chSide").innerHTML=`
  <div class="card"><div class="ct">Hill Conviction Index · ${S.chart.tf==="W"?"weekly":"daily"}</div>
    <div class="vmeter"><div class="bar"><b style="top:${(5-h)*10}%"></b></div><div style="display:flex;flex-direction:column;justify-content:space-between;gap:10px">
      <div class="scale"><span class="dn">+5 too high</span><span>0</span><span class="up">−5 too low</span></div></div></div>
    <div class="row" style="justify-content:space-between"><span class="big" style="color:${hciHue(h)}">${fmtH(h)}</span><span class="pill" style="color:${hciHue(h)};border-color:currentColor"><i></i>${hciWord(h)}</span></div></div>
  <div class="card"><div class="ct">Toolkit readout</div><dl class="kv">
    <dt>Hill zone</dt><dd>${z.status==="buyer"?`<span class="pill buy"><i></i>Buyer</span>`:z.status==="seller"?`<span class="pill sell"><i></i>Seller</span>`:`<span class="pill"><i></i>Neutral</span>`}</dd>
    <dt>Divergence</dt><dd>${src.div?(src.div.type==="bull"?`<span class="pill buy"><i></i>Bullish</span>`:`<span class="pill sell"><i></i>Bearish</span>`):"none"}</dd>
    <dt>Golden zone</dt><dd>${fmtP(g.bot)}–${fmtP(g.top)}${g.inZone?` <span class="pill gz"><i></i>In</span>`:""}</dd>
    <dt>Confluence</dt><dd>${dots(s)}</dd></dl></div>
  <div class="card"><div class="ct">Key levels</div><div class="lvl">
    ${z.sellers.slice().reverse().map(x=>`<div><span class="dn">Seller ${x.touches}×</span><span>${fmtP(x.level)}</span><span class="mut">${dist(x.level)}</span></div>`).join("")}
    <div><span class="gold">Last</span><span class="gold">${fmtP(last)}</span><span></span></div>
    ${z.buyers.map(x=>`<div><span class="up">Buyer ${x.touches}×</span><span>${fmtP(x.level)}</span><span class="mut">${dist(x.level)}</span></div>`).join("")}</div></div>
  ${s.mk==="crypto"&&s.deriv?.funding!=null?`<div class="card"><div class="ct" style="--c:${HEX.orange}">Derivatives</div><dl class="kv"><dt>Funding 8h</dt><dd class="${fundCls(s.deriv.funding)}">${fmtFund(s.deriv.funding)}</dd><dt>Open interest</dt><dd>${fmtUsd(s.deriv.oiUsd)}</dd><dt>OI 24h</dt><dd>${s.deriv.oiChg24h!=null?fmtPct(s.deriv.oiChg24h):"—"}</dd><dt>Long / short</dt><dd>${s.deriv.ls?s.deriv.ls.ratio.toFixed(2):"—"}</dd></dl></div>`:""}
  <div class="card"><div class="row"><button class="btn ${wl?.tks.includes(s.tk)?"gold":""}" data-act="watch" data-tk="${s.tk}">★ ${wl?.tks.includes(s.tk)?"Watching":"Watch"}</button><button class="btn" data-act="alert" data-tk="${s.tk}">Set alert</button><button class="btn" data-act="cmp" data-tk="${s.tk}">${S.cmp.has(s.tk)?"✓ Comparing":"+ Compare"}</button>
    <a class="btn" href="${tvUrl(s)}" target="_blank" rel="noopener">TradingView ↗</a></div>
    ${wl?`<div class="ct">${esc(wl.name)}</div><div class="qlist">${wl.tks.map(t=>`<button class="chip" data-act="chart" data-tk="${t}" aria-pressed="${t===s.tk}">${t}</button>`).join("")}</div>`:""}</div>`}

function niceStep(r){const p=Math.pow(10,Math.floor(Math.log10(r||1))),m=r/p;return(m<1.5?1:m<3?2:m<7?5:10)*p}
function drawChart(cv,src,o){
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;if(!W||!H)return null;
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
  const b=src.bars,n=b.length,start=o.start,end=o.end,cnt=end-start,K=!!o.compact,ov=o.ov;
  const pL=K?2:10,pR=K?2:76,axH=K?2:26,top=K?8:16,gap=K?6:16,hH=Math.round(H*(K?.27:.25));
  const pB=H-axH-hH-gap,hT=pB+gap,hB=H-axH,PW=W-pL-pR,bw=PW/cnt,X=i=>pL+(i-start+.5)*bw;
  const i0=Math.max(0,Math.floor(start)),i1=Math.min(n-1,Math.ceil(end)-1);if(i1<i0)return null;
  let lo=Infinity,hi=-Infinity;for(let i=i0;i<=i1;i++){if(b[i].l<lo)lo=b[i].l;if(b[i].h>hi)hi=b[i].h}
  const pad=(hi-lo)*.08;lo-=pad;hi+=pad;const Y=v=>top+(hi-v)/(hi-lo)*(pB-top),YH=h=>hT+(5-h)/10*(hB-hT);
  g.font=`${K?10:11}px "IBM Plex Mono",monospace`;g.textBaseline="middle";
  // backgrounds
  g.fillStyle=rgba(HEX.card2,.5);g.fillRect(pL,hT,PW,hB-hT);
  if(!K){g.strokeStyle="rgba(255,255,255,.05)";g.lineWidth=1;g.fillStyle=HEX.muted;g.textAlign="left";
    const st=niceStep((hi-lo)/6);for(let v=Math.ceil(lo/st)*st;v<hi;v+=st){const y=Math.round(Y(v))+.5;g.beginPath();g.moveTo(pL,y);g.lineTo(W-pR,y);g.stroke();g.fillText(fmtP(v),W-pR+8,y)}
    let pm=-1,lx=-99;g.textAlign="center";for(let i=i0;i<=i1;i++){const d=src.dates[i],m=d.getMonth();if(m!==pm&&i>i0){const x=Math.round(X(i))+.5;if(x-lx>56){g.beginPath();g.moveTo(x,top);g.lineTo(x,hB);g.stroke();
      g.fillText(m===0?String(d.getFullYear()):d.toLocaleDateString(undefined,{month:"short"}),x,H-axH/2);lx=x}}pm=m}}
  g.save();g.beginPath();g.rect(pL,0,PW,H);g.clip();
  if(ov.heat)for(let i=i0;i<=i1;i++){const h=src.hci[i];if(isNaN(h)||Math.abs(h)<1.2)continue;const t=clamp((Math.abs(h)-1.2)/3.3,0,1);
    g.fillStyle=rgba(h<0?HEX.green:HEX.red,.05+t*.22);g.fillRect(X(i)-bw/2,top,bw+.6,pB-top)}
  if(ov.golden){const G=src.golden,x0=Math.max(X(G.from)-bw/2,pL),y1=Y(G.top),y2=Y(G.bot);
    const gr=g.createLinearGradient(0,y1,0,y2);gr.addColorStop(0,rgba(HEX.gold,.22));gr.addColorStop(1,rgba(HEX.gold,.1));g.fillStyle=gr;g.fillRect(x0,y1,W-pR-x0,y2-y1);
    g.strokeStyle=rgba(HEX.gold,.85);g.setLineDash([5,4]);g.beginPath();g.moveTo(x0,y1);g.lineTo(W-pR,y1);g.moveTo(x0,y2);g.lineTo(W-pR,y2);g.stroke();g.setLineDash([]);
    if(!K){g.fillStyle=HEX.gold;g.textAlign="left";g.font=`600 10px "IBM Plex Mono",monospace`;g.fillText("GOLDEN ZONE  0.5 – 0.618",x0+8,y1-9);g.font=`11px "IBM Plex Mono",monospace`}}
  if(ov.fib&&!K){const G=src.golden;g.setLineDash([2,4]);g.lineWidth=1;g.textAlign="left";for(const f of G.fibs){const y=Y(f.p);if(y<top||y>pB)continue;g.strokeStyle=rgba(HEX.gold2,.5);g.beginPath();g.moveTo(pL,y);g.lineTo(W-pR,y);g.stroke();g.fillStyle=rgba(HEX.gold2,.9);g.fillText(f.f.toFixed(3),pL+6,y-7)}g.setLineDash([])}
  const zoneBand=(z,c,tag)=>{const y=Y(z.level);if(y<top-10||y>pB+10)return null;const hh=Math.max(6,Math.abs(Y(z.level*1.006)-Y(z.level*.994)));
    g.fillStyle=rgba(c,.13);g.fillRect(pL,y-hh/2,PW,hh);g.strokeStyle=rgba(c,.75);g.setLineDash([6,5]);g.lineWidth=1;g.beginPath();g.moveTo(pL,y-hh/2);g.lineTo(W-pR,y-hh/2);g.moveTo(pL,y+hh/2);g.lineTo(W-pR,y+hh/2);g.stroke();g.setLineDash([]);
    g.strokeStyle=c;g.lineWidth=1.5;g.beginPath();g.moveTo(pL,y);g.lineTo(W-pR,y);g.stroke();
    if(!K){g.font=`600 10px "IBM Plex Mono",monospace`;const txt=`${tag} ZONE · ${z.touches}×`,tw=g.measureText(txt).width;g.fillStyle=rgba(HEX.bg,.85);g.strokeStyle=rgba(c,.6);
      roundRect(g,pL+8,y-hh/2-20,tw+24,18,9);g.fill();g.stroke();g.fillStyle=c;g.beginPath();g.arc(pL+17,y-hh/2-11,3,0,7);g.fill();g.textAlign="left";g.fillText(txt,pL+25,y-hh/2-11);g.font=`11px "IBM Plex Mono",monospace`}
    return y};
  const tags=[];if(ov.zones){src.zone.sellers.forEach(z=>{const y=zoneBand(z,HEX.red,"SELLER");if(y!=null)tags.push([y,z.level,HEX.red])});src.zone.buyers.forEach(z=>{const y=zoneBand(z,HEX.green,"BUYER");if(y!=null)tags.push([y,z.level,HEX.green])})}
  // price
  if(o.type==="line"){g.beginPath();let f=true;for(let i=i0;i<=i1;i++){const x=X(i),y=Y(b[i].c);f?(g.moveTo(x,y),f=false):g.lineTo(x,y)}
    const path=new Path2D();path.moveTo(X(i0),pB);for(let i=i0;i<=i1;i++)path.lineTo(X(i),Y(b[i].c));path.lineTo(X(i1),pB);path.closePath();
    const ag=g.createLinearGradient(0,top,0,pB);ag.addColorStop(0,rgba(HEX.text,.16));ag.addColorStop(1,rgba(HEX.text,0));g.fillStyle=ag;g.fill(path);
    g.strokeStyle=HEX.text;g.lineWidth=K?1.5:2;g.lineJoin="round";g.stroke()}
  else for(let i=i0;i<=i1;i++){const k=b[i],x=X(i),up=k.c>=k.o,c=up?HEX.green:HEX.red;g.strokeStyle=c;g.fillStyle=c;g.lineWidth=1;
    g.beginPath();g.moveTo(Math.round(x)+.5,Y(k.h));g.lineTo(Math.round(x)+.5,Y(k.l));g.stroke();
    if(bw>=3){const yo=Y(k.o),yc=Y(k.c),bwid=Math.max(1,bw*.66);up?(g.fillStyle=rgba(c,.9)):(g.fillStyle=c);g.fillRect(x-bwid/2,Math.min(yo,yc),bwid,Math.max(1,Math.abs(yc-yo)))}}
  const line=(arr,c)=>{g.strokeStyle=c;g.lineWidth=1.4;g.beginPath();let f=true;for(let i=i0;i<=i1;i++){const v=arr[i];if(isNaN(v))continue;f?(g.moveTo(X(i),Y(v)),f=false):g.lineTo(X(i),Y(v))}g.stroke()};
  if(ov.sma20)line(src.sma20,"#7aa7ff");if(ov.sma50)line(src.sma50,"#b58cff");
  if(ov.div&&src.div){const d=src.div,c=d.type==="bull"?HEX.green:HEX.red;g.strokeStyle=c;g.lineWidth=2.2;g.setLineDash([]);
    g.beginPath();g.moveTo(X(d.a.i),Y(d.a.p));g.lineTo(X(d.b.i),Y(d.b.p));g.stroke();g.beginPath();g.moveTo(X(d.a.i),YH(d.a.h));g.lineTo(X(d.b.i),YH(d.b.h));g.stroke();
    for(const p of[d.a,d.b]){g.fillStyle=HEX.bg;g.lineWidth=2;g.beginPath();g.arc(X(p.i),Y(p.p),4.5,0,7);g.fill();g.stroke();g.beginPath();g.arc(X(p.i),YH(p.h),4,0,7);g.fill();g.stroke()}
    if(!K){g.fillStyle=c;g.textAlign="center";g.font=`600 10px "IBM Plex Mono",monospace`;g.fillText(d.type==="bull"?"BULLISH DIVERGENCE":"BEARISH DIVERGENCE",X(d.b.i),d.type==="bull"?Y(d.b.p)+18:Y(d.b.p)-16);g.font=`11px "IBM Plex Mono",monospace`}}
  // HCI pane
  g.fillStyle=rgba(HEX.red,.09);g.fillRect(pL,YH(5),PW,YH(CFG.hi)-YH(5));g.fillStyle=rgba(HEX.green,.09);g.fillRect(pL,YH(CFG.lo),PW,YH(-5)-YH(CFG.lo));
  g.strokeStyle="rgba(255,255,255,.12)";g.setLineDash([3,4]);g.lineWidth=1;[0,CFG.hi,CFG.lo].forEach(v=>{g.beginPath();g.moveTo(pL,YH(v));g.lineTo(W-pR,YH(v));g.stroke()});g.setLineDash([]);
  const hg=g.createLinearGradient(0,hT,0,hB);hg.addColorStop(0,HEX.red);hg.addColorStop(.28,HEX.orange);hg.addColorStop(.5,HEX.gold);hg.addColorStop(.72,HEX.lime);hg.addColorStop(1,HEX.green);
  g.strokeStyle=hg;g.lineWidth=K?1.6:2;g.lineJoin="round";g.beginPath();let f=true;for(let i=i0;i<=i1;i++){const h=src.hci[i];if(isNaN(h))continue;f?(g.moveTo(X(i),YH(h)),f=false):g.lineTo(X(i),YH(h))}g.stroke();
  g.restore();
  const lh=src.hci[n-1];if(i1===n-1){g.fillStyle=hciHue(lh);g.beginPath();g.arc(X(n-1),YH(lh),K?3:4.5,0,7);g.fill();g.strokeStyle=HEX.bg;g.lineWidth=2;g.stroke()}
  if(!K){g.fillStyle=HEX.muted;g.textAlign="left";g.font=`600 10px "IBM Plex Mono",monospace`;g.fillText("HCI",pL+8,hT+11);g.fillStyle=hciHue(lh);g.fillText(fmtH(lh),pL+36,hT+11);g.font=`11px "IBM Plex Mono",monospace`;
    g.fillStyle=HEX.muted;[[5,"+5"],[CFG.hi,fmtH(CFG.hi)],[0,"0"],[CFG.lo,fmtH(CFG.lo)],[-5,"−5"]].forEach(([v,t])=>g.fillText(t,W-pR+8,YH(v)));
    for(const[y,l,c]of tags){g.fillStyle=c;roundRect(g,W-pR+3,y-9,pR-6,18,4);g.fill();g.fillStyle=HEX.bg;g.fillText(fmtP(l),W-pR+8,y)}
    const lc=b[n-1].c,ly=Y(lc);if(ly>top&&ly<pB){g.strokeStyle=rgba(HEX.gold,.6);g.setLineDash([2,3]);g.beginPath();g.moveTo(pL,ly);g.lineTo(W-pR,ly);g.stroke();g.setLineDash([]);
      g.fillStyle=HEX.gold;roundRect(g,W-pR+3,ly-10,pR-6,20,4);g.fill();g.fillStyle=HEX.bg;g.font=`600 11px "IBM Plex Mono",monospace`;g.fillText(fmtP(lc),W-pR+8,ly);g.font=`11px "IBM Plex Mono",monospace`}}
  let idx=null;if(o.hover&&o.hover.x>pL&&o.hover.x<W-pR){idx=clamp(Math.floor((o.hover.x-pL)/bw+start),i0,i1);const x=Math.round(X(idx))+.5;
    g.strokeStyle="rgba(245,243,236,.35)";g.setLineDash([3,3]);g.lineWidth=1;g.beginPath();g.moveTo(x,top);g.lineTo(x,hB);g.stroke();
    const hy=o.hover.y;if(hy>top&&hy<pB){g.beginPath();g.moveTo(pL,hy);g.lineTo(W-pR,hy);g.stroke();g.setLineDash([]);const v=hi-(hy-top)/(pB-top)*(hi-lo);g.fillStyle=HEX.card3;roundRect(g,W-pR+3,hy-10,pR-6,20,4);g.fill();g.fillStyle=HEX.text;g.textAlign="left";g.fillText(fmtP(v),W-pR+8,hy)}
    g.setLineDash([]);const ds=src.dates[idx].toLocaleDateString(undefined,{month:"short",day:"numeric",year:"2-digit"}),tw=g.measureText(ds).width+16;g.fillStyle=HEX.card3;roundRect(g,x-tw/2,H-axH+3,tw,20,4);g.fill();g.fillStyle=HEX.text;g.textAlign="center";g.fillText(ds,x,H-axH+13);
    g.fillStyle=HEX.text;g.beginPath();g.arc(x,YH(src.hci[idx]),3.5,0,7);g.fill()}
  return{idx,bw,pL,pR}}
function roundRect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
// chart interaction
let drag=null;
function clampView(){const n=chartSrc().bars.length,v=S.chart.v;v.count=clamp(v.count,15,n+5);v.end=clamp(v.end,v.count*.25,n+Math.min(40,v.count*.4))}
chCv.addEventListener("pointerdown",e=>{drag={x:e.clientX,end:S.chart.v.end};chCv.setPointerCapture(e.pointerId)});
chCv.addEventListener("pointermove",e=>{const r=chCv.getBoundingClientRect();S.chart.hover={x:e.clientX-r.left,y:e.clientY-r.top};
  if(drag&&chInfo){S.chart.v.end=drag.end-(e.clientX-drag.x)/chInfo.bw;clampView()}drawMain()});
chCv.addEventListener("pointerup",()=>drag=null);chCv.addEventListener("pointercancel",()=>drag=null);
chCv.addEventListener("pointerleave",()=>{if(!drag){S.chart.hover=null;drawMain()}});
chCv.addEventListener("wheel",e=>{e.preventDefault();if(!chInfo)return;const v=S.chart.v,r=chCv.getBoundingClientRect(),fx=clamp((e.clientX-r.left-chInfo.pL)/(r.width-chInfo.pL-chInfo.pR),0,1);
  const start=v.end-v.count,anchor=start+fx*v.count,nc=v.count*(e.deltaY>0?1.12:1/1.12);v.count=nc;v.end=anchor+(1-fx)*nc;clampView();drawMain();syncRangeBtns()},{passive:false});
chCv.addEventListener("dblclick",()=>{resetView();enterChart()});
function syncRangeBtns(){$("chRange").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",Math.round(S.chart.v.count)===+b.dataset.v))}
function stepTicker(d){const L=S.scr.list.length?S.scr.list:ASSETS.map(s=>s.tk);let i=L.indexOf(S.chart.tk);S.chart.tk=L[(i+d+L.length)%L.length];resetView(S.chart.v?.count);enterChart()}
function openChart(tk){S.chart.tk=tk;resetView(S.chart.v?.count);closeDrawer();go("chart")}

/* ---------- drawer ---------- */
function openDrawer(tk){S.drawer=tk;S.scr.sel=tk;$("scrim").hidden=false;$("drawer").classList.add("open");renderDrawer();if(S.view==="screener")renderRows();setTimeout(()=>$("drawer").querySelector("[data-act=close-drawer]")?.focus(),50)}
function closeDrawer(){if(!S.drawer)return;S.drawer=null;$("drawer").classList.remove("open");$("scrim").hidden=true}
function renderDrawer(){const s=BY[S.drawer];if(!s)return;const z=s.zone,g=s.golden,st=s.setup,wl=activeList(),inW=wl?.tks.includes(s.tk);
  const ck=(ok,t)=>`<div><i class="${ok?"up":"mut"}">${ok?"✓":"·"}</i><span class="${ok?"":"mut"}">${t}</span></div>`;
  const side=st.side==="bear"?"bear":"bull";
  const db=$("drawer").querySelector(".db"),sc=db?db.scrollTop:0;
  $("drawer").innerHTML=`<div class="dh"><div style="flex:1;min-width:0"><div class="kicker">${s.sector}${s.themes.length?" · "+s.themes.join(" · "):""}</div>
      <div class="row" style="align-items:baseline;margin-top:6px"><span class="big">${s.tk}</span><span class="mono" style="font-size:20px">${fmtP(s.price)}</span><span class="mono ${pc(s.chg)}">${fmtPct(s.chg)}</span></div>
      <div class="mut">${esc(s.name)}${s.rank?` · #${s.rank}`:""} · ${fmtCap(s.capNow)}</div></div>
      <button class="iconbtn" data-act="close-drawer" aria-label="Close">✕</button></div>
    <div class="db">
      <div class="row"><button class="btn gold" data-act="chart" data-tk="${s.tk}">Open full chart + toolkit</button><button class="btn" data-act="watch" data-tk="${s.tk}">${inW?"★ Watching":"☆ Watch"}</button><button class="btn" data-act="alert" data-tk="${s.tk}">Set alert</button><button class="btn" data-act="cmp" data-tk="${s.tk}">${S.cmp.has(s.tk)?"✓ Comparing":"+ Compare"}</button></div>
      <canvas id="dCv" aria-label="${s.tk} chart with toolkit overlays"></canvas>
      <div class="perf">${[["1D",s.chg],["1W",s.chgW],["1M",s.chgM],["3M",s.chg3M]].map(([l,v])=>`<div><span>${l}</span><b class="mono ${pc(v)}">${fmtPct(v)}</b></div>`).join("")}</div>
      <div class="card" style="padding:14px"><div class="ct">Hill Conviction Index</div><div class="row" style="justify-content:space-between"><span class="big" style="font-size:38px;color:${hciHue(s.h)}">${fmtH(s.h)}</span><span class="pill" style="color:${hciHue(s.h)};border-color:currentColor"><i></i>${hciWord(s.h)}</span></div>
        <div style="position:relative;height:10px;border-radius:5px;background:var(--grad)"><b style="position:absolute;top:50%;left:${(s.h+5)*10}%;width:18px;height:18px;border-radius:50%;background:#0b0b10;border:3px solid var(--text);transform:translate(-50%,-50%)"></b></div>
        <div class="row mono" style="justify-content:space-between;font-size:11px;color:var(--muted)"><span>−5 too low</span><span>0</span><span>+5 too high</span></div></div>
      <div class="card" style="padding:14px"><div class="ct" style="--c:${side==="bull"?HEX.green:HEX.red}">Confluence checklist · ${side==="bull"?"bullish":"bearish"} ${st[side]}/5</div><div class="checks">
        ${side==="bull"?ck(s.h<=CFG.lo,`HCI too low (${fmtH(s.h)}) <span class="mut">· 2 pts</span>`)+ck(s.h<0&&s.h>CFG.lo,"HCI below zero <span class='mut'>· 1 pt</span>")+ck(z.status==="buyer",`In a buyer zone${z.status==="buyer"?` at ${fmtP(z.near.level)} (${z.near.touches}×)`:""}`)+ck(s.div?.type==="bull","Bullish divergence")+ck(g.inZone&&g.dir==="bull","Pulled back into the golden zone")
        :ck(s.h>=CFG.hi,`HCI too high (${fmtH(s.h)}) <span class="mut">· 2 pts</span>`)+ck(s.h>0&&s.h<CFG.hi,"HCI above zero <span class='mut'>· 1 pt</span>")+ck(z.status==="seller",`In a seller zone${z.status==="seller"?` at ${fmtP(z.near.level)} (${z.near.touches}×)`:""}`)+ck(s.div?.type==="bear","Bearish divergence")+ck(g.inZone&&g.dir==="bear","Bounced into the golden zone")}</div></div>
      <div class="card" style="padding:14px"><div class="ct">Hill Zones</div><div class="lvl">
        ${z.sellers.slice().reverse().map(x=>`<div><span class="dn">Seller · ${x.touches}×</span><span>${fmtP(x.level)}</span><span class="mut">${fmtPct((x.level/s.price-1)*100)}</span></div>`).join("")||`<div><span class="mut">No seller zone overhead</span><span></span><span></span></div>`}
        <div><span class="gold">Price</span><span class="gold">${fmtP(s.price)}</span><span></span></div>
        ${z.buyers.map(x=>`<div><span class="up">Buyer · ${x.touches}×</span><span>${fmtP(x.level)}</span><span class="mut">${fmtPct((x.level/s.price-1)*100)}</span></div>`).join("")||`<div><span class="mut">No buyer zone below</span><span></span><span></span></div>`}</div></div>
      <div class="card" style="padding:14px"><div class="ct">Golden Zone · Fibonacci</div><div class="lvl">${g.fibs.map(f=>`<div><span class="${f.f===.5||f.f===.618?"gold":"mut"}">${f.f.toFixed(3)}</span><span>${fmtP(f.p)}</span><span class="mut">${fmtPct((f.p/s.price-1)*100)}</span></div>`).join("")}</div>
        <p class="disclaimer" style="margin:0">${g.dir==="bull"?"Measured from the swing low up to the swing high. The gold band is the pullback buyers often defend.":"Measured from the swing high down to the swing low. The gold band is where rallies often stall."}</p></div>
      ${s.mk==="crypto"?cryptoDrawer(s):""}
      <div class="row"><a class="btn" href="${tvUrl(s)}" target="_blank" rel="noopener">Open on TradingView ↗</a><button class="btn ghost" data-act="screen-tk" data-tk="${s.tk}">Find in screener</button></div>
    </div>`;
  const ndb=$("drawer").querySelector(".db");if(ndb)ndb.scrollTop=sc;
  drawChart($("dCv"),s,{start:s.bars.length-90,end:s.bars.length+2,compact:true,ov:{zones:true,golden:true,heat:true,div:true},type:"candle"})}

/* ---------- compare ---------- */
const CMPC=[HEX.gold,"#63b3ff","#b38bff",HEX.text];
function toggleCmp(tk){if(S.cmp.has(tk))S.cmp.delete(tk);else{if(S.cmp.size>=4){toast("Compare holds 4 stocks","Remove one to add "+tk,null,HEX.orange);return}S.cmp.add(tk)}renderCmpBar();if(S.view==="screener")renderRows();if(S.view==="chart")renderChartSide();if(S.drawer)renderDrawer()}
function renderCmpBar(){const b=$("cmpBar");b.hidden=!S.cmp.size;b.innerHTML=`<span class="disclaimer" style="letter-spacing:.14em">COMPARE</span>${[...S.cmp].map((t,i)=>`<button class="chip" data-act="cmp" data-tk="${t}" style="--c:${CMPC[i]}"><i></i>${t} ✕</button>`).join("")}<button class="btn gold sm" data-act="cmp-open" ${S.cmp.size<2?"disabled style='opacity:.5'":""}>Compare ${S.cmp.size}</button><button class="btn ghost sm" data-act="cmp-clear">Clear</button>`}
function openCompare(){if(S.cmp.size<2){toast("Pick at least two stocks","Tick the box next to a stock in the screener.",null,HEX.orange);return}const m=$("cmpModal");$("scrim").hidden=false;m.hidden=false;
  m.innerHTML=`<div class="mh"><h3>Compare</h3><span class="mut">6-month performance and toolkit readings</span><div class="sp"></div><button class="iconbtn" data-act="close-modal" aria-label="Close">✕</button></div>
  <div class="mb"><div id="cmpLeg" class="row"></div><canvas id="cmpCv" style="width:100%;height:300px;display:block"></canvas><div class="tablewrap" style="max-height:none"><table style="min-width:640px"><thead><tr><th>Ticker</th><th class="num">Price</th><th class="num">6M</th><th>HCI</th><th>Hill zone</th><th>Divergence</th><th>Golden</th><th>Confluence</th></tr></thead><tbody id="cmpBody"></tbody></table></div></div>`;
  drawCompare()}
function drawCompare(){const cv=$("cmpCv");if(!cv)return;const tks=[...S.cmp],N=126,dpr=devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const ser=tks.map(t=>{const b=BY[t].bars,base=b[b.length-N].c;return b.slice(-N).map(x=>(x.c/base-1)*100)});let lo=Math.min(0,...ser.flat()),hi=Math.max(0,...ser.flat());const p=(hi-lo)*.08;lo-=p;hi+=p;
  const pL=8,pR=56,X=i=>pL+i/(N-1)*(W-pL-pR),Y=v=>10+(hi-v)/(hi-lo)*(H-30);g.font='11px "IBM Plex Mono",monospace';g.textBaseline="middle";
  const st=niceStep((hi-lo)/5);for(let v=Math.ceil(lo/st)*st;v<hi;v+=st){g.strokeStyle=v===0?"rgba(255,255,255,.25)":"rgba(255,255,255,.05)";g.beginPath();g.moveTo(pL,Y(v));g.lineTo(W-pR,Y(v));g.stroke();g.fillStyle=HEX.muted;g.fillText(`${v>0?"+":""}${v.toFixed(0)}%`,W-pR+8,Y(v))}
  ser.forEach((a,k)=>{g.strokeStyle=CMPC[k];g.lineWidth=2;g.beginPath();a.forEach((v,i)=>i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)));g.stroke();g.fillStyle=CMPC[k];g.beginPath();g.arc(X(N-1),Y(a[N-1]),3.5,0,7);g.fill()});
  $("cmpLeg").innerHTML=tks.map((t,k)=>`<span class="chip" style="--c:${CMPC[k]}" aria-pressed="true"><i></i>${t} <span class="mono ${pc(ser[k][N-1])}">${fmtPct(ser[k][N-1])}</span></span>`).join("");
  $("cmpBody").innerHTML=tks.map((t,k)=>{const s=BY[t];return`<tr data-act="drawer" data-tk="${t}"><td><span class="tkb" style="color:${CMPC[k]}">${t}</span></td><td class="num mono">${fmtP(s.price)}</td><td class="num mono ${pc(ser[k][N-1])}">${fmtPct(ser[k][N-1])}</td><td>${hm(s.h)}</td><td>${zoneP(s)}</td><td>${divP(s)}</td><td>${goldP(s)}</td><td>${dots(s)}</td></tr>`}).join("")}

/* ---------- watchlists ---------- */
function toggleWatch(tk){const l=activeList();if(!l){toast("No watchlist","Create a list in Watchlists first.",null,HEX.orange);return}
  const i=l.tks.indexOf(tk);i>=0?l.tks.splice(i,1):l.tks.push(tk);saveLists();toast(i>=0?`Removed ${tk}`:`Added ${tk}`,`${i>=0?"from":"to"} ${l.name}`,null,HEX.gold);
  if(S.view==="screener")renderRows();if(S.view==="watch")enterWatch();if(S.view==="chart")renderChartSide();if(S.drawer)renderDrawer()}
function enterWatch(){const l=activeList();
  $("wlLists").innerHTML=S.lists.filter(x=>x.mk===S.mk).map(x=>`<button class="wl-item" data-act="wl-pick" data-id="${x.id}" aria-current="${x.id===l?.id}"><span>${esc(x.name)}</span><small>${x.tks.length}</small></button>`).join("")||`<p class="mut">No lists yet.</p>`;
  $("wlRename").value=l?l.name:"";$("wlRename").disabled=!l;renderWatchBody()}
function renderWatchBody(){const l=activeList();if(!l){$("wlBody").innerHTML=`<tr><td colspan="10" class="empty">Create a list to start tracking stocks.</td></tr>`;$("wlStats").innerHTML="";return}
  const m=l.tks.map(t=>BY[t]).filter(Boolean);
  if(m.length){const avg=m.reduce((a,s)=>a+s.h,0)/m.length,best=m.slice().sort((a,b)=>b.chg-a.chg)[0],worst=m.slice().sort((a,b)=>a.chg-b.chg)[0],day=m.reduce((a,s)=>a+s.chg,0)/m.length;
    $("wlStats").innerHTML=`<div class="stat"><span>Avg HCI</span><b style="color:${hciHue(avg)}">${fmtH(avg)}</b></div><div class="stat"><span>Avg move today</span><b class="${pc(day)}">${fmtPct(day)}</b></div>
      <div class="stat"><span>Best</span><b class="up">${best.tk} ${fmtPct(best.chg)}</b></div><div class="stat"><span>Worst</span><b class="dn">${worst.tk} ${fmtPct(worst.chg)}</b></div>
      <div class="stat"><span>Active signals</span><b>${m.filter(s=>s.zone.status!=="neutral"||s.div||s.golden.inZone).length}/${m.length}</b></div>`}else $("wlStats").innerHTML="";
  $("wlBody").innerHTML=m.length?m.map(s=>`<tr data-act="drawer" data-tk="${s.tk}"><td><div class="tkc"><span class="tk">${s.tk}</span><span class="nm">${esc(s.name)}</span></div></td><td>${spark(s.spark)}</td><td class="num mono">${fmtP(s.price)}</td><td class="num mono ${pc(s.chg)}">${fmtPct(s.chg)}</td><td>${hm(s.h)}</td><td>${zoneP(s)}</td><td>${divP(s)}</td><td>${goldP(s)}</td><td>${dots(s)}</td><td><button class="btn ghost sm" data-act="watch" data-tk="${s.tk}">Remove</button></td></tr>`).join("")
    :`<tr><td colspan="10" class="empty">This list is empty. Add a ticker above or star stocks in the screener.</td></tr>`}
$("wlNew").addEventListener("submit",e=>{e.preventDefault();const n=$("wlName").value.trim();if(!n)return;const id=Date.now();S.lists.push({id,name:n,mk:S.mk,tks:[]});S.listId=id;$("wlName").value="";saveLists();enterWatch();toast("List created",n,null,HEX.gold)});
$("wlRename").addEventListener("change",e=>{const l=activeList();if(l&&e.target.value.trim()){l.name=e.target.value.trim();saveLists();enterWatch()}});
$("wlAdd").addEventListener("submit",e=>{e.preventDefault();const t=$("wlAddTk").value.trim().toUpperCase(),l=activeList();if(!l)return;
  if(!BY[t]){toast("Ticker not found",`${t||"That ticker"} isn't in the terminal's universe yet.`,null,HEX.red);return}if(!l.tks.includes(t))l.tks.push(t);$("wlAddTk").value="";saveLists();enterWatch()});
let delArm=0;

/* ---------- alerts ---------- */
function enterAlerts(){
  $("alTk").innerHTML=ASSETS.slice().sort((a,b)=>a.tk.localeCompare(b.tk)).map(s=>`<option value="${s.tk}">${s.tk} · ${esc(s.name)}</option>`).join("");
  $("alType").innerHTML=Object.entries(AT).filter(([,a])=>!a.mk||a.mk===MK).map(([k,a])=>`<option value="${k}">${a.l(a.v==="price"?"price":a.v??"").replace("NaN","…")}</option>`).join("");
  if(pendingAlertTk)$("alTk").value=pendingAlertTk;pendingAlertTk=null;syncAlertVal();$("alSound").checked=CFG.sound;
  S.alerts.forEach(a=>a.seen=true);saveAlerts();renderBadges();renderAlertLists()}
let pendingAlertTk=null;
function syncAlertVal(){const a=AT[$("alType").value],s=BY[$("alTk").value];$("alVWrap").hidden=a.v==null;if(a.v!=null)$("alV").value=a.v==="price"?fmtP(s.price).replace(/,/g,""):a.v}
$("alType").addEventListener("change",syncAlertVal);$("alTk").addEventListener("change",syncAlertVal);
$("alSound").addEventListener("change",e=>{CFG.sound=e.target.checked;store.set("cfg",CFG);if(CFG.sound)beep()});
$("alForm").addEventListener("submit",e=>{e.preventDefault();const type=$("alType").value,a=AT[type],tk=$("alTk").value,v=a.v!=null?+$("alV").value:undefined;
  S.alerts.unshift({id:Date.now(),mk:MK,tk,type,v,note:$("alNote").value.trim(),on:true,armed:true,fired:null,seen:true});$("alNote").value="";saveAlerts();renderAlertLists();toast("Alert created",`${tk}: ${a.l(v)}`,null,HEX.gold);checkAlerts()});
function renderAlertLists(){$("alCount").textContent=`${S.alerts.filter(a=>a.on).length} on · ${S.alerts.length} total`;
  $("alList").innerHTML=S.alerts.length?S.alerts.map(a=>{const mk=a.mk||"stocks",s=MARKETS[mk]?.by[a.tk],now=s&&AT[a.type]&&AT[a.type].t(s,a.v);if(!AT[a.type])return"";return`<div class="al ${a.fired?"fired":""}">
    <label class="switch" title="Turn alert on or off"><input type="checkbox" data-al-on="${a.id}" ${a.on?"checked":""} aria-label="Alert on"><span></span></label>
    <span class="t"><span class="pill mk">${mk==="crypto"?"Crypto":"Stocks"}</span> <button data-act="drawer" data-tk="${a.tk}" data-mk="${mk}" class="tkb" style="color:var(--gold)">${a.tk}</button> ${AT[a.type].l(a.v)}</span>
    <button class="btn ghost sm" data-act="al-del" data-id="${a.id}">Delete</button>
    <small>${a.note?esc(a.note)+" · ":""}${now?`<span class="gold">condition true now</span>`:"waiting"}${a.fired?` · last fired ${new Date(a.fired).toLocaleTimeString()}`:""}</small></div>`}).join("")
    :`<p class="mut">No alerts yet. Create one on the left, or press “Set alert” on any stock.</p>`;
  $("alHist").innerHTML=S.hist.length?S.hist.slice(0,80).map(h=>`<div><span class="mono mut">${new Date(h.t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span><span><button class="tkb" data-act="drawer" data-tk="${h.tk}" data-mk="${h.mk||"stocks"}" style="color:var(--gold)">${h.tk}</button> ${esc(h.text)}</span></div>`).join("")
    :`<p class="mut">Fired alerts will be logged here with the time they triggered.</p>`}
$("alList").addEventListener("change",e=>{const id=e.target.dataset.alOn;if(!id)return;const a=S.alerts.find(x=>x.id==id);a.on=e.target.checked;a.armed=true;saveAlerts();renderAlertLists()});
function checkAlerts(){let ch=false;for(const a of S.alerts){const mk=a.mk||"stocks",s=MARKETS[mk]?.by[a.tk];if(!s||!a.on||!AT[a.type])continue;const hit=AT[a.type].t(s,a.v);
  if(hit&&a.armed){a.armed=false;a.fired=Date.now();a.seen=S.view==="alerts";ch=true;const txt=`${AT[a.type].l(a.v)} · ${fmtP(s.price)}`;S.hist.unshift({t:Date.now(),tk:a.tk,mk,text:txt});
    toast(`🔔 ${a.tk} alert`,txt+(a.note?` · ${a.note}`:""),{l:"View",act:()=>{if(mk!==MK)switchMarket(mk);openDrawer(a.tk)}},HEX.gold);beep()}
  else if(!hit&&!a.armed){a.armed=true;ch=true}}
  if(ch){saveAlerts();renderBadges();if(S.view==="alerts")renderAlertLists()}}
let actx=null;function beep(force){if(!CFG.sound&&!force)return;try{actx=actx||new(window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime;
  [[880,0],[1320,.12]].forEach(([f,d])=>{const o=actx.createOscillator(),g=actx.createGain();o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(.12,t+d+.02);g.gain.exponentialRampToValueAtTime(.001,t+d+.25);o.connect(g).connect(actx.destination);o.start(t+d);o.stop(t+d+.3)})}catch{}}

/* ---------- live signal feed ---------- */
const snap=s=>({band:s.h<=CFG.lo?"low":s.h>=CFG.hi?"high":"mid",zone:s.zone.status,div:s.div?.type||null,gold:s.golden.inZone});
function diffEvents(s,p){const n=snap(s),ev=[];
  if(n.band!==p.band&&n.band!=="mid")ev.push({text:`HCI hit ${n.band==="low"?"too low":"too high"} (${fmtH(s.h)})`,side:n.band==="low"?"bull":"bear"});
  if(n.zone!==p.zone&&n.zone!=="neutral")ev.push({text:`Entered ${n.zone} zone at ${fmtP(s.zone.near.level)}`,side:n.zone==="buyer"?"bull":"bear"});
  if(n.div&&n.div!==p.div)ev.push({text:`${n.div==="bull"?"Bullish":"Bearish"} divergence printed`,side:n.div});
  if(n.gold&&!p.gold)ev.push({text:`Moved into the golden zone`,side:"gold"});
  ev.forEach(e=>pushEvent({...e,tk:s.tk,mk:s.mk,t:Date.now()}))}
function pushEvent(e){const f=S.feedBy[e.mk];f.unshift(e);f.length=Math.min(f.length,150);S.unreadBy[e.mk]++;if(!$("bell").hidden&&e.mk===MK)renderBell()}
function seedFeed(mk){const now=Date.now(),ev=[],add=(s,text,side)=>ev.push({tk:s.tk,mk,text,side,t:now,seed:true});
  MARKETS[mk].items.slice().sort((a,b)=>b.capNow-a.capNow).forEach(s=>{if(s.h<=CFG.lo)add(s,`HCI is too low (${fmtH(s.h)})`,"bull");if(s.h>=CFG.hi)add(s,`HCI is too high (${fmtH(s.h)})`,"bear");
  if(s.zone.status!=="neutral")add(s,`In a ${s.zone.status} zone near ${fmtP(s.zone.near.level)}`,s.zone.status==="buyer"?"bull":"bear");
  if(s.div)add(s,`${s.div.type==="bull"?"Bullish":"Bearish"} divergence active`,s.div.type);if(s.golden.inZone)add(s,"Inside the golden zone","gold")});
  S.feedBy[mk]=ev;S.unreadBy[mk]=0;feedSeen=now}
function renderBell(){$("bell").innerHTML=`<div class="ct" style="margin-bottom:8px">Signal notifications<span class="sp"></span><button data-act="bell-read">Mark all read</button></div><div class="feed" style="max-height:none" id="bellFeed"></div>`;renderFeed($("bellFeed"),40)}

/* ---------- live data (websocket) ---------- */
let pendingRefresh=false,refreshTimer=null;
function scheduleRefresh(mk){if(mk&&mk!==MK&&$("landing").hidden)return;if(!S.live){pendingRefresh=true;return}if(refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;refresh()},250)}
function applyQuotes(mk,list){const M=MARKETS[mk];for(const q of list){const s=M.by[q.tk];if(!s)continue;const prev=snap(s);s.quote=q.quote;
    if(q.bar){const L=s.bars[s.bars.length-1];if(L.d===q.bar.d)Object.assign(L,q.bar);else if(q.bar.d>L.d)s.bars.push({...q.bar})}
    calc(s);diffEvents(s,prev)}
  M.lastAt=Date.now();checkAlerts();scheduleRefresh(mk)}
function applyHistory(mk,{tk,bars}){const s=MARKETS[mk].by[tk];if(!s)return;s.bars=unpack(bars);calc(s);scheduleRefresh(mk)}
function applyMeta(mk,list){for(const m of list){const s=MARKETS[mk].by[m.tk];if(!s)continue;const{tk,...rest}=m;Object.assign(s,rest);s.capNow=s.shares?s.shares*s.price/1e9:s.capB}scheduleRefresh(mk)}
let fallbackTimer=null,fallbackBusy=false;
async function pollLiveSnapshot(){
  if(fallbackBusy)return;fallbackBusy=true;
  try{
    const updates=await Promise.all(Object.keys(MARKETS).map(async mk=>{
      const data=await getJSON(mk==="crypto"?"/api/crypto/bootstrap":"/api/bootstrap");return {mk,data};
    }));
    if(!fallbackTimer)return;
    for(const {mk,data} of updates){const M=MARKETS[mk];M.status=data.status;if(mk===MK)STATUS=data.status;
      const quotes=[];
      for(const item of data.stocks||data.coins){const s=M.by[item.tk];if(!s)continue;const {bars,...meta}=item;Object.assign(s,meta);s.bars=unpack(bars);quotes.push({tk:s.tk,quote:s.quote,bar:s.bars.at(-1)});}
      applyQuotes(mk,quotes);M.lastAt=data.status.lastQuoteAt||null;
      if(mk==="crypto"){applyDeriv(data.deriv||[]);M.research=data.research;M.liqSince=data.liqSince;applyWhales(data.whales||[]);}
    }
    checkAlerts();CONN.state="polling";renderSource();scheduleRefresh();
  }catch(e){CONN.state="reconnecting";renderSource();}
  finally{fallbackBusy=false;}
}
function startPollingFallback(){if(fallbackTimer)return;fallbackTimer=setInterval(pollLiveSnapshot,10000);pollLiveSnapshot();}
function connectWS(){CONN.state=fallbackTimer?CONN.state:CONN.retry?"reconnecting":"connecting";renderSource();
  const ws=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws`);
  ws.onopen=()=>{clearInterval(fallbackTimer);fallbackTimer=null;CONN.state="connected";CONN.retry=0;renderSource()};
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}const mk=m.market||"stocks",M=MARKETS[mk];if(!M)return;
    switch(m.type){
      case"quotes":applyQuotes(mk,m.data);break;
      case"history":applyHistory(mk,m.data);break;
      case"meta":applyMeta(mk,m.data);break;
      case"deriv":applyDeriv(m.data.coins);M.liqSince=m.data.liqSince;checkAlerts();scheduleRefresh(mk);break;
      case"whales":applyWhales(m.data);break;
      case"research":M.research[m.data.key]=m.data.data;scheduleRefresh(mk);break;
      case"status":M.status=m.data;if(mk===MK)STATUS=m.data;if(m.data.lastQuoteAt)M.lastAt=Math.max(M.lastAt||0,m.data.lastQuoteAt);if(mk===MK){renderSource();marketClock()}break}};
  ws.onclose=async()=>{const check=await fetch("/api/auth/me").catch(()=>null);if(check&&!check.ok){location.replace("/login.html");return}if(!fallbackTimer)CONN.state="reconnecting";renderSource();startPollingFallback();setTimeout(connectWS,Math.min(15000,1000*2**CONN.retry++))}}

/* =====================================================================
   CRYPTO MODULE — derivatives, whales, DeFi & DEX, coin drawer
   ===================================================================== */
const fundCls=f=>f==null?"mut":f>=3e-4?"dn":f<0?"up":"";
const fundCell=s=>s.deriv?.funding!=null?`<span class="${fundCls(s.deriv.funding)}">${fmtFund(s.deriv.funding)}</span>`:`<span class="mut">—</span>`;
const tvUrl=s=>`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s.mk==="crypto"?`BINANCE:${s.pair}`:s.tk)}`;
const coinCell=s=>`<div class="coin">${s.image?`<img src="${esc(s.image)}" alt="" loading="lazy">`:`<i></i>`}<div class="tkc"><span class="tk">${s.tk}</span><span class="nm">${esc(s.name)}${s.rank?` · #${s.rank}`:""}</span></div></div>`;
const stat=(l,v,cls="")=>`<div class="stat"><span>${l}</span><b class="${cls}">${v}</b></div>`;
const loading=()=>`<p class="mut">Loading…</p>`;
const ageOf=iso=>{const h=(Date.now()-Date.parse(iso))/3600e3;return h<1?`${Math.max(1,Math.round(h*60))}m`:h<48?`${Math.round(h)}h`:`${Math.round(h/24)}d`};

function applyDeriv(list){const M=MARKETS.crypto;if(!M)return;for(const d of list){const s=M.by[d.tk];if(s)s.deriv=d}}
function applyWhales(list){const M=MARKETS.crypto;if(!M)return;
  const seen=new Set(M.whales.slice(0,100).map(x=>x.id));
  for(const w of list){if(seen.has(w.id))continue;M.whales.unshift(w);const s=M.by[w.sym];if(!s)continue;s.lastWhaleAt=Math.max(s.lastWhaleAt||0,w.ts);
    if(w.usd>=2e6)pushEvent({tk:w.sym,mk:"crypto",t:Date.now(),text:whaleText(w,true),
      side:w.kind==="trade"?(w.side==="buy"?"bull":"bear"):w.kind==="liquidation"?(w.side==="long"?"bear":"bull"):"gold"})}
  if(M.whales.length>400)M.whales.length=400;
  checkAlerts();scheduleRefresh("crypto")}
function whaleText(w,short){const amt=fmtUsd(w.usd);
  if(w.kind==="trade")return`${w.side==="buy"?"Bought":"Sold"} ${amt} of ${w.sym}${short?"":` at ${fmtP(w.price)}`} on ${w.venue}`;
  if(w.kind==="liquidation")return`${w.side==="long"?"Long":"Short"} liquidated: ${amt} ${w.sym}${short?"":` at ${fmtP(w.price)}`} on ${w.venue}`;
  return`${(w.amount||0).toLocaleString(undefined,{maximumFractionDigits:1})} BTC (${amt}) moved on-chain`}
const whaleRow=w=>{const[k,c]=w.kind==="trade"?(w.side==="buy"?["BUY",HEX.green]:["SELL",HEX.red]):w.kind==="liquidation"?["LIQ",HEX.orange]:["CHAIN",HEX.gold];
  return`<div class="whrow" role="button" tabindex="0" data-act="drawer" data-tk="${w.sym}" data-mk="crypto" style="--c:${c}"><span class="whk">${k}</span><span class="tkb">${w.sym}</span><span class="wht">${esc(whaleText(w))}</span><span class="mono whu">${fmtUsd(w.usd)}</span><small>${w.link?`<a href="${esc(w.link)}" target="_blank" rel="noopener" data-act="noop">tx ↗</a> · `:""}${ago(w.ts)}</small></div>`};

/* ---------- crypto overview cards ---------- */
function renderCryptoOverview(){const M=MARKETS.crypto,R=M.research,g=R.global,f=R.fng,rows=ASSETS.filter(s=>s.deriv?.funding!=null);
  const capT=g?.capT??ASSETS.reduce((a,s)=>a+(s.capNow||0),0)/1000;
  $("ocGlobal").innerHTML=`<div class="row" style="align-items:baseline;gap:12px"><span class="big" style="font-size:40px">$${capT.toFixed(2)}T</span>${g?`<span class="mono ${pc(g.capChg24h)}">${fmtPct(g.capChg24h)} 24h</span>`:`<span class="mut">tracked coins only</span>`}</div>
    ${g?`<div><div class="lab"><span>BTC <b>${g.btcDom.toFixed(1)}%</b></span><span>ETH <b>${g.ethDom.toFixed(1)}%</b></span><span>Other <b>${(100-g.btcDom-g.ethDom).toFixed(1)}%</b></span></div><div class="split"><i style="width:${g.btcDom}%;background:${HEX.gold}"></i><i style="width:${g.ethDom}%;background:#8a92b2"></i><i style="width:${100-g.btcDom-g.ethDom}%;background:${HEX.card3}"></i></div></div>
    <dl class="kv"><dt>24h volume</dt><dd>$${g.volB.toFixed(0)}B</dd><dt>Coins listed worldwide</dt><dd>${g.coins.toLocaleString()}</dd></dl>`:`<p class="mut">Global data from CoinGecko is loading.</p>`}`;
  if(f?.length){const v=f.at(-1).value,cx=110,cy=110,r=86,a=Math.PI*(1-v/100),nx=cx+(r-18)*Math.cos(a),ny=cy-(r-18)*Math.sin(a);
    $("ocFng").innerHTML=`<svg viewBox="0 0 220 128" style="width:100%;max-width:300px;margin:0 auto;display:block" role="img" aria-label="Fear and Greed ${v}"><defs><linearGradient id="fgg" x1="0" x2="1"><stop offset="0" stop-color="${HEX.green}"/><stop offset=".5" stop-color="${HEX.gold}"/><stop offset="1" stop-color="${HEX.red}"/></linearGradient></defs>
      <path d="M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}" fill="none" stroke="url(#fgg)" stroke-width="12" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${HEX.text}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="7" fill="${HEX.bg}" stroke="${HEX.text}" stroke-width="3"/>
      <text x="${cx}" y="${cy-30}" text-anchor="middle" font-family="Anton" font-size="34" fill="${HEX.text}">${v}</text><text x="18" y="126" font-family="IBM Plex Mono" font-size="9" fill="${HEX.green}">FEAR</text><text x="202" y="126" text-anchor="end" font-family="IBM Plex Mono" font-size="9" fill="${HEX.red}">GREED</text></svg>
      <div class="state" style="text-align:center;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase">${esc(f.at(-1).label)}</div>
      <div class="row mut" style="justify-content:space-between"><span class="mono" style="font-size:11px">Last 30 days</span>${spark(f.map(x=>x.value),180,30)}</div>`}else $("ocFng").innerHTML=loading();
  const oi=rows.reduce((a,s)=>a+(s.deriv.oiUsd||0),0),wf=oi?rows.reduce((a,s)=>a+(s.deriv.oiUsd||0)*s.deriv.funding,0)/oi:0,L=rows.reduce((a,s)=>a+(s.deriv.liq?.long||0),0),Sh=rows.reduce((a,s)=>a+(s.deriv.liq?.short||0),0);
  const hot=rows.slice().sort((a,b)=>b.deriv.funding-a.deriv.funding),ext=hot.length>3?[...hot.slice(0,2),...hot.slice(-2).reverse()]:hot;
  $("ocDeriv").innerHTML=`<dl class="kv"><dt>Open interest</dt><dd>${fmtUsd(oi)}</dd><dt>OI-weighted funding</dt><dd class="${fundCls(wf)}">${fmtFund(wf)}</dd><dt>Liquidated longs / shorts</dt><dd><span class="dn">${fmtUsd(L)}</span> / <span class="up">${fmtUsd(Sh)}</span></dd></dl>
    <div class="mini-l">${ext.map(s=>`<button data-act="drawer" data-tk="${s.tk}"><span class="tkb">${s.tk}</span><span class="mut" style="font-size:12px">${s.deriv.funding>=0?"longs paying":"shorts paying"}</span><span class="mono ${fundCls(s.deriv.funding)}">${fmtFund(s.deriv.funding)}</span></button>`).join("")||loading()}</div>
    <button class="btn sm" data-act="view" data-view="deriv">Open derivatives →</button>`;
  $("ocWhales").innerHTML=`<div class="whfeed">${M.whales.slice(0,6).map(whaleRow).join("")||`<p class="mut">Waiting for the first whale print. Large trades stream in live.</p>`}</div><button class="btn sm" data-act="view" data-view="whales">Open whale tracker →</button>`;
  const d=R.defi,st=R.stables,dx=R.dex;
  $("ocDefi").innerHTML=`<dl class="kv"><dt>DeFi TVL</dt><dd>${d?`$${d.totalB.toFixed(1)}B <span class="${pc(d.chg1d)}">${fmtPct(d.chg1d)}</span>`:"—"}</dd><dt>Stablecoin supply</dt><dd>${st?`$${st.totalB.toFixed(1)}B <span class="${pc(st.chg7d)}">${fmtPct(st.chg7d)} 7d</span>`:"—"}</dd>
    <dt>DEX volume 24h</dt><dd>${dx?`$${dx.total24hB.toFixed(2)}B`:"—"}</dd><dt>Largest chain</dt><dd>${d?`${esc(d.top[0].name)} · $${d.top[0].tvlB.toFixed(1)}B`:"—"}</dd></dl>
    <button class="btn sm" data-act="view" data-view="defi">Open DeFi &amp; DEX →</button>`}

/* ---------- derivatives view ---------- */
function renderDeriv(){const M=MARKETS.crypto,rows=ASSETS.filter(s=>s.deriv?.funding!=null);
  const oi=rows.reduce((a,s)=>a+(s.deriv.oiUsd||0),0),wf=oi?rows.reduce((a,s)=>a+(s.deriv.oiUsd||0)*s.deriv.funding,0)/oi:0;
  const L=rows.reduce((a,s)=>a+(s.deriv.liq?.long||0),0),Sh=rows.reduce((a,s)=>a+(s.deriv.liq?.short||0),0);
  const since=M.liqSince&&Date.now()-M.liqSince<864e5-6e4?`since ${new Date(M.liqSince).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"24h";
  $("dvSub").textContent=`${rows.length} perpetual futures · ${M.status.derivatives?.source||"loading"} · funding refreshes every minute, open interest every 5 minutes`;
  $("dvStats").innerHTML=stat("Open interest",fmtUsd(oi))+stat("OI-weighted funding",fmtFund(wf),fundCls(wf))+stat("Funding ≥ 0.03%",rows.filter(s=>s.deriv.funding>=3e-4).length,"dn")+stat("Negative funding",rows.filter(s=>s.deriv.funding<0).length,"up")+stat(`Longs liquidated · ${since}`,fmtUsd(L),"dn")+stat(`Shorts liquidated · ${since}`,fmtUsd(Sh),"up");
  const fs=rows.slice().sort((a,b)=>b.deriv.funding-a.deriv.funding),mx=Math.max(...fs.map(s=>Math.abs(s.deriv.funding)),1e-4);
  $("dvFund").innerHTML=fs.map(s=>{const f=s.deriv.funding;return`<button class="sbar w" data-act="drawer" data-tk="${s.tk}"><span>${s.tk}</span><span class="trk"><b style="${f<0?"right:50%":"left:50%"};width:${Math.abs(f)/mx*50}%;background:${f>=0?HEX.red:HEX.green}"></b></span><span class="mono ${fundCls(f)}" style="text-align:right">${fmtFund(f)}</span><span class="mono c4 mut" style="text-align:right">${(f*3*365*100).toFixed(1)}%</span></button>`}).join("")||loading();
  const top=rows.map(s=>({s,t:(s.deriv.liq?.long||0)+(s.deriv.liq?.short||0)})).filter(x=>x.t>0).sort((a,b)=>b.t-a.t).slice(0,8),big=M.whales.filter(w=>w.kind==="liquidation").slice(0,8);
  $("dvLiq").innerHTML=`<div class="lab2"><span>Longs <b class="dn">${fmtUsd(L)}</b></span><span>Shorts <b class="up">${fmtUsd(Sh)}</b></span></div><div class="split"><i style="width:${L/(L+Sh||1)*100}%;background:${HEX.red}"></i><i style="width:${Sh/(L+Sh||1)*100}%;background:${HEX.green}"></i></div>
    <div class="ct">Most liquidated</div><div class="mini-l">${top.map(x=>`<button data-act="drawer" data-tk="${x.s.tk}"><span class="tkb">${x.s.tk}</span><span class="mut" style="font-size:12px">longs ${fmtUsd(x.s.deriv.liq.long)} · shorts ${fmtUsd(x.s.deriv.liq.short)}</span><span class="mono">${fmtUsd(x.t)}</span></button>`).join("")||`<p class="mut">No liquidations recorded yet. They stream in live from Bybit.</p>`}</div>
    <div class="ct">Largest recent</div><div class="whfeed">${big.map(whaleRow).join("")||`<p class="mut">Liquidations over ${fmtUsd(M.status.whaleMinUsd?.liquidation||1e5)} will appear here.</p>`}</div>`;
  const D=S.dv,key={tk:s=>s.tk,price:s=>s.price,fund:s=>s.deriv.funding,oi:s=>s.deriv.oiUsd||0,oi24:s=>s.deriv.oiChg24h??-999,oi7:s=>s.deriv.oiChg7d??-999,ls:s=>s.deriv.ls?.ratio||0,liq:s=>(s.deriv.liq?.long||0)+(s.deriv.liq?.short||0),h:s=>s.h}[D.sort]||(s=>s.deriv.oiUsd||0);
  const T=rows.slice().sort((a,b)=>{const x=key(a),y=key(b);return(x<y?-1:x>y?1:0)*D.dir});
  $("dvHead").innerHTML=[["tk","Coin"],["price","Price"],["fund","Funding 8h"],["apr","APR"],["oi","Open interest"],["oi24","OI 24h"],["oi7","OI 7d"],["ls","Long / short"],["liq","Liquidations L / S"],["h","HCI"]]
    .map(([k,l])=>k==="apr"?`<th class="num">${l}</th>`:`<th class="${["tk","ls","h","oi7"].includes(k)?"":"num"}" ${D.sort===k?`aria-sort="${D.dir>0?"ascending":"descending"}"`:""}><button data-act="dv-sort" data-k="${k}">${l}${D.sort===k?(D.dir>0?" ▲":" ▼"):""}</button></th>`).join("");
  $("dvBody").innerHTML=T.map(s=>{const d=s.deriv,ls=d.ls;return`<tr data-act="drawer" data-tk="${s.tk}"><td>${coinCell(s)}</td><td class="num mono">${fmtP(s.price)}</td><td class="num mono">${fundCell(s)}</td><td class="num mono mut">${(d.funding*3*365*100).toFixed(1)}%</td><td class="num mono">${fmtUsd(d.oiUsd)}</td>
    <td class="num mono ${d.oiChg24h==null?"mut":pc(d.oiChg24h)}">${d.oiChg24h==null?"—":fmtPct(d.oiChg24h)}</td><td>${d.oiSeries?.length>2?spark(d.oiSeries,80,24):"—"} <span class="mono ${pc(d.oiChg7d||0)}" style="font-size:11px">${d.oiChg7d==null?"":fmtPct(d.oiChg7d)}</span></td>
    <td>${ls?`<span class="lsbar"><i style="width:${ls.long*100}%"></i></span> <span class="mono" style="font-size:11.5px">${(ls.long*100).toFixed(0)}% long · ${ls.ratio.toFixed(2)}</span>`:"—"}</td>
    <td class="num mono"><span class="dn">${fmtUsd(d.liq?.long||0)}</span> / <span class="up">${fmtUsd(d.liq?.short||0)}</span></td><td>${hm(s.h)}</td></tr>`}).join("")||`<tr><td colspan="10" class="empty">Derivatives data is loading.</td></tr>`}

/* ---------- whales view ---------- */
function renderWhales(){const M=MARKETS.crypto,W=S.wh,now=Date.now();
  const hr=M.whales.filter(w=>now-w.ts<3600e3),tr=hr.filter(w=>w.kind==="trade"),buy=tr.filter(w=>w.side==="buy").reduce((a,w)=>a+w.usd,0),sell=tr.filter(w=>w.side==="sell").reduce((a,w)=>a+w.usd,0);
  const lq=hr.filter(w=>w.kind==="liquidation").reduce((a,w)=>a+w.usd,0),oc=hr.filter(w=>w.kind==="onchain"),big=hr.reduce((m,w)=>w.usd>(m?.usd||0)?w:m,null);
  $("whStats").innerHTML=stat("Whale prints · 1h",tr.length)+stat("Whale buys · 1h",fmtUsd(buy),"up")+stat("Whale sells · 1h",fmtUsd(sell),"dn")+stat("Net flow · 1h",`${buy>=sell?"+":"−"}${fmtUsd(Math.abs(buy-sell))}`,pc(buy-sell))
    +stat("Liquidations · 1h",fmtUsd(lq),"gold")+stat("On-chain BTC · 1h",`${oc.reduce((a,w)=>a+(w.amount||0),0).toLocaleString(undefined,{maximumFractionDigits:0})} BTC`)+stat("Largest · 1h",big?`${big.sym} ${fmtUsd(big.usd)}`:"—");
  $("whKinds").innerHTML=[["all","All activity"],["trade","Exchange trades"],["liquidation","Liquidations"],["onchain","On-chain BTC"]].map(([k,l])=>`<button class="chip" data-act="wh-kind" data-v="${k}" aria-pressed="${W.kind===k}">${l} <span class="n">${k==="all"?M.whales.length:M.whales.filter(w=>w.kind===k).length}</span></button>`).join("");
  const list=M.whales.filter(w=>(W.kind==="all"||w.kind===W.kind)&&w.usd>=W.min&&(!W.coin||w.sym===W.coin)).slice(0,150);
  $("whFeed").innerHTML=list.map(whaleRow).join("")||`<div class="empty">No whale activity matches these filters yet. Large trades stream in live; in quiet markets the first prints can take a few minutes.</div>`;
  const flow={};for(const w of M.whales)if(w.kind==="trade"){const f=(flow[w.sym]||={b:0,s:0});f[w.side==="buy"?"b":"s"]+=w.usd}
  const fl=Object.entries(flow).map(([tk,f])=>({tk,n:f.b-f.s,t:f.b+f.s})).sort((a,b)=>b.n-a.n),mx=Math.max(...fl.map(x=>Math.abs(x.n)),1);
  $("whFlow").innerHTML=fl.map(x=>`<button class="sbar w" data-act="drawer" data-tk="${x.tk}"><span>${x.tk}</span><span class="trk"><b style="${x.n<0?"right:50%":"left:50%"};width:${Math.abs(x.n)/mx*50}%;background:${x.n>=0?HEX.green:HEX.red}"></b></span><span class="mono ${pc(x.n)}" style="text-align:right">${x.n>=0?"+":"−"}${fmtUsd(Math.abs(x.n))}</span><span class="mono c4 mut" style="text-align:right">${fmtUsd(x.t)}</span></button>`).join("")||`<p class="mut">Net whale flow builds up as large prints come in.</p>`;
  const t=M.status.whaleMinUsd||{};
  $("whHow").textContent=`Exchange trades: single prints of at least ${fmtUsd(t.majors)} (BTC, ETH) or ${fmtUsd(t.alts)} (other coins) on Binance spot and Bybit perpetuals, for the 10 largest coins. Liquidations: Bybit liquidations of at least ${fmtUsd(t.liquidation)}. On-chain: unconfirmed Bitcoin transactions moving at least ${t.onchainBtc} BTC (total outputs, which can include change sent back to the sender). The tracker keeps the latest 400 events since the server started.`;
  const sel=$("whCoin");if(sel.options.length<2)sel.innerHTML=`<option value="">All coins</option>`+ASSETS.map(s=>`<option value="${s.tk}">${s.tk}</option>`).join("")}

/* ---------- DeFi & DEX view ---------- */
const RESEARCH=[
  ["Market & spot",[["CoinGecko","https://www.coingecko.com","Independent prices, categories, exchange trust scores"],["CoinMarketCap","https://coinmarketcap.com","Liquidity, rankings and the DexScan pair scanner"],["CryptoRank","https://cryptorank.io","Fundraising rounds, token unlocks, launch performance"]]],
  ["Derivatives",[["CoinGlass","https://www.coinglass.com","Open interest, liquidation heatmaps, funding across exchanges"],["Coinalyze","https://coinalyze.net","Aggregated OI, CVD and liquidation spikes on charts"]]],
  ["On-chain & whales",[["Arkham","https://intel.arkm.com","Labelled entities, exchange reserves, whale transfers"],["Nansen","https://www.nansen.ai","Smart-money wallet flows on EVM chains and Solana"],["Glassnode","https://studio.glassnode.com","BTC and ETH on-chain macro: SOPR, MVRV, exchange flows"],["CryptoQuant","https://cryptoquant.com","Exchange inflows and outflows, miner reserves"]]],
  ["DeFi & tokenomics",[["DeFiLlama","https://defillama.com","TVL, protocol revenue, stablecoins, DEX volume"],["Tokenomist","https://tokenomist.ai","Unlock schedules and emission dilution"],["Token Terminal","https://tokenterminal.com","Protocols as businesses: revenue, P/S, active users"]]],
  ["DEX screeners",[["DEX Screener","https://dexscreener.com","Real-time charts for new and low-cap pairs"],["DEXTools","https://www.dextools.io","Pair explorer with contract audit scores"],["GeckoTerminal","https://www.geckoterminal.com","Trending pools across 100+ networks"]]],
  ["Deep research",[["Dune","https://dune.com","Community SQL dashboards for any protocol"],["Messari","https://messari.io","Institutional research and governance tracking"]]],
];
function barsList(items){const mx=Math.max(...items.map(i=>i.v),1e-9);return`<div class="blist">${items.map(i=>`<div><span>${esc(i.l)}</span><span class="trk"><b style="width:${i.v/mx*100}%"></b></span><span class="mono">${i.txt}</span>${i.sub!=null?`<span class="mono ${i.sub.startsWith("+")?"up":"dn"}">${i.sub}</span>`:"<span></span>"}</div>`).join("")}</div>`}
function areaChart(vals,ts,fmt){const W=560,H=200,lo=Math.min(...vals)*.995,hi=Math.max(...vals)*1.005,X=i=>i/(vals.length-1)*W,Y=v=>12+(hi-v)/(hi-lo)*(H-34);
  const pts=vals.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" "),c=vals.at(-1)>=vals[0]?HEX.green:HEX.red;
  return`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="30-day trend"><defs><linearGradient id="agr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    ${[0,.5,1].map(t=>{const v=lo+(hi-lo)*t;return`<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.06)"/><text x="4" y="${Y(v)-5}" font-family="IBM Plex Mono" font-size="11" fill="${HEX.muted}">${fmt(v)}</text>`}).join("")}
    <polygon points="0,${H-22} ${pts} ${W},${H-22}" fill="url(#agr)"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><circle cx="${X(vals.length-1)-4}" cy="${Y(vals.at(-1))}" r="4" fill="${c}"/>
    <text x="0" y="${H-4}" font-family="IBM Plex Mono" font-size="11" fill="${HEX.muted}">${new Date(ts[0]).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</text><text x="${W}" y="${H-4}" text-anchor="end" font-family="IBM Plex Mono" font-size="11" fill="${HEX.muted}">${new Date(ts.at(-1)).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</text></svg>`}
function renderDefi(){const R=MARKETS.crypto.research,f=R.fng?.at(-1),d=R.defi,st=R.stables,dx=R.dex;
  $("dfStats").innerHTML=stat("DeFi TVL",d?`$${d.totalB.toFixed(1)}B`:"—")+stat("TVL · 24h",d?fmtPct(d.chg1d):"—",d?pc(d.chg1d):"")+stat("Stablecoin supply",st?`$${st.totalB.toFixed(1)}B`:"—")+stat("Stablecoins · 7d",st?fmtPct(st.chg7d):"—",st?pc(st.chg7d):"")+stat("DEX volume · 24h",dx?`$${dx.total24hB.toFixed(2)}B`:"—")+stat("Fear & Greed",f?`${f.value} ${f.label}`:"—");
  $("dfTvl").innerHTML=d?areaChart(d.series.map(x=>x.b),d.series.map(x=>x.t),v=>`$${v.toFixed(0)}B`)+`<div class="row mono" style="gap:16px;font-size:12px"><span>7d <b class="${pc(d.chg7d)}">${fmtPct(d.chg7d)}</b></span><span>30d <b class="${pc(d.chg30d)}">${fmtPct(d.chg30d)}</b></span></div>`:loading();
  $("dfChains").innerHTML=d?barsList(d.top.map(c=>({l:c.name,v:c.tvlB,txt:`$${c.tvlB.toFixed(1)}B`}))):loading();
  $("dfStables").innerHTML=st?`<div class="row" style="align-items:baseline;gap:12px"><span class="big" style="font-size:34px">$${st.totalB.toFixed(1)}B</span><span class="mono ${pc(st.chg7d)}">${fmtPct(st.chg7d)} 7d</span><span class="mono ${pc(st.chg30d)}">${fmtPct(st.chg30d)} 30d</span></div>`+barsList(st.top.map(c=>({l:c.symbol,v:c.b,txt:`$${c.b.toFixed(1)}B`,sub:fmtPct(c.chg7d)})))+`<p class="disclaimer" style="margin:0">Rising stablecoin supply usually means new capital waiting on the sidelines.</p>`:loading();
  $("dfDex").innerHTML=dx?`<div class="row" style="align-items:baseline;gap:12px"><span class="big" style="font-size:34px">$${dx.total24hB.toFixed(2)}B</span>${dx.chg1d!=null?`<span class="mono ${pc(dx.chg1d)}">${fmtPct(dx.chg1d)} vs yesterday</span>`:""}</div>`+barsList(dx.top.map(p=>({l:p.name,v:p.b,txt:`$${p.b.toFixed(2)}B`}))):loading();
  $("dfPools").innerHTML=R.pools?.length?R.pools.map(p=>`<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener" class="tkb" style="color:var(--text);text-decoration:none">${esc(p.name)}</a></td><td><span class="pill">${esc(p.network)}</span></td><td class="num mono">${fmtP(p.priceUsd)}</td><td class="num mono ${pc(p.chg24h)}">${fmtPct(p.chg24h)}</td><td class="num mono">${fmtUsd(p.vol24h)}</td><td class="num mono">${fmtUsd(p.liquidity)}</td><td class="num mono mut">${p.created?ageOf(p.created):"—"}</td><td><a class="btn sm ghost" href="${esc(p.url)}" target="_blank" rel="noopener">Chart ↗</a></td></tr>`).join(""):`<tr><td colspan="8" class="empty">Loading trending pools…</td></tr>`;
  $("dfTrend").innerHTML=R.trending?.length?`<div>${R.trending.map(c=>`<a class="trow" href="${esc(c.url)}" target="_blank" rel="noopener">${c.thumb?`<img src="${esc(c.thumb)}" alt="">`:"<span></span>"}<span><b>${esc(c.symbol)}</b> <span class="mut">${esc(c.name)}</span></span><span class="mono mut">${c.rank?"#"+c.rank:""}</span><span class="mono ${pc(c.chg24h||0)}">${c.chg24h!=null?fmtPct(c.chg24h):""}</span></a>`).join("")}</div>`:loading();
  $("dfLinks").innerHTML=RESEARCH.map(([grp,items])=>`<div><div class="ct">${grp}</div>${items.map(([n,u,dsc])=>`<a class="rlink" href="${u}" target="_blank" rel="noopener"><b>${n} ↗</b><span>${dsc}</span></a>`).join("")}</div>`).join("")}

/* ---------- coin drawer extras ---------- */
function cryptoDrawer(s){const d=s.deriv||{},ls=d.ls,wh=MARKETS.crypto.whales.filter(w=>w.sym===s.tk).slice(0,5),nf=d.nextFunding?Math.max(0,d.nextFunding-Date.now()):null,num=v=>v?v.toLocaleString(undefined,{maximumFractionDigits:0}):"—";
  return`<div class="card" style="padding:14px"><div class="ct">Market data</div><dl class="kv"><dt>Rank</dt><dd>${s.rank?"#"+s.rank:"—"}</dd><dt>Market cap</dt><dd>${fmtCap(s.capNow)}</dd><dt>Fully diluted value</dt><dd>${fmtCap(s.fdvB)}</dd><dt>24h volume</dt><dd>${fmtCap(s.volB)}</dd>
    <dt>Circulating supply</dt><dd>${num(s.circ)}${s.maxSupply?` / ${num(s.maxSupply)} max`:""}</dd><dt>All-time high</dt><dd>${s.ath?`${fmtP(s.ath)} <span class="dn">${fmtPct(s.athChg)}</span>`:"—"}</dd></dl></div>
  <div class="card" style="padding:14px"><div class="ct" style="--c:${HEX.orange}">Derivatives${d.perp?` · ${esc(d.perp)}`:""}</div>${d.funding!=null?`<dl class="kv"><dt>Funding (8h)</dt><dd class="${fundCls(d.funding)}">${fmtFund(d.funding)} <span class="mut">· ${(d.funding*3*365*100).toFixed(1)}% APR</span></dd>${nf!=null?`<dt>Next funding in</dt><dd>${Math.floor(nf/3600e3)}h ${Math.floor(nf%3600e3/60e3)}m</dd>`:""}
    <dt>Open interest</dt><dd>${fmtUsd(d.oiUsd)}</dd><dt>OI change</dt><dd><span class="${pc(d.oiChg24h||0)}">${d.oiChg24h!=null?fmtPct(d.oiChg24h):"—"}</span> 24h · <span class="${pc(d.oiChg7d||0)}">${d.oiChg7d!=null?fmtPct(d.oiChg7d):"—"}</span> 7d</dd><dt>Liquidations 24h</dt><dd><span class="dn">longs ${fmtUsd(d.liq?.long||0)}</span> · <span class="up">shorts ${fmtUsd(d.liq?.short||0)}</span></dd></dl>
    ${ls?`<div><div class="lab"><span>Longs <b class="up">${(ls.long*100).toFixed(1)}%</b></span><span>Shorts <b class="dn">${(ls.short*100).toFixed(1)}%</b></span></div><div class="split"><i style="width:${ls.long*100}%;background:${HEX.green}"></i><i style="width:${ls.short*100}%;background:${HEX.red}"></i></div><p class="disclaimer" style="margin:6px 0 0">Share of Binance futures accounts long vs short · ratio ${ls.ratio.toFixed(2)}</p></div>`:""}`:`<p class="mut">No perpetual futures data for ${s.tk}.</p>`}</div>
  <div class="card" style="padding:14px"><div class="ct" style="--c:${HEX.gold}">Whale activity</div><div class="whfeed">${wh.map(whaleRow).join("")||`<p class="mut">No whale prints for ${s.tk} since the server started.</p>`}</div></div>
  <div class="card" style="padding:14px"><div class="ct">Research ${s.tk}</div><div class="qlist">${[["CoinGecko",`https://www.coingecko.com/en/coins/${s.cgId}`],["CoinGlass",`https://www.coinglass.com/currencies/${s.tk}`],["Arkham",`https://intel.arkm.com/explorer/token/${s.cgId}`],["DEX Screener",`https://dexscreener.com/search?q=${s.tk}`],["DeFiLlama",`https://defillama.com/`]].map(([n,u])=>`<a class="chip" href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join("")}</div></div>`}

/* ---------- market picker & switching ---------- */
/* Landing cards are built once. Live updates then touch only the individual numbers that
   changed (text, colour, sparkline), so nothing on the card is re-created or repainted needlessly. */
let landingAt=0;
const setText=(el,v)=>{if(el.textContent!==v)el.textContent=v};
const setAttr=(el,k,v)=>{if(el.getAttribute(k)!==v)el.setAttribute(k,v)};
const setHTML=(el,h)=>{if(el._h!==h){el.innerHTML=h;el._h=h}};
function landingData(mk){const M=MARKETS[mk],A=M.items,avg=A.reduce((a,s)=>a+s.h,0)/A.length;
  const stats=[["Avg HCI",fmtH(avg),"",`color:${hciHue(avg)}`],["Too low",String(A.filter(s=>s.h<=CFG.lo).length),"up",""],["Too high",String(A.filter(s=>s.h>=CFG.hi).length),"dn",""]];
  if(mk==="crypto"){const g=M.research.global,f=M.research.fng?.at(-1);
    stats.push(["Market cap",g?`$${g.capT.toFixed(2)}T`:"—","",""],["Fear & Greed",f?String(f.value):"—","",f?`color:${hciHue((f.value-50)/10)}`:""],["Whales · 1h",String(M.whales.filter(w=>Date.now()-w.ts<3600e3).length),"gold",""])}
  else{const ses=M.status.session;stats.push(["Session",{open:"Open",pre:"Pre-mkt",post:"After hrs",closed:"Closed"}[ses]||"—",ses==="open"?"up":"",""],["Buyer zones",String(A.filter(s=>s.zone.status==="buyer").length),"up",""],["Seller zones",String(A.filter(s=>s.zone.status==="seller").length),"dn",""])}
  return{stats,top:A.slice().sort((a,b)=>b.capNow-a.capNow).slice(0,4)}}
function renderLanding(force){if(!force&&Date.now()-landingAt<2000)return;landingAt=Date.now();
  const last=store.get("market",null),box=$("landCards");
  for(const mk of["stocks","crypto"]){const M=MARKETS[mk];if(!M)continue;
    let card=box.querySelector(`.mcard[data-mk="${mk}"]`);
    if(!card){card=document.createElement("div");card.className="mcard";card.setAttribute("role","button");card.tabIndex=0;card.dataset.act="enter";card.dataset.mk=mk;card.setAttribute("aria-label",`Open the ${M.label.toLowerCase()} terminal`);
      card.innerHTML=`<div class="mc-top"><span class="kicker">${mk==="crypto"?"Digital assets · 24/7":"US equities · market hours"}</span><span class="mc-last"></span></div><div class="mc-title">${M.label}</div>
        <p class="mc-desc">${mk==="crypto"?`${M.items.length} coins with live Binance prices, funding, open interest, liquidations, whale tracking and DeFi data.`:`${M.items.length} large-cap US stocks with the heat map, screener, charts, watchlists and alerts.`}</p>
        <div class="mc-stats">${Array.from({length:6},()=>`<div><span></span><b></b></div>`).join("")}</div>
        <div class="mc-tickers">${Array.from({length:4},()=>`<div><b></b><i class="sp"></i><span class="mono"></span><span class="mono"></span></div>`).join("")}</div>
        <span class="btn gold mc-cta">Open ${M.label.toLowerCase()} terminal →</span>`;box.appendChild(card)}
    setHTML(card.querySelector(".mc-last"),last===mk?`<span class="pill gz"><i></i>Last used</span>`:"");
    const{stats,top}=landingData(mk);
    card.querySelectorAll(".mc-stats>div").forEach((d,i)=>{const[l,v,c,st]=stats[i];setText(d.children[0],l);const b=d.children[1];setText(b,v);setAttr(b,"class",c);setAttr(b,"style",st)});
    card.querySelectorAll(".mc-tickers>div").forEach((r,i)=>{const s=top[i];if(!s)return;const[tk,sp,px,ch]=r.children;
      setText(tk,s.tk);setHTML(sp,spark(s.spark,90,22));setText(px,fmtP(s.price));setText(ch,fmtPct(s.chg));setAttr(ch,"class",`mono ${pc(s.chg)}`)})}}
function showLanding(){if(SESSION.role==="superadmin"){go("overview");return}closeAll();renderLanding(true);$("landing").hidden=false;setTimeout(()=>$("landCards").querySelector(".mcard")?.focus({preventScroll:true}),50)}
function enterMarket(mk){$("landing").hidden=true;switchMarket(mk,"overview")}
function switchMarket(mk,view){if(!MARKETS[mk])return;if(mk!==MK)closeAll();setMarket(mk);store.set("market",mk);
  renderNav();renderTape();renderBadges();renderSource();marketClock();renderCmpBar();
  $("tkdl").innerHTML=ASSETS.map(s=>`<option value="${s.tk}">${esc(s.name)}</option>`).join("");$("whCoin").innerHTML="";
  const vs=viewsFor();go(view&&vs.some(v=>v[0]===view)?view:vs.some(v=>v[0]===S.view)?S.view:"overview")}

/* ---------- toasts ---------- */
function toast(title,msg,action,c){const t=document.createElement("div");t.className="toast";t.style.setProperty("--c",c||HEX.gold);
  t.innerHTML=`<b>${esc(title)}</b><span>${esc(msg)}</span>${action?`<button>${esc(action.l)}</button>`:""}`;if(action)t.querySelector("button").onclick=()=>{action.act();t.remove()};
  $("toasts").prepend(t);setTimeout(()=>t.remove(),6500);while($("toasts").children.length>4)$("toasts").lastChild.remove()}

/* ---------- palette ---------- */
let palItems=[],palI=0;
function openPalette(){closeAll();$("scrim").hidden=false;$("pal").hidden=false;$("palQ").value="";buildPal();$("palQ").focus()}
function buildPal(){const q=$("palQ").value.trim().toLowerCase();const items=[];
  const tks=ASSETS.filter(s=>!q||s.tk.toLowerCase().startsWith(q)||s.name.toLowerCase().includes(q)||s.tk.toLowerCase().includes(q))
    .sort((a,b)=>(b.tk.toLowerCase()===q)-(a.tk.toLowerCase()===q)||(b.tk.toLowerCase().startsWith(q))-(a.tk.toLowerCase().startsWith(q))||b.capNow-a.capNow).slice(0,q?8:5);
  tks.forEach(s=>items.push({g:MARKETS[MK].label,ic:s.tk.slice(0,3),l:`<b>${s.tk}</b> <span class="mut">${esc(s.name)}</span>`,r:`<span class="mono ${pc(s.chg)}">${fmtPct(s.chg)}</span> <span class="mono" style="color:${hciHue(s.h)}">${fmtH(s.h)}</span>`,run:sh=>sh?openChart(s.tk):openDrawer(s.tk)}));
  const other=MK==="stocks"?"crypto":"stocks";
  const cmds=[...viewsFor().map(([id,l],i)=>({g:"Go to",ic:String(i+1),l:l,run:()=>go(id)})),
    ...(MARKETS[other]?[{g:"Markets",ic:"⇆",l:`Switch to ${MARKETS[other].label}`,run:()=>switchMarket(other)}]:[]),{g:"Markets",ic:"◫",l:"Choose market",run:showLanding},
    {g:"Commands",ic:"▶",l:S.live?"Pause live feed":"Resume live feed",run:()=>setLive(!S.live)},{g:"Commands",ic:"⚙",l:"Open settings",run:openSettings},
    {g:"Commands",ic:"?",l:"Keyboard shortcuts",run:openKeys},{g:"Commands",ic:"🔔",l:"Create an alert",run:()=>go("alerts")},
    {g:"Commands",ic:"⇄",l:"Compare selected stocks",run:openCompare},{g:"Commands",ic:"⎘",l:"Copy screener as CSV",run:copyCsv},
    ...PRESETS.map((p,i)=>({g:"Screener presets",ic:"◎",l:p.l,mk:p.mk,run:()=>applyPreset(i)})).filter(c=>!c.mk||c.mk===MK)].filter(c=>!q||c.l.toLowerCase().includes(q));
  palItems=[...items,...cmds];palI=0;let lastG="";
  $("palRes").innerHTML=palItems.map((it,i)=>{const h=it.g!==lastG?`<div class="grp">${it.g}</div>`:"";lastG=it.g;return h+`<button class="it" data-pi="${i}" aria-selected="${i===palI}"><span class="ic">${it.ic}</span><span>${it.l}</span><span>${it.r||""}</span></button>`}).join("")||`<div class="empty">Nothing matches “${esc(q)}”.</div>`}
function palMove(d){palI=clamp(palI+d,0,palItems.length-1);$("palRes").querySelectorAll(".it").forEach((b,i)=>b.setAttribute("aria-selected",i===palI));$("palRes").querySelector(`[data-pi="${palI}"]`)?.scrollIntoView({block:"nearest"})}
function palRun(i,sh){const it=palItems[i];if(!it)return;closeAll();it.run(sh)}
$("palQ").addEventListener("input",buildPal);
$("palQ").addEventListener("keydown",e=>{if(e.key==="ArrowDown"){e.preventDefault();palMove(1)}else if(e.key==="ArrowUp"){e.preventDefault();palMove(-1)}else if(e.key==="Enter"){e.preventDefault();palRun(palI,e.shiftKey)}});
$("palRes").addEventListener("click",e=>{const b=e.target.closest("[data-pi]");if(b)palRun(+b.dataset.pi,e.shiftKey)});

/* ---------- settings & keys ---------- */
function openSettings(){closeAll();const m=$("setModal");$("scrim").hidden=false;m.hidden=false;
  m.innerHTML=`<div class="mh"><h3>Settings</h3><div class="sp"></div><button class="iconbtn" data-act="close-modal" aria-label="Close">✕</button></div>
  <form class="mb" id="setForm"><div class="ct">HCI thresholds</div><div class="grid2">
    <label class="fld"><span>Too high at or above</span><input id="sHi" type="number" min="1" max="5" step="0.5" value="${CFG.hi}"></label>
    <label class="fld"><span>Too low at or below</span><input id="sLo" type="number" min="-5" max="-1" step="0.5" value="${CFG.lo}"></label></div>
    <div class="ct">Hill Zones</div><div class="grid2">
    <label class="fld"><span>“In zone” distance (%)</span><input id="sProx" type="number" min="0.3" max="5" step="0.1" value="${CFG.prox}"></label>
    <label class="fld"><span>Swing clustering (%)</span><input id="sTol" type="number" min="0.3" max="5" step="0.1" value="${CFG.tol}"></label></div>
    <div class="ct">Experience</div>
    <label class="switch"><input type="checkbox" id="sSound" ${CFG.sound?"checked":""}><span></span>Play a sound when an alert fires</label>
    <div class="row"><button class="btn gold" type="submit">Save and recalculate</button><button class="btn ghost" type="button" data-act="set-defaults">Restore defaults</button><div class="sp"></div><button class="btn ghost" type="button" data-act="reset-data" id="resetBtn">Reset saved data</button></div>
    <p class="disclaimer" style="margin:0">Watchlists, alerts and settings are saved in this browser only.</p></form>`;
  $("setForm").addEventListener("submit",e=>{e.preventDefault();CFG.hi=clamp(+$("sHi").value||3,1,5);CFG.lo=clamp(+$("sLo").value||-3,-5,-1);CFG.prox=clamp(+$("sProx").value||1.5,.3,5);CFG.tol=clamp(+$("sTol").value||1.5,.3,5);CFG.sound=$("sSound").checked;
    store.set("cfg",CFG);recomputeAll();closeAll();enter(S.view);toast("Settings saved","Every stock was recalculated with the new thresholds.",null,HEX.gold)})}
function openKeys(){closeAll();const m=$("keyModal");$("scrim").hidden=false;m.hidden=false;
  const K=[["⌘K or /","Search & commands"],["1 – 9","Switch view"],["M","Switch stocks / crypto"],["?","This help"],["Esc","Close panels"],["P","Pause / resume feed"],["↑ ↓ or J K","Move in screener"],["Enter","Stock details"],["C","Open chart"],["W","Add to watchlist"],["X","Add to compare"],["← →","Pan chart"],["+ −","Zoom chart"],["[ ]","Previous / next ticker"],["0","Reset chart"]];
  m.innerHTML=`<div class="mh"><h3>Keyboard shortcuts</h3><div class="sp"></div><button class="iconbtn" data-act="close-modal" aria-label="Close">✕</button></div><div class="mb"><div class="keys">${K.map(([k,l])=>`<div><span>${l}</span><kbd>${k}</kbd></div>`).join("")}</div></div>`}
function closeAll(){["pal","setModal","keyModal","cmpModal"].forEach(id=>$(id).hidden=true);$("bell").hidden=true;closeDrawer();$("scrim").hidden=true}
function applyPreset(i){const p=PRESETS[i],F=S.scr;if(p.mk&&p.mk!==MK)switchMarket(p.mk);F.sig=new Set(p.sig);F.hmin=p.hmin??-5;F.hmax=p.hmax??5;F.group="All";F.q="";F.cap=0;go("screener");toast(p.l,`${filtered().length} ${MARKETS[MK].noun} match right now`,null,HEX.gold)}
async function copyCsv(){const t=csv();try{await navigator.clipboard.writeText(t);toast("CSV copied",`${filtered().length} rows on your clipboard`,null,HEX.gold)}catch{toast("Copy blocked","Use Download CSV instead.",null,HEX.orange)}}

/* ---------- global events ---------- */
document.addEventListener("click",e=>{const el=e.target.closest("[data-act]");if(!el)return;const a=el.dataset.act,tk=el.dataset.tk;
  if(el.closest("#bell")===null&&a!=="bell"&&!$("bell").hidden&&!el.closest("#bell"))$("bell").hidden=true;
  switch(a){
    case"feed-details":if(SESSION.role==="superadmin"){if(sidebarCollapsed)setSidebarCollapsed(false);sourceExpanded=!sourceExpanded;renderSource()}break;
    case"view":closeAll();go(el.dataset.view);break;
    case"drawer":if(el.dataset.mk&&el.dataset.mk!==MK)switchMarket(el.dataset.mk);if(el.tagName==="TR"&&S.view==="screener")S.scr.sel=tk;closeModalsOnly();openDrawer(tk);break;
    case"enter":enterMarket(el.dataset.mk);break;
    case"market":switchMarket(el.dataset.mk,S.view.startsWith("admin-")?"overview":undefined);break;
    case"landing":showLanding();break;
    case"dv-sort":{const k=el.dataset.k;if(S.dv.sort===k)S.dv.dir*=-1;else{S.dv.sort=k;S.dv.dir=k==="tk"?1:-1}renderDeriv();break}
    case"wh-kind":S.wh.kind=el.dataset.v;renderWhales();break;
    case"close-drawer":closeDrawer();break;
    case"chart":closeModalsOnly();openChart(tk);break;
    case"watch":e.stopPropagation();toggleWatch(tk);break;
    case"cmp":e.stopPropagation();toggleCmp(tk);break;
    case"cmp-open":closeDrawer();openCompare();break;
    case"cmp-clear":S.cmp.clear();renderCmpBar();if(S.view==="screener")renderRows();break;
    case"alert":pendingAlertTk=tk;closeAll();go("alerts");break;
    case"al-del":S.alerts=S.alerts.filter(x=>x.id!=el.dataset.id);saveAlerts();renderAlertLists();break;
    case"clear-hist":S.hist=[];saveAlerts();renderAlertLists();break;
    case"test-sound":beep(true);break;
    case"sig":{const F=S.scr;F.sig=new Set([el.dataset.sig]);F.group="All";F.hmin=-5;F.hmax=5;F.q="";F.cap=0;go("screener");break}
    case"group":{const F=S.scr;F.group=el.dataset.g;F.sig.clear();F.hmin=-5;F.hmax=5;go("screener");break}
    case"hbin":{const F=S.scr;F.hmin=+el.dataset.min;F.hmax=+el.dataset.max;F.sig.clear();F.group="All";go("screener");break}
    case"screen-tk":S.scr.q=tk.toLowerCase();S.scr.sig.clear();S.scr.group="All";S.scr.hmin=-5;S.scr.hmax=5;closeDrawer();go("screener");break;
    case"scr-group":S.scr.group=el.dataset.g;enterScreener();break;
    case"scr-sig":{const s=S.scr.sig,id=el.dataset.sig;s.has(id)?s.delete(id):s.add(id);enterScreener();break}
    case"scr-clear":Object.assign(S.scr,{group:"All",sig:new Set(),q:"",hmin:-5,hmax:5,cap:0});enterScreener();break;
    case"sort":{const F=S.scr,k=el.dataset.k;if(F.sort===k)F.dir*=-1;else{F.sort=k;F.dir=k==="tk"?1:-1}enterScreener();break}
    case"preset":applyPreset(+el.dataset.i);break;
    case"csv-copy":copyCsv();break;
    case"csv-dl":{const url=URL.createObjectURL(new Blob([csv()],{type:"text/csv"}));const l=document.createElement("a");l.href=url;l.download=`th-screener-${new Date().toISOString().slice(0,10)}.csv`;l.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break}
    case"map-mode":S.map.mode=el.dataset.v;store.set("mapMode",S.map.mode);renderMap();break;
    case"map-period":S.map.period=el.dataset.v;renderMap();break;
    case"map-size":S.map.size=el.dataset.v;renderMap();break;
    case"map-focus":S.map.focus=el.dataset.v||null;renderMap();break;
    case"ch-tf":S.chart.tf=el.dataset.v;resetView();enterChart();break;
    case"ch-range":{const v=S.chart.v,n=chartSrc().bars.length;v.count=+el.dataset.v;v.end=n+3;clampView();enterChart();break}
    case"ch-type":S.chart.type=el.dataset.v;enterChart();break;
    case"ch-ov":S.chart.ov[el.dataset.v]=!S.chart.ov[el.dataset.v];enterChart();break;
    case"ch-reset":resetView();enterChart();break;
    case"ch-prev":stepTicker(-1);break;case"ch-next":stepTicker(1);break;
    case"ch-full":{const c=$("chCard");(document.fullscreenElement?document.exitFullscreen():c.requestFullscreen?.())?.catch?.(()=>{});setTimeout(drawMain,200);break}
    case"wl-pick":S.listId=+el.dataset.id;saveLists();enterWatch();break;
    case"wl-del":{if(!activeList())break;if(Date.now()-delArm>3000){delArm=Date.now();el.textContent="Click again to delete";setTimeout(()=>{if($("wlDel"))$("wlDel").textContent="Delete list"},3000);break}
      const nm=activeList().name;const gone=activeList().id;S.lists=S.lists.filter(l=>l.id!==gone);S.listId=S.lists.find(l=>l.mk===S.mk)?.id||null;delArm=0;el.textContent="Delete list";saveLists();enterWatch();toast("List deleted",nm,null,HEX.red);break}
    case"palette":openPalette();break;
    case"settings":openSettings();break;
    case"keys":openKeys();break;
    case"close-modal":closeAll();break;
    case"live":setLive(!S.live);break;
    case"bell":{const b=$("bell");if(b.hidden){closeModalsOnly();b.hidden=false;renderBell();S.unread=0;renderBadges()}else b.hidden=true;e.stopPropagation();break}
    case"bell-read":S.unread=0;feedSeen=Date.now();renderBadges();renderBell();break;
    case"set-defaults":Object.assign(CFG,{hi:3,lo:-3,prox:1.5,tol:1.5});store.set("cfg",CFG);recomputeAll();openSettings();enter(S.view);break;
    case"reset-data":if(el.dataset.armed){try{Object.keys(localStorage).filter(k=>k.startsWith("thT:"+SESSION.id+":")).forEach(k=>localStorage.removeItem(k))}catch{}location.reload()}else{el.dataset.armed=1;el.textContent="Click again to reset";el.style.color="var(--red)"}break;
  }});
function closeModalsOnly(){["pal","setModal","keyModal","cmpModal"].forEach(id=>$(id).hidden=true);if(!S.drawer)$("scrim").hidden=true}
$("scrim").addEventListener("click",closeAll);
document.addEventListener("click",e=>{if(!$("bell").hidden&&!e.target.closest("#bell")&&!e.target.closest("[data-act=bell]"))$("bell").hidden=true});
document.addEventListener("keydown",e=>{const typing=/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||"");
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette();return}
  if(e.key==="Escape"){closeAll();return}
  if(typing||e.metaKey||e.ctrlKey||e.altKey)return;
  if(!$("landing").hidden){if(e.key==="1"&&MARKETS.stocks)enterMarket("stocks");else if(e.key==="2"&&MARKETS.crypto)enterMarket("crypto");return}
  if((e.key==="Enter"||e.key===" ")&&document.activeElement?.matches?.('[role="button"][data-act]')){e.preventDefault();document.activeElement.click();return}
  const overlay=!$("pal").hidden||!$("setModal").hidden||!$("keyModal").hidden||!$("cmpModal").hidden;if(overlay)return;
  const k=e.key;
  if(k==="/"){e.preventDefault();openPalette();return}
  if(k==="?"){openKeys();return}
  if(k==="p"||k==="P"){setLive(!S.live);return}
  if(/^[1-9]$/.test(k)&&!S.drawer){const v=viewsFor()[+k-1];if(v)go(v[0]);return}
  if((k==="m"||k==="M")&&MARKETS.crypto){switchMarket(MK==="stocks"?"crypto":"stocks");return}
  if(S.view==="screener"&&!S.drawer){if(k==="ArrowDown"||k==="j"){e.preventDefault();moveSel(1)}else if(k==="ArrowUp"||k==="k"){e.preventDefault();moveSel(-1)}
    else if(k==="Enter")openDrawer(S.scr.sel);else if(k==="c")openChart(S.scr.sel);else if(k==="w")toggleWatch(S.scr.sel);else if(k==="x")toggleCmp(S.scr.sel);return}
  if(S.drawer){if(k==="c")openChart(S.drawer);else if(k==="w")toggleWatch(S.drawer);else if(k==="x")toggleCmp(S.drawer);return}
  if(S.view==="chart"){const v=S.chart.v;if(k==="ArrowLeft"){v.end-=v.count*.1;clampView();drawMain()}else if(k==="ArrowRight"){v.end+=v.count*.1;clampView();drawMain()}
    else if(k==="+"||k==="="){v.count/=1.2;clampView();drawMain();syncRangeBtns()}else if(k==="-"||k==="_"){v.count*=1.2;clampView();drawMain();syncRangeBtns()}
    else if(k==="[")stepTicker(-1);else if(k==="]")stepTicker(1);else if(k==="0"){resetView();enterChart()}else if(k==="w")toggleWatch(S.chart.tk)}});

/* ---------- boot ---------- */
if(MARKETS.stocks)seedFeed("stocks");if(MARKETS.crypto)seedFeed("crypto");
if(MARKETS.crypto)applyDeriv(BOOT.cr.deriv),MARKETS.crypto.whales.forEach(w=>{const s=MARKETS.crypto.by[w.sym];if(s)s.lastWhaleAt=Math.max(s.lastWhaleAt||0,w.ts)});
renderNav();
const account = document.createElement("div"); account.className="account-menu";
const profile=document.createElement("div");profile.className="sidebar-profile";
const avatar=document.createElement("span");avatar.className="sidebar-avatar";avatar.textContent=SESSION.name.trim().slice(0,2).toUpperCase();avatar.setAttribute("aria-hidden","true");
const identity=document.createElement("div");identity.className="sidebar-identity";
const label=document.createElement("strong");label.textContent=SESSION.name;identity.append(label);
const role=document.createElement("span");role.className="sidebar-role";role.textContent=SESSION.role==="superadmin"?"Administrator":SESSION.access==="full"?"Full access":SESSION.access==="stocks"?"Stocks access":"Crypto access";identity.append(role);
profile.append(avatar,identity);account.append(profile);
if(SESSION.expiresAt&&SESSION.role!=="superadmin"){const expiry=document.createElement("small");expiry.className="sidebar-expiry";expiry.textContent="Access until "+new Date(SESSION.expiresAt).toLocaleDateString();account.append(expiry);}
if(SESSION.role==="superadmin"){

  const settings=document.createElement("details");settings.className="account-settings";settings.id="adminSettings";
  settings.open=S.view.startsWith("admin-");
  const summary=document.createElement("summary");summary.className="account-action";summary.title="Settings";summary.setAttribute("aria-label","Settings");summary.addEventListener("click",()=>{if(sidebarCollapsed)setSidebarCollapsed(false)});summary.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg><span>Settings</span>';settings.append(summary);
  const options=document.createElement("div");options.className="account-settings-options";
  for(const [title,anchor] of [["Users","users"],["API settings","api"]]){const a=document.createElement("button");a.dataset.act="view";a.dataset.view="admin-"+anchor;a.id="nav-admin-"+anchor;a.className="account-action";a.textContent=title;options.append(a);}
  settings.append(options);account.append(settings);
}
const logout=document.createElement("button");logout.className="account-action logout-action";logout.title="Logout";logout.setAttribute("aria-label","Logout");logout.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4"/></svg><span>Logout</span>';logout.onclick=async()=>{await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});location.replace("/login.html")};account.append(logout);$("accountMenu").append(account);$("landingLogout").onclick=logout.onclick;
$("tkdl").innerHTML=ASSETS.map(s=>`<option value="${s.tk}">${esc(s.name)}</option>`).join("");
renderTape();renderBadges();renderCmpBar();renderSource();marketClock();setInterval(()=>{marketClock();renderSource();if(!$("landing").hidden)renderLanding()},5000);
let rz;new ResizeObserver(()=>{clearTimeout(rz);rz=setTimeout(()=>{if(S.view==="map")renderMap();if(S.view==="chart")drawMain();if(S.drawer)renderDrawer();if(!$("cmpModal").hidden)drawCompare()},60)}).observe(document.body);
document.fonts?.ready.then(()=>{if(S.view==="chart")drawMain()});
setLive(true);
connectWS();
setInterval(async()=>{try{const r=await fetch("/api/auth/me");if(!r.ok){location.replace("/login.html");return}const u=(await r.json()).user;if(JSON.stringify(u.markets)!==JSON.stringify(SESSION.markets))location.reload();}catch{}},30000);
$("whMin").addEventListener("change",e=>{S.wh.min=+e.target.value;renderWhales()});
$("whCoin").addEventListener("change",e=>{S.wh.coin=e.target.value;renderWhales()});
$("boot").hidden=true;
if(SESSION.role!=="superadmin")showLanding();
const h0=(location.hash||"").slice(1);go(VIEWS.some(v=>v[0]===h0)?h0:S.view);
