/** Keep genuine finite OHLCV candles only, ordered and deduplicated by session. */
export function validBars(bars){
  const dates=new Map();
  for(const b of bars||[]){if(!/^\d{4}-\d{2}-\d{2}$/.test(b.d)||![b.o,b.h,b.l,b.c].every(v=>Number.isFinite(v)&&v>0)||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.l>b.h)continue;dates.set(b.d,{...b,v:Number.isFinite(b.v)&&b.v>=0?b.v:0});}
  return [...dates.values()].sort((a,b)=>a.d.localeCompare(b.d));
}
