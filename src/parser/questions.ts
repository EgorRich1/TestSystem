/**
 * Lines → questions.
 *
 * Structure (both bundled files come from Moodle exports):
 *   [N. | N - | N ]question text (1..n lines)
 *   Выберите один ответ: | Выберите один или несколько ответов:   ← "anchor"
 *   option line(s)…
 *
 * The anchor line is the most reliable separator, so questions are found
 * around anchors. Files without anchors fall back to "numbered line followed
 * by options".
 *
 * Correct answers are detected with a "different from its siblings" rule:
 * a formatting feature counts as a marking only if some, but not all,
 * options of the same question carry it.
 */
import { normalizeText, type Line, type Segment } from './docxXml'
import type { IssueKind, Option, ParseIssue, ParseReport, ParsedTest, Question } from './types'

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

export const ANCHOR_RE =
  /^(?:(?:Выберите|Select|Choose)(?:\s+(?:один|одну|one))?(?:\s+(?:или|or))?(?:\s+(?:несколько|more))?(?:\s+(?:ответ|ответа|ответов|вариант|варианта|вариантов|answer|answers))?|один(?:\s+или\s+несколько)?\s+ответ(?:а|ов)?)\s*[:.]?$/i

/** An anchor glued to other text in the same line: "…это:Выберите один ответ:восстановление…". */
const ANCHOR_INLINE_RE = /(?:Выберите\s+один(?:\s+или\s+несколько)?\s+ответ(?:а|ов)?\s*[:.]?|один(?:\s+или\s+несколько)?\s+ответ(?:а|ов)?\s*:)/i

