export function baseURL(value){let u;try{u=new URL(value);}catch{throw Error('Укажи полный URL API, например https://provider.example/v1');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('URL должен быть HTTP(S), без ключа, параметров и пароля.');return u.href.replace(/\/(?:chat\/completions|models)\/?$/,'').replace(/\/$/,'');}
async function request(settings,key,path,body,signal){
  const timeout=AbortSignal.timeout(180000), combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetch(`${baseURL(settings.url)}/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{Authorization:`Bearer ${key}`}:{})},body:body?JSON.stringify(body):undefined,signal:combined,credentials:'omit',redirect:'error'});}catch(e){if(combined.aborted)throw Error('Запрос отменён или превысил 3 минуты. Память не изменена.');throw Error('Не удалось обратиться к API. Проверь URL, сеть и CORS у провайдера. Можно переключиться на API Таверны.');}
  if(!response.ok)throw Error(`API: HTTP ${response.status}. ${response.status===401?'Проверь ключ.':response.status===429?'Лимит запросов или баланс.':response.status===400?'Проверь модель, лимит ответа и формат API.':'Запрос не выполнен.'}`);
  let data;try{data=await response.json();}catch{throw Error('API вернул не JSON. Проверь адрес.');}return data;
}
export async function models(settings,key,signal){const d=await request(settings,key,'models',null,signal);if(!Array.isArray(d.data))throw Error('Нет списка моделей. Введи имя вручную.');return d.data.map(x=>x.id).filter(x=>typeof x==='string').sort();}
export async function generate(settings,key,system,prompt,ctx,signal){
  if(settings.mode==='main'){
    if(typeof ctx.generateRaw!=='function')throw Error('В этой версии Таверны нет generateRaw. Обнови Таверну или выбери отдельный API.');
    const text=await ctx.generateRaw({systemPrompt:system,prompt,responseLength:settings.output,trimNames:false});
    if(signal?.aborted)throw Error('Результат отменён. Память не изменена.');
    return {text,usage:null};
  }
  if(!settings.model.trim())throw Error('Укажи модель для отдельного API.');
  const d=await request(settings,key,'chat/completions',{model:settings.model,messages:[{role:'system',content:system},{role:'user',content:prompt}],stream:false,max_tokens:settings.output},signal);
  const c=d.choices?.[0];let text=c?.message?.content;
  if(Array.isArray(text))text=text.map(x=>x.text||'').join('\n');
  if(c?.finish_reason==='length')throw Error('Ответ модели обрезан. Увеличь лимит ответа или уменьши диапазон.');
  if(typeof text!=='string'||!text.trim())throw Error('Модель вернула пустой ответ. Память не изменена.');
  return {text,usage:d.usage||null};
}
