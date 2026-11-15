import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanion } from './openrouter.mjs';
test('sends conversation and parses response without exposing the key', async () => {
 let request;
 const api = createCompanion({apiKey:'secret', model:'test/model', fetchImpl: async (url, options) => { request={url,options}; return new Response(JSON.stringify({choices:[{message:{content:'Я вас слушаю.'}}]}),{status:200}); }});
 const result=await api.reply({locale:'ru',messages:[{role:'patient',text:'Мне тяжело'}]});
 assert.equal(result.text,'Я вас слушаю.');
 assert.equal(JSON.parse(request.options.body).messages.at(-1).content,'Мне тяжело');
 assert.equal(result.language,'ru');
});
test('maps provider failure to safe error',async()=>{
 const api=createCompanion({apiKey:'secret',model:'test/model',fetchImpl:async()=>new Response('sensitive provider detail',{status:401})});
 await assert.rejects(api.reply({locale:'ru',messages:[]}), e=>e.code==='LLM_UNAVAILABLE' && !e.message.includes('sensitive'));
});
