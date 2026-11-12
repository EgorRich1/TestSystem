import { useEffect, useRef, useState } from 'react'
import type { ParsedTest } from '../parser'
import { RANDOM_COUNT, stats, type Mode, type Session, type StartOptions } from '../lib/session'
import { addUpload, BUNDLED, listUploads, loadTest, removeUpload, type TestSource } from '../lib/tests'
import { Badge, Button, Card, Toggle, plural } from './ui'

interface Props {
  session: Session | null
  onResume: () => void
  onDiscard: () => void
  onStart: (src: TestSource, test: ParsedTest, opts: StartOptions) => void
  onShowReport: (test: ParsedTest) => void
  selectedKey: string
  onSelect: (key: string) => void
}

export function Home({ session, onResume, onDiscard, onStart, onShowReport, selectedKey, onSelect }: Props) {
  const [uploads, setUploads] = useState<TestSource[]>(listUploads)
  const sources = [...BUNDLED, ...uploads]
  const selected = sources.find((s) => s.key === selectedKey) ?? sources[0]

  const [test, setTest] = useState<ParsedTest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('all')
  const [shuffleQuestions, setShuffleQuestions] = useState(false)
  const [shuffleOptions, setShuffleOptions] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    setTest(null)
    setError(null)
    setLoading(true)
    loadTest(selected)
      .then((t) => alive && setTest(t))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [selected])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const { source, persisted } = await addUpload(file)
      setUploads(persisted ? listUploads() : [...uploads, source])
      onSelect(source.key)
      if (!persisted) setNotice('Файл слишком большой для сохранения в браузере: тест доступен до перезагрузки страницы.')
    } catch (e) {
      setError(`Не удалось прочитать файл: ${(e as Error).message}`)
      setLoading(false)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const issuesCount = test ? test.report.issues.length : 0
  const n = test?.questions.length ?? 0
  const s = session && !session.finished ? stats(session) : null

  return (
    <div className="space-y-5">
      {session && s && (
        <Card className="ring-2 ring-teal-600/40">
          <p className="text-sm font-medium tracking-wide text-teal-700 uppercase dark:text-teal-400">Незавершённый тест</p>
          <p className="mt-1 text-lg">
            {session.title}: вопрос {Math.min(session.current + 1, s.total)} из {s.total}, верно {s.correct} из {s.answered}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onResume}>
              Продолжить
            </Button>
            <Button variant="ghost" onClick={onDiscard}>
              Сбросить
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">1. Выберите тест</h2>
        <div className="mt-4 grid gap-3" role="radiogroup" aria-label="Тест">
          {sources.map((src) => {
            const active = src.key === selected.key
            return (
              <div
                key={src.key}
                className={`flex items-center gap-2 rounded-xl ring-1 transition-colors ${
                  active
                    ? 'bg-teal-50 ring-2 ring-teal-600 dark:bg-teal-950/40'
                    : 'ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/60'
                }`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="flex min-h-14 flex-1 items-center gap-3 px-4 py-3 text-left"
                  onClick={() => onSelect(src.key)}
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full ring-2 ${active ? 'ring-teal-600' : 'ring-slate-400'}`}
                  >
                    {active && <span className="size-2.5 rounded-full bg-teal-600" />}
                  </span>
                  <span className="text-lg">{src.title}</span>
                  {!src.bundled && <Badge>загружен</Badge>}
                </button>
                {!src.bundled && (
                  <Button
                    variant="danger"
                    className="mr-2 min-h-9 px-3 py-1 text-sm"
                    onClick={() => {
                      if (!confirm(`Удалить тест «${src.title}» из списка?`)) return
                      removeUpload(src.key)
                      setUploads(listUploads())
                      if (active) onSelect(BUNDLED[0].key)
                    }}
                  >
                    Удалить
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4">
          <input
            ref={fileInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            id="docx-upload"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label
            htmlFor="docx-upload"
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 font-medium text-teal-700 ring-1 ring-teal-700/30 hover:bg-teal-50 dark:text-teal-300 dark:ring-teal-400/30 dark:hover:bg-teal-950/40"
          >
            <span aria-hidden>＋</span> Загрузить свой .docx
          </label>
        </div>

        <div className="mt-5 min-h-12 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50" aria-live="polite">
          {loading && <p className="text-slate-500">Разбираю файл…</p>}
          {error && <p className="text-rose-700 dark:text-rose-300">{error}</p>}
          {test && !loading && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-lg">
                <span className="font-semibold tabular-nums">{n}</span> {plural(n, 'вопрос', 'вопроса', 'вопросов')}
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  · один ответ: {test.report.single} · несколько: {test.report.multiple}
                  {test.report.selfCheck ? ` · по картинке: ${test.report.selfCheck}` : ''}
                </span>
              </p>
              <button
                type="button"
                className="text-teal-700 underline decoration-teal-700/40 underline-offset-4 hover:decoration-teal-700 dark:text-teal-300"
                onClick={() => onShowReport(test)}
              >
                Проблемы разбора{issuesCount ? ` (${issuesCount})` : ''}
              </button>
            </div>
          )}
          {notice && <p className="mt-2 text-amber-800 dark:text-amber-300">{notice}</p>}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">2. Режим</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Режим">
          <ModeCard
            active={mode === 'all'}
            onClick={() => setMode('all')}
            title="Все вопросы"
            text={n ? `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}, по порядку файла` : 'Все вопросы файла по порядку'}
          />
          <ModeCard
            active={mode === 'random'}
            onClick={() => setMode('random')}
            title={`${RANDOM_COUNT} случайных`}
            text={
              n && n < RANDOM_COUNT
                ? `В файле только ${n}: будут все, в случайном порядке`
                : `${RANDOM_COUNT} разных вопросов в случайном порядке`
            }
          />
        </div>
        <div className="mt-4 space-y-1">
          <Toggle
            checked={mode === 'random' || shuffleQuestions}
            disabled={mode === 'random'}
            onChange={setShuffleQuestions}
            label="Перемешать вопросы"
          />
          <Toggle checked={shuffleOptions} onChange={setShuffleOptions} label="Перемешивать варианты ответов" />
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          variant="primary"
          className="w-full py-3.5 text-lg sm:w-auto sm:px-10"
          disabled={!test || n === 0 || loading}
          onClick={() => {
            if (!test) return
            if (session && !session.finished && !confirm('Начать новый тест? Незавершённый тест будет сброшен.')) return
            onStart(selected, test, { mode, shuffleQuestions, shuffleOptions })
          }}
        >
          Начать тест
        </Button>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Клавиши: 1–9 выбрать вариант, Enter проверить / дальше, ← → листать
        </p>
      </div>
    </div>
  )
}

function ModeCard({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-xl px-4 py-3 text-left ring-1 transition-colors ${
        active
          ? 'bg-teal-50 ring-2 ring-teal-600 dark:bg-teal-950/40'
          : 'ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/60'
      }`}
    >
      <span className="block text-lg font-medium">{title}</span>
      <span className="block text-slate-500 dark:text-slate-400">{text}</span>
    </button>
  )
}
