import type { Locale } from "./types";

// Поиск опасных слов — дополнительный сигнал, а не клинический протокол.
// Он не обнаружит все опасные ситуации. Списки kk и uz — черновик, их должен проверить носитель,
// а весь набор — профильный специалист.
export type SafetyCategory = "bleeding" | "fever" | "neuro" | "chest" | "self_harm";
type Rules = Array<[SafetyCategory, RegExp]>;

const RULES: Record<Locale, Rules> = {
  ru: [
    ["bleeding", /прокладк\S*\s+(\S+\s+){0,2}(за|в)\s+час|сильн\S*\s+кровотеч|кровь\s+не\s+останавлива|сгустк\S*\s+(больше|крупнее)/],
    ["fever", /температур\S*\s*(38|39|40)|озноб|лихорад/],
    ["neuro", /сильн\S*\s+головн\S*\s+бол|пелен\S*\s+перед\s+глаз|мушки|двоится|судорог/],
    ["chest", /бол\S*\s+в\s+груди|трудно\s+дышать|не\s+могу\s+вдохнуть|одышк/],
    ["self_harm", /навредить\s+(себе|ребенку)|не\s+хочу\s+жить|покончить|лучше\s+бы\s+меня\s+не\s+было|причинить\s+себе/],
  ],
  en: [
    ["bleeding", /soak\w*\s+(through\s+)?(a\s+|the\s+)?pad\s+(in\s+)?(an?\s+)?hour|heavy\s+bleeding|bleeding\s+(won't|does\s*n't)\s+stop|large\s+clots/],
    ["fever", /\bfever\b|temperature\s+(of\s+)?(38|39|40|10[0-9])|\bchills\b/],
    ["neuro", /severe\s+headache|worst\s+headache|blurr\w*\s+vision|seeing\s+spots|seizure/],
    ["chest", /chest\s+pain|can't\s+breathe|short\w*\s+of\s+breath|trouble\s+breathing/],
    ["self_harm", /hurt\s+(myself|the\s+baby|my\s+baby)|don't\s+want\s+to\s+live|end\s+(it\s+all|my\s+life)|better\s+off\s+(dead|without\s+me)|kill\s+myself/],
  ],
  kk: [
    ["bleeding", /қан\s+кет|қатты\s+қан|төсем\S*\s+(бір\s+)?сағат/],
    ["fever", /(қызу|ыстығ)\S*\s*(38|39|40)|қалтыра/],
    ["neuro", /бас\S*\s+қатты\s+ауыр|көз\S*\s+бұлдыр|көзім\s+көрмей|құрысу/],
    ["chest", /кеуде\S*\s+ауыр|дем\s+ала\s+алма|тыныс\S*\s+тарыл/],
    ["self_harm", /өмір\s+сүргім\s+келме|өзіме\s+зиян|балама\s+зиян|өлгім\s+кел/],
  ],
  uz: [
    ["bleeding", /qon\s+ket|kuchli\s+qon|prokladka\S*\s+(bir\s+)?soat/],
    ["fever", /(harorat|isitma)\S*\s*(38|39|40)|qaltira/],
    ["neuro", /bosh\S*\s+qattiq\s+og'ri|ko'z\S*\s+xira|ko'rmayap|tutqanoq/],
    ["chest", /ko'krak\S*\s+og'ri|nafas\s+ololmay|nafas\s+qis/],
    ["self_harm", /yashagim\s+kelmay|o'zimga\s+zarar|bolamga\s+zarar|o'lgim\s+kel/],
  ],
};

// Проверяем по правилам всех языков: женщина может смешивать языки в одной реплике.
export function checkSafety(text: string): SafetyCategory | null {
  const t = text.toLowerCase().replace(/ё/g, "е").replace(/[’‘ʻʼ`´]/g, "'");
  for (const rules of Object.values(RULES)) {
    for (const [category, re] of rules) if (re.test(t)) return category;
  }
  return null;
}

// Что помощница отвечает вместо обычной реплики. Номера экстренных служб зависят от страны,
// поэтому здесь их нет: фронт показывает согласованную инструкцию для страны пациентки.
// Тексты — черновик до проверки специалистом.
export const SAFETY_REPLY: Record<Locale, string> = {
  ru: "То, что вы описали, может требовать срочной помощи. Пожалуйста, прямо сейчас обратитесь в экстренную службу — номера показаны на экране. Я не могу оценить ваше состояние и не заменяю врача.",
  en: "What you described may need urgent help. Please contact emergency services right now — the numbers are shown on the screen. I cannot assess your condition and I am not a substitute for a doctor.",
  kk: "Сіз сипаттаған жағдай шұғыл көмекті қажет етуі мүмкін. Дәл қазір жедел қызметке хабарласыңыз — нөмірлер экранда көрсетілген. Мен сіздің жағдайыңызды бағалай алмаймын және дәрігерді алмастырмаймын.",
  uz: "Siz aytgan holat shoshilinch yordam talab qilishi mumkin. Iltimos, hoziroq shoshilinch xizmatga murojaat qiling — raqamlar ekranda ko'rsatilgan. Men ahvolingizni baholay olmayman va shifokor o'rnini bosa olmayman.",
};
