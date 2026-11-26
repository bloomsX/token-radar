// Token Launch Radar — every figure here is recomputed from data.js.
// Row: 0 slug, 1 name, 2 cat, 3 chains, 4 TVL, 5 chg%, 6 age, 7 IV, 8 wl, 9 fam, 10-12 comps, 13 rank,
// 14 verdict, 15 net, 16 net/hour, 17 deposit, 18 MVC — the farm plan as computed (r5, farm.ts).
// Value: quadratic log-log curve x category (dropped) x growth carry (asymmetric excess, form 3) x
// chain-count (dropped) x age (dropped). Odds: logistic age curve (oc/ocMed); bands kept as evidence.
// Economics: farm.ts — 7% slice split across the crowd, stake-weighted; fees from the fee table;
// steps are [text, txCoeff, bridgeCoeff, mins, wait] per chain family.
const R=window.RADAR,M=R.meta,ROWS=R.rows;
ROWS.forEach((r,i)=>{r[13]=i+1;});
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const cm=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const fM=x=>x>=1e9?'$'+(x/1e9).toFixed(2)+'B':'$'+(x/1e6).toFixed(1)+'M';
const f$=x=>'$'+cm(x);
const pc=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d)+'%';
const catN=r=>M.cats[r[2]];
const chN=r=>r[3].map(i=>M.chains[i][0]);
const chFam=r=>M.chains[r[3][0]][1];
const bandOf=a=>a===null?-1:a<183?0:a<365?1:a<730?2:a<1096?3:4;
const bandOddsOf=r=>{const b=bandOf(r[6]);if(b<0)return M.base;const p=M.bands[b];return(p[1]+M.ps*M.base)/(p[2]+M.ps);};
const oddsOf=r=>{if(!M.oc||M.oc.length<3)return bandOddsOf(r);const a=r[6],ay=a===null?M.ocMed:a/365,miss=a===null?1:0,z=M.oc[0]+M.oc[1]*ay+M.oc[2]*miss;return 1/(1+Math.exp(-Math.min(30,Math.max(-30,z))));};
const catF=ci=>M.cf[ci]?M.cf[ci][0]:1;
const grF=c=>{if(!M.gk||c===null)return 1;const ex=c-M.mmc;if(M.gf===3){const sh=ex>=0?ex:ex/2;return clamp(1+clamp(sh,-25,25)/100,0.8,1.25);}return clamp(1+clamp(ex,-25,25)/100,0.8,1.25);};
const chFac=n=>{const b=n<2?'1':n<4?'2-3':'4+';return M.chf[b]?M.chf[b][0]:1;};
const agKey=a=>a===null?'u':a<365?'y0':a<730?'y1':a<1096?'y2':'y3';
const agF=a=>M.agf[agKey(a)]?M.agf[agKey(a)][0]:1;
const curve=tv=>{const u=Math.log(tv)-M.q[3];return Math.exp(M.q[0]+M.q[1]*u+M.q[2]*u*u);};
const vilOf=r=>Math.round(curve(r[4])*catF(r[2])*grF(r[5])*chFac(r[3].length)*agF(r[6]));
const bmOf=tv=>{for(const b of M.bm)if(tv<b[0])return b;return M.bm[M.bm.length-1];};
const stepsOf=f=>{const c=M.steps.c;return[c[0],c[1],c[2],M.steps.k[f],c[3],c[4],c[5],c[6],c[7],M.steps.x[f]];};
const feesOf=r=>{const f=M.fees[chFam(r)],s=stepsOf(r[9]),o={fees:0,mins:0,wait:0};for(const x of s){o.fees+=x[1]*f[0]+x[2]*f[1];o.mins+=x[3];o.wait+=x[4];}return o;};
const planSize=tv=>clamp(Math.round(tv*0.00025),1000,20000);
const crowdOf=tv=>clamp(M.econ.crowd[0]*Math.pow(Math.max(tv,1)/M.econ.crowd[1],M.econ.crowd[2]),M.econ.crowd[3],M.econ.crowd[4]);
const growthFactorOf=c=>c===null?1:clamp(1+c/100,0.75,1.25);
const grossOf=(r,dep,share)=>{const w=dep/(dep+M.econ.half);return(share*r[7]*w)/crowdOf(r[4])*growthFactorOf(r[5]);};
const mvcOf=r=>{const f=feesOf(r),h=f.mins/60;for(let d=M.econ.mvcMin;d<=M.econ.mvcMax;d+=M.econ.mvcStep){const n=grossOf(r,d,M.econ.drop)-f.fees;if(n>d*M.econ.tbill*(M.econ.weeks/52)&&n/h>M.econ.hurdle)return d;}return null;};
const depPlan=r=>r[17];
const netAt=(r,dep)=>Math.round(grossOf(r,dep,M.econ.drop)-feesOf(r).fees);
const nphAt=(r,dep)=>netAt(r,dep)/(feesOf(r).mins/60);
const verdictAt=(r,dep)=>{const n=netAt(r,dep);if(n<=0)return'SKIP';return n>dep*M.econ.tbill*(M.econ.weeks/52)&&Math.round(n/(feesOf(r).mins/60)*100)/100>M.econ.hurdle?'FARM':'THIN';};
const stepTx=(t,r,dep)=>t[0].replaceAll('{N}',r[1]).replaceAll('{D}','$'+cm(dep)).replaceAll('{C}',M.chains[r[3][0]][0]).replaceAll('{T}',cm(r[4]))+' Cost $'+(t[1]*M.fees[chFam(r)][0]+t[2]*M.fees[chFam(r)][1]).toFixed(2)+'. Time '+t[3]+' min hands-on.'+(t[4]?' + '+t[4]+' min wait':'');
const fnv=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return('0000000'+(h>>>0).toString(16)).slice(-8);};
const S={q:'',cat:'',chain:'',verdict:'',chip:'all',sort:'rank',dir:1,dep:'plan'};
const depOf=r=>+S.dep||depPlan(r);
const wlN=()=>ROWS.filter(r=>r[8]).length;
const offN=()=>ROWS.filter(r=>!r[8]&&r[4]>=M.floor).length;

