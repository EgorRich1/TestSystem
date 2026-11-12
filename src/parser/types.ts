export interface Option {
  id: string
  text: string
  isCorrect: boolean
  /** Keys into ParsedTest.images. */
  images?: string[]
}

/**
 * single / multiple — normal questions.
 * self — the question exists only as a picture (e.g. a screenshot with the answers
 * inside it): no text options, the user checks the answer and grades themself.
 */
export type QuestionType = 'single' | 'multiple' | 'self'

export interface Question {
  id: string
  /** Number printed in the source file ("123." / "123 -"), if any. */
  number?: number
  /** Section heading the question sits under (e.g. "Анафилактический шок"). */
  section?: string
  text: string
  options: Option[]
  type: QuestionType
  /** Pictures of the question (keys into ParsedTest.images). */
  images?: string[]
}

export type IssueKind =
  | 'no-correct'
  | 'all-correct'
  | 'too-few-options'
  | 'many-options'
  | 'hint-mismatch'
  | 'partial-format'
  | 'duplicate-options'
  | 'orphan'
  | 'no-anchor'
  | 'note'
  | 'possible-wrap'
  | 'image-only'

export interface ParseIssue {
  kind: IssueKind
  /** Index of the question in the file (1-based), when it relates to one. */
  index?: number
  number?: number
  message: string
  /** Question text or orphan text, for locating it in the .docx. */
  excerpt: string
  /** Whether the question was dropped from the quiz because of this issue. */
  excluded: boolean
}

export interface ParseReport {
  /** Questions found (blocks with an answer list). */
  found: number
  /** Questions usable in the quiz. */
  usable: number
  single: number
  multiple: number
  /** Picture-only questions (self-check). */
  selfCheck: number
  /** Questions that show at least one picture. */
  withImages: number
  /** How many questions had their answers detected by each marking. */
  markings: Record<string, number>
  /** Option lines glued back together because they were wrapped. */
  joinedLines: number
  issues: ParseIssue[]
}

export interface ParsedTest {
  title: string
  questions: Question[]
  report: ParseReport
  /** Picture key ("media/image1.jpg") → data: URL. */
  images: Record<string, string>
}
