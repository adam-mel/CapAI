import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DOWNLOADS = path.join(process.cwd(), 'temp-e2e', 'downloads');
const PREVIEW_CANVAS = path.join(DOWNLOADS, 'wysiwyg-preview-03-canvas.png');
const DIFF = path.join(DOWNLOADS, 'wysiwyg-diff-3s.jpg');
const PREVIEW_STAGE = path.join(DOWNLOADS, 'wysiwyg-preview-03-stage.png');
const EXPORT_FRAME = path.join(DOWNLOADS, 'wysiwyg-export-3s.jpg');
const ORIG_FRAME = path.join(DOWNLOADS, 'wysiwyg-orig-3s.jpg');

async function measureCanvasAlpha(file){
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width, height, channels} = info;
  let minX=width, minY=height, maxX=0, maxY=0, found=false;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const idx=(y*width+x)*channels;
      const a=data[idx+3];
      if(a>15){
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
        found=true;
      }
    }
  }
  if(!found) return {found:false, width,height};
  const bboxW=maxX-minX, bboxH=maxY-minY;
  return {found:true, width,height, bboxW,bboxH, pctW: bboxW/width*100, pctH: bboxH/height*100, minX,maxX,minY,maxY};
}

async function measureDiffNonBlack(file){
  const {data, info} = await sharp(file).raw().toBuffer({resolveWithObject:true});
  const {width,height,channels} = info;
  let minX=width, minY=height, maxX=0, maxY=0, found=false;
  // diff image: black where no difference, bright where difference (captions)
  // threshold: sum >30
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const idx=(y*width+x)*channels;
      const r=data[idx], g=data[idx+1], b=data[idx+2];
      const sum=r+g+b;
      if(sum>30){
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
        found=true;
      }
    }
  }
  if(!found) return {found:false, width,height};
  const bboxW=maxX-minX, bboxH=maxY-minY;
  return {found:true, width,height,bboxW,bboxH, pctW:bboxW/width*100, pctH:bboxH/height*100, minX,maxX,minY,maxY};
}

async function measureExportCaptionDirect(file){
  const {data, info} = await sharp(file).raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info;
  let minX=width, minY=height, maxX=0, maxY=0, found=false;
  // scan for gold/white bottom 50%
  const yStart=Math.floor(height*0.55);
  for(let y=yStart;y<height;y++){
    for(let x=0;x<width;x++){
      const idx=(y*width+x)*channels;
      const r=data[idx], g=data[idx+1], b=data[idx+2];
      const isGold = r>200 && g>170 && b<90;
      const isWhite = r>220 && g>220 && b>220;
      if(isGold||isWhite){
        if(x<minX) minX=x;
        if(y<minY) minY=y;
        if(x>maxX) maxX=x;
        if(y>maxY) maxY=y;
        found=true;
      }
    }
  }
  if(!found) return {found:false, width,height};
  return {found:true, width,height,bboxW:maxX-minX,bboxH:maxY-minY,pctW:(maxX-minX)/width*100,pctH:(maxY-minY)/height*100,minX,maxX,minY,maxY};
}

async function main(){
  console.log('=== MEASURE DIFF ===');
  if(fs.existsSync(PREVIEW_CANVAS)){
    const m=await measureCanvasAlpha(PREVIEW_CANVAS);
    console.log('PREVIEW_CANVAS alpha bbox:', JSON.stringify(m, null,2));
    console.log(`  pctH=${m.pctH?.toFixed(2)}% pctW=${m.pctW?.toFixed(2)}%`);
  } else console.log('missing preview canvas');

  if(fs.existsSync(PREVIEW_STAGE)){
    const m2=await measureDiffNonBlack(PREVIEW_STAGE); // stage not diff, will be huge, skip
    console.log('PREVIEW_STAGE diff (not meaningful) but raw non-black full image? we skip');
  }
  if(fs.existsSync(DIFF)){
    const m=await measureDiffNonBlack(DIFF);
    console.log('DIFF non-black bbox:', JSON.stringify(m, null,2));
    if(m.found) console.log(`  pctH=${m.pctH.toFixed(2)}% pctW=${m.pctW.toFixed(2)}% height ${m.bboxH} of ${m.height}`);
  }
  if(fs.existsSync(EXPORT_FRAME)){
    const m=await measureExportCaptionDirect(EXPORT_FRAME);
    console.log('EXPORT direct gold/white bottom scan:', JSON.stringify(m,null,2));
  }
  if(fs.existsSync(ORIG_FRAME)){
    const stat=fs.statSync(ORIG_FRAME);
    console.log(`ORIG_FRAME size ${stat.size}`);
  }
  if(fs.existsSync(EXPORT_FRAME)){
    console.log(`EXPORT_FRAME size ${fs.statSync(EXPORT_FRAME).size}`);
  }
  // Also measure preview stage vs orig? For thorough, measure preview stage diff via sharp? Could blend original?
  // We'll compute predicted theoretical pct
  const WYSIWYG_REF_W=352;
  const previewScale=352/352;
  const exportScale=1080/352;
  const base=60;
  const previewRaw=base*previewScale;
  const exportRaw=base*exportScale;
  // Simulate wrapping with actual measureText via sharp? Use canvas estimate via node-canvas? Simplify using previous theory 51.7 vs 158.7
  console.log('\nTheory: preview 51.7px (14.7% width) export 158.7px (14.7% width) both ~10.3% height single line, 20.6% for 2 lines');
  // Check diff pctH should be similar to preview canvas pctH after scaling for resolution
  // preview canvas logical 352x626, diff is 1080x1920 => ratio 3.068, so pct should be similar (since both are %)
}

main().catch(e=>{ console.error(e); process.exit(1); });
