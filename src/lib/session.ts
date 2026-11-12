import type { Question } from '../parser'

export type Mode = 'all' | 'random' | 'retry'

export interface Answer {
  selected: string[]
  validated: boolean
  correct: boolean
}

export interface SessionQuestion {
  q: Question
  /** Option ids in display order. */
  order: string[]
}

export interface Session {
  testKey: string
  title: string
  mode: Mode
  items: SessionQuestion[]
  answers: Record<string, Answer>
  current: number
  finished: boolean
}

export interface StartOptions {
  mode: Mode
  shuffleQuestions: boolean
  shuffleOptions: boolean
  randomCount?: number
}

export const RANDOM_COUNT = 150

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function createSession(
  testKey: string,
  title: string,
  questions: Question[],
  opts: StartOptions,
): Session {
  let picked: Question[]
  if (opts.mode === 'random') {
    picked = shuffle(questions).slice(0, Math.min(opts.randomCount ?? RANDOM_COUNT, questions.length))
  } else if (opts.shuffleQuestions) {
    picked = shuffle(questions)
  } else {
    picked = questions
  }
  return {
    testKey,
    title,
    mode: opts.mode,
    items: picked.map((q) => {
      const ids = q.options.map((o) => o.id)
      return { q, order: opts.shuffleOptions ? shuffle(ids) : ids }
    }),
    answers: {},
    current: 0,
    finished: false,
  }
}

/** A multiple-answer question counts only if the selection matches exactly. */
export function isExactlyCorrect(q: Question, selected: string[]): boolean {
  const right = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id))
  return selected.length === right.size && selected.every((id) => right.has(id))
}

export function stats(s: Session) {
  const answered = s.items.filter((it) => s.answers[it.q.id]?.validated)
  const correct = answered.filter((it) => s.answers[it.q.id].correct).length
  return { total: s.items.length, answered: answered.length, correct }
}
