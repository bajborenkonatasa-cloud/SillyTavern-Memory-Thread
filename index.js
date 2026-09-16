import {DEFAULTS,CATEGORIES,uid,clone,norm,ensureIds,source,sourceMap,validSources,eligible,emptyMemory,activeRecords,coverage,nextRange,rangeMessages,validateExtraction,applyExtraction,activeBatches,latestScene,latestOverview,recordText,estimateTokens,buildContext,exportMemory,importMemory,EXTRACTION_PROMPT,fingerprint} from './core.js';
import {generate,models} from './api.js';

const KEY='memory_thread', TAG='memory_thread_context';
const ctx=()=>SillyTavern.getContext();
let settings, panel, body, dialog, tab='now', busy=false, writing=false, aborter=null, internalGeneration=false, preview={text:'',tokens:0,selected:[],omitted:[],matches:[]}, previewSerial=0, forced=[],usedForced=[],search='',remembered=new Map(),toastTimer,refreshTimer,life=0,usage=null;
const $=(s,root=document)=>root.querySelector(s);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr=escape;
const scope=()=>`${ctx().groupId||'solo'}:${ctx().characterId??''}:${ctx().getCurrentChatId?.()??ctx().chatId??''}`;
function mem(){const c=ctx();return c.chatMetadata?.[KEY]||emptyMemory();}
function chat(){return ctx().chat||[];}
function notify(title,detail='',action=()=>openPanel('memories')){
  const box=$('#mt-toast');box.replaceChildren();const h=document.createElement('div');h.className='mt-toast-title';h.textContent=title;box.append(h);const d=document.createElement('div');d.className='mt-toast-detail';d.textContent=detail;box.append(d);const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Закрыть уведомление');close.onclick=e=>{e.stopPropagation();box.hidden=true;};box.append(close);box.onclick=()=>{box.hidden=true;action();};box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,9000);
}
function error(e){notify('Не получилось',e.message||String(e),()=>openPanel());}
async function persist(next,expected=scope()){
  if(writing)throw Error('Уже идёт сохранение. Повтори через секунду.');
  if(scope()!==expected)throw Error('Чат переключён. Результат не применён.');
  const c=ctx(),old=c.chatMetadata[KEY],character=c.characters?.[c.characterId];
  const endpoint=c.groupId?'/api/chats/group/get':'/api/chats/get';
  const address=c.groupId?{id:c.chatId}:{ch_name:character?.name,file_name:c.chatId,avatar_url:character?.avatar};
  next.revision=(next.revision||0)+1;c.chatMetadata[KEY]=next;writing=true;
  try{
    await c.saveMetadata();
    // ST's saveMetadata may swallow server errors. Verify the server copy before hiding.
    const response=await fetch(endpoint,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify(address),cache:'no-store'});
    if(!response.ok)throw Error('Не прочитана серверная копия');
    const saved=await response.json();
    if(JSON.stringify(saved?.[0]?.chat_metadata?.[KEY])!==JSON.stringify(next))throw Error('Серверная копия не совпала');
    if(scope()!==expected)throw Error('Чат переключён');
  }catch(e){if(scope()===expected)c.chatMetadata[KEY]=old;throw Error('Не удалось подтвердить сохранение памяти на сервере или чат переключён. Скрытие не выполняется. Повтори после восстановления связи.');}finally{writing=false;}
}
function saveSettings(){ctx().extensionSettings[KEY]=settings;ctx().saveSettingsDebounced();}
function keyValue(){try{return sessionStorage.getItem('memory-thread-api-key')||'';}catch{return '';}}
function setKey(value){try{sessionStorage.setItem('memory-thread-api-key',value);}catch{throw Error('Браузер запретил хранение ключа в сессии.');}}
async function count(text){if(!text)return 0;try{const n=await ctx().getTokenCountAsync(text);return Number.isFinite(n)?n:estimateTokens(text);}catch{return estimateTokens(text);}}
const setPrompt=text=>ctx().setExtensionPrompt(TAG,text,1,settings.depth,false,0);
async function refreshContext(showToast=false){
  const serial=++previewSerial,expected=scope(),epoch=life;
  if(!settings.enabled){preview={text:'',tokens:0,selected:[],omitted:[],matches:[]};setPrompt('');return;}
  const result=await buildContext(mem(),chat(),settings,count,forced);
  if(serial!==previewSerial||scope()!==expected||epoch!==life)return;
  preview=result;setPrompt(result.text);
  if(showToast&&settings.toast){const hit=result.matches.find(m=>chat().length-(remembered.get(m.id)??-10000)>=settings.cooldown);if(hit){remembered.set(hit.id,chat().length);notify('🌙 '+hit.title,`В контексте · совпадение: ${hit.reason}`,()=>{openPanel('memories');editRecord(hit.id);});}}
  const footer=$('#mt-budget');if(footer)footer.textContent=`Память: ${result.tokens} / ${settings.budget} токенов`;
}
function refreshSoon(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshContext().then(()=>render()).catch(error),100);}
function openPanel(nextTab){if(nextTab)tab=nextTab;panel.hidden=false;render();refreshContext().then(()=>{if(tab==='context')render();}).catch(error);}
function modal(title,html,onSubmit,submit='Сохранить'){
  if(dialog.open)dialog.close();dialog.innerHTML=`<form id="mt-form"><h3>${escape(title)}</h3>${html}<div class="mt-error" id="mt-dialog-error" role="alert"></div><div class="mt-row mt-actions"><button type="submit" class="mt-primary">${escape(submit)}</button><button type="button" data-close>Отмена</button></div></form>`;
  $('[data-close]',dialog).onclick=()=>dialog.close();$('#mt-form',dialog).onsubmit=async e=>{e.preventDefault();const form=e.target,button=$('[type=submit]',form);button.disabled=true;try{await onSubmit(new FormData(form));if(dialog.open&&$('#mt-form',dialog)===form)dialog.close();}catch(err){if($('#mt-form',dialog)===form)$('#mt-dialog-error',dialog).textContent=err.message||String(err);else error(err);}finally{button.disabled=false;}};dialog.showModal();
}
function showText(title,text){modal(title,`<pre>${escape(text)}</pre>`,async()=>{},'Понятно');}
function requireIdle(){if(writing)throw Error('Дождись завершения сохранения.');if(busy)throw Error('Дождись завершения обработки или нажми «Отменить запрос».');if(!chat().length)throw Error('Сначала открой чат с сообщениями.');}
async function mutate(fn){requireIdle();const next=clone(mem());fn(next);await persist(next);await refreshContext();render();}
function tags(r){return `<div class="mt-tags"><span class="mt-tag">${escape(CATEGORIES[r.category])}</span>${r.pinned?'<span class="mt-tag">📌 Закреплено</span>':''}${r.locked?'<span class="mt-tag">🔐 Защищено</span>':''}${r.manual?'<span class="mt-tag">✍ Вручную</span>':''}${preview.selected.includes(r.id)?'<span class="mt-tag">↗ В контексте</span>':''}</div>`;}
function renderCard(r){return `<article class="mt-card" data-id="${attr(r.id)}">${tags(r)}<h3>${escape(r.title)}</h3>${r.date?`<div class="mt-date">${escape(r.date)}</div>`:''}<p>${escape(r.text)}</p>${r.quote?`<blockquote>«${escape(r.quote)}»<div class="mt-sub">${escape(r.quoteSpeaker)}</div></blockquote>`:''}${r.knownTo?.length?`<div class="mt-sub">Знают: ${escape(r.knownTo.join(', '))}</div>`:''}<div class="mt-row"><button data-card="edit">Править</button><button data-card="recall">Вспомнить</button><button data-card="flash">Флешбэк</button><button data-card="pin">${r.pinned?'Открепить':'📌'}</button><button data-card="source">Источник</button><button data-card="disable">Отключить</button></div></article>`;}
function render(){
  if(!panel)return;const m=mem(),ch=chat(),records=activeRecords(m,ch),cov=coverage(m,ch),todo=cov.filter(x=>x.eligible&&!x.covered),done=cov.filter(x=>x.eligible&&x.covered).length;
  $('#mt-fab small').textContent=records.length;$('#mt-status').textContent=busy?'Обрабатываю выбранные сообщения…':`Обработано ${done} из ${cov.filter(x=>x.eligible).length} · новых/изменённых: ${todo.length}`;
  $('#mt-progress').hidden=!busy;$('#mt-cancel').hidden=!busy;$('#mt-budget').textContent=`Память: ${preview.tokens} / ${settings.budget} токенов`;
  for(const el of panel.querySelectorAll('[data-tab]'))el.setAttribute('aria-selected',String(el.dataset.tab===tab));
  for(const el of panel.querySelectorAll('[data-work]'))el.disabled=busy;
  if(tab==='now'){
    const scene=latestScene(m,ch),overview=latestOverview(m,ch),invalid=m.records.filter(r=>!r.manual&&!validSources(r.sources,sourceMap(ch))).length;
    body.innerHTML=`<div class="mt-info">${settings.enabled?'🟢 Память включена':'⏸ Память выключена'} · ${settings.mode==='main'?'API Таверны':'Отдельный API'}<br>Ручной режим: нажимай «Запомнить новое» после сцены или каждых 10–15 сообщений.</div><br>${scene?`<article class="mt-card"><div class="mt-kicker">ТЕКУЩАЯ СЦЕНА</div><h3>${escape(scene.date||'Дата не указана')}</h3><p>${escape(scene.scene)}</p></article>`:'<div class="mt-empty"><span>🧵</span>Начнём собирать историю?<br>Нажми «Запомнить новое» или выбери диапазон.<br>Скрытые сообщения тоже доступны для обработки.</div>'}${overview?`<article class="mt-card"><div class="mt-kicker">НИТЬ СЮЖЕТА</div><p>${escape(overview.text)}</p></article>`:''}${invalid?`<div class="mt-info mt-warn">${invalid} записей имеют изменённый или отсутствующий источник и не используются. Обработай изменённый участок заново. Ручные записи сохраняются.</div><br>`:''}${todo.length?`<div class="mt-info">Ещё не обработаны: ${todo.slice(0,25).map(x=>'#'+x.index).join(', ')}${todo.length>25?' …':''}</div>`:''}<br><button data-action="help">Как пользоваться</button>`;
  }else if(tab==='memories'){
    const filtered=records.filter(r=>norm(recordText(r)).includes(norm(search)));
    body.innerHTML=`<div class="mt-row" style="margin-bottom:12px"><button data-action="add" class="mt-primary">＋ Своя запись</button><button data-action="disabled">Отключённые (${m.dismissed.length})</button></div><input class="mt-search" id="mt-search" placeholder="Найти воспоминание…" aria-label="Поиск воспоминаний" value="${attr(search)}">${filtered.length?filtered.sort((a,b)=>b.pinned-a.pinned||b.created-a.created).map(renderCard).join(''):'<div class="mt-empty"><span>🌙</span>Здесь будут события, секреты и реплики.<br>Можно добавить первую запись вручную.</div>'}`;
    $('#mt-search').oninput=e=>{const pos=e.target.selectionStart;search=e.target.value;render();$('#mt-search').focus();$('#mt-search').setSelectionRange(pos,pos);};
  }else if(tab==='history'){
    const batches=activeBatches(m,ch),map=sourceMap(ch);
    body.innerHTML=`<div class="mt-info">Номера как в Таверне: первое сообщение — №0. Сводки привязаны к тексту сообщений; изменённые участки не считаются обработанными.</div><br>${batches.slice().reverse().map(b=>`<article class="mt-card"><div class="mt-kicker">#${Math.min(...b.sources.map(s=>map.get(s.id).index))} — #${Math.max(...b.sources.map(s=>map.get(s.id).index))}</div><h3>${escape(b.date||'Сцена без даты')}</h3><p>${escape(b.summary)}</p><button data-batch="${attr(b.id)}">Открыть исходный текст</button></article>`).join('')||'<div class="mt-empty">Пока нет обработанных сцен.</div>'}<button data-action="unhide">Показать последний скрытый нами диапазон</button>`;
  }else if(tab==='context'){
    body.innerHTML=`<div class="mt-info">${preview.tokens} / ${settings.budget} токенов · ${preview.selected.length} записей.<br>Это зарегистрированный блок расширения. Итоговый запрос также зависит от настроек Таверны и других расширений.</div>${preview.omitted.length?`<br><div class="mt-info mt-warn">Не вместилось: ${preview.omitted.length} блоков. ${preview.omitted.map(id=>escape(records.find(r=>r.id===id)?.title||id)).join('; ')}. Увеличь бюджет или сократи записи.</div>`:''}<pre>${escape(preview.text||'Память пока не отправляется.')}</pre>${forced.length?'<button data-action="clear-forced">Снять ручные напоминания</button>':''}<br><button data-action="refresh">Обновить предпросмотр</button>`;
  }else renderSettings();
}
function input(name,label,value,type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${attr(value)}" ${extra}></label>`;}
function textArea(name,label,value,extra=''){return `<label>${label}<textarea name="${name}" ${extra}>${escape(value)}</textarea></label>`;}
function check(name,label,value){return `<label class="mt-check"><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;}
function renderSettings(){body.innerHTML=`<form id="mt-settings" class="mt-stack"><div class="mt-card"><h3>Контекст и воспоминания</h3>${check('enabled','Включить память',settings.enabled)}<div class="mt-grid">${input('budget','Бюджет памяти, токенов',settings.budget,'number','min="200" max="16000" required')}${input('depth','Глубина в чате',settings.depth,'number','min="0" max="100" required')}${input('chunk','Сообщений за одно нажатие',settings.chunk,'number','min="1" max="100" required')}${input('remind','Напоминать каждые N новых сообщений (0 — выкл.)',settings.remind,'number','min="0" max="100" required')}</div>${check('autoRecall','Подбирать записи по словам и участникам',settings.autoRecall)}${check('toast','Показывать плашки подходящих воспоминаний',settings.toast)}${input('cooldown','Пауза повторной плашки, сообщений',settings.cooldown,'number','min="1" max="100" required')}</div><div class="mt-card"><h3>Модель для памяти</h3><label>Подключение<select name="mode"><option value="main" ${settings.mode==='main'?'selected':''}>Текущее API Таверны</option><option value="separate" ${settings.mode==='separate'?'selected':''}>Отдельное OpenAI-совместимое API</option></select></label>${input('url','Базовый URL (обычно заканчивается на /v1)',settings.url,'text','placeholder="https://provider.example/v1"')}${input('apiKey','Ключ · только в текущей сессии браузера',keyValue(),'password','autocomplete="off"')}${input('model','Название модели',settings.model,'text','list="mt-model-list"')}<datalist id="mt-model-list"></datalist><div class="mt-row"><button type="button" data-action="models">Загрузить модели</button><button type="button" data-action="test-api">Проверить отдельный API</button></div><p class="mt-sub">Отдельное API вызывается браузером напрямую: провайдер должен разрешать CORS. Ключ не входит в экспорт и настройки Таверны. После закрытия сессии его нужно ввести снова.</p><div class="mt-grid">${input('output','Максимум токенов ответа',settings.output,'number','min="512" max="16000" required')}${input('inputLimit','Лимит входа перед отправкой (оценка)',settings.inputLimit,'number','min="1000" max="200000" required')}</div></div><details class="mt-card"><summary>Дополнительные пожелания модели</summary>${textArea('customPrompt','Добавляются к правилам извлечения',settings.customPrompt,'maxlength="8000"')}<p class="mt-sub">Основные правила — в core.js. Здесь можно попросить подробнее сохранять атмосферу или определённые детали.</p></details><button type="submit" class="mt-primary">Сохранить настройки</button></form><br><div class="mt-row"><button data-action="export">Экспорт памяти</button><button data-action="import">Импорт Memory Thread / Facts Tracker</button><button data-action="help">Инструкция</button></div>${usage?`<p class="mt-sub">Последний API-запрос: ${escape(JSON.stringify(usage))}</p>`:''}`;
  $('#mt-settings').onsubmit=e=>{e.preventDefault();try{requireIdle();readSettings(new FormData(e.target));saveSettings();refreshSoon();notify('Настройки сохранены','Можно возвращаться к истории.',()=>openPanel('now'));}catch(err){error(err);}};
}
function readSettings(f){for(const key of ['enabled','autoRecall','toast'])settings[key]=f.has(key);for(const key of ['budget','depth','chunk','remind','cooldown','output','inputLimit'])settings[key]=Number(f.get(key));for(const key of ['url','model','customPrompt'])settings[key]=String(f.get(key)||'').trim();settings.mode=f.get('mode')==='separate'?'separate':'main';setKey(String(f.get('apiKey')||'').trim());}
function editRecord(id){
  requireIdle();const r=activeRecords(mem(),chat()).find(r=>r.id===id)||{id:uid(),key:uid(),title:'',category:'event',text:'',date:'',participants:[],knownTo:[],keywords:[],quote:'',quoteSpeaker:'',importance:'medium',certainty:'fact',sources:[],pinned:false,locked:true};
  modal(id?'Править воспоминание':'Своё воспоминание',`<div class="mt-stack">${input('title','Название',r.title,'text','required maxlength="180"')}<div class="mt-grid"><label>Категория<select name="category">${Object.entries(CATEGORIES).map(([k,v])=>`<option value="${k}" ${r.category===k?'selected':''}>${v}</option>`).join('')}</select></label>${input('date','Дата и время в ролевой',r.date,'text','maxlength="240" placeholder="14 октября 1843 · вечер"')}</div>${textArea('text','Что произошло и почему это важно',r.text,'required maxlength="4000"')}${input('participants','Участники, через запятую',r.participants.join(', '))}${input('knownTo','Кто знает об этом, через запятую',r.knownTo.join(', '))}${input('keywords','Слова для срабатывания, через запятую',r.keywords.join(', '))}${textArea('quote','Точная реплика (необязательно)',r.quote,'maxlength="3000"')}${input('quoteSpeaker','Кто произнёс реплику',r.quoteSpeaker)}<div class="mt-grid"><label>Важность<select name="importance">${['high','medium','low'].map((v,i)=>`<option value="${v}" ${r.importance===v?'selected':''}>${['Высокая','Средняя','Низкая'][i]}</option>`).join('')}</select></label><label>Достоверность<select name="certainty">${['fact','belief','dream','unknown'].map((v,i)=>`<option value="${v}" ${r.certainty===v?'selected':''}>${['Факт','Мнение / подозрение','Сон / видение','Неясно'][i]}</option>`).join('')}</select></label></div>${check('pinned','Закрепить в контексте (в пределах бюджета)',r.pinned)}<div class="mt-info">После сохранения это ручная защищённая запись. ИИ не перезапишет её. Ручную цитату ты подтверждаешь сама.</div></div>`,async f=>{
    const val=k=>String(f.get(k)||'').trim(),list=k=>val(k).split(',').map(s=>s.trim()).filter(Boolean).slice(0,16);
    await mutate(m=>{m.records.push({...r,id:uid(),title:val('title'),category:val('category'),text:val('text'),date:val('date'),participants:list('participants'),knownTo:list('knownTo'),keywords:list('keywords'),quote:val('quote'),quoteSpeaker:val('quoteSpeaker'),importance:val('importance'),certainty:val('certainty'),manual:true,locked:true,pinned:f.has('pinned'),created:Date.now()});m.dismissed=m.dismissed.filter(k=>k!==r.key);});
  });
}
function showSources(sources){if(!sources.length){showText('Источник','Ручная или импортированная запись без привязки к сообщениям.');return;}const map=sourceMap(chat());showText('Исходные сообщения',sources.map(s=>{const v=map.get(s.id),m=v?chat()[v.index]:null;return m?`#${v.index} · ${m.name}\n${m.mes}${v.hash!==s.hash?'\n[Текст изменён после записи]':''}`:`#${s.index} — источник отсутствует в этой ветке`;}).join('\n\n────────\n\n'));}
function chooseRange(){requireIdle();const r=nextRange(mem(),chat(),settings.chunk)||[Math.max(0,chat().length-settings.chunk),chat().length-1];modal('Обработать диапазон',`<div class="mt-info">Номера сообщений как в Таверне, начиная с 0. Скрытые сообщения включаются; уже обработанный диапазон можно пересканировать.</div><br><div class="mt-grid">${input('from','С сообщения №',r[0],'number',`min="0" max="${chat().length-1}" required`)}${input('to','По сообщение № включительно',r[1],'number',`min="0" max="${chat().length-1}" required`)}</div>`,async f=>{const from=Number(f.get('from')),to=Number(f.get('to'));rangeMessages(chat(),from,to);dialog.close();await prepareScan(from,to);},'Показать перед отправкой');}
async function prepareScan(from,to){
  requireIdle();const expected=scope(),epoch=life;
  if(ensureIds(chat()))await ctx().saveChat();
  if(scope()!==expected||epoch!==life)throw Error('Чат переключён. Выбери диапазон снова.');
  const rows=rangeMessages(chat(),from,to).map(x=>({i:x.i,m:clone(x.m)}));if(!rows.length)throw Error('Нет текста для обработки.');
  const m=mem(),overview=latestOverview(m,chat()),batches=activeBatches(m,chat());
  const synopsis=batches.map(b=>({range:b.sources.map(s=>s.index),summary:b.summary}));
  // Keep extraction context bounded: newest overview plus scenes not represented there.
  const included=new Set(overview?.sources.map(s=>s.id)||[]);
  const extra=batches.filter(b=>b.sources.some(s=>!included.has(s.id)));
  const contextSources=[...(overview?.sources||[]),...extra.flatMap(b=>b.sources)];
  const records=activeRecords(m,chat()).map(r=>({key:r.key,text:r.text,locked:r.locked,category:r.category}));
  const system=EXTRACTION_PROMPT.replaceAll('{{user}}',ctx().name1||'user').replaceAll('{{char}}',ctx().name2||'char')+(settings.customPrompt?'\nДополнительные пожелания:\n'+settings.customPrompt:'');
  const prompt=JSON.stringify({existing_overview:overview?.text||'',other_scenes:overview?extra.map(b=>({range:b.sources.map(s=>s.index),summary:b.summary})):synopsis,existing_records:records,messages:rows.map(({i,m})=>({index:i,speaker:m.name,role:m.is_user?'user':'character',text:m.mes}))});
  const estimated=estimateTokens(system+prompt);
  if(estimated>settings.inputLimit)throw Error(`Оценка входа ${estimated} токенов превышает лимит ${settings.inputLimit}. Уменьши диапазон или увеличь лимит входа в настройках под контекст модели.`);
  modal('Запомнить выбранную сцену',`<div class="mt-card"><div class="mt-kicker">#${from} — #${to}</div><h3>${rows.length} сообщений</h3><p>Примерно ${estimated} входных токенов + до ${settings.output} токенов ответа.</p><div class="mt-sub">Это оценка, не цена. Отправляются выбранные сообщения, действующая память и инструкция; исходный старый чат целиком не отправляется.</div></div>${check('hide','После сохранения скрыть этот диапазон',false)}<details><summary>Посмотреть выбранный текст</summary><pre>${escape(rows.map(x=>`#${x.i} ${x.m.name}: ${x.m.mes}`).join('\n\n'))}</pre></details>`,async f=>{
    if(scope()!==expected||epoch!==life)throw Error('Чат переключён. Выбери диапазон снова.');
    dialog.close();await runScan({rows,from,to,system,prompt,contextSources,expected,epoch,hide:f.has('hide')});
  },'Отправить и сохранить');
}
async function runScan(job){
  requireIdle();busy=true;aborter=new AbortController();const signal=aborter.signal;render();
  const revision=mem().revision;try{
    internalGeneration=settings.mode==='main';const result=await generate({...settings},keyValue(),job.system,job.prompt,ctx(),signal);internalGeneration=false;
    if(signal.aborted||scope()!==job.expected||life!==job.epoch)throw Error('Чат переключён или запрос отменён. Результат не применён.');
    const map=sourceMap(chat());if(!validSources([...job.rows.map(r=>source(r.m,r.i)),...job.contextSources],map)||mem().revision!==revision)throw Error('История или память изменилась во время запроса. Повтори обработку.');
    const parsed=validateExtraction(result.text,job.rows),applied=applyExtraction(mem(),parsed,job.rows,job.contextSources);
    await persist(applied.memory,job.expected);usage=result.usage;
    if(job.hide&&scope()===job.expected&&life===job.epoch)await hideRows(job.rows,job.expected);
    await refreshContext();render();notify(`✨ Сцена сохранена · ${parsed.entries.length} записей`,parsed.warnings.length?parsed.warnings.join(' '):`#${job.from}–${job.to}. Можно открыть и поправить воспоминания.`);
  }catch(e){error(e);}finally{internalGeneration=false;busy=false;aborter=null;render();}
}
async function hideRows(rows,expected){
  // Use the native command rather than guessing version-specific hidden flags.
  const ids=rows.filter(r=>!r.m.is_system&&!r.m.is_hidden&&!r.m.extra?.isHidden).map(r=>r.m.extra.memoryThreadId);
  const op={id:uid(),sources:rows.filter(r=>ids.includes(r.m.extra.memoryThreadId)).map(r=>source(r.m,r.i)),created:Date.now()};
  const next=clone(mem());next.hiddenOps.push(op);await persist(next,expected);
  const {executeSlashCommandsWithOptions}=await import('/scripts/slash-commands.js');
  for(const id of ids){if(scope()!==expected)throw Error('Чат переключён. Память сохранена; скрытие остановлено.');const i=chat().findIndex(m=>m.extra?.memoryThreadId===id);if(i<0)throw Error('Сообщение исчезло. Память сохранена; скрытие остановлено.');await executeSlashCommandsWithOptions(`/hide ${i}`);if(!chat()[i]?.is_system&&!chat()[i]?.is_hidden)throw Error('Не удалось подтвердить скрытие. Память сохранена; проверь сообщения вручную.');}
}
async function unhide(){requireIdle();const expected=scope(),next=clone(mem()),op=next.hiddenOps.at(-1);if(!op)throw Error('Нет диапазонов, скрытых этим расширением.');const {executeSlashCommandsWithOptions}=await import('/scripts/slash-commands.js');for(const s of op.sources){if(scope()!==expected)throw Error('Чат переключён.');const i=chat().findIndex(m=>m.extra?.memoryThreadId===s.id);if(i>=0)await executeSlashCommandsWithOptions(`/unhide ${i}`);}next.hiddenOps.pop();await persist(next,expected);render();}
function download(name,data){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importFile(){
  requireIdle();const inputEl=document.createElement('input');inputEl.type='file';inputEl.accept='.json';const expected=scope(),epoch=life;
  inputEl.onchange=async()=>{try{const file=inputEl.files[0];if(!file)return;if(file.size>12e6)throw Error('Файл больше 12 МБ.');const payload=JSON.parse(await file.text());if(scope()!==expected||epoch!==life)throw Error('Чат переключён.');
    if(payload.format==='memory-thread'){
      const imported=importMemory(payload,chat()),active=activeRecords(imported,chat()).length;
      modal('Восстановить память',`<p>В файле ${imported.records.length} версий записей; активных для этого чата: ${active}.</p><p>Заменить текущую память? Сначала будет скачана резервная копия. Источники другой ветки не привязываются автоматически.</p>`,async()=>{requireIdle();if(scope()!==expected||epoch!==life)throw Error('Чат переключён.');download('memory-thread-before-import.json',exportMemory(mem()));await persist(imported,expected);await refreshContext();render();},'Восстановить');
    }else{
      const facts=Array.isArray(payload)?payload:payload.facts||payload.state?.facts||payload.data?.facts;
      if(!Array.isArray(facts)||!facts.length||facts.length>10000)throw Error('Не найден массив facts. Экспортируй один чат из Facts Memory Tracker.');
      const map={characters:'character',events:'event',secrets:'secret',flashbacks:'flashback'};
      const items=facts.filter(f=>typeof f.text==='string'&&f.text.trim()).map(f=>({id:uid(),key:uid(),title:f.text.slice(0,80),text:f.text.slice(0,4000),category:map[f.category]||'event',importance:['high','medium','low'].includes(f.importance)?f.importance:'medium',date:'',participants:[],knownTo:[],keywords:[],quote:'',quoteSpeaker:'',certainty:'fact',sources:[],manual:true,locked:true,pinned:false,disabled:false,created:Date.now()}));
      modal('Импорт фактов',`<p>Добавить ${items.length} записей как ручные защищённые воспоминания?</p><p>Они не имеют проверенных источников. Отредактируй даты, ключевые слова и круг осведомлённых при необходимости.</p>`,async()=>{if(scope()!==expected||epoch!==life)throw Error('Чат переключён.');await mutate(m=>m.records.push(...items));},'Добавить');
    }
  }catch(e){error(e);}};inputEl.click();
}
async function apiAction(action){requireIdle();const f=new FormData($('#mt-settings'));const cfg={...settings,mode:'separate',url:String(f.get('url')||''),model:String(f.get('model')||''),output:32},key=String(f.get('apiKey')||'');if(action==='models'){const list=await models(cfg,key);$('#mt-model-list').innerHTML=list.map(x=>`<option value="${attr(x)}"></option>`).join('');notify('Модели загружены',`${list.length} вариантов. Выбери модель в поле названия.`,()=>{});}else{await generate(cfg,key,'Reply briefly.','Say OK.',ctx());notify('API отвечает','Подключение работает. Сохрани настройки.',()=>{});}}
function help(){showText('Быстрый старт · Нить памяти',`1. Открой чат. Плавающая кнопка 🧵 открывает панель; перетаскивай её за сам кружок.
2. В настройках оставь API Таверны либо задай отдельное OpenAI-совместимое API. Отдельное API требует CORS. Ключ хранится только в сессии браузера.
3. Нажми «Запомнить новое»: выбирается первый необработанный участок, максимум 15 сообщений по умолчанию. «Диапазон» позволяет указать любые номера, начиная с 0.
4. Просмотри оценку объёма, при желании отметь «После сохранения скрыть». Подтверди отправку. Ошибка API не скрывает историю.
5. «Воспоминания» → «Править» защищает твою редакцию от ИИ. «Своя запись» добавляет ручную память. Даты — из ролевой; неизвестные не выдумываются.
6. «Вспомнить» ставит запись в очередь следующего ответа. «Флешбэк» дополнительно просит отразить её в ответе. Если не хватает бюджета, запись остаётся в очереди; проверь вкладку «В контекст».
7. Поиск по словам и участникам бесплатен сам по себе. Высокая важность, закрепление, сводка и текущая сцена также участвуют в отборе. Семантической векторизации нет.
8. Свайпы и правки исключают зависимые старые записи. «Запомнить новое» предложит повторно обработать пропуск. Ручные записи сохраняются; в новой ветке проверь их сама.
9. Экспорт JSON сохраняет память без ключа. Полный экспорт чата Таверны сохраняет исходные сообщения. Делай оба перед переносом.
10. Чтобы не удваивать контекст, отключи отправку памяти других расширений после проверки переноса. Записи в них удалять не нужно.

Нумерация — как в Таверне (#0). Кнопка «Источник» показывает текст в отдельном окне и не раскрывает скрытые сообщения в запросе.
Технически проверены структура ответа, источники и точность автоматически извлечённых цитат. Истинность интерпретации событий зависит от модели: просматривай важные записи.
Бета 1.0.0. Проверено на имитаторе интерфейсов актуальной SillyTavern; твоя сборка и живой провайдер требуют проверки после установки.`);}
async function action(name){
  if(name==='new'){requireIdle();const range=nextRange(mem(),chat(),settings.chunk);if(!range){notify('Всё обработано','Для повторной обработки выбери диапазон.');return;}return prepareScan(...range);}
  if(name==='range')return chooseRange();if(name==='add')return editRecord();if(name==='help')return help();if(name==='export')return download('memory-thread-backup.json',exportMemory(mem()));if(name==='import')return importFile();if(name==='unhide')return unhide();if(name==='refresh'){await refreshContext();render();return;}if(name==='clear-forced'){forced=[];await refreshContext();render();return;}if(name==='models'||name==='test-api')return apiAction(name);
  if(name==='disabled'){const keys=mem().dismissed;modal('Отключённые записи',keys.length?keys.map(k=>{const r=mem().records.find(r=>r.key===k);return `<label class="mt-check"><input type="checkbox" name="restore" value="${attr(k)}">${escape(r?.title||k)}</label>`;}).join(''):'<p>Нет отключённых записей.</p>',async f=>mutate(m=>m.dismissed=m.dismissed.filter(k=>!f.getAll('restore').includes(k))),'Включить отмеченные');}
}
async function cardAction(name,id){const r=activeRecords(mem(),chat()).find(r=>r.id===id);if(!r)return;if(name==='edit')return editRecord(id);if(name==='source')return showSources(r.sources);if(name==='pin')return mutate(m=>{m.records.find(x=>x.id===id).pinned=!r.pinned;});if(name==='disable')return mutate(m=>m.dismissed.push(r.key));if(name==='recall'||name==='flash'){forced=forced.filter(f=>f.id!==id);forced.push({id,mode:name==='flash'?'flash':'recall'});await refreshContext();render();notify(preview.selected.includes(id)?'Добавлено для следующего ответа':'Не хватает бюджета памяти',preview.selected.includes(id)?r.title:'Увеличь лимит или сократи запись. Она остаётся в очереди.',()=>openPanel('context'));}}
function dragFab(fab){let drag=null,suppress=false;fab.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,left:fab.getBoundingClientRect().left,top:fab.getBoundingClientRect().top,moved:false};fab.setPointerCapture(e.pointerId);});fab.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(!drag.moved)return;positionFab(drag.left+dx,drag.top+dy);});fab.addEventListener('pointerup',()=>{if(drag?.moved){settings.left=parseFloat(fab.style.left);settings.top=parseFloat(fab.style.top);saveSettings();suppress=true;}drag=null;});fab.addEventListener('pointercancel',()=>drag=null);fab.onclick=()=>{if(suppress){suppress=false;return;}panel.hidden?openPanel():panel.hidden=true;};}
function positionFab(x,y){const fab=$('#mt-fab');fab.style.right='auto';fab.style.bottom='auto';fab.style.left=Math.max(4,Math.min(innerWidth-64,x))+'px';fab.style.top=Math.max(4,Math.min(innerHeight-64,y))+'px';}
function mount(){
  const fab=document.createElement('button');fab.id='mt-fab';fab.innerHTML='🧵<small>0</small>';fab.title='Нить памяти · перетащи или нажми';fab.setAttribute('aria-label','Открыть Нить памяти');document.body.append(fab);dragFab(fab);if(settings.left!==null)positionFab(settings.left,settings.top);
  panel=document.createElement('section');panel.id='mt-panel';panel.hidden=true;panel.setAttribute('aria-label','Нить памяти');panel.innerHTML=`<header class="mt-head"><div><div class="mt-kicker">MEMORY THREAD · BETA</div><h2>Нить памяти</h2><div class="mt-sub" id="mt-status"></div></div><button class="mt-icon" id="mt-close" aria-label="Закрыть панель">×</button></header><div id="mt-progress" class="mt-progress" hidden></div><div class="mt-toolbar"><button class="mt-primary" data-action="new" data-work>✦ Запомнить новое</button><button data-action="range" data-work>Диапазон</button><button id="mt-cancel" hidden>Отменить запрос</button></div><nav class="mt-tabs" aria-label="Разделы памяти">${[['now','Сейчас'],['memories','Воспоминания'],['history','История'],['context','В контекст'],['settings','⚙ Настройки']].map(([id,t])=>`<button data-tab="${id}" aria-selected="false">${t}</button>`).join('')}</nav><div id="mt-body"></div><footer class="mt-footer"><span id="mt-budget"></span><span class="mt-muted">Ручной режим</span></footer>`;document.body.append(panel);body=$('#mt-body');
  dialog=document.createElement('dialog');dialog.id='mt-dialog';document.body.append(dialog);const toast=document.createElement('aside');toast.id='mt-toast';toast.hidden=true;toast.setAttribute('role','status');document.body.append(toast);
  $('#mt-close').onclick=()=>panel.hidden=true;$('#mt-cancel').onclick=()=>{aborter?.abort();notify('Отмена запрошена','Результат не будет применён. API Таверны может завершить запрос в фоне.');};
  panel.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.dataset.tab){tab=el.dataset.tab;render();return;}const run=async()=>{if(el.dataset.action)await action(el.dataset.action);if(el.dataset.card)await cardAction(el.dataset.card,el.closest('[data-id]').dataset.id);if(el.dataset.batch){const b=mem().batches.find(b=>b.id===el.dataset.batch);if(b)showSources(b.sources);}};run().catch(error);});
  window.addEventListener('resize',()=>{if(settings.left!==null)positionFab(settings.left,settings.top);});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)panel.hidden=true;});
  const target=$('#extensionsMenu');if(target){const b=document.createElement('div');b.className='list-group-item flex-container flexGap5';b.tabIndex=0;b.innerHTML='<span>🧵</span><span>Нить памяти</span>';b.onclick=()=>openPanel();b.onkeydown=e=>{if(e.key==='Enter')openPanel();};target.append(b);}
}
async function attachChat(){life++;aborter?.abort();forced=[];usedForced=[];remembered.clear();previewSerial++;setPrompt('');if(dialog.open)dialog.close();const expected=scope();if(chat().length&&ensureIds(chat()))await ctx().saveChat();if(scope()!==expected)return;await refreshContext();render();}
function installEvents(){const c=ctx(),ev=c.eventTypes||c.event_types,on=(name,fn)=>{if(ev[name])c.eventSource.on(ev[name],fn);};
  on('CHAT_CHANGED',()=>attachChat().catch(error));
  for(const name of ['MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED'])on(name,()=>{previewSerial++;setPrompt('');refreshSoon();});
  on('MESSAGE_SENT',async()=>{if(internalGeneration)return;ensureIds(chat());await refreshContext(true);render();});
  on('MESSAGE_RECEIVED',async()=>{if(internalGeneration)return;ensureIds(chat());const used=new Set(usedForced);forced=forced.filter(f=>!used.has(f.id));usedForced=[];await refreshContext();render();const n=coverage(mem(),chat()).filter(x=>x.eligible&&!x.covered).length;if(settings.remind>0&&n>=settings.remind&&!busy&&chat().length-(remembered.get('reminder')||0)>=settings.remind){remembered.set('reminder',chat().length);notify('🧵 Сохраним сцену?',`${n} сообщений ещё не обработаны.`,()=>openPanel());}});
  on('GENERATION_AFTER_COMMANDS',async(type,options,dryRun)=>{if(internalGeneration||type==='quiet')return;await refreshContext(!dryRun);if(!dryRun)usedForced=forced.filter(f=>preview.selected.includes(f.id)).map(f=>f.id);});
  on('GENERATION_STOPPED',()=>{usedForced=[];});
}
async function init(){if($('#mt-fab'))return;const c=ctx();if(!c.extensionSettings)c.extensionSettings={};settings={...DEFAULTS,...c.extensionSettings[KEY]};mount();installEvents();await attachChat();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
