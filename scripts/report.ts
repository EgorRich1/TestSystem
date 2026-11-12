// Parse .docx test files and write PARSE_REPORT.md.
// Usage: npm run report [-- file1.docx file2.docx]
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { FEATURE_LABELS, parseDocx } from '../src/parser/index.ts'
import type { ParseIssue } from '../src/parser/types.ts'

const xml = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document

const DEFAULT = [
  ['public/tests/derma-2026.docx', 'Тесты Дерма 2026'],
  ['public/tests/terapia-2026.docx', 'Тесты Терапия 2026'],
]
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => [f, basename(f, '.docx')]) : DEFAULT

const KIND: Record<ParseIssue['kind'], string> = {
  orphan: 'Не импортировано',
  'no-correct': 'Нет выделенного ответа (исключены)',
  'too-few-options': 'Меньше двух вариантов (исключены)',
  'hint-mismatch': '«Выберите один ответ», но выделено несколько',
  'partial-format': 'Вариант выделен частично',
  'all-correct': 'Выделены все варианты (засчитаны все)',
  'no-anchor': 'Нет строки «Выберите…» (собран по номеру)',
  'many-options': 'Больше 8 вариантов',
  'possible-wrap': 'Возможно, ответ разорван на две строки',
  'duplicate-options': 'Повторяющиеся варианты',
  note: 'Пометка «проверить» в файле',
  'image-only': 'Вопрос только из картинки (самопроверка)',
}

let md = '# Отчёт о разборе тестов\n\nСгенерировано `npm run report`.\n'
for (const [file, title] of files) {
  const r = await parseDocx(readFileSync(file), title, xml)
  const rep = r.report
  const marks = Object.entries(rep.markings)
    .map(([f, n]) => `${FEATURE_LABELS[f as keyof typeof FEATURE_LABELS]}: ${n}`)
    .join(', ')
  md += `\n## ${title}\n\n`
  md += `| Найдено вопросов | В тесте | Один ответ | Несколько | По картинке | С картинками | Склеено строк |\n|---|---|---|---|---|---|---|\n`
  md += `| ${rep.found} | ${rep.usable} | ${rep.single} | ${rep.multiple} | ${rep.selfCheck} | ${rep.withImages} | ${rep.joinedLines} |\n\n`
  md += `Правильные ответы определены по: ${marks}.\n`
  const groups = new Map<ParseIssue['kind'], ParseIssue[]>()
  for (const i of rep.issues) groups.set(i.kind, [...(groups.get(i.kind) ?? []), i])
  for (const [kind, list] of groups) {
    md += `\n### ${KIND[kind]} (${list.length})\n\n`
    for (const i of list) {
      const where = i.number !== undefined ? `№ ${i.number}` : `#${i.index ?? '?'}`
      md += `- **${where}**: ${i.excerpt.replace(/\s+/g, ' ').slice(0, 140)}${kind === 'possible-wrap' || kind === 'hint-mismatch' || kind === 'orphan' || kind === 'image-only' ? ` (${i.message})` : ''}\n`
    }
  }
  console.log(`${title}: найдено ${rep.found}, в тесте ${rep.usable}, замечаний ${rep.issues.length}`)
}
writeFileSync('PARSE_REPORT.md', md)
console.log('→ PARSE_REPORT.md')
