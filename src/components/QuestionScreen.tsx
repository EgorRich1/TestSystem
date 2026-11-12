import { useCallback, useEffect, useState } from "react";
import {
  isExactlyCorrect,
  stats,
  type Answer,
  type Session,
} from "../lib/session";
import { QuestionImage } from "./QuestionImage";
import { Button } from "./ui";

interface Props {
  session: Session;
  onAnswer: (qid: string, answer: Answer) => void;
  onGo: (index: number) => void;
  onFinish: () => void;
  onHome: () => void;
  /** Picture key → URL for the current test. */
  images: Record<string, string>;
}

export function QuestionScreen({
  session,
  onAnswer,
  onGo,
  onFinish,
  onHome,
  images,
}: Props) {
  const { items, current } = session;
  const item = items[current];
  const { q, order } = item;
  const saved = session.answers[q.id];
  const validated = !!saved?.validated;
  const [draft, setDraft] = useState<string[]>(saved?.selected ?? []);
  const selected = validated ? saved.selected : draft;
  const isLast = current === items.length - 1;
  const multiple = q.type === "multiple";
  const selfCheck = q.type === "self";
  /** Self-check question: the answer panel of the picture is shown. */
  const [revealed, setRevealed] = useState(false);
  const st = stats(session);

  // New question → reset the draft.
  useEffect(() => {
    setDraft(session.answers[q.id]?.selected ?? []);
    setRevealed(false);
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);

  const toggle = useCallback(
    (id: string) => {
      if (validated) return;
      setDraft((d) =>
        multiple
          ? d.includes(id)
            ? d.filter((x) => x !== id)
            : [...d, id]
          : [id],
      );
    },
    [validated, multiple],
  );

  const validate = useCallback(() => {
    if (validated || draft.length === 0) return;
    onAnswer(q.id, {
      selected: draft,
      validated: true,
      correct: isExactlyCorrect(q, draft),
    });
  }, [validated, draft, onAnswer, q]);

  const next = useCallback(() => {
    if (isLast) onFinish();
    else onGo(current + 1);
  }, [isLast, onFinish, onGo, current]);

  const finishEarly = () => {
    if (confirm("Завершить тест? Вопросы без ответа засчитаются как неверные."))
      onFinish();
  };

  const grade = useCallback(
    (correct: boolean) =>
      onAnswer(q.id, { selected: [], validated: true, correct }),
    [onAnswer, q.id],
  );

  const primary = useCallback(() => {
    if (validated) next();
    else if (selfCheck) setRevealed(true);
    else validate();
  }, [validated, selfCheck, next, validate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text")
        return;
      if (selfCheck && /^[12]$/.test(e.key)) {
        if (revealed && !validated) {
          e.preventDefault();
          grade(e.key === "1");
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const id = order[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          toggle(id);
        }
      } else if (e.key === "Enter") {
        if (t.tagName === "BUTTON" && t.dataset.primary === undefined) return; // let focused buttons work
        e.preventDefault();
        primary();
      } else if (e.key === "ArrowLeft" && current > 0) {
        onGo(current - 1);
      } else if (e.key === "ArrowRight" && validated) {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    order,
    toggle,
    primary,
    current,
    validated,
    next,
    onGo,
    selfCheck,
    revealed,
    grade,
  ]);

  const byId = new Map(q.options.map((o) => [o.id, o]));
  const pct = Math.round((st.answered / st.total) * 100);

  return (
    <div className="space-y-4 pb-28 sm:pb-6">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          className="-ml-3 px-3 whitespace-nowrap"
          onClick={onHome}
        >
          ← На главную
        </Button>
        {!isLast && (
          <Button
            variant="ghost"
            className="-mr-3 px-3 whitespace-nowrap"
            onClick={finishEarly}
          >
            Завершить тест
          </Button>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold whitespace-nowrap tabular-nums">
            Вопрос {current + 1} / {items.length}
          </h1>
          <p className="text-slate-500 whitespace-nowrap tabular-nums dark:text-slate-400">
            верно {st.correct} из {st.answered}
          </p>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Пройдено"
        >
          <div
            className="h-full rounded-full bg-teal-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {(q.section || q.number !== undefined) && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {q.section ? `${q.section} · ` : ""}
            {q.number !== undefined ? `№ ${q.number} в файле` : ""}
          </p>
        )}
      </div>

      <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-7 dark:bg-slate-900 dark:ring-slate-800">
        {q.text ? (
          <p className="text-xl leading-relaxed font-medium whitespace-pre-line sm:text-2xl sm:leading-relaxed">
            {q.text}
          </p>
        ) : (
          selfCheck && (
            <p className="text-xl font-medium sm:text-2xl">
              Вопрос по картинке
            </p>
          )
        )}
        {q.images?.map((key) =>
          images[key] ? (
            <QuestionImage
              key={key}
              src={images[key]}
              alt="Картинка к вопросу"
              hideAnswer={selfCheck && !revealed && !validated}
              className="mt-4"
            />
          ) : (
            <p
              key={key}
              className="mt-4 rounded-xl bg-slate-100 p-4 text-slate-500 dark:bg-slate-800"
            >
              Загрузка картинки…
            </p>
          ),
        )}
        {selfCheck && !validated && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            {revealed
              ? "Сравните со своим ответом и оцените себя."
              : "Варианты ответа — на картинке. Выберите ответ про себя и нажмите «Показать ответ». Нажмите на картинку, чтобы увеличить."}
          </p>
        )}
        {selfCheck && revealed && !validated && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Button
              className="py-3 text-lg !ring-2 !ring-emerald-600"
              onClick={() => grade(true)}
            >
              ✓ Я ответил верно{" "}
              <kbd className="hidden font-mono text-sm text-slate-400 sm:inline">
                1
              </kbd>
            </Button>
            <Button
              className="py-3 text-lg !ring-2 !ring-rose-600"
              onClick={() => grade(false)}
            >
              ✗ Я ошибся{" "}
              <kbd className="hidden font-mono text-sm text-slate-400 sm:inline">
                2
              </kbd>
            </Button>
          </div>
        )}
        {multiple && !validated && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            Выберите несколько ответов
          </p>
        )}

        {!selfCheck && (
          <fieldset className="mt-5 min-w-0 space-y-3" disabled={validated}>
            <legend className="sr-only">Варианты ответа</legend>
            {order.map((id, i) => {
              const o = byId.get(id)!;
              const isSel = selected.includes(id);
              let tone =
                "ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/60" +
                (isSel
                  ? " !ring-2 !ring-teal-600 bg-teal-50 dark:bg-teal-950/40"
                  : "");
              let tag: string | null = null;
              if (validated) {
                if (o.isCorrect && isSel) {
                  tone =
                    "ring-2 ring-emerald-600 bg-emerald-50 dark:bg-emerald-950/50";
                  tag = "верно";
                } else if (o.isCorrect) {
                  tone =
                    "ring-2 ring-emerald-600 bg-emerald-50 dark:bg-emerald-950/50";
                  tag = multiple ? "пропущен" : "правильный ответ";
                } else if (isSel) {
                  tone = "ring-2 ring-rose-600 bg-rose-50 dark:bg-rose-950/50";
                  tag = "неверно";
                } else {
                  tone = "ring-slate-200 opacity-70 dark:ring-slate-700";
                }
              }
              return (
                <label
                  key={id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3.5 ring-1 sm:gap-4 sm:px-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-teal-600/60 ${tone} ${validated ? "cursor-default" : ""}`}
                >
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={q.id}
                    className="mt-1.5 size-5 shrink-0 accent-teal-700"
                    checked={isSel}
                    onChange={() => toggle(id)}
                  />
                  <span className="min-w-0 flex-1 text-lg leading-relaxed [overflow-wrap:anywhere] sm:text-xl">
                    {o.text}
                    {o.images?.map(
                      (key) =>
                        images[key] && (
                          <span
                            key={key}
                            className="mt-2 block max-w-xs"
                            onClick={(e) => e.preventDefault()}
                          >
                            <QuestionImage
                              src={images[key]}
                              alt={`Картинка к варианту ${i + 1}`}
                            />
                          </span>
                        ),
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <kbd className="hidden rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-500 sm:inline dark:bg-slate-800 dark:text-slate-400">
                      {i + 1}
                    </kbd>
                    {tag && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-sm font-semibold ${
                          tag === "неверно"
                            ? "bg-rose-600 text-white"
                            : tag === "пропущен"
                              ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-600 dark:bg-emerald-900 dark:text-emerald-100"
                              : "bg-emerald-600 text-white"
                        }`}
                      >
                        {tag}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {validated && (
          <p
            role="status"
            className={`mt-5 rounded-xl px-4 py-3 text-lg font-semibold ${
              saved.correct
                ? "bg-emerald-600 text-white dark:bg-emerald-700"
                : "bg-rose-600 text-white dark:bg-rose-700"
            }`}
          >
            {selfCheck
              ? saved.correct
                ? "✓ Вы отметили: верно"
                : "✗ Вы отметили: ошибка"
              : saved.correct
                ? "✓ Правильно"
                : "✗ Неправильно"}
          </p>
        )}
      </article>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 dark:border-slate-800 dark:bg-slate-950/95 sm:dark:bg-transparent">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Button
            variant="secondary"
            className="whitespace-nowrap"
            disabled={current === 0}
            onClick={() => onGo(current - 1)}
            aria-label="Предыдущий вопрос"
          >
            ← Назад
          </Button>
          <div className="flex-1" />
          <Button
            variant="primary"
            data-primary
            className="min-w-36 text-lg whitespace-nowrap sm:min-w-44"
            disabled={!validated && (selfCheck ? revealed : draft.length === 0)}
            onClick={primary}
          >
            {!validated
              ? selfCheck
                ? "Показать ответ"
                : "Проверить"
              : isLast
                ? "Результаты"
                : "Далее →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
