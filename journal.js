// Local journal helpers. No network or SillyTavern dependencies.
import {norm, recordText} from './core.js';

export function makeChapters(batches, map, size=5){
  const n=Math.max(1,Number(size)||5), chapters=[];
  for(let i=0;i<batches.length;i+=n){
    const scenes=batches.slice(i,i+n);
    const indices=scenes.flatMap(b=>b.sources.map(s=>map.get(s.id)?.index).filter(Number.isInteger));
    chapters.push({
      number:chapters.length+1,
      from:indices.length?Math.min(...indices):null,
      to:indices.length?Math.max(...indices):null,
      scenes,
      title:`Глава ${chapters.length+1}`,
      date:scenes.map(s=>s.date).filter(Boolean).join(' → '),
      text:scenes.map(s=>s.summary).filter(Boolean).join('\n\n')
    });
  }
  return chapters;
}

export function topicMatches(records, query){
  const q=norm(query); if(!q)return [];
  const parts=q.split(' ').filter(Boolean);
  return records.map(r=>{
    const text=norm(recordText(r));
    let score=0;
    if(text.includes(q))score+=8;
    for(const p of parts)if(text.includes(p))score+=2;
    for(const p of r.participants||[])if(norm(p).includes(q)||q.includes(norm(p)))score+=5;
    for(const k of r.keywords||[])if(norm(k).includes(q)||q.includes(norm(k)))score+=4;
    if(r.pinned)score+=1;
    return {record:r,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.record.created-a.record.created).map(x=>x.record);
}

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function diaryHtml({title='Memory Thread',chapters=[],records=[]}){
  const chapterHtml=chapters.map(ch=>`<section class="chapter"><div class="orn">✦ ❦ ✦</div><h2>${esc(ch.title)}</h2><div class="meta">${ch.from!==null?`Сообщения #${ch.from}–#${ch.to}`:''}${ch.date?` · ${esc(ch.date)}`:''}</div>${ch.scenes.map((s,i)=>`<article><h3>Сцена ${i+1}${s.date?` · ${esc(s.date)}`:''}</h3><p>${esc(s.summary)}</p><details><summary>Текущее состояние сцены</summary><p>${esc(s.scene)}</p></details></article>`).join('')}</section>`).join('');
  const memories=records.map(r=>`<article class="memory"><h3>${esc(r.title)}</h3><div class="meta">${esc(r.category)}${r.date?` · ${esc(r.date)}`:''}</div><p>${esc(r.text)}</p>${r.knownTo?.length?`<div class="meta">👁 Знают: ${esc(r.knownTo.join(', '))}</div>`:''}</article>`).join('');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:#15131a;color:#ece8f3;font:16px/1.6 system-ui,-apple-system,sans-serif}main{max-width:860px;margin:auto;padding:28px 18px 80px}header{text-align:center;padding:34px 12px}.orn{letter-spacing:8px;color:#d7b9ef}.sub,.meta{opacity:.65;font-size:13px}.chapter,.memory{background:#ffffff08;border:1px solid #d8c4eb24;border-radius:18px;padding:18px;margin:16px 0;box-shadow:0 12px 35px #0003}.chapter{border-left:4px solid #b895dc}.memory{border-left:4px solid #dfb46d}h1,h2,h3{font-family:Georgia,serif}article{padding:8px 0;border-top:1px solid #ffffff0d}article:first-of-type{border-top:0}details{margin-top:8px}summary{cursor:pointer;color:#d9c4ef}.divider{text-align:center;margin:34px 0;color:#c8addf}</style><main><header><div class="orn">✧ ✦ 🧵 ✦ ✧</div><h1>${esc(title)}</h1><div class="sub">Экспорт дневника Memory Thread</div></header>${chapterHtml||'<p>Хроника пока пуста.</p>'}<div class="divider">✦ · · · ✦</div><h2>🌙 Воспоминания</h2>${memories||'<p>Воспоминаний пока нет.</p>'}</main></html>`;
}