/** "12. Text", "12) Text", "724 - Text", "1  Text" (number + capital letter). */
export const QUESTION_NUMBER_RE = /^(\d{1,4})(?:\s*[.)]|\s*[-–—](?=\s|$)|(?=\s+[A-ZА-ЯЁ«"(]))\s*/

const CHECK_RE = /[✅✔✓☑]\uFE0F?/g
const DASH_RE = /^[-–—]\s*/
const OCR_RADIO_RE = /^[ОO]\s+(?=[a-zа-яё])/
const LABEL_RE = /^(?:[а-яё]|[a-z]|\d{1,2})\s*[).]\s+/i
const END_WORD_RE =
  /(?:^|\s)(?:в|во|и|с|со|на|по|к|ко|о|об|обо|от|до|для|из|без|при|а|или|не|но|за|под|над|через|у|что|как|между|перед|после|либо|чем|его|их|ее|её)$/

/* ------------------------------------------------------------------ */
/* Formatting features                                                 */
/* ------------------------------------------------------------------ */

export const FEATURES = [
  'highlight',
  'shading',
  'check',
  'bold',
  'color',
  'underline',
  'dash',
  'italic',
  'strike',
] as const
export type Feature = (typeof FEATURES)[number]

/** Lower tier wins: italic only decides if nothing stronger differs. */
const TIER: Record<Feature, number> = {
  highlight: 1,
  shading: 1,
  check: 1,
  bold: 2,
  color: 2,
  underline: 2,
  dash: 2,
  italic: 3,
  strike: 3,
}

export const FEATURE_LABELS: Record<Feature, string> = {
  highlight: 'выделение цветом (highlight)',
  shading: 'заливка (shading)',
  check: 'значок ✅',
  bold: 'жирный шрифт',
  color: 'цвет шрифта',
  underline: 'подчёркивание',
  dash: 'дефис перед ответом',
  italic: 'курсив',
  strike: 'зачёркивание',
}

type Fractions = Record<Feature, number>

function visibleLen(s: string) {
  return s.replace(/\s/g, '').replace(CHECK_RE, '').length
}

/** Share of visible characters carrying each feature (0..1). */
export function fractions(segs: Segment[], text: string): Fractions {
  const f: Fractions = {
    highlight: 0, shading: 0, check: 0, bold: 0, color: 0, underline: 0, dash: 0, italic: 0, strike: 0,
  }
  let total = 0
  for (const s of segs) {
    const n = visibleLen(s.text)
    if (!n) continue
    total += n
    if (s.fmt.highlight) f.highlight += n
    if (s.fmt.shading) f.shading += n
    if (s.fmt.bold) f.bold += n
    if (s.fmt.color) f.color += n
    if (s.fmt.underline) f.underline += n
    if (s.fmt.italic) f.italic += n
    if (s.fmt.strike) f.strike += n
  }
  if (total) for (const k of FEATURES) f[k] /= total
  CHECK_RE.lastIndex = 0
  f.check = CHECK_RE.test(text) ? 1 : 0
  f.dash = DASH_RE.test(text) ? 1 : 0
  return f
}

const ON = 0.5
const PARTIAL_LOW = 0.15
const PARTIAL_HIGH = 0.85

/** Formatting signature used to decide whether two lines may be one option. */
function markSignature(l: Line): string {
  const f = fractions(l.segs, '')
  return (['highlight', 'shading', 'bold', 'color', 'underline'] as const)
    .filter((k) => f[k] >= ON)
    .join(',')
}

function isMarkedLine(l: Line): boolean {
  const f = fractions(l.segs, l.text)
  return f.highlight >= ON || f.shading >= ON || f.check > 0 || f.dash > 0
}

function isHeading(l: Line): boolean {
  if (!l.text) return false
  if (ANCHOR_RE.test(l.text) || QUESTION_NUMBER_RE.test(l.text)) return false
  if (l.headingStyle) return true
  const f = fractions(l.segs, l.text)
  return f.color >= 0.9 && f.underline >= 0.9 && f.highlight < 0.1 && l.text.length < 120
}

/* ------------------------------------------------------------------ */
/* Splitting glued lines                                               */
/* ------------------------------------------------------------------ */

function withSegs(l: Line, segs: Segment[]): Line {
  return { ...l, segs, text: normalizeText(segs.map((s) => s.text).join('')) }
}

/** Split a line after `visible` non-whitespace characters, keeping formatting. */
export function splitAt(l: Line, visible: number): [Line, Line] {
  const head: Segment[] = []
  const tail: Segment[] = []
  let left = visible
  for (const s of l.segs) {
    if (left <= 0) {
      tail.push(s)
      continue
    }
    let cut = 0
    let cnt = 0
    while (cut < s.text.length && cnt < left) {
      if (!/\s/.test(s.text[cut])) cnt++
      cut++
    }
    head.push({ text: s.text.slice(0, cut), fmt: s.fmt })
    if (cut < s.text.length) tail.push({ text: s.text.slice(cut), fmt: s.fmt })
    left -= cnt
  }
  return [withSegs(l, head), { ...withSegs(l, tail), hasImage: false }]
}

const visibleCount = (s: string) => s.replace(/\s/g, '').length

/** Pull "Выберите один ответ:" out of lines where it is glued to text. */
function splitAnchors(lines: Line[]): Line[] {
  const out: Line[] = []
  const queue = [...lines]
  while (queue.length) {
    const l = queue.shift()!
    const m = ANCHOR_INLINE_RE.exec(l.text)
    if (!m || ANCHOR_RE.test(l.text)) {
      out.push(l)
      continue
    }
    const before = l.text.slice(0, m.index)
    const [head, rest] = before.trim() ? splitAt(l, visibleCount(before)) : [null, l]
    const [anchor, tail] = splitAt(rest, visibleCount(m[0]))
    if (head) out.push(head)
    out.push(anchor)
    if (tail.text) queue.unshift(tail)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Option assembly                                                     */
/* ------------------------------------------------------------------ */

interface RawOption {
  lines: Line[]
  /** Picture-only lines that follow this option. */
  pics: Line[]
}

function firstWord(s: string) {
  return s.split(' ')[0] ?? ''
}

function lastWord(s: string) {
  const w = s.split(' ')
  return w[w.length - 1] ?? ''
}

/**
 * Adjective endings that almost never end an answer on their own
 * ("…с тяжелым", "…эпидермальных", "…экономической") — a noun must follow.
 * Endings of standalone answers ("кислая", "пирогенные") are left out on purpose.
 */
const ADJ_ENDINGS: [RegExp, string][] = [
  [/(?:ого|его)$/, 'ого'],
  [/(?:ому|ему)$/, 'ому'],
  [/(?:ыми|ими)$/, 'ыми'],
  [/(?:ым|им)$/, 'ым'],
  [/(?:ых|их)$/, 'ых'],
  [/(?:ск|н)ой$/, 'ой'],
]
const ANY_ENDING: [RegExp, string][] = [
  ...ADJ_ENDINGS,
  [/(?:ой|ей)$/, 'ой'],
  [/(?:ая|яя)$/, 'ая'],
  [/(?:ую|юю)$/, 'ую'],
  [/(?:ое|ее)$/, 'ое'],
  [/(?:ые|ие)$/, 'ые'],
]
/** Adjectives used as nouns ("у новорожденных", "слизистых"). */
const NOUN_LIKE_RE =
  /^(?:новорожденн|слизист|беременн|легк|больн|взросл|животн|насеком|близк|родн|пожил|рабоч|учащ|военнослужащ|умерш|пострадавш|заболевш|посторонн|месячн|остальн|прочи|други|многи|таки|их$|его$)/
const STARTS_WITH_FUNCTION_WORD_RE =
  /^(?:в|во|и|с|со|на|по|к|ко|о|об|от|до|для|из|без|при|а|или|не|но|за|под|над|через|у|только|чем)\s/

function endingClass(w: string, table: [RegExp, string][]): string | null {
  for (const [re, cls] of table) if (re.test(w)) return cls
  return null
}

/**
 * Was `cur` wrapped off the end of `prev` (PDF copy-paste)?
 * Only grammar-based signals are used — line width is unreliable with
 * proportional fonts and gives many false merges.
 */
export function shouldJoin(prev: Line, cur: Line): boolean {
  const pt = prev.text
  const ct = cur.text
  if (!pt || !ct) return false
  if (DASH_RE.test(ct)) return false
  CHECK_RE.lastIndex = 0
  if (CHECK_RE.test(pt)) return false
  if (markSignature(prev) !== markSignature(cur)) return false
  if (/[.;!?:,]$/.test(pt)) return false
  // "… с тяжелым" / "… инстилляции в" — dangling preposition or conjunction.
  if (END_WORD_RE.test(pt)) return true
  if (!/^[a-zа-яё(]/.test(ct)) return false
  // "… грам-" / "… грам -" — hyphenated word split.
  if (/[а-яёa-z]\s?-$/i.test(pt)) return true
  const lwRaw = lastWord(pt)
  const lw = lwRaw.toLowerCase()
  const fw = firstWord(ct).toLowerCase()
  const cls = endingClass(lw, ADJ_ENDINGS)
  if (!cls) return false
  if (pt.split(' ').length < 2) return false // a one-word answer is complete
  if (/^[A-ZА-ЯЁ]/.test(lwRaw)) return false // surname: "Левандовского"
  if (NOUN_LIKE_RE.test(lw)) return false
  if (STARTS_WITH_FUNCTION_WORD_RE.test(ct + ' ')) return false
  // Parallel answers ("цилиндрическим" / "мерцательным") are separate.
  if (endingClass(fw, ANY_ENDING) === cls) return false
  return true
}

const NOTE_RE = /^проверить[.!]?$/i

/** Short lowercase line after a long one — maybe a wrap we did not dare to join. */
function looksWrapped(prev: Line, cur: Line): boolean {
  const pt = prev.text
  const ct = cur.text
  CHECK_RE.lastIndex = 0
  if (CHECK_RE.test(pt) || DASH_RE.test(ct)) return false
  if (/[.;!?:,)]$/.test(pt)) return false
  if (!/^[a-zа-яё]/.test(ct) || ct.split(' ').length > 2) return false
  if (pt.length < 28 || pt.split(' ').length < 3) return false
  return markSignature(prev) === markSignature(cur)
}

function optionText(o: RawOption): string {
  return o.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim()
}

function cleanOption(text: string): string {
  return text
    .replace(CHECK_RE, '')
    .replace(DASH_RE, '')
    .replace(OCR_RADIO_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

interface Block {
  index: number
  number?: number
  section?: string
  text: string
  hint: 'single' | 'multiple' | null
  optionLines: Line[]
  /** Found by its number only — there was no "Выберите…" line. */
  noAnchor?: boolean
  /** Picture ids shown with the question text. */
  images: string[]
  /** Only a picture, no text options (screenshot of a question). */
  selfCheck?: boolean
}

export interface BuildResult extends ParsedTest {
  /** Every question found, including excluded ones (debug/tests). */
  all: Question[]
  /** Pairs of lines that were glued into one option ("a ⏎ b"). */
  joins: string[]
}

export function buildQuestions(
  inputLines: Line[],
  title: string,
  /** Relationship id → image key; unknown ids are dropped. Default: keep the id. */
  resolveImage: (rId: string) => string | undefined = (id) => id,
): BuildResult {
  const lines = splitAnchors(inputLines)
  const imgs = (ls: Line[]) => [...new Set(ls.flatMap((l) => l.images).map(resolveImage).filter((x): x is string => !!x))]
  const issues: ParseIssue[] = []
  const blank = (i: number) => !lines[i].text && !lines[i].hasImage
  const headingAt = lines.map(isHeading)

  const sectionAt: (string | undefined)[] = []
  let sec: string | undefined
  lines.forEach((l, i) => {
    if (headingAt[i]) sec = l.text
    sectionAt[i] = sec
  })

  const anchors = lines.map((l, i) => (ANCHOR_RE.test(l.text) ? i : -1)).filter((i) => i >= 0)
  const blocks: Block[] = []

  let lastNumber: number | undefined
  /** A "123 Text" line inside an answer list only starts a question if 123 fits the sequence. */
  const startsQuestion = (text: string): boolean => {
    const m = QUESTION_NUMBER_RE.exec(text)
    if (!m) return false
    const n = Number(m[1])
    const words = text.slice(m[0].length).split(' ').filter(Boolean).length
    if (lastNumber === undefined) return words >= 3
    if (n > lastNumber && n <= lastNumber + 30) return true
    return n <= 3 && words >= 4 // numbering restarted in a new section
  }

  const pushBlock = (b: Omit<Block, 'index'>) => {
    blocks.push({ ...b, index: blocks.length + 1 })
    if (b.number !== undefined) lastNumber = b.number
  }

  /** Content between an answer list and the next question: anchor-less questions or junk. */
  const leftovers = (from: number, to: number) => {
    const groups: { start: number; lines: Line[]; images: Line[] }[] = []
    for (let i = from; i <= to; i++) {
      const l = lines[i]
      if (headingAt[i] || (!l.text && !l.hasImage)) continue
      if (!groups.length || (l.text && startsQuestion(l.text))) {
        groups.push({ start: i, lines: [], images: [] })
        if (l.text) {
          const m = QUESTION_NUMBER_RE.exec(l.text)
          if (m) lastNumber = Number(m[1])
        }
      }
      const g = groups[groups.length - 1]
      if (l.text) g.lines.push(l)
      if (l.hasImage) g.images.push(l)
    }
    for (const g of groups) {
      const first = g.lines[0]?.text ?? ''
      const m = QUESTION_NUMBER_RE.exec(first)
      const pictures = imgs(g.images)
      if (m && g.lines.length >= 3) {
        pushBlock({
          number: Number(m[1]),
          section: sectionAt[g.start],
          text: first.slice(m[0].length).trim(),
          hint: null,
          optionLines: g.lines.slice(1),
          noAnchor: true,
          images: pictures,
        })
        continue
      }
      if (pictures.length) {
        // "728 - <screenshot>": the whole question, answers included, is the picture.
        const text = g.lines.map((l) => l.text).join(' ')
        pushBlock({
          number: m ? Number(m[1]) : undefined,
          section: sectionAt[g.start],
          text: (m ? text.slice(m[0].length) : text).trim(),
          hint: null,
          optionLines: [],
          images: pictures,
          selfCheck: true,
        })
        continue
      }
      issues.push({
        kind: 'orphan',
        number: m ? Number(m[1]) : undefined,
        message:
          g.lines.length === 2
            ? 'Вопрос с единственным вариантом ответа: не импортирован'
            : 'Текст вне вопросов: не распознан как вопрос',
        excerpt: g.lines.map((l) => l.text).join(' ').slice(0, 200) || '(картинка)',
        excluded: true,
      })
    }
  }

  if (anchors.length > 0) {
    // 1. Find where each question's text starts.
    const starts: number[] = []
    anchors.forEach((a, k) => {
      const lower = k > 0 ? anchors[k - 1] : -1
      let j = a - 1
      while (j > lower && blank(j)) j--
      const ref = j > lower ? fractions(lines[j].segs, lines[j].text).bold : 0
      let start = a
      let taken = 0
      while (j > lower) {
        const l = lines[j]
        if (blank(j) || headingAt[j]) break
        if (taken > 0) {
          if (isMarkedLine(l)) break
          if (ref >= 0.6 && fractions(l.segs, l.text).bold < 0.3) break
          if (taken >= 8) break
        }
        start = j
        taken++
        if (QUESTION_NUMBER_RE.test(l.text)) break
        j--
      }
      starts.push(start)
    })

    // 2. Slice text / options.
    anchors.forEach((a, k) => {
      const qLines = lines.slice(starts[k], a).filter((l) => l.text)
      let text = qLines.map((l) => l.text).join(' ')
      let number: number | undefined
      const m = QUESTION_NUMBER_RE.exec(text)
      if (m) {
        number = Number(m[1])
        text = text.slice(m[0].length)
      }
      const anchorText = lines[a].text.toLowerCase()
      const optionLines: Line[] = []
      pushBlock({
        number,
        section: sectionAt[a],
        text: text.trim(),
        hint: /несколько|more/.test(anchorText) ? 'multiple' : /один|одну|one/.test(anchorText) ? 'single' : null,
        optionLines,
        images: imgs(lines.slice(starts[k], a + 1)),
      })

      const end = k + 1 < anchors.length ? starts[k + 1] - 1 : lines.length - 1
      let i = a + 1
      for (; i <= end; i++) {
        const l = lines[i]
        if (headingAt[i] || blank(i)) continue
        if (optionLines.length > 0 && l.text && startsQuestion(l.text)) break
        optionLines.push(l)
      }
      if (i <= end) leftovers(i, end)
    })
  } else {
    // Fallback: numbered question line, options until the next numbered line.
    leftovers(0, lines.length - 1)
    for (const b of blocks) b.noAnchor = false
  }

  // 3. Options, wrap joining and correctness.
  const markings: Record<string, number> = {}
  let joinedLines = 0
  const joins: string[] = []
  const all: Question[] = []
  const usable: Question[] = []

  // Pass 1: assemble options.
  const prepared = blocks.map((b) => {
    const raw: RawOption[] = []
    const wraps: string[] = []
    let note = false
    for (const l of b.optionLines) {
      if (NOTE_RE.test(l.text)) {
        note = true
        continue
      }
      const last = raw[raw.length - 1]
      if (!l.text) {
        // A picture on its own line: before the answers it belongs to the question,
        // after an answer — to that answer.
        if (last) last.pics.push(l)
        else b.images.push(...imgs([l]))
        continue
      }
      const prev = last?.lines[last.lines.length - 1]
      if (prev && shouldJoin(prev, l)) {
        joins.push(`${prev.text} ⏎ ${l.text}`)
        last.lines.push(l)
        joinedLines++
      } else {
        if (prev && looksWrapped(prev, l)) wraps.push(`${prev.text} ⏎ ${l.text}`)
        raw.push({ lines: [l], pics: [] })
      }
    }
    const texts = raw.map(optionText)
    const fr = raw.map((o, i) => fractions(o.lines.flatMap((l) => l.segs), texts[i]))
    return { b, raw, texts, fr, wraps, note }
  })

  // Document-wide marker features: present on some options but far from all.
  // Lets "every option highlighted" mean "all correct" instead of "no marking".
  const totalOptions = prepared.reduce((s, p) => s + p.fr.length, 0) || 1
  const docMarkers = FEATURES.filter((f) => {
    if (TIER[f] !== 1) return false
    const share = prepared.reduce((s, p) => s + p.fr.filter((x) => x[f] >= ON).length, 0) / totalOptions
    return share > 0.02 && share < 0.75
  })

  // Pass 2: decide correctness, report.
  prepared.forEach(({ b, raw, texts, fr, wraps, note }) => {
    if (b.selfCheck) {
      const q: Question = {
        id: `q${b.index}`,
        number: b.number,
        section: b.section,
        text: b.text,
        options: [],
        type: 'self',
        images: b.images,
      }
      all.push(q)
      usable.push(q)
      issues.push({
        kind: 'image-only',
        index: b.index,
        number: b.number,
        message: 'Вопрос только из картинки: варианты ответа на самой картинке, ответ проверяется самооценкой',
        excerpt: b.text || '(картинка)',
        excluded: false,
      })
      return
    }
    const n = raw.length
    const differing = FEATURES.filter((f) => {
      const on = fr.filter((x) => x[f] >= ON).length
      return on > 0 && on < n
    })
    let used: Feature[]
    if (differing.length) {
      const bestTier = Math.min(...differing.map((f) => TIER[f]))
      used = differing.filter((f) => TIER[f] === bestTier)
    } else {
      // Nothing differs: all options carry a document-level marker → all correct.
      used = docMarkers.filter((f) => n > 1 && fr.every((x) => x[f] >= ON))
    }
    const correct = fr.map((x) => used.some((f) => x[f] >= ON))
    used.forEach((f) => (markings[f] = (markings[f] ?? 0) + 1))

    // Labels like "а) … б) …" are stripped only if every option has one.
    let cleaned = texts.map(cleanOption)
    if (cleaned.length > 1 && cleaned.every((t) => LABEL_RE.test(t))) {
      cleaned = cleaned.map((t) => t.replace(LABEL_RE, ''))
    }

    const qid = `q${b.index}`
    const options: Option[] = cleaned.map((t, i) => {
      const pics = imgs([...raw[i].lines, ...raw[i].pics])
      return { id: `${qid}-o${i + 1}`, text: t, isCorrect: correct[i], ...(pics.length ? { images: pics } : {}) }
    })
    const nCorrect = correct.filter(Boolean).length
    const q: Question = {
      id: qid,
      number: b.number,
      section: b.section,
      text: b.text,
      options,
      type: nCorrect > 1 ? 'multiple' : 'single',
      ...(b.images.length ? { images: [...new Set(b.images)] } : {}),
    }
    all.push(q)

    const issue = (kind: IssueKind, message: string, excluded: boolean) =>
      issues.push({ kind, index: b.index, number: b.number, message, excerpt: b.text.slice(0, 200), excluded })

    let excluded = false
    if (n < 2) {
      issue('too-few-options', `Найдено вариантов ответа: ${n}`, true)
      excluded = true
    } else if (nCorrect === 0) {
      issue('no-correct', 'Не найден ни один выделенный (правильный) ответ', true)
      excluded = true
    } else {
      if (nCorrect === n) {
        issue('all-correct', `Выделены все ${n} вариантов (засчитаны все как правильные)`, false)
      }
      if (n > 8) {
        issue('many-options', `Необычно много вариантов: ${n}. Возможно, строка ответа разорвана`, false)
      }
      if (b.hint === 'single' && nCorrect > 1) {
        issue('hint-mismatch', `Указано «Выберите один ответ», но выделено ${nCorrect}`, false)
      }
      const partial = fr.some((x) =>
        used.some((f) => x[f] > PARTIAL_LOW && x[f] < PARTIAL_HIGH && f !== 'check' && f !== 'dash'),
      )
      if (partial) {
        issue('partial-format', 'Один из вариантов выделен лишь частично', false)
      }
      const seen = new Set<string>()
      if (cleaned.some((t) => (seen.has(t.toLowerCase()) ? true : (seen.add(t.toLowerCase()), false)))) {
        issue('duplicate-options', 'Повторяющиеся варианты ответа', false)
      }
      if (b.noAnchor) {
        issue('no-anchor', 'Нет строки «Выберите…»: вопрос собран по номеру, проверьте границу вопроса и ответов', false)
      }
      if (note) {
        issue('note', 'В файле стоит пометка «проверить»', false)
      }
      // Only worth a look when the answer list is longer than usual.
      for (const w of n >= 6 ? wraps : []) {
        issue('possible-wrap', `Возможно, один ответ разбит на две строки: «${w}»`, false)
      }
    }
    if (!excluded) usable.push(q)
  })

  const report: ParseReport = {
    found: blocks.length,
    usable: usable.length,
    single: usable.filter((q) => q.type === 'single').length,
    multiple: usable.filter((q) => q.type === 'multiple').length,
    selfCheck: usable.filter((q) => q.type === 'self').length,
    withImages: usable.filter((q) => q.images?.length || q.options.some((o) => o.images?.length)).length,
    markings,
    joinedLines,
    issues,
  }
  return { title, questions: usable, all, report, joins, images: {} }
}
