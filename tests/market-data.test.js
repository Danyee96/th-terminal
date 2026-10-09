import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {Market,packBars} from '../src/services/market.js';import {CryptoMarket} from '../src/services/crypto.js';import {computeStock} from '../src/shared/indicators.js';import {validBars} from '../src/lib/bars.js';import {createProvider} from '../src/providers/index.js';
const log={info(){},warn(){},error(){}};
const candles=(n=120)=>Array.from({length:n},(_,i)=>({d:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),o:100+i,h:102+i,l:99+i,c:101+i,v:1000}));
test('failed history cannot create simulated prices; only real cache is retained',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'th-real-data-'));const config={cacheDir:dir,historyRefreshMin:60,historyYears:2,quotePollMs:1};const provider={id:'nasdaq',label:'Nasdaq',mode:'polling',history:async()=>{throw new Error('Unavailable')},quotes:async()=>[]};
 try{const market=new Market({provider,config,log});const s={tk:'TEST',bars:[],capB:0};market.stocks.set(s.tk,s);
 await fs.writeFile(path.join(dir,'TEST.json'),JSON.stringify({source:'simulated',fetchedAt:Date.now(),bars:candles()}));assert.equal(await market.loadHistory(s,{useCache:true}),false);assert.equal(s.bars.length,0);assert.equal(market.bootstrap().stocks.length,0);assert.deepEqual(market.status.unavailable,['TEST']);
 await fs.writeFile(path.join(dir,'TEST.json'),JSON.stringify({source:'nasdaq',fetchedAt:1,bars:candles()}));await market.loadHistory(s,{useCache:true});assert.equal(s.source,'nasdaq');assert.equal(s.historyStale,true);assert.equal(s.bars.length,120);
 const chosen=createProvider({provider:'simulated'},log);assert.equal(chosen.id,'nasdaq');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('quote ordering, accurate OHLC bounds and low-price precision',()=>{
 const market=new Market({provider:{id:'nasdaq',mode:'polling'},config:{},log});market.status.session='open';const d=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});const s={tk:'TEST',bars:[{d:'2020-01-01',o:90,h:110,l:85,c:100,v:100}],quote:{ts:100}};
 market.applyPrice(s,{price:120,open:130,ts:200});assert.equal(s.bars.at(-1).d,d);assert.equal(s.bars.at(-1).h,130);assert.equal(s.bars.at(-1).l,120);market.applyPrice(s,{price:10,ts:150});assert.equal(s.quote.price,120);
 const small={d:'2025-01-01',o:0.000012345678,h:0.000013345678,l:0.000011345678,c:0.000012345678,v:100};assert.equal(packBars([small])[0][4],small.c);
});
test('crypto returns use calendar-day periods and official candles preserve volume',()=>{
 const s={bars:candles(),pair:'BTCUSDT'};computeStock(s);const last=s.bars.at(-1).c;assert.equal(s.chgW,(last/s.bars.at(-8).c-1)*100);assert.equal(s.chgM,(last/s.bars.at(-31).c-1)*100);assert.equal(s.chg3M,(last/s.bars.at(-91).c-1)*100);
 const crypto=new CryptoMarket({config:{},log});const c={tk:'BTC',bars:[{d:new Date().toISOString().slice(0,10),o:1,h:3,l:1,c:2,v:0}]};crypto.applyCandle(c,{t:Date.now(),o:'100',h:'120',l:'95',c:'110',q:'12345'},Date.now());assert.deepEqual([c.bars[0].o,c.bars[0].h,c.bars[0].l,c.bars[0].c,c.bars[0].v],[100,120,95,110,12345]);
});
test('invalid market candles are excluded, not repaired with artificial values',()=>{const good=candles(2);assert.equal(validBars([...good,{...good[0],c:NaN},{...good[1],h:1}]).length,2);assert.equal(validBars([{d:'invalid',o:1,h:2,l:1,c:1}]).length,0);});

test('flat prices produce neutral conviction, not false oversold or golden-zone signals',()=>{const s={bars:candles().map(b=>({...b,o:100,h:100,l:100,c:100}))};computeStock(s);assert.equal(s.h,0);assert.equal(s.golden.inZone,false);assert.equal(s.setup.score,0);assert.equal(s.zone.status,'neutral');});
