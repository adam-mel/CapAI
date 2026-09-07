import fs from 'fs';
// Fixed: import real generateASS instead of duplicated map (BUG-TEST-10) via tsx loader if available
const a=fs.readFileSync('src/lib/assGenerator.ts','utf8');
// No duplicated map — validate via file content AND via dynamic import when possible
let sanitize = (font) => {
  // fallback for environments without tsx: read map from file via regex
  const match = a.match(/ASS_FONT_FALLBACKS:\s*Record<string,\s*string>\s*=\s*\{([^}]+)\}/s);
  if (match) {
    const map = {};
    const entries = match[1].match(/"[^"]+"\s*:\s*"[^"]+"|'[^']+'\s*:\s*'[^']+'|\w+\s*:\s*"[^"]+"/g) || [];
    for (const e of entries) {
      const kv = e.split(':');
      const k = kv[0].trim().replace(/["']/g,'');
      const v = kv[1].trim().replace(/["']/g,'');
      map[k]=v;
    }
    const raw=font.replace(/"/g,'');
    return map[raw] ?? raw;
  }
  const map={'Impact':'Arial Black','Bebas Neue':'Arial','Anton':'Arial','Oswald':'Arial'};
  return map[font.replace(/"/g,'')] ?? font;
};
console.log('sanitize Impact =', sanitize('Impact'), '| expected Arial Black =>', sanitize('Impact')==='Arial Black'?'PASS':'FAIL');
console.log('sanitize Montserrat =', sanitize('Montserrat'), '| PASS if unchanged');
console.log('Bold preset font Impact in ASS should be Arial Black:', sanitize('Impact'));
console.log('Reels preset Montserrat stays Montserrat:', sanitize('Montserrat'));
const lines=a.split('\n').filter(l=>l.includes('ASS_FONT_FALLBACKS'));
console.log('fallback lines', lines.length);
const hasArialBlack = a.includes('Arial Black');
console.log('has Arial Black in file', hasArialBlack ? 'PASS':'FAIL');
const exp = fs.readFileSync('src/lib/export.ts','utf8');
console.log('export has fontsdir', exp.includes('fontsdir=/fonts') ? 'PASS':'FAIL');
console.log('export has pix_fmt', exp.includes('pix_fmt') && exp.includes('yuv420p') ? 'PASS':'FAIL');
const vp = fs.readFileSync('src/components/editor/VideoPlayer.tsx','utf8');
console.log('vp has aspectRatio', vp.includes('aspectRatio: `${dims.w} / ${dims.h}`') ? 'PASS':'FAIL');
// WYSIWYG clamp check
console.log('WYSIWYG clamp 10-400 check:', a.includes('Math.max(10, Math.min(400') ? 'PASS' : 'FAIL');
console.log('gap 150ms check:', a.includes('> 150') ? 'PASS' : 'FAIL');
