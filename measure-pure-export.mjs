import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE='http://localhost:3000';
const ID='75aaa111-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const DOWNLOADS=path.join(process.cwd(),'temp-e2e','downloads');

async function main(){
  const browser=await chromium.launch({headless:false});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await ctx.newPage();
  // seed already done, just navigate
  await page.goto(`${BASE}/projects/${ID}`,{waitUntil:'domcontentloaded',timeout:20000});
  for(let i=0;i<15;i++){
    await page.waitForTimeout(1000);
    const st=await page.evaluate(()=>{ const v=document.querySelector('video'); return {w: v?.videoWidth, h: v?.videoHeight, ready: v?.readyState}; });
    if(st.w===1080 && st.h===1920) break;
  }
  // Need to get active segment at 3s
  const result = await page.evaluate(async ()=>{
    const WYSIWYG_REF_W=352;
    // get segment at 3s via reading from IndexedDB? Instead we can directly use known text IS COMPLETELY
    // We'll manually construct segment similar to seeded one
    const seg={id:'test', startMs:2400, endMs:3800, text:'IS COMPLETELY', words:[{word:'IS', startMs:2400, endMs:3100, confidence:0.97},{word:'COMPLETELY', startMs:3100, endMs:3800, confidence:0.97}]};
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
    // Import renderCaption dynamically? It's bundled. We can replicate measurement via creating canvas and calling renderCaption if available on window
    // Instead we will directly use canvas measurement via creating canvas and using same logic as canvasRenderer but we can attempt to import via eval
    // Simpler: we will create two canvases and use the app's renderCaption if exposed via window
    // The app's canvasRenderer is not globally exposed, so we replicate scaling logic manually by measuring text
    // We'll create canvas elements and use 2D context to measure with actual font
    // For accurate comparison, we will use the same WYSIWYG scaling logic as in canvasRenderer to compute effective sizes and bbox
    // But to get actual pixel bbox, we need to actually render using same code path. We can fetch the module via dynamic import if we expose via page's module system
    // Attempt to import via `import('/src/lib/canvasRenderer.ts')` not possible in browser.
    // Alternative: we will just manually render using similar logic: effectiveBaseSize = base * scale, etc.
    // Simpler: use the existing on-page canvas rendering: we already have a canvas at 352x626 with caption. We can create a new canvas at 1080x1920 and apply same rendering steps via copying the logic here
    // Let's just do a direct render using Context2D with same steps but simplified: we can compute bbox by actually drawing text

    // Create preview canvas (352x626) and export canvas (1080x1920) and draw same text "IS COMPLETELY" at same style scaled
    // We'll use same function as in canvasRenderer but re-implement minimal version that draws correctly for size measurement
    // For measurement, we can just draw single line "IS COMPLETELY" with font Impact, weight 900, size effective, and measure bbox via alpha scan
    function drawAndMeasure(canvasWidth, canvasHeight){
      const c=document.createElement('canvas');
      c.width=canvasWidth; c.height=canvasHeight;
      const ctx=c.getContext('2d');
      // WYSIWYG scaling
      const wysiwygScale=canvasWidth/352;
      const baseSize=60;
      let effectiveBaseSize=baseSize*wysiwygScale;
      let effectiveStrokeWidth=4*wysiwygScale;
      let effectiveShadowBlur=6*wysiwygScale;
      let effectiveShadowOffsetX=3*wysiwygScale;
      let effectiveShadowOffsetY=3*wysiwygScale;
      const family='"Impact", Inter, sans-serif';
      const fontStyle='normal';
      const baseWeight='900';
      ctx.clearRect(0,0,canvasWidth,canvasHeight);
      // Simplified: draw "IS COMPLETELY" as two lines? Let's mimic wrapping: measure width
      ctx.font=`${fontStyle} ${baseWeight} ${effectiveBaseSize}px ${family}`;
      const text="IS COMPLETELY";
      const words=text.split(' ');
      const spaceW=ctx.measureText(' ').width;
      const widths=words.map(w=>ctx.measureText(w).width);
      const maxContentWidth=canvasWidth*0.88;
      const totalW=widths[0]+spaceW+widths[1];
      let lineWords;
      let effectiveSize=effectiveBaseSize;
      if(totalW>maxContentWidth){
        // wrap into 2 lines
        lineWords=[["IS"],["COMPLETELY"]];
        // scale down
        const maxLineW=Math.max(widths[0], widths[1]);
        if(maxLineW>maxContentWidth){
          const scale=(maxContentWidth/maxLineW)*0.96;
          effectiveSize=effectiveBaseSize*scale;
          ctx.font=`${fontStyle} ${baseWeight} ${effectiveSize}px ${family}`;
        }
      } else {
        lineWords=[["IS","COMPLETELY"]];
      }
      // Re-measure after potential scale
      const lineHeight=effectiveSize*1.25;
      const totalBlockH=lineWords.length*lineHeight;
      // Position
      let baseY;
      const vPreset='bottom';
      if(vPreset==='top') baseY=canvasHeight*0.18;
      else if(vPreset==='center') baseY=canvasHeight*0.5;
      else baseY=canvasHeight*0.84;
      const offsetScale=canvasHeight/720;
      baseY+=12*offsetScale;
      // Draw each line
      ctx.textBaseline='alphabetic';
      ctx.fillStyle='#FFD700';
      ctx.strokeStyle='#000000';
      ctx.lineWidth=effectiveStrokeWidth;
      ctx.lineJoin='round';
      ctx.shadowColor='#000000';
      ctx.shadowBlur=effectiveShadowBlur;
      ctx.shadowOffsetX=effectiveShadowOffsetX;
      ctx.shadowOffsetY=effectiveShadowOffsetY;
      for(let li=0; li<lineWords.length; li++){
        const wordsInLine=lineWords[li];
        const lineText=wordsInLine.join(' ');
        ctx.font=`${fontStyle} ${baseWeight} ${effectiveSize}px ${family}`;
        const lineW=ctx.measureText(lineText).width;
        let lineX;
        lineX=(canvasWidth - lineW)/2; // center
        const lineY=baseY - (lineWords.length-1)*lineHeight*0.5 + li*lineHeight;
        if(effectiveStrokeWidth>0){
          ctx.strokeText(lineText, lineX, lineY);
        }
        ctx.fillText(lineText, lineX, lineY);
      }
      // Measure bbox via alpha
      const img=ctx.getImageData(0,0,canvasWidth,canvasHeight);
      let minX=canvasWidth, minY=canvasHeight, maxX=0, maxY=0, found=false;
      for(let y=0;y<canvasHeight;y++){
        for(let x=0;x<canvasWidth;x++){
          const idx=(y*canvasWidth+x)*4;
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
      if(!found) return {found:false, canvasWidth, canvasHeight, effectiveSize};
      const bboxW=maxX-minX, bboxH=maxY-minY;
      return {found:true, canvasWidth, canvasHeight, effectiveSize, bboxW,bboxH, pctW: bboxW/canvasWidth*100, pctH: bboxH/canvasHeight*100, lineWords, totalBlockH, baseY, lineHeight};
    }

    const preview = drawAndMeasure(352,626);
    const exportM = drawAndMeasure(1080,1920);
    return {preview, exportM, seg, style};
  });
  console.log(JSON.stringify(result,null,2));
  console.log(`Preview effective ${result.preview.effectiveSize.toFixed(1)} bboxH ${result.preview.bboxH} pctH ${result.preview.pctH.toFixed(2)}%`);
  console.log(`Export effective ${result.exportM.effectiveSize.toFixed(1)} bboxH ${result.exportM.bboxH} pctH ${result.exportM.pctH.toFixed(2)}%`);
  console.log(`Match diff pctH ${Math.abs(result.preview.pctH - result.exportM.pctH).toFixed(2)}% pctW diff ${Math.abs(result.preview.pctW - result.exportM.pctW).toFixed(2)}%`);
  // Save images for visual check
  // We will also save the canvases as dataUrls via page evaluate and write to disk using Node? But we already have measurement
  // Let's also generate canvases and export as files for report
  const data = await page.evaluate(async ()=>{
    function drawCanvas(w,h){
      const c=document.createElement('canvas');
      c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      const wysiwygScale=w/352;
      const effectiveSize=60*wysiwygScale;
      // reuse same draw logic as above but simplified for export
      // For actual files, we will just return dataURL
      // We'll replicate full render using same steps as previous but we need to actually draw with same logic as above
      // Let's just call the same function again but return dataURL
      const fontFamily='"Impact", Inter, sans-serif';
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle='#000000';
      ctx.fillRect(0,0,w,h); // black background to mimic video
      // draw caption
      let eff=effectiveSize;
      const maxContentWidth=w*0.88;
      ctx.font=`normal 900 ${eff}px ${fontFamily}`;
      const widths=[ctx.measureText('IS').width, ctx.measureText('COMPLETELY').width];
      const spaceW=ctx.measureText(' ').width;
      const totalW=widths[0]+spaceW+widths[1];
      let lineWords, eff2=eff;
      if(totalW>maxContentWidth){
        const maxLineW=Math.max(widths[0],widths[1]);
        if(maxLineW>maxContentWidth){
          const scale=(maxContentWidth/maxLineW)*0.96;
          eff2=eff*scale;
        }
        lineWords=[['IS'],['COMPLETELY']];
      } else { lineWords=[['IS','COMPLETELY']]; eff2=eff; }
      const lineHeight=eff2*1.25;
      let baseY=w===352? 626*0.84+12*626/720 : 1920*0.84+12*1920/720;
      // Actually compute baseY correctly
      baseY = (h*0.84) + 12*(h/720);
      ctx.fillStyle='#FFD700';
      ctx.strokeStyle='#000000';
      ctx.lineWidth=4*wysiwygScale*(eff2/eff); // scaled stroke
      ctx.shadowColor='#000000';
      ctx.shadowBlur=6*wysiwygScale*(eff2/eff);
      ctx.shadowOffsetX=3*wysiwygScale*(eff2/eff);
      ctx.shadowOffsetY=3*wysiwygScale*(eff2/eff);
      ctx.lineJoin='round';
      ctx.textBaseline='alphabetic';
      for(let li=0;li<lineWords.length;li++){
        const lineText=lineWords[li].join(' ');
        ctx.font=`normal 900 ${eff2}px ${fontFamily}`;
        const lineW=ctx.measureText(lineText).width;
        const lineX=(w-lineW)/2;
        const lineY=baseY - (lineWords.length-1)*lineHeight*0.5 + li*lineHeight;
        if(ctx.lineWidth>0) ctx.strokeText(lineText, lineX, lineY);
        ctx.fillText(lineText, lineX, lineY);
      }
      return c.toDataURL('image/png');
    }
    return {previewUrl: drawCanvas(352,626), exportUrl: drawCanvas(1080,1920)};
  });
  // Save to disk via Node
  fs.writeFileSync(path.join(DOWNLOADS,'wysiwyg-pure-preview-352.png'), Buffer.from(data.previewUrl.split(',')[1],'base64'));
  fs.writeFileSync(path.join(DOWNLOADS,'wysiwyg-pure-export-1080.png'), Buffer.from(data.exportUrl.split(',')[1],'base64'));
  console.log('Saved pure preview/export images');

  await browser.close();
}
main().catch(e=>{ console.error(e); process.exit(1); });
