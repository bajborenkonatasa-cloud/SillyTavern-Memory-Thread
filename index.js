import {DEFAULTS,CATEGORIES,uid,clone,norm,ensureIds,source,sourceMap,validSources,eligible,emptyMemory,activeRecords,coverage,nextRange,rangeMessages,validateExtraction,applyExtraction,activeBatches,latestScene,latestOverview,recordText,estimateTokens,buildContext,exportMemory,importMemory,EXTRACTION_PROMPT,ADULT_ARCHIVE_PROMPT,ADULT_DETAIL_PROMPT,fingerprint} from './core.js';
import {generate,models} from './api.js';
import {makeChapters,topicMatches,diaryHtml} from './journal.js';

const KEY='memory_thread', TAG='memory_thread_context';
const ctx=()=>SillyTavern.getContext();
let settings, panel, body, dialog, tab='now', busy=false, writing=false, aborter=null, internalGeneration=false, preview={text:'',tokens:0,selected:[],omitted:[],matches:[]}, previewSerial=0, forced=[],usedForced=[],search='',remembered=new Map(),toastTimer,refreshTimer,life=0,usage=null,lastRun=null;
const RECOMMENDED_CUSTOM_PROMPT=`Prioritize details that may matter in future roleplay: relationship changes and their causes, emotional turning points, promises, conflicts, secrets, fears, desires, recurring habits, behavioral traits, important items or places, injuries, and consequences. Track who knows, suspects, or does not know each fact. Avoid duplicates; when a state changes, update it and preserve the cause. Ignore decorative descriptions and trivial actions unless they affect characters, relationships, or future plot. For adult scenes, follow the selected adult-memory settings.`;
const $=(s,root=document)=>root.querySelector(s);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr=escape;
const snapshotMessage=m=>({name:String(m?.name??''),is_user:!!m?.is_user,is_system:!!m?.is_system,is_hidden:!!m?.is_hidden,mes:String(m?.mes??''),extra:{memoryThreadId:m?.extra?.memoryThreadId,isHidden:!!m?.extra?.isHidden}});
const scope=()=>`${ctx().groupId||'solo'}:${ctx().characterId??''}:${ctx().getCurrentChatId?.()??ctx().chatId??''}`;
const diagnosticKey=()=>`memory-thread-last-run:${scope()}`;
function loadLastRun(){try{return JSON.parse(sessionStorage.getItem(diagnosticKey())||'null');}catch{return null;}}
function setLastRun(value){lastRun=value;try{sessionStorage.setItem(diagnosticKey(),JSON.stringify(value));}catch{}render();}
function usageText(u){if(!u)return '';const input=u.prompt_tokens??u.input_tokens,output=u.completion_tokens??u.output_tokens,total=u.total_tokens;return [Number.isFinite(input)?`вход ${input}`:'',Number.isFinite(output)?`выход ${output}`:'',Number.isFinite(total)?`всего ${total}`:''].filter(Boolean).join(' · ');}
function mem(){const c=ctx();return c.chatMetadata?.[KEY]||emptyMemory();}
function chat(){return ctx().chat||[];}
function notify(title,detail='',action=()=>openPanel('memories')){
  const box=$('#mt-toast');box.replaceChildren();const h=document.createElement('div');h.className='mt-toast-title';h.textContent=title;box.append(h);const d=document.createElement('div');d.className='mt-toast-detail';d.textContent=detail;box.append(d);const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Закрыть уведомление');close.onclick=e=>{e.stopPropagation();box.hidden=true;};box.append(close);box.onclick=()=>{box.hidden=true;action();};box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,9000);
}
function explainError(e){
  const msg=e?.message||String(e);
  if(msg.includes('Оценка входа'))return {title:'📚 Диапазон слишком большой',detail:msg};
  if(msg.includes('HTTP 401'))return {title:'🔑 API не принял ключ',detail:msg};
  if(msg.includes('HTTP 429'))return {title:'💳 Лимит или баланс API',detail:msg};
  if(msg.includes('не вернула JSON')||msg.includes('повреждённый JSON')||msg.includes('summary, scene'))return {title:'🧩 Ответ модели не подошёл',detail:msg};
  if(msg.includes('Текущее API Таверны не ответило')||msg.includes('Не удалось обратиться к API'))return {title:'🌐 Модель или провайдер не ответили',detail:msg};
  if(msg.includes('Чат переключён')||msg.includes('История или память изменилась'))return {title:'↔️ Чат изменился во время операции',detail:msg};
  if(msg.includes('обрезан'))return {title:'✂️ Ответ модели обрезан',detail:msg};
  if(msg.includes('внутреннее рассуждение')||msg.includes('пустой финальный'))return {title:'🧠 Модель не дала финальный ответ',detail:msg};
  if(msg.includes('сохранение памяти на сервере'))return {title:'💾 Ответ получен, но память не записалась',detail:msg};
  return {title:'Не получилось',detail:msg};
}
function error(e){const info=explainError(e);notify(info.title,info.detail,()=>openPanel());}
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
function currentApiInfo(){
  const c=ctx();
  const mode=c.mainApi==='openai'?'Chat Completion':c.mainApi==='textgenerationwebui'?'Text Completion':String(c.mainApi||'текущее API');
  const source=c.chatCompletionSettings?.chat_completion_source;
  let model='';
  try{model=typeof c.getChatCompletionModel==='function'?String(c.getChatCompletionModel()||''):'';}catch{}
  const parts=[mode];
  if(source&&c.mainApi==='openai')parts.push(String(source));
  if(model)parts.push(model);
  return parts.join(' · ');
}
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
  // Keep one <dialog> open while moving between wizard steps. Closing and immediately
  // reopening the same dialog is unreliable in some Android/WebView builds.
  const alreadyOpen=dialog.open;
  dialog.innerHTML=`<form id="mt-form"><h3>${escape(title)}</h3>${html}<div class="mt-error" id="mt-dialog-error" role="alert"></div><div class="mt-row mt-actions"><button type="submit" class="mt-primary">${escape(submit)}</button><button type="button" data-close>Отмена</button></div></form>`;
  $('[data-close]',dialog).onclick=()=>dialog.close();
  $('#mt-form',dialog).onsubmit=async e=>{
    e.preventDefault();
    const form=e.target,button=$('[type=submit]',form),label=button.textContent;
    button.disabled=true;button.textContent='Подготавливаю…';
    try{
      await onSubmit(new FormData(form));
      if(dialog.open&&$('#mt-form',dialog)===form)dialog.close();
    }catch(err){
      console.error('[Memory Thread]',err);
      if(dialog.open&&$('#mt-form',dialog)===form){
        const info=explainError(err);
        $('#mt-dialog-error',dialog).textContent=`${info.title}\n${info.detail}`;
      }else error(err);
    }finally{
      if(button.isConnected){button.disabled=false;button.textContent=label;}
    }
  };
  if(!alreadyOpen)dialog.showModal();
}
function showText(title,text){modal(title,`<pre>${escape(text)}</pre>`,async()=>{},'Понятно');}
function requireIdle(){if(writing)throw Error('Дождись завершения сохранения.');if(busy)throw Error('Дождись завершения обработки или нажми «Отменить запрос».');if(!chat().length)throw Error('Сначала открой чат с сообщениями.');}
async function mutate(fn){requireIdle();const next=clone(mem());fn(next);await persist(next);await refreshContext();render();}
function tags(r){return `<div class="mt-tags"><span class="mt-tag mt-tag-category">${escape(CATEGORIES[r.category])}</span>${r.importance==='high'?'<span class="mt-tag">🔥 Важное</span>':''}${r.pinned?'<span class="mt-tag">📌 Закреплено</span>':''}${r.locked?'<span class="mt-tag">🔐 Защищено</span>':''}${r.manual?'<span class="mt-tag">✍ Вручную</span>':''}${preview.selected.includes(r.id)?'<span class="mt-tag">↗ В контексте</span>':''}</div>`;}
function renderCard(r){return `<article class="mt-card mt-memory-card mt-cat-${attr(r.category)}" data-id="${attr(r.id)}"><div class="mt-card-thread"></div>${tags(r)}<h3>${escape(r.title)}</h3>${r.date?`<div class="mt-date">🕰 ${escape(r.date)}</div>`:''}<p>${escape(r.text)}</p>${r.quote?`<blockquote>«${escape(r.quote)}»<div class="mt-sub">— ${escape(r.quoteSpeaker)}</div></blockquote>`:''}${r.knownTo?.length?`<div class="mt-sub mt-known">👁 Знают: ${escape(r.knownTo.join(', '))}</div>`:''}<div class="mt-row mt-card-actions"><button data-card="edit">✎ Править</button><button data-card="recall">🧠 Вспомнить</button><button data-card="flash">🌙 Флешбэк</button><button data-card="pin">${r.pinned?'📌 Открепить':'📌 Закрепить'}</button><button data-card="source">📜 Источник</button><button data-card="merge">🔗 Объединить</button><button data-card="disable">🙈 Отключить</button><button data-card="delete" class="mt-danger">🗑 Удалить</button></div></article>`;}
function render(){
  if(!panel)return;const m=mem(),ch=chat(),records=activeRecords(m,ch),cov=coverage(m,ch),todo=cov.filter(x=>x.eligible&&!x.covered),done=cov.filter(x=>x.eligible&&x.covered).length;
  $('#mt-fab small').textContent=records.length;$('#mt-status').textContent=busy?'Обрабатываю выбранные сообщения…':`Обработано ${done} из ${cov.filter(x=>x.eligible).length} · новых/изменённых: ${todo.length}`;
  $('#mt-progress').hidden=!busy;$('#mt-cancel').hidden=!busy;$('#mt-budget').textContent=`Память: ${preview.tokens} / ${settings.budget} токенов`;
  for(const el of panel.querySelectorAll('[data-tab]'))el.setAttribute('aria-selected',String(el.dataset.tab===tab));
  for(const el of panel.querySelectorAll('[data-work]'))el.disabled=busy;
  if(tab==='now'){
    const scene=latestScene(m,ch),overview=latestOverview(m,ch),invalid=m.records.filter(r=>!r.manual&&!validSources(r.sources,sourceMap(ch))).length;
    body.innerHTML=`<section class="mt-journal-hero"><div class="mt-journal-ornament">✧ ✦ 🧵 ✦ ✧</div><div class="mt-journal-title">Дневник этой истории</div><div class="mt-journal-sub">Сцены, чувства, обещания и маленькие детали, которые не должны потеряться.</div><div class="mt-stats"><span>📖 ${done} обработано</span><span>🌙 ${records.length} воспоминаний</span><span>📝 ${todo.length} ждут</span>${settings.adultContent?'<span>🔞 взрослые сцены</span>':''}</div></section>${scene?`<article class="mt-card mt-scene-card"><div class="mt-kicker">🕯 ТЕКУЩАЯ СЦЕНА</div><h3>${escape(scene.date||'Дата не указана')}</h3><p>${escape(scene.scene)}</p><div class="mt-card-flourish">❦</div></article>`:'<div class="mt-empty mt-diary-empty"><span>📖</span>Первые страницы ещё пусты.<br>Нажми «Запомнить новое» после сцены — и здесь начнёт складываться история.</div>'}${overview?`<article class="mt-card mt-story-card"><div class="mt-kicker">🧵 НИТЬ СЮЖЕТА</div><p>${escape(overview.text)}</p><div class="mt-card-flourish">✧</div></article>`:''}${lastRun?`<article class="mt-card mt-run-card ${lastRun.status==='success'?'mt-run-ok':lastRun.status==='error'?'mt-run-error':''}"><div class="mt-kicker">${lastRun.status==='success'?'✅':lastRun.status==='error'?'⚠️':'⏳'} ПОСЛЕДНИЙ ЗАПРОС ПАМЯТИ</div><h3>${escape(lastRun.status==='success'?'Сохранён':lastRun.status==='error'?'Не сохранён':'В процессе')}</h3><p>${escape(lastRun.message||`Диапазон #${lastRun.from}–#${lastRun.to}`)}</p>${lastRun.usage?`<div class="mt-sub">🧮 ${escape(usageText(lastRun.usage))}</div>`:''}<button data-action="diagnostic">🔎 Подробности</button></article>`:''}<div class="mt-note-strip">${settings.enabled?'🟢 Память включена':'⏸ Память выключена'} · ${settings.mode==='main'?'API Таверны':'Отдельный API'} · ручной режим</div>${invalid?`<div class="mt-info mt-warn">⚠ ${invalid} записей больше не привязаны к исходному тексту и временно не используются. Пересканируй изменённый участок.</div><br>`:''}${todo.length?`<div class="mt-info">📝 Ещё не обработаны: ${todo.slice(0,25).map(x=>'#'+x.index).join(', ')}${todo.length>25?' …':''}</div>`:''}<div class="mt-row mt-bottom-actions"><button data-action="help">❔ Как пользоваться</button></div>`;
  }else if(tab==='memories'){
    const filtered=records.filter(r=>norm(recordText(r)).includes(norm(search)));
    body.innerHTML=`<div class="mt-section-heading"><div><div class="mt-kicker">🌙 КАРТОТЕКА</div><h3>Воспоминания</h3></div><span class="mt-counter">${filtered.length}</span></div><div class="mt-row mt-library-actions"><button data-action="add" class="mt-primary">✍ Новая запись</button><button data-action="topic">🧭 Собрать по теме</button><button data-action="disabled">🙈 Отключённые (${m.dismissed.length})</button></div><input class="mt-search" id="mt-search" placeholder="🔎 Найти имя, событие, предмет…" aria-label="Поиск воспоминаний" value="${attr(search)}">${filtered.length?filtered.sort((a,b)=>b.pinned-a.pinned||b.created-a.created).map(renderCard).join(''):'<div class="mt-empty mt-diary-empty"><span>🌙</span>Пока здесь тихо.<br>После сохранённой сцены появятся события, отношения, секреты и реплики.</div>'}`;
    $('#mt-search').oninput=e=>{const pos=e.target.selectionStart;search=e.target.value;render();$('#mt-search').focus();$('#mt-search').setSelectionRange(pos,pos);};
  }else if(tab==='chronicle'){
    const batches=activeBatches(m,ch),map=sourceMap(ch),chapters=makeChapters(batches,map,settings.chapterSize);
    body.innerHTML=`<div class="mt-section-heading"><div><div class="mt-kicker">📚 ХРОНИКА</div><h3>Главы и сохранённые сцены</h3></div><span class="mt-counter">${batches.length}</span></div><div class="mt-info">Главы собираются локально из уже сохранённых сцен — без нового запроса к модели. Сейчас в одной главе до <strong>${settings.chapterSize}</strong> сцен.</div><div class="mt-row mt-library-actions"><button data-action="export-html">📖 Экспорт красивого дневника</button><button data-action="unhide">👁 Вернуть последний скрытый диапазон</button></div>${chapters.length?`<div class="mt-chapters">${chapters.slice().reverse().map(ch=>`<details class="mt-card mt-chapter-card"><summary><strong>📕 ${escape(ch.title)}</strong> <span class="mt-sub">${ch.from!==null?`#${ch.from}–#${ch.to}`:''} · ${ch.scenes.length} сцен</span></summary><div class="mt-chapter-body">${ch.scenes.map((b,i)=>`<article class="mt-mini-scene"><div class="mt-kicker">СЦЕНА ${i+1}${b.date?` · ${escape(b.date)}`:''}</div><p>${escape(b.summary)}</p><button data-batch="${attr(b.id)}">📜 Источник</button></article>`).join('')}</div></details>`).join('')}</div>`:'<div class="mt-empty mt-diary-empty"><span>📚</span>Хроника пока пуста.</div>'}<div class="mt-section-heading mt-scenes-heading"><div><div class="mt-kicker">🕯 СТРАНИЦЫ</div><h3>Все сцены</h3></div></div>${batches.slice().reverse().map((b,n)=>`<article class="mt-card mt-history-card"><div class="mt-history-number">${String(batches.length-n).padStart(2,'0')}</div><div class="mt-kicker">#${Math.min(...b.sources.map(s=>map.get(s.id).index))} — #${Math.max(...b.sources.map(s=>map.get(s.id).index))}</div><h3>${escape(b.date||'Сцена без даты')}</h3><p>${escape(b.summary)}</p><button data-batch="${attr(b.id)}">📜 Открыть исходный текст</button></article>`).join('')}`;
  }else if(tab==='context'){
    body.innerHTML=`<div class="mt-section-heading"><div><div class="mt-kicker">🧠 ПЕРЕД СЛЕДУЮЩИМ ОТВЕТОМ</div><h3>Что вспомнит модель</h3></div><span class="mt-counter">${preview.tokens}/${settings.budget}</span></div><div class="mt-info">Сейчас в рюкзак памяти помещено <strong>${preview.selected.length}</strong> отдельных записей. Кнопка обновления ниже только пересобирает предпросмотр локально и не вызывает языковую модель.</div>${preview.omitted.length?`<br><div class="mt-info mt-warn">🧳 Не вместилось: ${preview.omitted.length} блоков. ${preview.omitted.map(id=>escape(records.find(r=>r.id===id)?.title||id)).join('; ')}.</div>`:''}<div class="mt-context-paper"><pre>${escape(preview.text||'Память пока не отправляется.')}</pre></div><div class="mt-row">${forced.length?'<button data-action="clear-forced">🧹 Снять ручные напоминания</button>':''}<button data-action="refresh">↻ Обновить предпросмотр</button></div>`;
  }else renderSettings();
}
function input(name,label,value,type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${attr(value)}" ${extra}></label>`;}
function textArea(name,label,value,extra=''){return `<label>${label}<textarea name="${name}" ${extra}>${escape(value)}</textarea></label>`;}
function check(name,label,value){return `<label class="mt-check"><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;}
function renderSettings(){
  const mainInfo=currentApiInfo();
  body.innerHTML=`<div class="mt-section-heading"><div><div class="mt-kicker">⚙ МАСТЕРСКАЯ ПАМЯТИ</div><h3>Настройки дневника</h3></div></div><form id="mt-settings" class="mt-stack"><div class="mt-card mt-settings-card"><h3>🧵 Контекст и воспоминания</h3>${check('enabled','Включить Нить памяти',settings.enabled)}<div class="mt-grid">${input('budget','Бюджет памяти, токенов',settings.budget,'number','min="200" max="16000" required')}${input('depth','Глубина в чате',settings.depth,'number','min="0" max="100" required')}${input('chunk','Сообщений за одно нажатие',settings.chunk,'number','min="1" max="100" required')}${input('remind','Предлагать сохранить после N необработанных сообщений (0 — выкл.)',settings.remind,'number','min="0" max="100" required')}${input('chapterSize','Сцен в одной главе хроники',settings.chapterSize,'number','min="2" max="20" required')}</div>${check('autoRecall','Автоматически подбирать подходящие воспоминания',settings.autoRecall)}${check('toast','Показывать маленькие плашки, когда память сработала',settings.toast)}${input('cooldown','Пауза повторной плашки, сообщений',settings.cooldown,'number','min="1" max="100" required')}</div><div class="mt-card mt-adult-card"><div class="mt-settings-icon">🔞</div><h3>Взрослые сцены</h3><p class="mt-sub">Для ролевых сцен между совершеннолетними персонажами. Режим меняет только инструкцию архивариусу — он не обходит ограничения выбранного API или провайдера.</p>${check('adultContent','Не пропускать сюжетно значимые детали взрослых сцен',settings.adultContent)}<div id="mt-adult-detail">${check('adultDetail','Сохранять конкретные интимные детали, если они важны для будущего сюжета',settings.adultDetail)}<p class="mt-sub">Без лишнего пересказа: только то, что влияет на отношения, границы, доверие, конфликт, обещания или последствия.</p></div></div><div class="mt-card mt-settings-card"><h3>🤖 Модель для памяти</h3><label>Подключение<select name="mode" id="mt-mode"><option value="main" ${settings.mode==='main'?'selected':''}>Текущее API Таверны</option><option value="separate" ${settings.mode==='separate'?'selected':''}>Отдельное OpenAI-совместимое API</option></select></label><div id="mt-main-api"><div class="mt-info">🟢 Используется автоматически: <strong>${escape(mainInfo)}</strong><br>Ничего из URL / API key / Model ниже вводить не нужно.</div><div class="mt-row"><button type="button" data-action="test-main">🧪 Проверить текущее API</button></div></div><div id="mt-separate-api"><div class="mt-info mt-warn">🌐 Эти поля относятся только к отдельной модели памяти и не меняют основное подключение SillyTavern.</div>${input('url','Базовый URL (обычно /v1)',settings.url,'text','placeholder="https://provider.example/v1"')}${input('apiKey','API key · только в текущей сессии браузера',keyValue(),'password','autocomplete="off"')}${input('model','Название модели',settings.model,'text','list="mt-model-list"')}<datalist id="mt-model-list"></datalist><div class="mt-row"><button type="button" data-action="models">📋 Загрузить модели</button><button type="button" data-action="test-api">🧪 Проверить отдельный API</button></div><p class="mt-sub">Провайдер должен разрешать CORS. Ключ не входит в экспорт и после закрытия сессии вводится заново.</p></div><div class="mt-grid">${input('output','Максимум токенов ответа',settings.output,'number','min="512" max="16000" required')}${input('inputLimit','Лимит входа перед отправкой',settings.inputLimit,'number','min="1000" max="200000" required')}</div></div><details class="mt-card mt-settings-card"><summary>✨ Дополнительные пожелания архивариусу</summary>${textArea('customPrompt','Твои правила для извлечения памяти',settings.customPrompt,'maxlength="8000" placeholder="Можно писать по-русски или по-английски…"')}<div class="mt-row mt-prompt-tools"><button type="button" data-action="suggest-prompt">🇬🇧 Вставить короткий рекомендуемый промпт</button></div><p class="mt-sub">Основные системные инструкции теперь компактные и на английском, но вся читаемая память по-прежнему должна возвращаться на русском. Твои пожелания добавляются поверх них.</p></details><button type="submit" class="mt-primary mt-save-settings">💾 Сохранить настройки</button></form><div class="mt-row mt-settings-tools"><button data-action="export">📦 Экспорт памяти</button><button data-action="import">📥 Импорт памяти</button><button data-action="help">❔ Инструкция</button></div>${usage?`<p class="mt-sub">Последний API-запрос: ${escape(JSON.stringify(usage))}</p>`:''}`;
  const toggleApiFields=()=>{const separate=$('#mt-mode').value==='separate';$('#mt-main-api').hidden=separate;$('#mt-separate-api').hidden=!separate;};
  const toggleAdult=()=>{const box=$('[name="adultContent"]');const detail=$('#mt-adult-detail');if(detail){detail.classList.toggle('mt-disabled-block',!box.checked);detail.querySelectorAll('input').forEach(x=>x.disabled=!box.checked);}};
  $('#mt-mode').onchange=toggleApiFields;toggleApiFields();$('[name="adultContent"]').onchange=toggleAdult;toggleAdult();
  $('#mt-settings').onsubmit=e=>{e.preventDefault();try{requireIdle();readSettings(new FormData(e.target));saveSettings();refreshSoon();notify('Настройки сохранены','Дневник памяти обновлён.',()=>openPanel('now'));}catch(err){error(err);}};
}
function readSettings(f){for(const key of ['enabled','autoRecall','toast','adultContent','adultDetail'])settings[key]=f.has(key);for(const key of ['budget','depth','chunk','remind','chapterSize','cooldown','output','inputLimit'])settings[key]=Number(f.get(key));for(const key of ['url','model','customPrompt'])settings[key]=String(f.get(key)||'').trim();settings.mode=f.get('mode')==='separate'?'separate':'main';setKey(String(f.get('apiKey')||'').trim());}
function editRecord(id){
  requireIdle();const r=activeRecords(mem(),chat()).find(r=>r.id===id)||{id:uid(),key:uid(),title:'',category:'event',text:'',date:'',participants:[],knownTo:[],keywords:[],quote:'',quoteSpeaker:'',importance:'medium',certainty:'fact',sources:[],pinned:false,locked:true};
  modal(id?'Править воспоминание':'Своё воспоминание',`<div class="mt-stack">${input('title','Название',r.title,'text','required maxlength="180"')}<div class="mt-grid"><label>Категория<select name="category">${Object.entries(CATEGORIES).map(([k,v])=>`<option value="${k}" ${r.category===k?'selected':''}>${v}</option>`).join('')}</select></label>${input('date','Дата и время в ролевой',r.date,'text','maxlength="240" placeholder="14 октября 1843 · вечер"')}</div>${textArea('text','Что произошло и почему это важно',r.text,'required maxlength="4000"')}${input('participants','Участники, через запятую',r.participants.join(', '))}${input('knownTo','Кто знает об этом, через запятую',r.knownTo.join(', '))}${input('keywords','Слова для срабатывания, через запятую',r.keywords.join(', '))}${textArea('quote','Точная реплика (необязательно)',r.quote,'maxlength="3000"')}${input('quoteSpeaker','Кто произнёс реплику',r.quoteSpeaker)}<div class="mt-grid"><label>Важность<select name="importance">${['high','medium','low'].map((v,i)=>`<option value="${v}" ${r.importance===v?'selected':''}>${['Высокая','Средняя','Низкая'][i]}</option>`).join('')}</select></label><label>Достоверность<select name="certainty">${['fact','belief','dream','unknown'].map((v,i)=>`<option value="${v}" ${r.certainty===v?'selected':''}>${['Факт','Мнение / подозрение','Сон / видение','Неясно'][i]}</option>`).join('')}</select></label></div>${check('pinned','Закрепить в контексте (в пределах бюджета)',r.pinned)}<div class="mt-info">После сохранения это ручная защищённая запись. ИИ не перезапишет её. Ручную цитату ты подтверждаешь сама.</div></div>`,async f=>{
    const val=k=>String(f.get(k)||'').trim(),list=k=>val(k).split(',').map(s=>s.trim()).filter(Boolean).slice(0,16);
    await mutate(m=>{m.records.push({...r,id:uid(),title:val('title'),category:val('category'),text:val('text'),date:val('date'),participants:list('participants'),knownTo:list('knownTo'),keywords:list('keywords'),quote:val('quote'),quoteSpeaker:val('quoteSpeaker'),importance:val('importance'),certainty:val('certainty'),manual:true,locked:true,pinned:f.has('pinned'),created:Date.now()});m.dismissed=m.dismissed.filter(k=>k!==r.key);});
  });
}
function mergeRecord(id){
  requireIdle();const all=activeRecords(mem(),chat()),base=all.find(r=>r.id===id);if(!base)return;
  const others=all.filter(r=>r.id!==id);if(!others.length){notify('Нечего объединять','Нужно хотя бы ещё одно активное воспоминание.');return;}
  modal('🔗 Объединить воспоминания',`<div class="mt-info">Основа: <strong>${escape(base.title)}</strong><br>Выбери записи, которые относятся к одному факту или одной линии. Исходные записи будут заменены одной ручной защищённой записью.</div><div class="mt-merge-list">${others.map(r=>`<label class="mt-merge-option"><input type="checkbox" name="merge" value="${attr(r.id)}"><span><strong>${escape(r.title)}</strong><small>${escape(CATEGORIES[r.category])} · ${escape(r.text.slice(0,130))}${r.text.length>130?'…':''}</small></span></label>`).join('')}</div>`,async f=>{
    const ids=[id,...f.getAll('merge')];if(ids.length<2)throw Error('Выбери хотя бы ещё одно воспоминание.');
    const picked=all.filter(r=>ids.includes(r.id));const keys=new Set(picked.map(r=>r.key));const unique=a=>[...new Set(a.filter(Boolean))].slice(0,16);const importance={low:1,medium:2,high:3};
    const merged={...base,id:uid(),key:'manual:merged:'+uid(),title:base.title,text:unique(picked.map(r=>r.text)).join('\n\n'),date:base.date||picked.find(r=>r.date)?.date||'',participants:unique(picked.flatMap(r=>r.participants||[])),knownTo:unique(picked.flatMap(r=>r.knownTo||[])),keywords:unique(picked.flatMap(r=>r.keywords||[])),quote:base.quote||'',quoteSpeaker:base.quoteSpeaker||'',importance:picked.slice().sort((a,b)=>(importance[b.importance]||0)-(importance[a.importance]||0))[0]?.importance||'medium',certainty:picked.every(r=>r.certainty===picked[0].certainty)?picked[0].certainty:'unknown',sources:[...new Map(picked.flatMap(r=>r.sources||[]).map(x=>[x.id+':'+x.hash,x])).values()],manual:true,locked:true,pinned:picked.some(r=>r.pinned),disabled:false,created:Date.now()};
    forced=forced.filter(x=>!ids.includes(x.id));await mutate(m=>{m.records=m.records.filter(r=>!keys.has(r.key));m.dismissed=m.dismissed.filter(k=>!keys.has(k));m.records.push(merged);});notify('🔗 Воспоминания объединены','Создана одна защищённая запись. При желании открой «Править» и отшлифуй текст.',()=>openPanel('memories'));
  },'Объединить');
}
function deleteRecord(id){
  requireIdle();const r=activeRecords(mem(),chat()).find(x=>x.id===id);if(!r)return;
  modal('🗑 Удалить воспоминание',`<div class="mt-info mt-warn">Будут окончательно удалены все версии записи <strong>${escape(r.title)}</strong> с этим ключом. Сводки сцен и исходные сообщения останутся.</div><p>Если позже пересканировать старую сцену, архивариус может создать похожий факт заново.</p>`,async()=>{forced=forced.filter(x=>x.id!==id);await mutate(m=>{m.records=m.records.filter(x=>x.key!==r.key);m.dismissed=m.dismissed.filter(k=>k!==r.key);});notify('Воспоминание удалено',r.title,()=>openPanel('memories'));},'Удалить навсегда');
}
function showSources(sources){if(!sources.length){showText('Источник','Ручная или импортированная запись без привязки к сообщениям.');return;}const map=sourceMap(chat());showText('Исходные сообщения',sources.map(s=>{const v=map.get(s.id),m=v?chat()[v.index]:null;return m?`#${v.index} · ${m.name}\n${m.mes}${v.hash!==s.hash?'\n[Текст изменён после записи]':''}`:`#${s.index} — источник отсутствует в этой ветке`;}).join('\n\n────────\n\n'));}
function chooseRange(){requireIdle();const r=nextRange(mem(),chat(),settings.chunk)||[Math.max(0,chat().length-settings.chunk),chat().length-1];modal('Обработать диапазон',`<div class="mt-info">Номера сообщений как в Таверне, начиная с 0. Скрытые сообщения включаются; уже обработанный диапазон можно пересканировать.</div><br><div class="mt-grid">${input('from','С сообщения №',r[0],'number',`min="0" max="${chat().length-1}" required`)}${input('to','По сообщение № включительно',r[1],'number',`min="0" max="${chat().length-1}" required`)}</div>`,async f=>{const from=Number(f.get('from')),to=Number(f.get('to'));rangeMessages(chat(),from,to);await prepareScan(from,to);},'Показать перед отправкой');}
async function prepareScan(from,to){
  requireIdle();const expected=scope(),epoch=life;
  if(ensureIds(chat()))await ctx().saveChat();
  if(scope()!==expected||epoch!==life)throw Error('Чат переключён. Выбери диапазон снова.');
  const rows=rangeMessages(chat(),from,to).map(x=>({i:x.i,m:snapshotMessage(x.m)}));if(!rows.length)throw Error('Нет текста для обработки.');
  const m=mem(),overview=latestOverview(m,chat()),batches=activeBatches(m,chat());
  const synopsis=batches.map(b=>({range:b.sources.map(s=>s.index),summary:b.summary}));
  // Keep extraction context bounded: newest overview plus scenes not represented there.
  const included=new Set(overview?.sources.map(s=>s.id)||[]);
  const extra=batches.filter(b=>b.sources.some(s=>!included.has(s.id)));
  const contextSources=[...(overview?.sources||[]),...extra.flatMap(b=>b.sources)];
  const records=activeRecords(m,chat()).map(r=>({key:r.key,text:r.text,locked:r.locked,category:r.category}));
  let system=EXTRACTION_PROMPT.replaceAll('{{user}}',ctx().name1||'user').replaceAll('{{char}}',ctx().name2||'char');if(settings.adultContent)system+='\n\n'+ADULT_ARCHIVE_PROMPT;if(settings.adultContent&&settings.adultDetail)system+='\n\n'+ADULT_DETAIL_PROMPT;if(settings.customPrompt)system+='\n\nAdditional user preferences (follow them when compatible with the archive rules):\n'+settings.customPrompt;
  const prompt=JSON.stringify({existing_overview:overview?.text||'',other_scenes:overview?extra.map(b=>({range:b.sources.map(s=>s.index),summary:b.summary})):synopsis,existing_records:records,messages:rows.map(({i,m})=>({index:i,speaker:m.name,role:m.is_user?'user':'character',text:m.mes}))});
  const estimated=await count(system+prompt);
  if(estimated>settings.inputLimit){const suggested=Math.max(1,Math.floor(rows.length*(settings.inputLimit/estimated)*0.85));throw Error(`Оценка входа ${estimated} токенов превышает лимит ${settings.inputLimit}. Для этого чата попробуй примерно ${suggested} сообщений за раз или увеличь лимит входа, если контекст модели это позволяет.\n\nЗапрос к модели НЕ отправлен — API на этом шаге не расходуется.`);}
  modal('Запомнить выбранную сцену',`<div class="mt-card mt-scan-card"><div class="mt-kicker">📖 #${from} — #${to}</div><h3>${rows.length} сообщений</h3><p>Оценка Таверны: ${estimated} входных токенов + до ${settings.output} токенов ответа.</p><div class="mt-sub">Отправляются выбранные сообщения, действующая память и инструкция архивариуса — не весь старый чат.</div>${settings.adultContent?`<div class="mt-adult-badge">🔞 Взрослые сцены: ${settings.adultDetail?'значимые конкретные детали':'сюжетные последствия'}</div>`:''}</div>${check('hide','🙈 После сохранения скрыть этот диапазон',false)}<details><summary>📜 Посмотреть выбранный текст</summary><pre>${escape(rows.map(x=>`#${x.i} ${x.m.name}: ${x.m.mes}`).join('\n\n'))}</pre></details>`,async f=>{
    if(scope()!==expected||epoch!==life)throw Error('Чат переключён. Выбери диапазон снова.');
    dialog.close();await runScan({rows,from,to,system,prompt,contextSources,expected,epoch,hide:f.has('hide')});
  },'Отправить и сохранить');
}
function showRunDiagnostic(){
  if(!lastRun)return;const response=lastRun.responsePreview?`<details open><summary>📜 Фрагмент ответа модели</summary><pre>${escape(lastRun.responsePreview)}</pre></details>`:'';
  const detail=`<div class="mt-info ${lastRun.status==='error'?'mt-warn':''}"><strong>${escape(lastRun.message||'Нет сообщения')}</strong><br>Этап: ${escape(lastRun.stage||'—')} · диапазон #${lastRun.from??'?'}–#${lastRun.to??'?'}${lastRun.model?`<br>Модель: ${escape(lastRun.model)}`:''}${lastRun.usage?`<br>Токены: ${escape(usageText(lastRun.usage))}`:''}</div>${response}<p class="mt-sub">Диагностика хранится только в текущей сессии браузера и не содержит API-ключ.</p>`;
  modal('🔎 Последний запрос памяти',detail,async()=>{},'Понятно');
}
function showScanFailure(run){
  const raw=run.responsePreview?`<details><summary>📜 Показать фрагмент ответа модели</summary><pre>${escape(run.responsePreview)}</pre></details>`:'';
  modal('⚠️ Сцена не сохранена',`<div class="mt-info mt-warn"><strong>${escape(run.message)}</strong><br><br>Этап: ${escape(run.stage||'неизвестно')}${run.usage?`<br>Токены API: ${escape(usageText(run.usage))}`:''}</div>${raw}<p class="mt-sub">Если ответ модели уже был получен, провайдер мог учесть токены даже несмотря на то, что Memory Thread отказался сохранять некорректный результат.</p>`,async()=>{},'Понятно');
}
async function runScan(job){
  requireIdle();busy=true;aborter=new AbortController();const signal=aborter.signal;render();
  const revision=mem().revision;let stage='api',result=null;
  setLastRun({status:'running',stage,from:job.from,to:job.to,model:settings.mode==='separate'?settings.model:currentApiInfo(),message:`Отправлен диапазон #${job.from}–#${job.to}`,at:Date.now()});
  try{
    internalGeneration=settings.mode==='main';result=await generate({...settings},keyValue(),job.system,job.prompt,ctx(),signal);internalGeneration=false;
    stage='validation';setLastRun({status:'running',stage,from:job.from,to:job.to,model:result.model||(settings.mode==='separate'?settings.model:currentApiInfo()),usage:result.usage||null,responsePreview:String(result.text||'').slice(0,5000),message:'Ответ модели получен. Проверяю JSON…',at:Date.now()});
    if(signal.aborted||scope()!==job.expected||life!==job.epoch)throw Error('Чат переключён или запрос отменён. Результат не применён.');
    const map=sourceMap(chat());if(!validSources([...job.rows.map(r=>source(r.m,r.i)),...job.contextSources],map)||mem().revision!==revision)throw Error('История или память изменилась во время запроса. Повтори обработку.');
    const parsed=validateExtraction(result.text,job.rows),applied=applyExtraction(mem(),parsed,job.rows,job.contextSources);
    stage='save';setLastRun({...lastRun,stage,message:'JSON принят. Сохраняю память…'});
    await persist(applied.memory,job.expected);usage=result.usage;
    if(job.hide&&scope()===job.expected&&life===job.epoch){stage='hide';await hideRows(job.rows,job.expected);}
    await refreshContext();
    setLastRun({status:'success',stage:'done',from:job.from,to:job.to,model:result.model||(settings.mode==='separate'?settings.model:currentApiInfo()),usage:result.usage||null,responsePreview:String(result.text||'').slice(0,5000),message:`Сохранено: ${parsed.entries.length} воспоминаний · #${job.from}–#${job.to}`,at:Date.now()});
    render();notify(`✨ Сцена сохранена · ${parsed.entries.length} записей`,parsed.warnings.length?parsed.warnings.join(' '):`#${job.from}–#${job.to}. Можно открыть и поправить воспоминания.`);
  }catch(e){
    const info=explainError(e),run={status:'error',stage,from:job.from,to:job.to,model:result?.model||(settings.mode==='separate'?settings.model:currentApiInfo()),usage:result?.usage||null,responsePreview:String(result?.text||lastRun?.responsePreview||'').slice(0,5000),message:`${info.title}: ${info.detail}`,at:Date.now()};
    setLastRun(run);showScanFailure(run);
  }finally{internalGeneration=false;busy=false;aborter=null;render();}
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
async function apiAction(action){
  requireIdle();
  if(action==='test-main'){
    const f=new FormData($('#mt-settings'));
    const cfg={...settings,mode:'main',output:64};
    await generate(cfg,'','Ответь только словом OK.','OK',ctx());
    notify('Текущее API отвечает',currentApiInfo(),()=>{});return;
  }
  const f=new FormData($('#mt-settings'));const cfg={...settings,mode:'separate',url:String(f.get('url')||''),model:String(f.get('model')||''),output:64},key=String(f.get('apiKey')||'');
  if(action==='models'){const list=await models(cfg,key);$('#mt-model-list').innerHTML=list.map(x=>`<option value="${attr(x)}"></option>`).join('');notify('Модели загружены',`${list.length} вариантов. Выбери модель в поле названия.`,()=>{});}else{await generate(cfg,key,'Reply briefly.','Say OK.',ctx());notify('Отдельный API отвечает','Подключение работает. Сохрани настройки.',()=>{});}
}
function help(){showText('Быстрый старт · Нить памяти',`1. Играй как обычно. После законченной сцены или примерно каждых 10–15 содержательных сообщений нажимай «✨ Запомнить новое». Для длинных сообщений бери меньше; для коротких цельных сцен можно чуть больше.
2. «📖 Диапазон» позволяет вручную выбрать номера сообщений. Скрытые через /hide сообщения Memory Thread всё ещё может обработать, пока они остаются в чате.
3. После успешного сохранения старый диапазон можно скрыть: исходный текст перестанет раздувать обычный контекст, а сцена, сюжет и отдельные воспоминания останутся в Memory Thread.
4. В «🌙 Память» можно править, закреплять, отключать, объединять и окончательно удалять записи. Ручная правка становится защищённой от автоматического перезаписывания.
5. «🔗 Объединить» заменяет несколько выбранных фактов одной ручной защищённой записью. Это удобно для дублей или одной развивающейся линии. После объединения запись можно отредактировать.
6. «🗑 Удалить» удаляет все версии конкретного ключа памяти, но не исходные сообщения и не сводки сцен. При повторном сканировании старой сцены похожий факт может появиться снова.
7. «🧠 Вспомнить» принудительно кладёт запись в ближайший контекст, а «🌙 Флешбэк» дополнительно помечает её как воспоминание, которое можно отразить в следующем ответе.
8. Вкладка «🧠 Контекст» показывает готовый блок для основной ролевой модели. «↻ Обновить предпросмотр» не вызывает языковую модель и не тратит API — она только локально пересобирает подборку.
9. 🔞 Режим взрослых сцен относится только к вымышленным совершеннолетним персонажам. Он просит архивариуса не терять сюжетно значимые интимные детали, но не обходит фильтры или правила выбранного провайдера. Второй переключатель сохраняет конкретику только когда она реально важна для будущего сюжета.
10. «Текущее API Таверны» использует выбранную сейчас модель SillyTavern. «Отдельный API» позволяет выделить более дешёвую или другую модель специально для памяти; ключ хранится только в текущей сессии браузера.
11. Экспорт JSON сохраняет память без API-ключа. Перед крупными экспериментами делай резервную копию Memory Thread и самого чата.
12. Если используешь другой memory-tracker, на время теста лучше выключить его инъекцию в контекст, чтобы две системы не дублировали одни и те же воспоминания.

Memory Thread beta.4.0 · Chronicle. Основная ролевая модель получает только выбранную часть памяти в пределах заданного бюджета, а полный архив продолжает храниться отдельно.`);}

function downloadText(name,text,type='text/plain;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function topicWizard(){
  requireIdle();
  modal('🧭 Собрать память по теме',`${input('topic','Тема или имя','','text','required maxlength="160" placeholder="Арман, отношения Арман–Ханаби, магия…"')}<div class="mt-info">Поиск идёт только по уже сохранённой памяти и ничего не отправляет в API.</div>`,async f=>{
    const q=String(f.get('topic')||'').trim();const matches=topicMatches(activeRecords(mem(),chat()),q).slice(0,30);const form=$('#mt-form',dialog);
    dialog.innerHTML=`<form id="mt-topic-result"><h3>🧭 ${escape(q)}</h3>${matches.length?`<div class="mt-topic-results">${matches.map(r=>`<article class="mt-topic-item"><strong>${escape(r.title)}</strong><div class="mt-sub">${escape(CATEGORIES[r.category])}</div><p>${escape(r.text)}</p></article>`).join('')}</div><div class="mt-info">Найдено ${matches.length}. «Вспомнить найденное» попробует положить их в ближайший контекст, но общий лимит памяти всё равно соблюдается.</div>`:'<div class="mt-empty"><span>🔎</span>В сохранённой памяти ничего похожего не найдено.</div>'}<div class="mt-row mt-actions">${matches.length?'<button type="button" class="mt-primary" id="mt-topic-recall">🧠 Вспомнить найденное</button>':''}<button type="button" id="mt-topic-close">Закрыть</button></div></form>`;
    $('#mt-topic-close',dialog).onclick=()=>dialog.close();
    const recall=$('#mt-topic-recall',dialog);if(recall)recall.onclick=async()=>{for(const r of matches){forced=forced.filter(x=>x.id!==r.id);forced.push({id:r.id,mode:'recall'});}await refreshContext();dialog.close();openPanel('context');render();};
  },'Собрать');
}
async function action(name){
  if(name==='new'){requireIdle();const range=nextRange(mem(),chat(),settings.chunk);if(!range){notify('Всё обработано','Для повторной обработки выбери диапазон.');return;}return prepareScan(...range);}
  if(name==='range')return chooseRange();if(name==='topic')return topicWizard();if(name==='export-html'){const batches=activeBatches(mem(),chat()),map=sourceMap(chat()),chapters=makeChapters(batches,map,settings.chapterSize),records=activeRecords(mem(),chat());return downloadText('memory-thread-diary.html',diaryHtml({title:`Нить памяти · ${ctx().name2||'история'}`,chapters,records}),'text/html;charset=utf-8');}if(name==='diagnostic'){if(!lastRun)return;return showRunDiagnostic();}if(name==='add')return editRecord();if(name==='suggest-prompt'){const field=$('textarea[name="customPrompt"]',panel);if(field){field.value=RECOMMENDED_CUSTOM_PROMPT;field.focus();notify('🇬🇧 Промпт вставлен','Он короче и на английском для экономии. Память всё равно будет на русском. Нажми «Сохранить настройки».',()=>{});}return;}if(name==='help')return help();if(name==='export')return download('memory-thread-backup.json',exportMemory(mem()));if(name==='import')return importFile();if(name==='unhide')return unhide();if(name==='refresh'){await refreshContext();render();return;}if(name==='clear-forced'){forced=[];await refreshContext();render();return;}if(name==='models'||name==='test-api'||name==='test-main')return apiAction(name);
  if(name==='disabled'){const keys=mem().dismissed;modal('Отключённые записи',keys.length?keys.map(k=>{const r=mem().records.find(r=>r.key===k);return `<label class="mt-check"><input type="checkbox" name="restore" value="${attr(k)}">${escape(r?.title||k)}</label>`;}).join(''):'<p>Нет отключённых записей.</p>',async f=>mutate(m=>m.dismissed=m.dismissed.filter(k=>!f.getAll('restore').includes(k))),'Включить отмеченные');}
}
async function cardAction(name,id){const r=activeRecords(mem(),chat()).find(r=>r.id===id);if(!r)return;if(name==='edit')return editRecord(id);if(name==='merge')return mergeRecord(id);if(name==='delete')return deleteRecord(id);if(name==='source')return showSources(r.sources);if(name==='pin')return mutate(m=>{m.records.find(x=>x.id===id).pinned=!r.pinned;});if(name==='disable')return mutate(m=>m.dismissed.push(r.key));if(name==='recall'||name==='flash'){forced=forced.filter(f=>f.id!==id);forced.push({id,mode:name==='flash'?'flash':'recall'});await refreshContext();render();notify(preview.selected.includes(id)?'Добавлено для следующего ответа':'Не хватает бюджета памяти',preview.selected.includes(id)?r.title:'Увеличь лимит или сократи запись. Она остаётся в очереди.',()=>openPanel('context'));}}
function dragFab(fab){let drag=null,suppress=false;fab.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,left:fab.getBoundingClientRect().left,top:fab.getBoundingClientRect().top,moved:false};fab.setPointerCapture(e.pointerId);});fab.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(!drag.moved)return;positionFab(drag.left+dx,drag.top+dy);});fab.addEventListener('pointerup',()=>{if(drag?.moved){settings.left=parseFloat(fab.style.left);settings.top=parseFloat(fab.style.top);saveSettings();suppress=true;}drag=null;});fab.addEventListener('pointercancel',()=>drag=null);fab.onclick=()=>{if(suppress){suppress=false;return;}panel.hidden?openPanel():panel.hidden=true;};}
function positionFab(x,y){const fab=$('#mt-fab');fab.style.right='auto';fab.style.bottom='auto';fab.style.left=Math.max(4,Math.min(innerWidth-64,x))+'px';fab.style.top=Math.max(4,Math.min(innerHeight-64,y))+'px';}
function mount(){
  const fab=document.createElement('button');fab.id='mt-fab';fab.innerHTML='🧵<small>0</small>';fab.title='Нить памяти · перетащи или нажми';fab.setAttribute('aria-label','Открыть Нить памяти');document.body.append(fab);dragFab(fab);if(settings.left!==null)positionFab(settings.left,settings.top);
  panel=document.createElement('section');panel.id='mt-panel';panel.hidden=true;panel.setAttribute('aria-label','Нить памяти');panel.innerHTML=`<header class="mt-head"><div class="mt-head-mark">🧵</div><div class="mt-head-copy"><div class="mt-kicker">MEMORY THREAD · β4.0 · CHRONICLE</div><h2>Нить памяти</h2><div class="mt-sub" id="mt-status"></div></div><button class="mt-icon" id="mt-close" aria-label="Закрыть панель">×</button></header><div id="mt-progress" class="mt-progress" hidden></div><div class="mt-toolbar"><button class="mt-primary mt-main-action" data-action="new" data-work>✨ Запомнить новое</button><button data-action="range" data-work>📖 Диапазон</button><button id="mt-cancel" hidden>✕ Отменить</button></div><nav class="mt-tabs" aria-label="Разделы памяти">${[['now','🕯','Сейчас'],['memories','🌙','Память'],['chronicle','📚','Хроника'],['context','🧠','Контекст'],['settings','⚙','Настройки']].map(([id,icon,t])=>`<button data-tab="${id}" aria-selected="false"><span>${icon}</span><small>${t}</small></button>`).join('')}</nav><div id="mt-body"></div><footer class="mt-footer"><span id="mt-budget"></span><span class="mt-muted">✦ ручной режим</span></footer>`;document.body.append(panel);body=$('#mt-body');
  dialog=document.createElement('dialog');dialog.id='mt-dialog';document.body.append(dialog);const toast=document.createElement('aside');toast.id='mt-toast';toast.hidden=true;toast.setAttribute('role','status');document.body.append(toast);
  $('#mt-close').onclick=()=>panel.hidden=true;$('#mt-cancel').onclick=()=>{aborter?.abort();notify('Отмена запрошена','Результат не будет применён. API Таверны может завершить запрос в фоне.');};
  panel.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.dataset.tab){tab=el.dataset.tab;render();return;}const run=async()=>{if(el.dataset.action)await action(el.dataset.action);if(el.dataset.card)await cardAction(el.dataset.card,el.closest('[data-id]').dataset.id);if(el.dataset.batch){const b=mem().batches.find(b=>b.id===el.dataset.batch);if(b)showSources(b.sources);}};run().catch(error);});
  window.addEventListener('resize',()=>{if(settings.left!==null)positionFab(settings.left,settings.top);});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)panel.hidden=true;});
  const target=$('#extensionsMenu');if(target){const b=document.createElement('div');b.className='list-group-item flex-container flexGap5';b.tabIndex=0;b.innerHTML='<span>🧵</span><span>Нить памяти</span>';b.onclick=()=>openPanel();b.onkeydown=e=>{if(e.key==='Enter')openPanel();};target.append(b);}
}
async function attachChat(){life++;aborter?.abort();forced=[];usedForced=[];remembered.clear();previewSerial++;setPrompt('');lastRun=loadLastRun();if(dialog.open)dialog.close();const expected=scope();if(chat().length&&ensureIds(chat()))await ctx().saveChat();if(scope()!==expected)return;await refreshContext();render();}
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
