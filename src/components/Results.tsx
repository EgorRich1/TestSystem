import { stats, type Session } from "../lib/session";
import { QuestionImage } from "./QuestionImage";
import { Button, Card, plural } from "./ui";

interface Props {
  session: Session;
  onRetryWrong: () => void;
  onHome: () => void;
  onReview: (index: number) => void;
  images: Record<string, string>;
}

export function Results({
  session,
  onRetryWrong,
  onHome,
  onReview,
  images,
}: Props) {
  const st = stats(session);
  const pct = st.total ? Math.round((st.correct / st.total) * 100) : 0;
  const unanswered = st.total - st.answered;
  const wrong = session.items
    .map((it, index) => ({ it, index, a: session.answers[it.q.id] }))
    .filter((x) => x.a?.validated && !x.a.correct);

  const tone =
    pct >= 80
      ? "text-emerald-700 dark:text-emerald-400"
      : pct >= 60
        ? "text-amber-700 dark:text-amber-400"
        : "text-rose-700 dark:text-rose-400";

  return (
    <div className="space-y-5">
      <Card className="text-center">
        <p className="text-slate-500 dark:text-slate-400">{session.title}</p>
        <p className={`mt-2 text-6xl font-bold tabular-nums ${tone}`}>{pct}%</p>
        <p className="mt-2 text-xl">
          Верно <span className="font-semibold tabular-nums">{st.correct}</span>{" "}
          из <span className="font-semibold tabular-nums">{st.total}</span>
        </p>
        {unanswered > 0 && (
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Без ответа: {unanswered}{" "}
            {plural(unanswered, "вопрос", "вопроса", "вопросов")} (засчитаны как
            неверные)
          </p>
        )}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            variant="primary"
            className="text-lg"
            disabled={wrong.length === 0}
            onClick={onRetryWrong}
          >
            Повторить только ошибки{wrong.length ? ` (${wrong.length})` : ""}
          </Button>
          <Button onClick={onHome} className="text-lg">
            На главную
          </Button>
        </div>
      </Card>

      {wrong.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xl font-semibold">
            Ошибки ({wrong.length})
          </h2>
          <ol className="space-y-3">
            {wrong.map(({ it, index, a }) => {
              const sel = new Set(a.selected);
              const mine = it.q.options.filter((o) => sel.has(o.id));
              const right = it.q.options.filter((o) => o.isCorrect);
              return (
                <li key={it.q.id}>
                  <Card>
                    <div className="flex items-baseline justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
                      <span>
                        Вопрос {index + 1}
                        {it.q.number !== undefined
                          ? ` · № ${it.q.number} в файле`
                          : ""}
                      </span>
                      <button
                        type="button"
                        className="text-teal-700 underline underline-offset-4 dark:text-teal-300"
                        onClick={() => onReview(index)}
                      >
                        открыть
                      </button>
                    </div>
                    <p className="mt-2 text-lg font-medium leading-relaxed">
                      {it.q.text ||
                        (it.q.type === "self" ? "Вопрос по картинке" : "")}
                    </p>
                    {it.q.images?.map(
                      (key) =>
                        images[key] && (
                          <div key={key} className="mt-3 max-w-md">
                            <QuestionImage
                              src={images[key]}
                              alt="Картинка к вопросу"
                            />
                          </div>
                        ),
                    )}
                    {it.q.type === "self" ? (
                      <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 dark:bg-rose-950/40">
                        Вы отметили этот вопрос как ошибку. Правильный ответ —
                        внизу картинки.
                      </p>
                    ) : (
                      <dl className="mt-3 space-y-2">
                        <div className="rounded-lg bg-rose-50 px-3 py-2 dark:bg-rose-950/40">
                          <dt className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                            Ваш ответ
                          </dt>
                          {mine.map((o) => (
                            <dd
                              key={o.id}
                              className={
                                o.isCorrect
                                  ? "text-emerald-800 dark:text-emerald-300"
                                  : ""
                              }
                            >
                              {o.isCorrect ? "✓ " : "✗ "}
                              {o.text}
                            </dd>
                          ))}
                        </div>
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/40">
                          <dt className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                            Правильный ответ
                          </dt>
                          {right.map((o) => (
                            <dd key={o.id}>{o.text}</dd>
                          ))}
                        </div>
                      </dl>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        st.answered > 0 && (
          <p className="text-center text-lg">Ни одной ошибки — отлично!</p>
        )
      )}
    </div>
  );
}
