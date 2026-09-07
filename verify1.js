const { chromium } = require('playwright');
(async()=>{
  const browser = await chromium.launch({headless:true});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // capture console
  const logs=[];
  page.on('console', m=>{ logs.push('['+m.type()+'] '+m.text()); });
  page.on('pageerror', e=> logs.push('[pageerror] '+e.message));
  await page.goto('http://localhost:3000', {waitUntil:'networkidle', timeout:15000});
  await page.waitForTimeout(1500);
  const links = await page.evaluate(()=> Array.from(document.querySelectorAll('a')).map(a=> ({href:a.getAttribute('href'), text:a.innerText.slice(0,160)})));
  console.log('LINKS', JSON.stringify(links.slice(0,30), null, 2));
  const dbContent = await page.evaluate(async()=>{
    return new Promise((resolve)=>{
      const req = indexedDB.open('capai_db');
      req.onsuccess=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('projects')){ resolve({noStore:true, stores:Array.from(db.objectStoreNames)}); return; }
        const tx=db.transaction('projects','readonly');
        const store=tx.objectStore('projects');
        const getAll=store.getAll();
        getAll.onsuccess=()=>{
          const vals=getAll.result;
          resolve(vals.map(p=> ({id:p.id, name:p.name, segments: p.segments?.length, hasBlob: !!p.videoBlob, blobSize: p.videoBlob?.size || 0, captionStyle: p.captionStyle, mode:p.settings?.mode, videoDims: p.videoDims || null })));
        };
        getAll.onerror=()=> resolve({err:String(getAll.error)});
      };
      req.onerror=()=> resolve({err:String(req.error)});
    });
  });
  console.log('DB_PROJECTS', JSON.stringify(dbContent, null, 2));
  console.log('LOGS', logs.slice(0,80).join('\n'));
  await page.screenshot({path: 'C:/Users/adams/AppData/Local/Temp/opencode/capai-dashboard.png', fullPage:true});
  console.log('SCREENSHOT saved');
  await browser.close();
})().catch(e=>{ console.error(e.stack||e); process.exit(1)})