function kpis(){
  let farm=0,best=null,bn=-Infinity;
  for(const r of ROWS){const d=depPlan(r);if(verdictAt(r,d)==='FARM')farm++;const n=nphAt(r,d);if(n>bn){bn=n;best=r;}}
  const c=[
    [wlN()+'/'+M.wl,'watchlist'],
    [ROWS.length,wlN()+' watchlist + '+offN()+' off-list + '+(ROWS.length-wlN()-offN())+' early'],
    [M.ho.loo.toFixed(1)+'× / '+M.ho.wf.toFixed(1)+'×','held-out miss, flat '+M.ho.floo.toFixed(1)+'×'],
    [M.ho.p50.toFixed(0)+'% / '+M.ho.p90.toFixed(0)+'%','in P25–P75 / P10–P90 bands'],
    [M.ho.blo.toFixed(3)+' / '+M.ho.bwf.toFixed(3),'Brier LOO / WF'],
    [farm+' FARM','at plan size · best $'+bn.toFixed(0)+'/hr · '+(best?best[1]:'')]];
  $('kpis').innerHTML=c.map(x=>'<div class="kpi"><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join('');
}
function ledger(){
  const L=M.led;
  const segs=[[L.rk,'#0F766E'],[L.an,'#1A1D21'],[L.tn,'#C9C2B4'],[L.un,'#F59E0B']];
  $('ledger-bar').innerHTML=segs.map(s=>'<div style="width:'+(s[0]/L.tot*100).toFixed(2)+'%;background:'+s[1]+'"></div>').join('');
  $('ledger-text').innerHTML='<b>'+L.rk+' ranked</b> ('+wlN()+' watchlist + '+offN()+' off-list + '+(L.rk-wlN()-offN())+' early below floor) + <b>'+L.an+'</b> traded anchors, usable mcap + <b>'+L.tn+'</b> traded without one + <b>'+L.un+'</b> pre-token set aside = <b>'+L.tot+'</b>. Cutoff $'+cm(M.cut)+' TVL'+(L.bc?'; '+L.bc+' early protocols sit below it, unranked.':'; every eligible early protocol is ranked.');
  $('ledger-reasons').textContent='Above floor ('+L.af+' not ranked): '+Object.entries(L.rs).map(e=>e[0]+' '+e[1]).join(' · ')+'.';
}
function evidence(){
  const f='Implied value = value-if-launched × token odds. Value-if-launched = TVL × size-curve multiple (ln market cap = '+M.q[0].toFixed(3)+' + '+M.q[1].toFixed(3)+' × u + '+M.q[2].toFixed(3)+' × u², u = ln TVL − '+M.q[3].toFixed(2)+')'+(Object.keys(M.cf).length?' × category factor':'')+(M.gk?' × growth carry (asymmetric excess over the market median)':'')+'. Token odds = the logistic age curve 1/(1+exp(-('+M.oc[0].toFixed(3)+' + '+M.oc[1].toFixed(3)+' × age in years + '+M.oc[2].toFixed(3)+' × age unknown))); band peer counts are shown beside it as the raw evidence. Flat multiple ('+M.flat.toFixed(3)+'×) is the baseline.';
  $('formula').innerHTML='<b>'+f+'</b>';
  $('ttb').innerHTML=M.terms.map(t=>'<tr><td>'+esc(t[0])+'</td><td>'+t[1].toFixed(2)+'× vs '+t[2].toFixed(2)+'×</td><td>'+t[3].toFixed(2)+'× vs '+t[4].toFixed(2)+'×</td><td>'+(t[5]?'Kept':'Dropped')+'</td></tr>').join('');
  $('otb').innerHTML=M.ot.map(t=>'<tr><td>'+esc(t[0])+'</td><td>'+t[1].toFixed(3)+' / '+t[2].toFixed(3)+'</td><td>'+t[3].toFixed(3)+' / '+t[4].toFixed(3)+'</td><td>'+(t[5]?'Kept':'Dropped')+'</td></tr>').join('');
  const g=M.gnum;
  $('evidence-note').textContent='Kept only if it improves both tests. Bands from LOO residuals, per TVL band: '+M.ho.p50.toFixed(0)+'% of the '+M.led.an+' real caps sit inside P25–P75 (stated 50%), '+M.ho.p90.toFixed(0)+'% inside P10–P90 (stated 80%). Growth (asymmetric excess over the market median week: positive excess in full, negative at half weight, capped ±25%) was tested and kept: LOO '+g[0].toFixed(2)+'× vs '+g[1].toFixed(2)+'× without it, walk-forward '+g[2].toFixed(2)+'× vs '+g[3].toFixed(2)+'×.';
  chart();
}
function chart(){
  const pts=M.an.map(a=>[a[1]*1000,a[2]*1000]);
  const rows=ROWS.map(r=>[r[4],r[7]]);
  const all=pts.concat(rows);
  const xs=all.map(p=>Math.log(p[0])),ys=all.map(p=>Math.log(p[1]));
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const W=640,H=210,P=34;
  const X=v=>P+(Math.log(v)-x0)/(x1-x0)*(W-2*P);
  const Y=v=>H-P-(Math.log(v)-y0)/(y1-y0)*(H-2*P);
  let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%">';
  for(let e=Math.ceil(x0/Math.LN10);e<=Math.floor(x1/Math.LN10);e++){
    const v=Math.pow(10,e);
    s+='<line x1="'+X(v).toFixed(1)+'" y1="'+(H-P)+'" x2="'+X(v).toFixed(1)+'" y2="'+P+'" stroke="#EDE7DA"/>';
  }
  const path=mu=>{let d='';for(let i=0;i<=40;i++){const tv=Math.exp(x0+(x1-x0)*i/40);d+=(i?'L':'M')+X(tv).toFixed(1)+' '+Y(curve(tv)*mu(tv)).toFixed(1);}return d;};
  for(let i=1;i<3;i++)s+='<path d="'+path(tv=>bmOf(tv)[i])+'" fill="none" stroke="#0F766E" stroke-dasharray="4 3" stroke-width="1"/>';
  s+='<path d="'+path(()=>1)+'" fill="none" stroke="#1A1D21" stroke-width="2"/>';
  s+=pts.map(p=>'<circle cx="'+X(p[0]).toFixed(1)+'" cy="'+Y(p[1]).toFixed(1)+'" r="2.6" fill="#0F766E"/>').join('');
  s+=rows.map(p=>'<circle cx="'+X(p[0]).toFixed(1)+'" cy="'+Y(p[1]).toFixed(1)+'" r="2" fill="#9AA3AD"/>').join('');
  $('chart').innerHTML=s+'</svg>';
}
function selfcheck(){
  const n=ROWS.length;
  let mono=true,bad=0;
  for(let i=0;i<n;i++){if(i&&ROWS[i][7]>ROWS[i-1][7])mono=false;if(Math.round(vilOf(ROWS[i])*oddsOf(ROWS[i]))!==ROWS[i][7])bad++;}
  const sum=ROWS.reduce((a,r)=>a+r[7],0);
  const chk=fnv(ROWS.map((r,i)=>r[0]+':'+(i+1)+':'+r[7]).join('|'));
  const ok=n===M.led.rk&&mono&&sum===M.tot&&chk===M.cs&&bad===0;
  $('selfcheck').className='selfcheck'+(ok?'':' bad');
  $('selfcheck').innerHTML='<b>Self-check '+(ok?'passed':'FAILED')+' — recomputed here:</b> '+n+' rows · '+(mono?'values never rise':'VALUES RISE')+' · total '+fM(sum)+(sum===M.tot?' = board total':' ≠ '+fM(M.tot))+' · checksum '+(chk===M.cs?'matches':'MISMATCH '+chk)+' · recomputed values: '+(bad===0?'all match':bad+' MISMATCH')+'.';
}
function filtered(){
  const q=S.q.toLowerCase();
  const list=ROWS.filter(r=>{
    if(S.chip==='wl'&&!r[8])return false;
    if(S.chip==='off'&&(r[8]||r[4]<M.floor))return false;
    if(S.chip==='early'&&r[4]>=M.floor)return false;
    if(['farm','thin','skip'].includes(S.chip)&&verdictAt(r,depOf(r)).toLowerCase()!==S.chip)return false;
    if(S.cat&&catN(r)!==S.cat||S.chain&&!chN(r).includes(S.chain)||S.verdict&&verdictAt(r,depOf(r))!==S.verdict)return false;
    if(q&&!(r[1].toLowerCase().includes(q)||catN(r).toLowerCase().includes(q)||chN(r).some(c=>c.toLowerCase().includes(q))))return false;
    return true;});
  const VK={rank:r=>r[13],name:r=>r[1],tvl:r=>r[4],chg:r=>r[5]===null?-99999:r[5],age:r=>r[6]===null?-1:r[6],odds:oddsOf,vil:vilOf,iv:r=>r[7],nph:r=>nphAt(r,depOf(r))};
  const val=VK[S.sort];
  return list.slice().sort((a,b)=>{const va=val(a),vb=val(b);const c=typeof va==='string'?va.localeCompare(vb):va-vb;return(c===0?a[0].localeCompare(b[0]):c)*S.dir;});
}
function table(){
  const list=filtered();
  const badge=r=>r[8]?'<span class="badge b-wl">WATCHLIST</span>':r[4]<M.floor?'<span class="badge b-early">EARLY</span>':'<span class="badge b-off">OFF-LIST</span>';
  $('board').querySelector('tbody').innerHTML=list.map(r=>{
    const dep=depOf(r),net=netAt(r,dep),nph=nphAt(r,dep),v=verdictAt(r,dep);
    const vil=vilOf(r),od=oddsOf(r);
    const age=r[6]===null?'not reported':(r[6]/365).toFixed(1)+'y';
    return '<tr data-slug="'+r[0]+'" class="'+(r[13]===1?'top1':'')+'">'
    +'<td>'+r[13]+'</td>'
    +'<td><span class="pname">'+esc(r[1])+'</span>'+badge(r)+'<div class="psub">'+esc(catN(r))+' · '+esc(chN(r).join(', '))+'</div></td>'
    +'<td class="num">'+fM(r[4])+'</td>'
    +'<td class="num">'+(r[5]===null?'n/a':pc(r[5]))+'</td>'
    +'<td class="num">'+age+'</td>'
    +'<td class="num">'+(od*100).toFixed(0)+'%</td>'
    +'<td class="num">'+fM(vil)+'</td>'
    +'<td class="num"><b>'+fM(r[7])+'</b></td>'
    +'<td class="num"><span class="v-'+v+'">'+v+'</span><div class="psub">net '+(net<0?'−':'+')+f$(Math.abs(net))+' · $'+nph.toFixed(0)+'/hr</div></td></tr>';
  }).join('');
  $('rowcount').textContent=list.length+' of '+ROWS.length+' rows'+(S.chip!=='all'?' — '+S.chip.toUpperCase()+' only':'');
  document.querySelectorAll('#board tbody tr').forEach(tr=>tr.onclick=()=>location.hash='#d='+tr.dataset.slug);
}
function controls(){
  const cats=[...new Set(ROWS.map(catN))].sort();
  $('f-cat').innerHTML='<option value="">All categories</option>'+cats.map(c=>'<option>'+esc(c)+'</option>').join('');
  const chs=[...new Set(ROWS.flatMap(chN))].sort();
  $('f-chain').innerHTML='<option value="">All chains</option>'+chs.map(c=>'<option>'+esc(c)+'</option>').join('');
  $('f-cat').value=S.cat;$('f-chain').value=S.chain;
  const chips=[['all','All '+ROWS.length],['wl','Watchlist '+wlN()],['off','Off-list '+offN()],['early','Early'],['farm','Farm'],['thin','Marginal'],['skip','Skip']];
  $('chips').innerHTML=chips.map(c=>'<button type="button" class="chip'+(S.chip===c[0]?' on':'')+'" data-chip="'+c[0]+'">'+c[1]+'</button>').join('');
  document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>{S.chip=b.dataset.chip;syncHash();renderAll();}));
}
function detail(slug){
  const r=ROWS.find(x=>x[0]===slug);
  if(!r){location.hash='';return;}
  const dep=depPlan(r),f=feesOf(r);
  const vil=vilOf(r),od=oddsOf(r),ivLive=Math.round(vil*od);
  const net=netAt(r,dep),nph=nphAt(r,dep),v=verdictAt(r,dep);
  const tb=dep*M.econ.tbill*(M.econ.weeks/52),mvc=mvcOf(r),b=bandOf(r[6]),bm=bmOf(r[4]);
  const bp=b<0?'age unknown — smooth age curve at the median age':('logistic age curve at '+(r[6]/365).toFixed(1)+'y — '+M.bands[b][1]+' of '+M.bands[b][2]+' peers aged '+['<6m','6–12m','1–2y','2–3y','3y+'][b]+' record a token');
  const uq=Math.log(r[4])-M.q[3];
  const pl=Math.exp(M.q[0]+M.q[1]*uq)/r[4];
  const qf=Math.exp(M.q[2]*uq*uq);
  const near=[r[10],r[11],r[12]].map(ai=>{const a=M.an[ai],tv=a[1]*1000,mc=a[2]*1000,pr=Math.round(curve(tv));return[a[0],tv,mc,pr,Math.max(pr/mc,mc/pr)];});
  const deps=[1000,5000,10000,30000];
  const nearDep=dep<3000?1000:dep<7500?5000:dep<20000?10000:30000;
  const mx=deps.map(d=>'<tr><th>'+f$(d)+'</th>'+[.035,.07,.14].map(s=>{const n2=Math.round(grossOf(r,d,s)-f.fees);const v2=n2<=0?'SKIP':(n2>d*M.econ.tbill*(M.econ.weeks/52)&&Math.round(n2/(f.mins/60)*100)/100>M.econ.hurdle?'FARM':'THIN');return'<td class="'+(d===nearDep&&s===0.07?'hl ':'')+'v-'+v2+'">'+v2+'<br>'+f$(n2)+'</td>';}).join('')+'</tr>').join('');
  const steps=stepsOf(r[9]).map(t=>stepTx(t,r,dep));
  const brow=[
    ['TVL',f$(r[4])],
    ['× size curve, power-law part','×'+pl.toFixed(3)],
    ['× quadratic factor exp('+M.q[2].toFixed(3)+'·u²)','×'+qf.toFixed(3)+' · '+f$(Math.round(curve(r[4])))+' after size curve'],
    ['× category factor ('+(M.cf[r[2]]?M.cf[r[2]][1]+' comparables':'n<10 — factor 1')+')','×'+catF(r[2]).toFixed(3)],
    ['× growth carry','×'+grF(r[5]).toFixed(3)],
    ['× chain-count factor','×'+chFac(r[3].length).toFixed(3)],
    ['× age factor','×'+agF(r[6]).toFixed(3)],
    ['<b>= value if it launches</b>','<b>'+f$(vil)+'</b>'],
    ['× token odds ('+bp+')','×'+od.toFixed(3)],
    ['<b>= implied value</b>','<b>'+f$(r[7])+'</b>']];
  $('board-view').hidden=true;
  const dv=$('detail-view');
  dv.hidden=false;
  dv.innerHTML='<button type="button" class="back" id="back">← Back to board</button>'
  +'<section class="card detail-head"><h2>'+esc(r[1])+' '+(r[8]?'<span class="badge b-wl">WATCHLIST</span>':r[4]<M.floor?'<span class="badge b-early">EARLY</span>':'<span class="badge b-off">OFF-LIST</span>')+'</h2>'
  +'<div class="big">'+fM(r[7])+'</div><p class="small">implied value · rank '+r[13]+' of '+ROWS.length+'<br>Band P25–P75 '+fM(vil*bm[1]*od)+'–'+fM(vil*bm[2]*od)+'</p></section>'
  +'<div class="detail-grid"><section class="card"><h2>Inputs</h2><dl class="kv">'
  +'<dt>TVL</dt><dd>'+f$(r[4])+'</dd><dt>7-day change</dt><dd>'+(r[5]===null?'not reported':pc(r[5],2))+'</dd>'
  +'<dt>Age, no token</dt><dd>'+(r[6]===null?'n/a':r[6]+'d ('+(r[6]/365).toFixed(1)+'y)')+'</dd>'
  +'<dt>Category</dt><dd>'+esc(catN(r))+'</dd><dt>Chains</dt><dd>'+esc(chN(r).join(', '))+'</dd></dl></section>'
  +'<section class="card"><h2>Value build</h2>'
  +'<table class="build"><tbody>'+brow.map(x=>'<tr><td>'+x[0]+'</td><td>'+x[1]+'</td></tr>').join('')+'</tbody></table>'
  +'<p class="small">Dropped (×1 here): '+M.dropped.join(', ')+'.</p>'
  +'<p class="small"><b>Recomputed here: '+esc(r[1])+'’s implied value is '+f$(ivLive)+' — '+(ivLive===r[7]?'equals the board file':'differs by '+f$(Math.abs(ivLive-r[7])))+'.</b></p>'
  +'<h3>Comparables</h3><table class="mini"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Blind price</th><th>Miss</th></tr></thead><tbody>'
  +near.map(n=>'<tr><td>'+esc(n[0])+'</td><td class="num">'+fM(n[1])+'</td><td class="num">'+fM(n[2])+'</td><td class="num">'+fM(n[3])+'</td><td class="num">'+n[4].toFixed(2)+'×</td></tr>').join('')
  +'</tbody></table></section>'
  +'<section class="card"><h2>Farm — <span class="v-'+v+'">'+v+'</span></h2>'
  +'<dl class="kv"><dt>Deposit</dt><dd>'+f$(dep)+'</dd>'
  +'<dt>Fees</dt><dd>'+f$(f.fees)+'</dd>'
  +'<dt>Net</dt><dd>'+f$(net)+'</dd>'
  +'<dt>Net/hour</dt><dd>$'+nph.toFixed(2)+' (hurdle $25)</dd>'
  +'<dt>Min. capital</dt><dd>'+(mvc===null?'None up to $30,000 pays':f$(mvc))+'</dd></dl>'
  +'<p class="small"><b>Verdict rule:</b> FARM: net &gt; T-bill ('+f$(tb)+') and net/hour &gt; $25. THIN: net &gt; 0. SKIP: net ≤ 0. The drop is the model’s 7% slice, not a payout; yield left out.</p>'
  +'<h3>Net by deposit</h3><table class="matrix"><thead><tr><th>Deposit</th><th>3.5%</th><th>7%</th><th>14%</th></tr></thead><tbody>'
  +mx
  +'</tbody></table></section></div>'
  +'<section class="card"><h2>10 farm steps</h2><ol class="plan">'
  +steps.map(s=>'<li>'+esc(s)+'</li>').join('')
  +'</ol><p class="tot">Total: '+f$(f.fees)+' fees · '+f.mins+' min · '+f.wait+' min waiting.</p>'
  +'<div class="warn"><b>Stop:</b> exit if TVL −30% or withdrawals pause. Never pay to claim.</div></section>'
  +'<div class="strip"><b>Integrity:</b> growth is an explicit factor ×'+grF(r[5]).toFixed(3)+' here — '+(M.gk?'kept':'dropped')+': LOO '+M.gnum[0].toFixed(2)+'× vs '+M.gnum[1].toFixed(2)+'×, walk-forward '+M.gnum[2].toFixed(2)+'× vs '+M.gnum[3].toFixed(2)+'×.</div>';
  $('back').addEventListener('click',()=>{location.hash='';});
}
function parseHash(){
  const h=location.hash.replace(/^#/,'');
  const p=new URLSearchParams(h);
  if(p.get('d')){detail(p.get('d'));return;}
  $('detail-view').hidden=true;
  $('board-view').hidden=false;
  if(p.get('f'))S.chip=p.get('f');
  if(p.get('s')){S.sort=p.get('s');S.dir=p.get('dir')==='desc'?-1:1;}
  renderAll();
}
function syncHash(){
  const q=[];
  if(S.chip!=='all')q.push('f='+S.chip);
  if(S.sort!=='rank'){q.push('s='+S.sort);q.push('dir='+(S.dir===1?'asc':'desc'));}
  history.replaceState(null,'','#'+q.join('&'));
}
function renderAll(){table();controls();}
document.querySelectorAll('#board thead th').forEach(th=>th.addEventListener('click',()=>{
  const k=th.dataset.sort;
  if(S.sort===k)S.dir=-S.dir;else{S.sort=k;S.dir=k==='name'?1:-1;}
  syncHash();renderAll();
}));
$('q').addEventListener('input',e=>{S.q=e.target.value;table();});
$('f-cat').addEventListener('change',e=>{S.cat=e.target.value;table();});
$('f-chain').addEventListener('change',e=>{S.chain=e.target.value;table();});
$('f-verdict').addEventListener('change',e=>{S.verdict=e.target.value;table();});
$('f-dep').addEventListener('change',e=>{S.dep=e.target.value;table();});
$('reset').addEventListener('click',()=>{
  Object.assign(S,{q:'',cat:'',chain:'',verdict:'',chip:'all',sort:'rank',dir:1,dep:'plan'});
  ['q','f-cat','f-chain','f-verdict'].forEach(id=>$(id).value='');$('f-dep').value='plan';
  syncHash();renderAll();
});
window.addEventListener('hashchange',parseHash);
kpis();ledger();evidence();selfcheck();controls();parseHash();
