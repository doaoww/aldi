import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCard } from './card.mjs';
const cases = JSON.parse(await readFile(new URL('./four-language-dialogues.json', import.meta.url), 'utf8'));
test('fixtures cover all four languages and expected original quotes belong to mothers', () => {
 assert.deepEqual([...new Set(cases.map(c => c.language.split('-')[0]))].sort(), ['en','kk','ru','uz']);
 for (const c of cases) {
  const messages=c.dialogue.map(m=>({role:m.role==='mother'?'patient':'assistant',text:m.text}));
  const quote=c.expected_card.quote_original;
  const card=buildCard({fields:{complaint:{value:'fixture',quote}}},messages,c.language.split('-')[0]);
  assert.equal(card.fields.complaint.quoteVerified,true,`${c.id}: quote not found in patient messages`);
 }
});

