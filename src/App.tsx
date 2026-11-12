import { useCallback, useEffect, useState } from 'react'
import { Home } from './components/Home'
import { QuestionScreen } from './components/QuestionScreen'
import { ReportDialog } from './components/ReportDialog'
import { Results } from './components/Results'
import { Button } from './components/ui'
import type { ParsedTest } from './parser'
import { createSession, type Answer, type Session } from './lib/session'
import { KEYS, load, remove, save } from './lib/storage'
import { BUNDLED, findSource, loadTest } from './lib/tests'

type Theme = 'system' | 'light' | 'dark'
interface Prefs {
  theme: Theme
  fontScale: number
  selectedKey: string
}

const FONT_SCALES = [1, 1.125, 1.25, 1.375]

export default function App() {
  const [session, setSession] = useState<Session | null>(() => load<Session | null>(KEYS.session, null))
  const [inTest, setInTest] = useState(() => !!session)
  const [report, setReport] = useState<ParsedTest | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    theme: 'system',
    fontScale: 1,
    selectedKey: BUNDLED[0].key,
    ...load<Partial<Prefs>>(KEYS.prefs, {}),
  }))

  // Pictures live in the parsed test, not in the saved session: load them for the session's test.
  const [images, setImages] = useState<Record<string, string>>({})
  const testKey = session?.testKey
  useEffect(() => {
    const src = testKey ? findSource(testKey) : undefined
    if (!src) return
    let alive = true
    loadTest(src)
      .then((t) => alive && setImages(t.images ?? {}))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [testKey])

  // Persist.
  useEffect(() => {
    if (session) save(KEYS.session, session)
    else remove(KEYS.session)
  }, [session])
  useEffect(() => {
    save(KEYS.prefs, prefs)
  }, [prefs])

  // Theme + font size.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#f8fafc')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [prefs.theme])
  useEffect(() => {
    document.documentElement.style.fontSize = `${prefs.fontScale * 100}%`
  }, [prefs.fontScale])

  const update = useCallback((fn: (s: Session) => Session) => setSession((s) => (s ? fn(s) : s)), [])
  const onAnswer = useCallback(
    (qid: string, a: Answer) => update((s) => ({ ...s, answers: { ...s.answers, [qid]: a } })),
    [update],
  )
  const onGo = useCallback((i: number) => update((s) => ({ ...s, current: i })), [update])
  const onFinish = useCallback(() => update((s) => ({ ...s, finished: true })), [update])

  const goHome = () => {
    setInTest(false)
    window.scrollTo({ top: 0 })
  }

  const showQuestion = inTest && session && !session.finished
  const showResults = inTest && session?.finished

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <button type="button" onClick={goHome} className="flex items-center gap-2 text-left font-semibold">
            <img src="./favicon.svg" alt="" className="size-7" />
            <span className="text-lg">Тесты</span>
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              className="min-h-10 px-3"
              aria-label="Уменьшить шрифт"
              disabled={prefs.fontScale === FONT_SCALES[0]}
              onClick={() => setPrefs((p) => ({ ...p, fontScale: FONT_SCALES[Math.max(0, FONT_SCALES.indexOf(p.fontScale) - 1)] }))}
            >
              A−
            </Button>
            <Button
              variant="ghost"
              className="min-h-10 px-3 text-lg"
              aria-label="Увеличить шрифт"
              disabled={prefs.fontScale === FONT_SCALES[FONT_SCALES.length - 1]}
              onClick={() =>
                setPrefs((p) => ({
                  ...p,
                  fontScale: FONT_SCALES[Math.min(FONT_SCALES.length - 1, FONT_SCALES.indexOf(p.fontScale) + 1)],
                }))
              }
            >
              A+
            </Button>
            <Button
              variant="ghost"
              className="min-h-10 px-3"
              aria-label="Сменить тему"
              title={{ system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' }[prefs.theme]}
              onClick={() =>
                setPrefs((p) => ({ ...p, theme: ({ system: 'light', light: 'dark', dark: 'system' } as const)[p.theme] }))
              }
            >
              {{ system: '◐', light: '☀', dark: '☾' }[prefs.theme]}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5 sm:py-8">
        {showQuestion ? (
          <QuestionScreen
            session={session}
            images={images}
            onAnswer={onAnswer}
            onGo={onGo}
            onFinish={onFinish}
            onHome={goHome}
          />
        ) : showResults ? (
          <Results
            session={session}
            images={images}
            onHome={() => {
              setSession(null)
              goHome()
            }}
            onReview={(i) => update((s) => ({ ...s, current: i, finished: false }))}
            onRetryWrong={() => {
              const wrong = session.items.filter((it) => {
                const a = session.answers[it.q.id]
                return a?.validated && !a.correct
              })
              setSession({
                testKey: session.testKey,
                title: session.title.replace(/( — ошибки)?$/, ' — ошибки'),
                mode: 'retry',
                items: wrong.map((it) => ({ ...it })),
                answers: {},
                current: 0,
                finished: false,
              })
              window.scrollTo({ top: 0 })
            }}
          />
        ) : (
          <Home
            session={session}
            selectedKey={prefs.selectedKey}
            onSelect={(key) => setPrefs((p) => ({ ...p, selectedKey: key }))}
            onResume={() => setInTest(true)}
            onDiscard={() => {
              if (confirm('Сбросить незавершённый тест?')) setSession(null)
            }}
            onShowReport={setReport}
            onStart={(src, test, opts) => {
              setSession(createSession(src.key, test.title, test.questions, opts))
              setInTest(true)
              window.scrollTo({ top: 0 })
            }}
          />
        )}
      </main>

      {report && <ReportDialog test={report} onClose={() => setReport(null)} />}
    </div>
  )
}
