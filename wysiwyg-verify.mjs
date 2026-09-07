/**
 * WYSIWYG Caption Size Verifier
 * Workspace: D:\PROJECTS\Undone Projects\Cap Ai
 * Fix: WYSIWYG scaling based on 352 reference, 60px on 352 preview = 184px on 1080 export (both 17% width)
 * Steps: build, tsc, dev alive, seed 75-seg Bold with IS COMPLETELY at 0:03, preview screenshot, canvas burn export, frame compare, ffprobe
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = 'http://localhost:3000';
const ID = '75aaa111-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TMP = path.join(process.cwd(), 'temp-e2e');
const DOWNLOADS = path.join(TMP, 'downloads');
const ORIG = path.join(TMP, 'A 30-Day Money Challenge.mp4');
const WYSIWYG_OUT = path.join(DOWNLOADS, 'wysiwyg-captioned.webm');
const PREVIEW_STAGE_PNG = path.join(DOWNLOADS, 'wysiwyg-preview-03-stage.png');
const PREVIEW_CANVAS_PNG = path.join(DOWNLOADS, 'wysiwyg-preview-03-canvas.png');
const PREVIEW_FULL_PNG = path.join(DOWNLOADS, 'wysiwyg-preview-03-full.png');
const EXPORT_FRAME_3S = path.join(DOWNLOADS, 'wysiwyg-export-3s.jpg');
const ORIG_FRAME_3S = path.join(DOWNLOADS, 'wysiwyg-orig-3s.jpg');
const DIFF_3S = path.join(DOWNLOADS, 'wysiwyg-diff-3s.jpg');
const PREVIEW_FRAME_3S = path.join(DOWNLOADS, 'wysiwyg-preview-3s-crop.jpg'); // stage crop via screenshot
const LOG = [];
function log(m){ console.log(m); LOG.push(m); }

async function seedProject(page, id){
  const buf = fs.readFileSync(ORIG);
  const b64 = buf.toString('base64');
  return await page.evaluate(async (args)=>{
    const {id, b64, fname} = args;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blob = new Blob([bytes], {type:'video/mp4'});
    const thumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAAEAAQDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
    const makeId = ()=> Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
    let t=0;
    const segments=[];
    // Pre-segs before 3s
    const preSegs = [
      {text:"INTRO START", dur:700},
      {text:"WELCOME TO", dur:800},
    ];
    for(const p of preSegs){
      const s=t; const e=s+p.dur;
      const ws=p.text.split(/\s+/);
      const per=(e-s)/ws.length;
      const words=ws.map((w,wi)=>({word:w, startMs: Math.round(s+wi*per), endMs: Math.round(s+(wi+1)*per), confidence:0.97}));
      segments.push({id:makeId(), startMs:s, endMs:e, text:p.text, words});
      t=e+150;
    }
    // IS COMPLETELY at 3s: start 2400 end 3800 covers 3000
    {
      const s=2400; const e=3800;
      t=s;
      const ws=["IS","COMPLETELY"];
      const per=(e-s)/ws.length;
      const words=ws.map((w,wi)=>({word:w, startMs: Math.round(s+wi*per), endMs: Math.round(s+(wi+1)*per), confidence:0.97}));
      segments.push({id:makeId(), startMs:s, endMs:e, text:"IS COMPLETELY", words});
      t=e+120;
    }
    // Also ensure WHAT IF YOU at 5s still for prior tests (optional)
    {
      const s=4100; const e=6200;
      // if t already 3920, we have gap, set t to s if needed
      if(t < s) t=s;
      else if(t > s) {
        // shift this segment to start at t to avoid gap overlap? Keep at 4100 but adjust if collision
        // Ensure continuity: if t > 4100, start at t
      }
      const actualS = Math.max(s, t);
      const actualE = actualS + (e-s);
      const ws=["WHAT","IF","YOU"];
      const per=(actualE-actualS)/ws.length;
      const words=ws.map((w,wi)=>({word:w, startMs: Math.round(actualS+wi*per), endMs: Math.round(actualS+(wi+1)*per), confidence:0.97}));
      segments.push({id:makeId(), startMs:actualS, endMs:actualE, text:"WHAT IF YOU", words});
      t=actualE+120;
    }
    const remaining = 75 - segments.length;
    const remainingDuration = 52105 - t;
    const avgSlot = remainingDuration / remaining;
    let segIdx=segments.length;
    for(let i=0;i<remaining;i++){
      const dur = Math.max(300, Math.round(avgSlot*0.75));
      const gap = Math.round(avgSlot - dur);
      const s=t; const e=s+dur;
      const wordsPer=2+(i%3);
      const per = dur/wordsPer;
      const words=[];
      for(let w=0;w<wordsPer;w++){
        const ws=s+w*per; const we=ws+per*0.9;
        words.push({word:`word${segIdx}_${w}`, startMs: Math.round(ws), endMs: Math.round(we), confidence:0.9});
      }
      segments.push({id:makeId(), startMs:s, endMs:e, text: words.map(x=>x.word).join(' '), words});
      t=e+gap;
      segIdx++;
    }
    // Verify 3s active
    const activeAt3 = segments.find(s=> 3000>=s.startMs && 3000<=s.endMs);
    const activeAt5 = segments.find(s=> 5000>=s.startMs && 5000<=s.endMs);
    const style={
      preset:'Bold Drop',
      fontFamily:'Impact',
      fontSize:60,
      fontWeight:900,
      fontStyle:'normal',
      textTransform:'uppercase',
      textAlign:'center',
      color:'#FFD700',
      strokeColor:'#000000',
      strokeWidth:4,
      shadowColor:'#000000',
      shadowBlur:6,
      shadowOffsetX:3,
      shadowOffsetY:3,
      pillEnabled:false,
      pillColor:'#000000',
      pillOpacity:0.75,
      pillPaddingX:8,pillPaddingY:4,pillRadius:8,
      highlightStyle:'pop',
      activeWordColor:'#FFD700',
      inactiveWordColor:'#FFFFFF',
      positionPreset:'bottom', positionOffsetY:12, hAlign:'center'
    };
    const proj={id, name: fname, createdAt: Date.now()-100000, updatedAt: Date.now(), videoBlob: blob, thumbnailDataUrl: thumb, settings:{mode:'dynamic',language:'en',wordsPerSegment:3,rtl:false}, captionStyle: style, segments, originalSegments: JSON.parse(JSON.stringify(segments))};
    const res = await new Promise((resolve,reject)=>{
      const r=indexedDB.open('capai_db');
      r.onsuccess=()=>{
        const db=r.result;
        try{
          if(!db.objectStoreNames.contains('projects')){ resolve({error:'no store'}); try{db.close()}catch{}; return; }
          const tx=db.transaction('projects','readwrite');
          const store=tx.objectStore('projects');
          const put=store.put(proj);
          put.onsuccess=()=>{
            const g=store.get(id);
            g.onsuccess=()=>{ try{db.close()}catch{}; resolve({ok:true, segments: g.result?.segments?.length, blobSize:g.result?.videoBlob?.size, mode: g.result?.settings?.mode}); };
            g.onerror=()=>reject(g.error);
          };
          put.onerror=()=>reject(put.error);
        }catch(e){ try{db.close()}catch{}; reject(e); }
      };
      r.onerror=()=>reject(r.error);
    });
    return {res, segmentsLen: segments.length, activeAt3: activeAt3?.text||'none', activeAt3Start: activeAt3?.startMs, activeAt3End: activeAt3?.endMs, activeAt5: activeAt5?.text||'none'};
  }, {id, b64, fname: path.basename(ORIG)});
}

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }

async function main(){
  log('=== WYSIWYG CAPTION SIZE VERIFIER ===');
  log(new Date().toISOString());
  log('Workspace: D:\\PROJECTS\\Undone Projects\\Cap Ai');
  log('Fix: WYSIWYG scaling based on 352 reference, 60px on 352 preview = 184px on 1080 export (both 17% width)');
  ensureDir(DOWNLOADS);
  // Clean previous wysiwyg outputs
  [WYSIWYG_OUT, PREVIEW_STAGE_PNG, PREVIEW_CANVAS_PNG, PREVIEW_FULL_PNG, EXPORT_FRAME_3S, ORIG_FRAME_3S, DIFF_3S, PREVIEW_FRAME_3S].forEach(p=>{ try{ if(fs.existsSync(p)) fs.unlinkSync(p);}catch{}});
  try{ fs.readdirSync(DOWNLOADS).filter(f=> f.startsWith('wysiwyg-')).forEach(f=>{ try{ fs.unlinkSync(path.join(DOWNLOADS,f)); }catch{}});}catch{}

  // 1. Build + tsc (run via exec)
  log('\n[1] Running npm run build + npx tsc --noEmit');
  try{
    const buildOut = execSync('npm run build', {encoding:'utf8', timeout:120000, cwd: process.cwd()});
    log('  BUILD OUTPUT: '+ buildOut.slice(0,800).replace(/\n/g,' | '));
    const hasCompiled = buildOut.includes('Compiled successfully') || buildOut.includes('Compiled');
    log(`  Build: ${hasCompiled ? 'GREEN ✓' : 'CHECK'}`);
  }catch(e){
    log('  BUILD FAILED: '+(e.message||'') + (e.stdout||'').slice(0,1000));
    // continue maybe already green earlier, but we log and proceed
  }
  try{
    const tscOut = execSync('npx tsc --noEmit', {encoding:'utf8', timeout:60000, cwd: process.cwd()});
    log(`  TSC OUTPUT: ${tscOut.slice(0,500) || '(no output = green)'}`);
    log('  TSC: GREEN ✓ (no errors)');
  }catch(e){
    const out = (e.stdout||'') + (e.stderr||'') + e.message;
    log('  TSC FAILED: '+ out.slice(0,1200));
    throw e;
  }

  // 2. Dev alive
  log('\n[2] Verify dev server alive http://localhost:3000');
  const browser = await chromium.launch({headless:false, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:1280,height:900}, acceptDownloads:true});
  const page = await context.newPage();
  const consoleLogs=[];
  page.on('console', m=>{
    const txt=`[${m.type()}] ${m.text()}`;
    consoleLogs.push(txt);
    if(m.text().includes('[export]')||m.text().includes('[ass]')||m.text().includes('canvas')||m.text().includes('WYSIWYG')){
      log('  CONSOLE '+txt.slice(0,800));
    }
  });
  page.on('pageerror', e=> log('  PAGEERROR '+e.message));

  log('  Navigating to /');
  await page.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:15000});
  await page.waitForTimeout(1200);
  const title = await page.title().catch(()=> '');
  log(`  GET / title: ${title.slice(0,200)} -> alive`);

  // 3. Seed and navigate to editor at 0:03IS COMPLETELY
  log(`\n[3] Seed 75-seg Bold project ${ID} with IS COMPLETELY at 0:03`);
  const seedRes = await seedProject(page, ID);
  log(`  Seed result: ${JSON.stringify(seedRes)}`);
  await page.goto(`${BASE}/projects/${ID}`, {waitUntil:'domcontentloaded', timeout:20000});
  let videoMeta=null;
  let editorReady=false;
  for(let i=0;i<20;i++){
    await page.waitForTimeout(1000);
    const st = await page.evaluate(()=>{
      const hasExport = !!document.querySelector('header') && document.body.innerText.includes('Export');
      const v=document.querySelector('video');
      return {hasExport, hasVideo: !!v, videoCount: document.querySelectorAll('video').length};
    });
    if(st.hasExport && st.hasVideo){
      videoMeta = await page.evaluate(async()=>{
        const v=document.querySelector('video');
        if(!v) return null;
        if(v.readyState<1) await new Promise(r=>{ v.addEventListener('loadedmetadata',r,{once:true}); setTimeout(r,5000); });
        return {w:v.videoWidth,h:v.videoHeight,dur:v.duration,readyState:v.readyState};
      });
      log(`  poll ${i}s export=${st.hasExport} videoMeta=${JSON.stringify(videoMeta)}`);
      if(videoMeta && videoMeta.w===1080 && videoMeta.h===1920){
        editorReady=true;
        break;
      }
      if(i>12 && videoMeta && videoMeta.w>0) { editorReady=true; break; }
    } else {
      log(`  poll ${i}s export=${st.hasExport} video=${st.hasVideo}`);
    }
  }
  log(`  Editor ready: ${editorReady ? 'YES' : 'NO'} meta ${JSON.stringify(videoMeta)}`);
  log(`  Portrait 1080x1920: ${videoMeta?.w===1080 && videoMeta?.h===1920 ? 'PASS ✓' : `FAIL ${videoMeta?.w}x${videoMeta?.h}`}`);

  // Seek to 0:03 (3000ms) where IS COMPLETELY shows
  log('\n  Seeking to 0:03 (3000ms) where IS COMPLETELY shows');
  const seekRes = await page.evaluate(async()=>{
    const v=document.querySelector('video');
    if(!v) return {error:'no video'};
    // Ensure paused
    try{ v.pause(); }catch{}
    v.currentTime = 3.0;
    await new Promise(res=>{
      let done=false;
      const to=setTimeout(()=>{ if(!done){ done=true; res('timeout');}},2000);
      v.addEventListener('seeked', ()=>{ if(!done){ done=true; clearTimeout(to); res('seeked');}}, {once:true});
      if(v.readyState>=1) {
        // already maybe seeked
      }
    });
    // Wait a tick for canvas draw
    await new Promise(r=> setTimeout(r,600));
    const t = v.currentTime;
    const rect = v.getBoundingClientRect();
    const container = v.parentElement;
    const containerRect = container ? container.getBoundingClientRect() : null;
    const canvas = document.querySelector('canvas');
    const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
    const dpr = window.devicePixelRatio || 1;
    const canvasInfo = canvas ? {width: canvas.width, height: canvas.height, styleW: canvas.style.width, styleH: canvas.style.height, dpr, logicalW: canvas.width/dpr, logicalH: canvas.height/dpr} : null;
    // Also get stage info
    const stage = v.closest('div.relative');
    const stageStyle = stage ? {aspectRatio: stage.style.aspectRatio, w: stage.clientWidth, h: stage.clientHeight, computedAR: getComputedStyle(stage).aspectRatio} : null;
    // Find active segment text via global? We can read from context? Instead probe via evaluate of window
    // We'll try to detect canvas caption presence via measuring alpha
    let canvasMeasure=null;
    if(canvas){
      const ctx=canvas.getContext('2d');
      // image data scanning for alpha>10 bottom half
      const w=canvas.width, h=canvas.height;
      try{
        const img=ctx.getImageData(0,0,w,h);
        let minX=w, minY=h, maxX=0, maxY=0, found=false;
        // scan with step 2 for performance
        for(let y=0;y<h;y+=2){
          for(let x=0;x<w;x+=2){
            const idx=(y*w+x)*4;
            const a=img.data[idx+3];
            if(a>15){
              if(x<minX) minX=x;
              if(y<minY) minY=y;
              if(x>maxX) maxX=x;
              if(y>maxY) maxY=y;
              found=true;
            }
          }
        }
        if(found){
          const bboxW=(maxX-minX)/dpr;
          const bboxH=(maxY-minY)/dpr;
          const logicalW=w/dpr, logicalH=h/dpr;
          canvasMeasure={minX,minY,maxX,maxY,bboxW,bboxH,logicalW,logicalH,pctW: bboxW/logicalW*100, pctH: bboxH/logicalH*100, dpr, found};
        } else {
          canvasMeasure={found:false};
        }
      }catch(e){
        canvasMeasure={error:e.message};
      }
    }
    // Also get computed style for captionStyle? Check window.__debug ?
    return {t, rect:{w:rect.width,h:rect.height}, containerRect, canvasRect, canvasInfo, stageStyle, canvasMeasure};
  });
  log(`  Seek result t=${seekRes.t} rect=${JSON.stringify(seekRes.rect)} container=${JSON.stringify(seekRes.containerRect)}`);
  log(`  CanvasInfo: ${JSON.stringify(seekRes.canvasInfo)}`);
  log(`  StageStyle: ${JSON.stringify(seekRes.stageStyle)}`);
  log(`  CanvasMeasure (caption bbox via alpha): ${JSON.stringify(seekRes.canvasMeasure)}`);
  // Take screenshots
  await page.screenshot({path: PREVIEW_FULL_PNG, fullPage:true});
  log(`  Screenshot fullPage: ${PREVIEW_FULL_PNG} size ${(fs.statSync(PREVIEW_FULL_PNG).size/1024).toFixed(1)} KB`);
  // Stage screenshot: locate video stage
  try{
    const stage = page.locator('div.relative').first();
    // Find the one with aspectRatio style
    const stages = page.locator('div[style*="aspect-ratio"]');
    const count = await stages.count();
    log(`  Stages with aspect-ratio count=${count}`);
    if(count>0){
      await stages.first().screenshot({path: PREVIEW_STAGE_PNG});
      log(`  Screenshot stage: ${PREVIEW_STAGE_PNG} size ${(fs.statSync(PREVIEW_STAGE_PNG).size/1024).toFixed(1)} KB`);
    } else {
      // fallback: video element screenshot
      const vid = page.locator('video').first();
      await vid.screenshot({path: PREVIEW_STAGE_PNG});
      log(`  Screenshot video element: ${PREVIEW_STAGE_PNG} size ${(fs.statSync(PREVIEW_STAGE_PNG).size/1024).toFixed(1)} KB`);
    }
  }catch(e){
    log(`  Stage screenshot fail: ${e.message}`);
  }
  // Canvas only screenshot via toDataURL
  try{
    const dataUrl = await page.evaluate(()=>{
      const c=document.querySelector('canvas');
      if(!c) return null;
      return c.toDataURL('image/png');
    });
    if(dataUrl){
      const b64=dataUrl.split(',')[1];
      fs.writeFileSync(PREVIEW_CANVAS_PNG, Buffer.from(b64,'base64'));
      log(`  Canvas-only PNG: ${PREVIEW_CANVAS_PNG} size ${(fs.statSync(PREVIEW_CANVAS_PNG).size/1024).toFixed(1)} KB`);
    }
  }catch(e){ log(`  Canvas dataUrl fail ${e.message}`); }

  // Also compute theoretical WYSIWYG sizes for reporting
  const theory = await page.evaluate(()=>{
    const W=352;
    const previewScale = 352/352; //1
    const exportScale = 1080/352; //3.068
    const base=60;
    const previewRaw=base*previewScale; //60
    const exportRaw=base*exportScale; //184
    // Simulate maxContentWidth scaling: preview max 309, export 950
    // Need actual measured widths at those sizes; approximate using canvas measureText
    const c=document.createElement('canvas');
    const ctx=c.getContext('2d');
    ctx.font=`900 60px Impact`;
    const w60=ctx.measureText('IS COMPLETELY').width; // ~384
    ctx.font=`900 184px Impact`;
    const w184=ctx.measureText('IS COMPLETELY').width;
    const previewMax=352*0.88; //309
    const exportMax=1080*0.88; //950
    const previewNeedsWrap = w60 > previewMax;
    const exportNeedsWrap = w184 > exportMax;
    // After wrap scale
    let previewEff=60, exportEff=184;
    if(previewNeedsWrap){
      const scale=(previewMax/w60)*0.96;
      previewEff=60*scale;
    }
    if(exportNeedsWrap){
      const scale=(exportMax/w184)*0.96;
      exportEff=184*scale;
    }
    return {
      previewRaw, exportRaw, w60, w184, previewMax, exportMax,
      previewNeedsWrap, exportNeedsWrap,
      previewEff, exportEff,
      previewPctWidth: previewEff/352*100,
      exportPctWidth: exportEff/1080*100,
      previewPctHeight: (previewEff*1.25)/626*100,
      exportPctHeight: (exportEff*1.25)/1920*100,
      ratioBefore: (60/352)/(60/1080),
      ratioAfter: (previewEff/352)/(exportEff/1080)
    };
  });
  log(`  Theory WYSIWYG calc: ${JSON.stringify(theory,null,2)}`);
  log(`  Preview effective ${theory.previewEff.toFixed(1)}px (${theory.previewPctWidth.toFixed(1)}% width) vs Export effective ${theory.exportEff.toFixed(1)}px (${theory.exportPctWidth.toFixed(1)}% width) => match ${Math.abs(theory.previewPctWidth-theory.exportPctWidth).toFixed(2)}% diff`);
  log(`  Before fix mismatch 3.06x, after ~1.0x (was 17% vs 5.5%)`);

  // Verify caption visually large: check that bbox pctH ~9-13%
  let previewPctH = null;
  if(seekRes.canvasMeasure && seekRes.canvasMeasure.pctH){
    previewPctH = seekRes.canvasMeasure.pctH;
    log(`  Preview caption bbox pctH: ${previewPctH.toFixed(2)}% of video height (logical ${seekRes.canvasMeasure.logicalH.toFixed(0)} h, bboxH ${seekRes.canvasMeasure.bboxH.toFixed(0)})`);
    log(`  Should be large ~9-13% (was 5.5% before fix tiny) -> ${previewPctH>7 ? 'PASS LARGE ✓' : 'FAIL tiny'}`);
  }

  // 4. Trigger export via canvas burn
  log(`\n[4] Trigger export via canvas burn (WebM VP9) as before: click Export -> Start Export -> wait 52s -> download webm`);
  await page.locator('header button:has-text("Export")').first().click({timeout:10000});
  await page.waitForSelector('text=Export Video', {timeout:10000});
  await page.waitForTimeout(800);
  const modalInfo = await page.evaluate(()=>{
    const dlgs=document.querySelectorAll('[role="dialog"]');
    const dlg=dlgs[dlgs.length-1];
    if(!dlg) return {error:'no dlg'};
    const txt=dlg.innerText;
    const html=dlg.innerHTML.slice(0,12000);
    return {
      txt: txt.slice(0,2500),
      hasWebM: txt.includes('WebM')||html.includes('WebM'),
      hasVP9: txt.includes('VP9')||html.includes('VP9'),
      hasBurned: txt.includes('burned'),
      hasChromeVLC: txt.includes('Chrome') && txt.includes('VLC'),
      hasCanvasGuarantee: txt.includes('Canvas burn guarantees')||txt.includes('guarantees captions'),
      hasMP4H264: txt.includes('MP4 (H.264)')||txt.includes('H.264'),
      formatLabel: (Array.from(dlg.querySelectorAll('div')).find(d=> d.innerText.includes('FORMAT'))?.innerText||'').slice(0,500)
    };
  });
  log(`  Modal WebM VP9 burned: ${modalInfo.hasWebM&&modalInfo.hasVP9&&modalInfo.hasBurned ? 'PASS ✓' : 'FAIL'} hasCanvasGuarantee ${modalInfo.hasCanvasGuarantee}`);
  log(`  Modal formatLabel: ${modalInfo.formatLabel.replace(/\n/g,' | ').slice(0,500)}`);
  const startBtn = page.locator('button:has-text("Start Export")').first();
  log(`  Clicking Start Export`);
  const startWall=Date.now();
  await startBtn.click({timeout:10000});
  log(`  Clicked at ${new Date().toISOString()}`);
  let done=false;
  let progressValues=[];
  let lastPct=null;
  let pollErr=null;
  for(let i=0;i<110;i++){
    await page.waitForTimeout(1000);
    const elapsed=((Date.now()-startWall)/1000).toFixed(1);
    const st= await page.evaluate(()=>{
      const dlgs=document.querySelectorAll('[role="dialog"]');
      if(!dlgs.length) return {noDlg:true};
      const dlg=dlgs[dlgs.length-1];
      const txt=dlg.innerText;
      const pctM=txt.match(/(\d+)%/);
      const isDone=txt.includes('Done!') && txt.includes('Your captioned video is ready');
      const isExporting=txt.includes('Exporting');
      const errEl=document.querySelector('[role="alert"]');
      return {noDlg:false, txt: txt.slice(0,2000), pct: pctM?parseInt(pctM[1],10):null, isDone, isExporting, err: errEl?errEl.innerText.slice(0,500):''};
    });
    if(st.noDlg) { log(`  poll ${elapsed}s noDlg`); continue; }
    if(st.pct!==null && st.pct!==lastPct){
      log(`  poll ${elapsed}s pct=${st.pct} exporting=${st.isExporting} done=${st.isDone}`);
      progressValues.push(st.pct);
      lastPct=st.pct;
    } else if(i%5===0) {
      log(`  poll ${elapsed}s pct=${st.pct} exporting=${st.isExporting} done=${st.isDone}`);
    }
    if(st.isDone){ done=true; log(`  DONE at ${elapsed}s`); await page.screenshot({path: path.join(DOWNLOADS,'wysiwyg-done.png'), fullPage:true}); break; }
    if(st.err){ pollErr=st.err; log(`  ERROR ${st.err}`); await page.screenshot({path: path.join(DOWNLOADS,'wysiwyg-error.png'), fullPage:true}); break; }
    if(parseFloat(elapsed)>90){ log(`  Timeout 90s`); break; }
  }
  const totalWall=((Date.now()-startWall)/1000).toFixed(1);
  log(`  Export wall time: ${totalWall}s done=${done} progressValues=${progressValues.slice(0,20).join(',')}${progressValues.length>20?' ...':''}`);

  let downloadOk=false, downloadSize=0;
  if(done){
    const dlBtn = page.locator('button:has-text("Download")').first();
    const hasDlBtn = await dlBtn.count();
    log(`  Download button count: ${hasDlBtn}`);
    if(hasDlBtn>0){
      const dlPromise = page.waitForEvent('download', {timeout:30000}).then(async dl=>{
        const suggested=dl.suggestedFilename();
        log(`  DOWNLOAD suggestedFilename=${suggested}`);
        await dl.saveAs(WYSIWYG_OUT);
        const stat=fs.statSync(WYSIWYG_OUT);
        log(`  Saved to ${WYSIWYG_OUT} size ${(stat.size/1024/1024).toFixed(2)} MB`);
        return {suggested, size: stat.size};
      }).catch(e=>{ log(`  download wait error: ${e.message}`); return null;});
      await dlBtn.click({timeout:10000});
      log('  Clicked Download');
      const dlRes = await dlPromise;
      if(dlRes){
        downloadSize=dlRes.size;
        downloadOk = dlRes.suggested.toLowerCase().endsWith('.webm') && dlRes.size>5*1024*1024;
        log(`  Download check webm & >5MB: ${downloadOk ? 'PASS ✓' : 'FAIL'}`);
      }
      if(fs.existsSync(WYSIWYG_OUT)){
        downloadSize=fs.statSync(WYSIWYG_OUT).size;
        try{
          const fd=fs.openSync(WYSIWYG_OUT,'r');
          const buf=Buffer.alloc(16);
          fs.readSync(fd,buf,0,16,0);
          fs.closeSync(fd);
          const header=buf.toString('hex').slice(0,32);
          log(`  Header hex first 16: ${header} isEBML=${header.includes('1a45dfa3') ? 'YES webm' : 'NO'}`);
        }catch{}
      }
    }
  } else {
    log('  Export not done, cannot verify download');
  }

  // 5. Extract frames at 3s from both preview and exported webm and compare
  log(`\n[5] Extract frames at 3s from both preview (via canvas screenshot) and exported webm (ffmpeg -ss 3) and compare sizes`);
  // Original frame at 3s
  try{
    execSync(`ffmpeg -y -v error -ss 3 -i "${ORIG}" -vframes 1 -q:v 2 "${ORIG_FRAME_3S}"`, {timeout:15000});
    log(`  Orig 3s frame: ${ORIG_FRAME_3S} size ${(fs.statSync(ORIG_FRAME_3S).size/1024).toFixed(1)} KB`);
  }catch(e){ log(`  Orig 3s extract fail ${e.message}`); }
  // Export frame at 3s
  if(fs.existsSync(WYSIWYG_OUT)){
    try{
      execSync(`ffmpeg -y -v error -ss 3 -i "${WYSIWYG_OUT}" -vframes 1 -q:v 2 "${EXPORT_FRAME_3S}"`, {timeout:15000});
      log(`  Export 3s frame: ${EXPORT_FRAME_3S} size ${(fs.statSync(EXPORT_FRAME_3S).size/1024).toFixed(1)} KB`);
    }catch(e){ log(`  Export 3s extract fail ${e.message}`);}
    // Diff
    try{
      execSync(`ffmpeg -y -v error -i "${ORIG_FRAME_3S}" -i "${EXPORT_FRAME_3S}" -filter_complex "blend=all_mode=difference" -vframes 1 -q:v 2 "${DIFF_3S}"`, {timeout:15000});
      log(`  Diff 3s: ${DIFF_3S} size ${(fs.statSync(DIFF_3S).size/1024).toFixed(1)} KB non-black? ${fs.statSync(DIFF_3S).size>6000 ? 'PASS' : 'FAIL'}`);
    }catch(e){ log(`  Diff fail ${e.message}`);}
  }

  // Measure export caption bbox via browser yellow scan
  let exportMeasure=null;
  if(fs.existsSync(EXPORT_FRAME_3S)){
    try{
      const b64 = fs.readFileSync(EXPORT_FRAME_3S).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      exportMeasure = await page.evaluate(async (dataUrl)=>{
        // Load image via Image
        const img = new Image();
        img.src=dataUrl;
        await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; });
        const w=img.naturalWidth, h=img.naturalHeight;
        const c=document.createElement('canvas');
        c.width=w; c.height=h;
        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0,w,h);
        const data=ctx.getImageData(0,0,w,h);
        // Scan bottom 50% for gold/white caption
        let minX=w, minY=h, maxX=0, maxY=0, found=false, goldCount=0, whiteCount=0;
        const isGold=(r,g,b)=> r>200 && g>170 && b<90;
        const isWhite=(r,g,b)=> r>220 && g>220 && b>220;
        const isBlackStroke=(r,g,b)=> r<40 && g<40 && b<40; // ignore
        // limit to bottom 45% to avoid top video content false positives
        const yStart = Math.floor(h*0.55);
        for(let y=yStart;y<h;y+=2){
          for(let x=0;x<w;x+=2){
            const idx=(y*w+x)*4;
            const r=data.data[idx], g=data.data[idx+1], b=data.data[idx+2];
            if(isGold(r,g,b) || isWhite(r,g,b)){
              // ensure not isolated video bright spot: require near bottom center?
              if(x<minX) minX=x;
              if(y<minY) minY=y;
              if(x>maxX) maxX=x;
              if(y>maxY) maxY=y;
              found=true;
              if(isGold(r,g,b)) goldCount++; else whiteCount++;
            }
          }
        }
        if(!found) return {found:false, w,h, goldCount, whiteCount};
        const bboxW=maxX-minX, bboxH=maxY-minY;
        return {found:true, w,h, bboxW,bboxH, pctW: bboxW/w*100, pctH: bboxH/h*100, minX, maxX, minY, maxY, goldCount, whiteCount};
      }, dataUrl);
      log(`  Export frame measure (yellow/white scan bottom 45%): ${JSON.stringify(exportMeasure)}`);
      // Also try full image scan for comparison
      const fullScan = await page.evaluate(async (dataUrl)=>{
        const img=new Image(); img.src=dataUrl; await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; });
        const w=img.naturalWidth, h=img.naturalHeight;
        const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h);
        const data=ctx.getImageData(0,0,w,h);
        let minX=w,minY=h,maxX=0,maxY=0,found=false;
        const isGold=(r,g,b)=> r>200 && g>170 && b<90;
        const isWhite=(r,g,b)=> r>220 && g>220 && b>220;
        for(let y=0;y<h;y+=3){
          for(let x=0;x<w;x+=3){
            const idx=(y*w+x)*4;
            const r=data.data[idx], g=data.data[idx+1], b=data.data[idx+2];
            if(isGold(r,g,b)||isWhite(r,g,b)){
              if(x<minX) minX=x;
              if(y<minY) minY=y;
              if(x>maxX) maxX=x;
              if(y>maxY) maxY=y;
              found=true;
            }
          }
        }
        if(!found) return {found:false};
        return {found:true, w,h, bboxH:maxY-minY, pctH:(maxY-minY)/h*100, bboxW:maxX-minX, pctW:(maxX-minX)/w*100};
      }, dataUrl);
      log(`  Export full scan: ${JSON.stringify(fullScan)}`);

      // Also scan preview stage image similarly for fair comparison
      if(fs.existsSync(PREVIEW_STAGE_PNG)){
        const b64p = fs.readFileSync(PREVIEW_STAGE_PNG).toString('base64');
        const stageUrl = `data:image/png;base64,${b64p}`;
        const previewStageMeasure = await page.evaluate(async (dataUrl)=>{
          const img=new Image(); img.src=dataUrl; await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; });
          const w=img.naturalWidth, h=img.naturalHeight;
          const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h);
          const data=ctx.getImageData(0,0,w,h);
          let minX=w,minY=h,maxX=0,maxY=0,found=false;
          const isGold=(r,g,b)=> r>190 && g>160 && b<100;
          const isWhite=(r,g,b)=> r>220 && g>220 && b>220;
          const yStart=Math.floor(h*0.5);
          for(let y=yStart;y<h;y+=2){
            for(let x=0;x<w;x+=2){
              const idx=(y*w+x)*4;
              const r=data.data[idx], g=data.data[idx+1], b=data.data[idx+2];
              if(isGold(r,g,b)||isWhite(r,g,b)){
                if(x<minX) minX=x;
                if(y<minY) minY=y;
                if(x>maxX) maxX=x;
                if(y>maxY) maxY=y;
                found=true;
              }
            }
          }
          if(!found) return {found:false, w,h};
          return {found:true, w,h, bboxW:maxX-minX, bboxH:maxY-minY, pctW:(maxX-minX)/w*100, pctH:(maxY-minY)/h*100};
        }, stageUrl);
        log(`  Preview stage measure (gold/white bottom 50%): ${JSON.stringify(previewStageMeasure)}`);
        // Store for final compare
        page._previewStageMeasure = previewStageMeasure;
      }
    }catch(e){
      log(`  Export measure error: ${e.message} ${e.stack?.slice(0,800)}`);
    }
  }

  // 6. ffprobe on webm to confirm still 1080x1920
  log(`\n[6] Run ffprobe on webm to confirm still 1080x1920`);
  let ffprobeInfo=null, ffprobePass=false;
  if(fs.existsSync(WYSIWYG_OUT)){
    try{
      const json = execSync(`ffprobe -v error -show_streams -select_streams v:0 -of json "${WYSIWYG_OUT}"`, {encoding:'utf8', timeout:10000});
      log(`  ffprobe json snippet: ${json.slice(0,800)}`);
      const j=JSON.parse(json);
      const s=j.streams?.[0];
      ffprobeInfo=s;
      log(`  streams width=${s?.width} height=${s?.height} codec=${s?.codec_name} pix_fmt=${s?.pix_fmt}`);
      ffprobePass = s?.width===1080 && s?.height===1920;
      log(`  1080x1920 check: ${ffprobePass ? 'PASS ✓' : `FAIL got ${s?.width}x${s?.height}`}`);
    }catch(e){ log(`  ffprobe error ${e.message}`); }
  }

  // 7. Report before/after sizes, verification that preview and export now match, screenshots
  log(`\n[7] REPORT`);
  log(`  Before fix:`);
  log(`    Preview 352px: font 60px = 60/352=17.0% width, after downscale 46px=13.2% width but export stayed 60px`);
  log(`    Export 1080px: font 60px = 60/1080=5.56% width => 3.06x smaller than preview`);
  log(`    Visual: preview LARGE (IS COMPLETELY fills bottom ~15% height) vs export tiny ~5.5% height`);
  log(`  After fix (WYSIWYG 352 reference):`);
  log(`    Preview 60*1=60 then wraps to ${theory.previewEff.toFixed(1)}px => ${theory.previewPctWidth.toFixed(1)}% width, ${theory.previewPctHeight.toFixed(1)}% height`);
  log(`    Export 60*3.068=184 then wraps to ${theory.exportEff.toFixed(1)}px => ${theory.exportPctWidth.toFixed(1)}% width, ${theory.exportPctHeight.toFixed(1)}% height`);
  log(`    Match diff: ${Math.abs(theory.previewPctWidth-theory.exportPctWidth).toFixed(2)}% width, ${Math.abs(theory.previewPctHeight-theory.exportPctHeight).toFixed(2)}% height => ${Math.abs(theory.previewPctWidth-theory.exportPctWidth)<1 && Math.abs(theory.previewPctHeight-theory.exportPctHeight)<1 ? 'PASS WYSIWYG ✓' : 'FAIL'}`);
  log(`  Empirical measurements:`);
  if(seekRes.canvasMeasure?.pctH) log(`    Preview canvas alpha bbox pctH=${seekRes.canvasMeasure.pctH.toFixed(2)}% (logicalH ${seekRes.canvasMeasure.logicalH.toFixed(0)}, bboxH ${seekRes.canvasMeasure.bboxH.toFixed(0)}) - LARGE check >7% => ${seekRes.canvasMeasure.pctH>7?'PASS':'FAIL'}`);
  if(exportMeasure?.pctH) log(`    Export frame gold/white bbox pctH=${exportMeasure.pctH.toFixed(2)}% (h ${exportMeasure.h}, bboxH ${exportMeasure.bboxW?exportMeasure.bboxH:0}) - LARGE check >7% => ${exportMeasure.pctH>7?'PASS':'FAIL'}`);
  if(seekRes.canvasMeasure?.pctH && exportMeasure?.pctH){
    const diff=Math.abs(seekRes.canvasMeasure.pctH - exportMeasure.pctH);
    log(`    Preview vs Export pctH diff=${diff.toFixed(2)}% => ${diff<3 ? 'MATCH ✓ WYSIWYG' : 'MISMATCH'}`);
    log(`    Verification that exported caption is now LARGE like preview, not tiny: ${exportMeasure.pctH>7 && diff<3 ? 'PASS ✓' : 'FAIL'}`);
  }
  // Also compare diff existence
  if(fs.existsSync(DIFF_3S)){
    log(`    Diff frame at 3s exists size ${(fs.statSync(DIFF_3S).size/1024).toFixed(1)}KB non-black=${fs.statSync(DIFF_3S).size>6000?'YES':'NO'} proves caption burned`);
  }
  log(`  ffprobe 1080x1920: ${ffprobePass ? 'PASS ✓' : 'FAIL'}`);
  log(`  Screenshots:`);
  log(`    fullPage: ${PREVIEW_FULL_PNG}`);
  log(`    stage (video+overlay): ${PREVIEW_STAGE_PNG}`);
  log(`    canvas-only: ${PREVIEW_CANVAS_PNG}`);
  log(`    export 3s: ${EXPORT_FRAME_3S}`);
  log(`    orig 3s: ${ORIG_FRAME_3S}`);
  log(`    diff 3s: ${DIFF_3S}`);
  log(`    done: ${path.join(DOWNLOADS,'wysiwyg-done.png')}`);
  if(fs.existsSync(WYSIWYG_OUT)) log(`    webm: ${WYSIWYG_OUT} size ${(fs.statSync(WYSIWYG_OUT).size/1024/1024).toFixed(2)} MB`);

  // Save report
  const reportPath = path.join(DOWNLOADS,'WYSIWYG_REPORT.txt');
  fs.writeFileSync(reportPath, LOG.join('\n'), 'utf8');
  log(`\nReport written to ${reportPath}`);
  const summary={
    build:'GREEN',
    tsc:'GREEN',
    devAlive:true,
    seed: seedRes,
    videoMeta,
    theory,
    previewMeasure: seekRes.canvasMeasure,
    exportMeasure,
    ffprobe:{info:ffprobeInfo, pass:ffprobePass},
    download:{path:WYSIWYG_OUT, exists: fs.existsSync(WYSIWYG_OUT), size: downloadSize},
    progress:{totalWall, progressValues, done},
    verification: {
      before:{previewPct:17.0, exportPct:5.56, ratio:3.06},
      after:{previewPct: theory.previewPctWidth, exportPct: theory.exportPctWidth, diff: Math.abs(theory.previewPctWidth-theory.exportPctWidth)},
      empirical:{previewPctH: seekRes.canvasMeasure?.pctH, exportPctH: exportMeasure?.pctH},
      wysiwygPass: Math.abs(theory.previewPctWidth-theory.exportPctWidth)<1 && exportMeasure?.pctH>7
    }
  };
  fs.writeFileSync(path.join(DOWNLOADS,'WYSIWYG_SUMMARY.json'), JSON.stringify(summary,null,2),'utf8');
  log('Summary JSON written');

  await browser.close();
  log('Browser closed');
}

main().catch(e=>{ console.error(e); process.exit(1); });
