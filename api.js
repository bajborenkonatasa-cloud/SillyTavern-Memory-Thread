export function baseURL(value){let u;try{u=new URL(value);}catch{throw Error('Укажи полный URL API, например https://provider.example/v1');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('URL должен быть HTTP(S), без ключа, параметров и пароля.');return u.href.replace(/\/(?:chat\/completions|models)\/?$/,'').replace(/\/$/,'');}
async function request(settings,key,path,body,signal){
  const timeout=AbortSignal.timeout(180000), combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetch(`${baseURL(settings.url)}/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{Authorization:`Bearer ${key}`}:{})},body:body?JSON.stringify(body):undefined,signal:combined,credentials:'omit',redirect:'error'});}catch(e){if(combined.aborted)throw Error('Запрос отменён или превысил 3 минуты. Память не изменена.');throw Error('Не удалось обратиться к API. Проверь URL, сеть и CORS у провайдера. Можно переключиться на API Таверны.');}
  if(!response.ok){
    let provider='';
    try{const raw=await response.text();if(raw){try{const parsed=JSON.parse(raw);provider=parsed?.error?.message||parsed?.message||raw;}catch{provider=raw;}}}catch{}
    provider=String(provider||'').replace(/\s+/g,' ').trim().slice(0,600);
    const hint=response.status===401?'Проверь API-ключ.':response.status===429?'Проверь лимит запросов или баланс.':response.status===400?'Проверь модель, лимит ответа и формат API.':response.status>=500?'Провайдер временно недоступен или перегружен.':'Запрос не выполнен.';
    throw Error(`API: HTTP ${response.status}. ${hint}${provider?`\nОтвет провайдера: ${provider}`:''}`);
  }
  let data;try{data=await response.json();}catch{throw Error('API вернул не JSON. Проверь адрес и совместимость OpenAI API.');}return data;
}
export async function models(settings,key,signal){const d=await request(settings,key,'models',null,signal);if(!Array.isArray(d.data))throw Error('Нет списка моделей. Введи имя вручную.');return d.data.map(x=>x.id).filter(x=>typeof x==='string').sort();}
export async function generate(settings,key,system,prompt,ctx,signal){
  if(settings.mode==='main'){
    if(typeof ctx.generateRaw!=='function')throw Error('В этой версии Таверны нет generateRaw. Обнови Таверну или выбери отдельный API.');
    let text;
    try{
      // generateRaw deliberately uses the connection/model currently selected in SillyTavern.
      // URL/key/model from the separate-API section are not involved in this mode.
      text=await ctx.generateRaw({systemPrompt:system,prompt,responseLength:settings.output,trimNames:false});
    }catch(e){
      const detail=e?.message||String(e);
      throw Error(`Текущее API Таверны не ответило: ${detail}`);
    }
    if(signal?.aborted)throw Error('Результат отменён. Память не изменена.');
    if(typeof text!=='string'||!text.trim())throw Error('Текущее API Таверны вернуло пустой ответ. Память не изменена.');
    return {text,usage:null};
  }
  if(!settings.model.trim())throw Error('Укажи модель для отдельного API.');
  const body={model:settings.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],stream:false,max_tokens:settings.output,temperature:0.2};
  // rout.my documents OpenAI-style JSON object mode. Asking for it makes archive output
  // much less likely to be wrapped in prose or malformed markdown. Other generic APIs
  // keep the plain Chat Completions request for compatibility.
  try{if(new URL(baseURL(settings.url)).hostname.toLowerCase().endsWith('rout.my'))body.response_format={type:'json_object'};}catch{}
  const d=await request(settings,key,'chat/completions',body,signal);
  const c=d.choices?.[0],message=c?.message||{};
  const asText=value=>{if(typeof value==='string')return value;if(Array.isArray(value))return value.map(x=>typeof x==='string'?x:(x?.text||x?.content||'')).filter(Boolean).join('\n');return '';};
  let text=asText(message.content)||asText(c?.text)||asText(d?.output_text);
  const reasoning=asText(message.reasoning_content)||asText(message.reasoning);
  if(c?.finish_reason==='length')throw Error(`Ответ модели обрезан${reasoning?' после reasoning':''}. Увеличь лимит ответа или уменьши диапазон.`);
  if(!text.trim()&&reasoning.trim())throw Error('Модель потратила ответ на внутреннее рассуждение, но не вернула финальный текст. Для памяти выбери менее «думающую» модель или увеличь максимум токенов ответа. Память не изменена.');
  if(!text.trim())throw Error('Модель вернула пустой финальный ответ. Память не изменена.');
  return {text,usage:d.usage||null,finishReason:c?.finish_reason||'',model:d.model||settings.model,reasoningTokens:Number(d?.usage?.completion_tokens_details?.reasoning_tokens||0)};
}
