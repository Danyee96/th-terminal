/** Heuristic price-pattern candidates, not validated trading signals.
 * Only candles before the latest (potentially unfinished) candle confirm a breakout.
 */
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const extrema=(b,key,high)=>{const out=[];for(let i=3;i<b.length-3;i++)if(b.slice(i-3,i+4).every((x,j)=>j===3||(high?x[key]<b[i][key]:x[key]>b[i][key])))out.push({i,p:b[i][key]});return out;};
const regression=(a,key)=>{const m=(a.length-1)/2,y=mean(a.map(x=>x[key]));let num=0,den=0;a.forEach((x,i)=>{num+=(i-m)*(x[key]-y);den+=(i-m)**2;});const slope=den?num/den:0;return {slope,at:i=>y+slope*(i-m)};};
export function detectPatterns(bars){
 if(bars.length<30)return [];
 const offset=Math.max(0,bars.length-181),b=bars.slice(offset,-1),n=b.length;if(n<29)return [];
 if(!b.every(x=>[x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0)))return [];
 const tr=b.slice(-14).map((x,j)=>{const i=n-14+j,prev=b[Math.max(0,i-1)].c;return Math.max(x.h-x.l,Math.abs(x.h-prev),Math.abs(x.l-prev));});const atr=mean(tr);if(!(atr>0))return [];
 const close=b.at(-1).c,current=bars.at(-1).c,out=[];
 const add=(type,name,direction,points,breakout,support)=>{
  const pad=atr*.25,zone={low:support-pad,high:support+pad};
  const invalid=direction==='bull'?current<zone.low:current>zone.high;
  const confirmed=b.slice(points.at(-1).i+1).some(x=>direction==='bull'?x.c>breakout+pad:x.c<breakout-pad);
  const pending=direction==='bull'?current>breakout+pad:current<breakout-pad;
  out.push({type,name,direction,status:invalid?'invalidated':confirmed?'confirmed':pending?'pending-close':'forming',breakout,invalidation:zone,points:points.map(p=>({...p,i:p.i+offset})),start:points[0].i+offset,end:points.at(-1).i+offset,confirmedThrough:b.at(-1).d,method:'heuristic'});
 };
 for(const bull of [true,false]){
  const ps=extrema(b,bull?'l':'h',!bull).filter(p=>p.i>=n-100).slice(-8);
  for(let k=ps.length-1;k>0;k--){const a=ps[k-1],z=ps[k],gap=z.i-a.i;if(gap<8||gap>65||n-1-z.i>18)continue;
   const tolerance=Math.max(atr*.7,(a.p+z.p)*.0075);if(Math.abs(a.p-z.p)>tolerance)continue;
   const middle=b.slice(a.i+1,z.i);const level=bull?Math.max(...middle.map(x=>x.h)):Math.min(...middle.map(x=>x.l));
   if((bull?level-Math.max(a.p,z.p):Math.min(a.p,z.p)-level)<atr*2)continue;
   const mid=a.i+1+middle.findIndex(x=>(bull?x.h:x.l)===level);
   const support=bull?Math.min(a.p,z.p):Math.max(a.p,z.p);
   if(b.slice(z.i+1).some(x=>bull?x.c<support-atr*.25:x.c>support+atr*.25))continue;
   add(bull?'double-bottom':'double-top',bull?'Double bottom':'Double top',bull?'bull':'bear',[a,{i:mid,p:level},z],level,support);break;
  }
 }
 const highs=extrema(b,'h',true).slice(-10);
 for(let k=highs.length-1;k>0;k--){const right=highs[k];if(n-1-right.i<4||n-1-right.i>18)continue;
  for(let j=k-1;j>=0;j--){const left=highs[j],width=right.i-left.i;if(width<25||width>100)continue;
   const rim=(left.p+right.p)/2;if(Math.abs(left.p-right.p)/rim>.035)continue;
   const cup=b.slice(left.i,right.i+1),floor=Math.min(...cup.map(x=>x.l)),depth=rim-floor,lowI=left.i+cup.findIndex(x=>x.l===floor);
   if(depth/rim<.08||depth/rim>.4||lowI<left.i+width*.25||lowI>left.i+width*.75)continue;
   const centre=cup.slice(Math.floor(width*.35),Math.ceil(width*.65));if(mean(centre.map(x=>x.c))>floor+depth*.45)continue;
   const handle=b.slice(right.i+1,-1);if(handle.length<3)continue;const handleLow=Math.min(...handle.map(x=>x.l));
   if(handleLow<rim-depth*.5||rim-handleLow>depth*.35||rim-handleLow<atr*.3)continue;
   const handleI=right.i+1+handle.findIndex(x=>x.l===handleLow);
   if(handle.some(x=>x.c>rim+atr*.25))continue;
   add('cup-handle','Cup and handle','bull',[left,{i:lowI,p:floor},right,{i:handleI,p:handleLow}],Math.max(left.p,right.p),handleLow);j=-1;k=-1;
  }
 }
 for(const bull of [true,false]){let found=false;
  for(let length=5;length<=15&&!found;length++){
   const poleEnd=n-length-1;if(poleEnd<15)continue;const flag=b.slice(poleEnd+1,-1);if(flag.length<4)continue;
   const upper=regression(flag,'h'),lower=regression(flag,'l');if(bull?(upper.slope>=0||lower.slope>=0):(upper.slope<=0||lower.slope<=0))continue;
   if(Math.abs(upper.slope-lower.slope)>atr*.25)continue;
   for(let poleLength=5;poleLength<=15;poleLength++){
    const start=poleEnd-poleLength,delta=b[poleEnd].c-b[start].c,move=Math.abs(delta);if((bull?delta<=0:delta>=0)||move<atr*3||move/b[start].c<.04)continue;
    const low=Math.min(...flag.map(x=>x.l)),high=Math.max(...flag.map(x=>x.h));if(high-low>move*.5)continue;
    if(bull?b[poleEnd].c-low>move*.5:high-b[poleEnd].c>move*.5)continue;
    const boundary=bull?upper.at(flag.length):lower.at(flag.length),support=bull?lower.at(flag.length):upper.at(flag.length);
    add(bull?'bull-flag':'bear-flag',bull?'Bull flag':'Bear flag',bull?'bull':'bear',[{i:start,p:b[start].c},{i:poleEnd,p:b[poleEnd].c},{i:n-2,p:b[n-2].c}],boundary,support);found=true;break;
   }
  }
 }
 return out.sort((a,z)=>z.end-a.end).slice(0,5);
}
