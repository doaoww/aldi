import { AppError } from "@/domain/errors";
import type { Locale } from "@/domain/types";
import { db } from "@/infrastructure/db";

type Row = Awaited<ReturnType<typeof load>>[number];

const load = (id?: string) =>
  db.exercise.findMany({
    where: { published: true, ...(id && { id }) },
    orderBy: { sortOrder: "asc" },
    include: { translations: { where: { published: true } } },
  });

// 3D-файлы общие для всех языков; тексты — отдельно на каждый язык.
const assetUrl = (path: string | null) =>
  path && !/^https?:\/\//.test(path) && process.env.ASSET_BASE_URL ? `${process.env.ASSET_BASE_URL.replace(/\/$/, "")}${path}` : path;

function view(e: Row, locale: Locale) {
  const t = e.translations.find((x) => x.locale === locale);
  return {
    id: e.id,
    locale,
    durationSec: e.durationSec,
    // Модели может не быть: тогда фронт честно показывает, что 3D ещё не готово.
    has3d: e.modelUrl !== null,
    modelUrl: assetUrl(e.modelUrl),
    animationName: e.animationName,
    // Если инструкции на выбранном языке нет, другой язык незаметно не подставляем.
    available: Boolean(t),
    availableLocales: e.translations.map((x) => x.locale),
    title: t?.title ?? null,
    description: t?.description ?? null,
    instructions: (t?.instructions as string[] | undefined) ?? [],
    breathingCues: (t?.breathingCues as { atSec: number; text: string }[] | undefined) ?? [],
    audioUrl: assetUrl(t?.audioUrl ?? null),
    contraindications: t?.contraindications ?? null,
    // false = демонстрационный пример, не проверенный специалистом.
    reviewed: t?.reviewed ?? false,
  };
}

export async function listExercises(locale: Locale) {
  return { items: (await load()).map((e) => view(e, locale)) };
}

export async function getExercise(id: string, locale: Locale) {
  const [exercise] = await load(id);
  if (!exercise) throw new AppError("NOT_FOUND");
  return view(exercise, locale);
}
