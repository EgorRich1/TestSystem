import { useEffect, useMemo, useState } from 'react'
import { FEATURE_LABELS, type ParsedTest, type ParseIssue } from '../parser'
import { Badge, Button } from './ui'

const KIND_LABELS: Record<ParseIssue['kind'], string> = {
  'no-correct': 'Нет выделенного ответа',
  'too-few-options': 'Меньше двух вариантов',
  orphan: 'Не импортировано',
  'hint-mismatch': '«Один ответ», но выделено несколько',
  'all-correct': 'Выделены все варианты',
  'partial-format': 'Частичное выделение',
  'many-options': 'Слишком много вариантов',
  'possible-wrap': 'Возможен разрыв строки',
  'no-anchor': 'Нет строки «Выберите…»',
  note: 'Пометка «проверить»',
  'duplicate-options': 'Повторы вариантов',
  'image-only': 'Вопрос-картинка (самопроверка)',
}

const ORDER: ParseIssue['kind'][] = [
  'orphan',
  'image-only',
  'no-correct',
  'too-few-options',
  'hint-mismatch',
  'partial-format',
  'all-correct',
  'no-anchor',
  'many-options',
  'possible-wrap',
  'duplicate-options',
  'note',
]

export function ReportDialog({ test, onClose }: { test: ParsedTest; onClose: () => void }) {
  const r = test.report
  const groups = useMemo(() => {
    const m = new Map<ParseIssue['kind'], ParseIssue[]>()
    for (const i of r.issues) m.set(i.kind, [...(m.get(i.kind) ?? []), i])
    return ORDER.filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const)
  }, [r.issues])
  const [open, setOpen] = useState<string | null>(groups[0]?.[0] ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Отчёт о разборе файла"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-semibold">Отчёт о разборе</h2>
            <p className="text-slate-500 dark:text-slate-400">{test.title}</p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </Button>
        </header>

        <div className="overflow-y-auto p-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Найдено вопросов" value={r.found} />
            <Stat label="В тесте" value={r.usable} />
            <Stat label="Один ответ" value={r.single} />
            <Stat label="Несколько" value={r.multiple} />
          </dl>

          <p className="mt-4 text-slate-600 dark:text-slate-300">
            Правильные ответы определены по:{' '}
            {Object.entries(r.markings)
              .sort((a, b) => b[1] - a[1])
              .map(([f, n]) => `${FEATURE_LABELS[f as keyof typeof FEATURE_LABELS] ?? f} (${n})`)
              .join(', ') || '—'}
            . Склеено перенесённых строк: {r.joinedLines}.
          </p>

          {groups.length === 0 ? (
            <p className="mt-6 text-lg">Проблем не найдено.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {groups.map(([kind, items]) => (
                <div key={kind} className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setOpen(open === kind ? null : kind)}
                    aria-expanded={open === kind}
                  >
                    <span className="font-medium">{KIND_LABELS[kind]}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={items[0].excluded ? 'rose' : 'amber'}>{items.length}</Badge>
                      <span className="text-slate-400">{open === kind ? '▴' : '▾'}</span>
                    </span>
                  </button>
                  {open === kind && (
                    <ul className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {items.map((i, n) => (
                        <li key={n} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            {i.number !== undefined && <span>№ {i.number} в файле</span>}
                            {i.index !== undefined && <span>· вопрос {i.index} по порядку</span>}
                            {i.excluded && <Badge tone="rose">исключён из теста</Badge>}
                          </div>
                          <p className="mt-1">{i.excerpt}</p>
                          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{i.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
