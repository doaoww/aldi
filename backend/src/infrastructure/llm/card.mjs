export const FIELD_KEYS = ['time_since_birth','birth_info','complaint','triggers','frequency','impact','tried_or_told','own_question'];
const normalize = text => text.normalize('NFC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
export function buildCard(raw, messages, locale) {
 if (!['ru','kk','uz','en'].includes(locale) || !raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object' || Array.isArray(raw.fields)) throw new TypeError('Invalid card');
 if (Object.keys(raw.fields).some(k => !FIELD_KEYS.includes(k))) throw new TypeError('Unknown field');
 const patientTexts = messages.filter(m => m.role === 'patient' && typeof m.text === 'string').map(m => normalize(m.text));
 const fields = Object.fromEntries(FIELD_KEYS.map(key => {
   const f = raw.fields[key] ?? {value:null,quote:null};
   if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(k => !['value','quote'].includes(k)) || !('value' in f) || !('quote' in f) || (f.value !== null && typeof f.value !== 'string') || (f.quote !== null && typeof f.quote !== 'string')) throw new TypeError('Invalid field');
   const quote = f.quote?.trim() || null;
   return [key,{value:f.value,quote,quoteVerified:!!quote && patientTexts.some(t => t.includes(normalize(quote))),editedByPatient:false}];
 }));
 const questions = raw.doctorQuestions ?? [];
 if (!Array.isArray(questions) || questions.some(q => typeof q !== 'string')) throw new TypeError('Invalid questions');
 return {version:1,sourceLocale:locale,fields,doctorQuestions:questions};
}
