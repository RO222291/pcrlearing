(() => {
  'use strict';
  globalThis.mathAsset = path => globalThis.MATH_ASSETS[path] || path;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href), base = new URL('.', location.href);
    const key = url.href.startsWith(base.href) ? url.pathname.slice(base.pathname.length) : '';
    if (globalThis.MATH_DATA[key] && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(globalThis.MATH_DATA[key], (k,v) => typeof v === 'string' && globalThis.MATH_ASSETS[v] ? globalThis.MATH_ASSETS[v] : v), {headers:{'Content-Type':'application/json'}});
    }
    return nativeFetch(input, init);
  };
  document.querySelectorAll('[data-math-src]').forEach(el => el.src = mathAsset(el.dataset.mathSrc));
  const dictionary = Object.fromEntries(Object.entries(globalThis.MATH_EN || {}).map(([k,v])=>[k.trim(),v])), han = /[\u3400-\u9fff]/;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const templates = Object.entries(dictionary).filter(([s])=>s.includes('{{')).map(([s,en]) => {
    const ids = [...s.matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]);
    return { re: new RegExp('^'+s.split(/\{\{\d+\}\}/).map(esc).join('([\\s\\S]*?)')+'$'), en, ids };
  });
  const keys = Object.keys(dictionary).filter(s=>s && !s.includes('{{') && han.test(s)).sort((a,b)=>b.length-a.length);
  const fragments = new RegExp(keys.map(esc).join('|'),'g');
  const cache=new Map(), missing=new Set();
  function translate(text, depth=0) {
    const s=String(text).trim();if(!han.test(s))return s;if(dictionary[s])return dictionary[s];if(cache.has(s))return cache.get(s);
    if(depth<3)for(const rule of templates){const match=s.match(rule.re);if(match){let out=rule.en;rule.ids.forEach((id,i)=>{out=out.replaceAll('{{'+id+'}}',(translate(match[i+1],depth+1) ?? match[i+1]))});if(!han.test(out)){cache.set(s,out);return out}}}
    const out=s.replace(fragments,k=>dictionary[k]);
    if(han.test(out)){missing.add(s);return null;}cache.set(s,out);return out;
  }
  globalThis.mathBilingual={translate,missing,dictionary};
  const originals=new WeakMap(),attributeOriginals=new WeakMap();
  function attributes(el){
    if(el.closest('[data-math-en]'))return;
    for(const name of ['title','aria-label','placeholder','alt']){
      const current=el.getAttribute(name);if(!current||!han.test(current))continue;
      let record=attributeOriginals.get(el)||{};if(record[name]?.result===current)continue;
      const en=translate(current);if(en){const result=current+' / '+en;record[name]={source:current,result};attributeOriginals.set(el,record);el.setAttribute(name,result)}
    }
    if(el.tagName==='IMG'&&el.alt&&han.test(el.alt)&&el.closest('figure')&&!el.closest('figure').querySelector('[data-math-image-caption]')){
      const en=translate(attributeOriginals.get(el)?.alt?.source||el.alt);if(en){const caption=document.createElement('figcaption');caption.dataset.mathImageCaption='';caption.dataset.mathEn='';caption.lang='en';caption.textContent=en;el.closest('figure').append(caption);
      if(el.src.startsWith('data:image/svg+xml;base64,')){
        const xml=new DOMParser().parseFromString(new TextDecoder().decode(Uint8Array.from(atob(el.src.split(',')[1]),c=>c.charCodeAt(0))),'image/svg+xml');
        const labels=[...new Set([...xml.querySelectorAll('text')].map(n=>n.textContent.trim()).filter(s=>han.test(s)))];
        if(labels.length){const glossary=document.createElement('div');glossary.className='math-diagram-key';glossary.dataset.mathEn='';for(const label of labels){const en=translate(label);if(en){const item=document.createElement('span');item.textContent=label+' / '+en;glossary.append(item)}}caption.after(glossary)}
      }}
    }
  }
  function text(node){
    const parent=node.parentElement;if(!parent||!han.test(node.data)||parent.closest('script,style,textarea,code,[data-math-en]'))return;
    if(parent.namespaceURI==='http://www.w3.org/2000/svg')return;
    const en=translate(node.data);if(!en)return;
    if(parent.tagName==='OPTION'||parent.tagName==='TITLE'){const prev=originals.get(node);if(prev===node.data)return;node.data=node.data+' / '+en;originals.set(node,node.data);return;}
    if(parent.classList.contains('math-pair')){const translated=parent.querySelector('[data-math-en]');if(translated)translated.textContent=en;return;}
    const pair=document.createElement('span');pair.className='math-pair';node.before(pair);pair.append(node);
    const translated=document.createElement('span');translated.className='math-en';translated.dataset.mathEn='';translated.lang='en';translated.textContent=en;pair.append(translated);
  }
  function process(root){
    if(root.nodeType===3){text(root);return}if(root.nodeType!==1||root.closest('[data-math-en]'))return;
    attributes(root);const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())nodes.push(n);
    for(const n of nodes){if(n.nodeType===3)text(n);else attributes(n)}
  }
  const config={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','alt']};
  const observer=new MutationObserver(records=>{observer.disconnect();const roots=new Set();for(const r of records){if(r.type==='childList')r.addedNodes.forEach(n=>roots.add(n));else roots.add(r.target)}for(const r of roots)if(r.isConnected)process(r);observer.observe(document.body,config)});
  process(document.body);observer.observe(document.body,config);globalThis.mathBilingual.disconnect=()=>observer.disconnect();
  if(globalThis.CanvasRenderingContext2D){
    const draw=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(value,x,y,maxWidth){
      draw.call(this,value,x,y,...(maxWidth?[maxWidth]:[]));
      if(han.test(String(value))){const en=translate(value);if(en){this.save();this.font='12px Arial';draw.call(this,en,x,y+18,Math.max(40,maxWidth||this.canvas.width-x-28));this.restore();}}
    };
  }
  if(navigator.clipboard?.writeText){const write=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=value=>{const en=han.test(String(value))?translate(value):null;return write(en?value+'\n\n'+en:value)}}
  ['alert','confirm','prompt'].forEach(name=>{const original=globalThis[name].bind(globalThis);globalThis[name]=(message,...args)=>{const en=translate(message);return original(en?message+'\n\n'+en:message,...args)}});
})();
