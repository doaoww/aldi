import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCard } from './card.mjs';
test('quotes are checked only against individual patient messages', () => {
 const card = buildCard({fields:{complaint:{value:'Утечка',quote:'подтекает при чихании'},frequency:{value:'ежедневно',quote:'каждый день'}}}, [{role:'patient',text:'Подтекает при чихании'},{role:'assistant',text:'каждый день'}], 'ru');
 assert.equal(Object.keys(card.fields).length,8);
 assert.equal(card.fields.complaint.quoteVerified,true);
 assert.equal(card.fields.frequency.quoteVerified,false);
 assert.equal(card.fields.impact.value,null);
});
test('rejects unknown fields and incorrect types',()=>{
 assert.throws(()=>buildCard({fields:{extra:{value:'x',quote:'x'}}},[],'ru'));
 assert.throws(()=>buildCard({fields:{complaint:{value:42,quote:null}}},[],'ru'));
});
