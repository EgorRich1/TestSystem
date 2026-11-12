import JSZip from 'jszip'
import { readLines, readRels, type XmlParser } from './docxXml'
import { buildQuestions, type BuildResult } from './questions'

export type { Question, Option, ParsedTest, ParseReport, ParseIssue } from './types'
export { FEATURE_LABELS } from './questions'

const browserXml: XmlParser = (xml) => new DOMParser().parseFromString(xml, 'application/xml')

export function parseDocxXml(
  documentXml: string,
  stylesXml: string | null,
  title: string,
  parseXml: XmlParser = browserXml,
): BuildResult {
  return buildQuestions(readLines(documentXml, stylesXml, parseXml), title)
}

export async function parseDocx(
  data: ArrayBuffer | Uint8Array,
  title: string,
  parseXml: XmlParser = browserXml,
): Promise<BuildResult> {
  const zip = await JSZip.loadAsync(data)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('В файле нет word/document.xml — это точно .docx?')
  const documentXml = await doc.async('string')
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? null
  const rels = readRels((await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? null, parseXml)

  const result = buildQuestions(readLines(documentXml, stylesXml, parseXml), title, (rId) => {
    const target = rels.get(rId)
    return target && zip.file('word/' + target) && MIME[ext(target)] ? target : undefined
  })

  // Embed only the pictures that questions actually use.
  const used = new Set(result.all.flatMap((q) => [...(q.images ?? []), ...q.options.flatMap((o) => o.images ?? [])]))
  for (const key of used) {
    const b64 = await zip.file('word/' + key)!.async('base64')
    result.images[key] = `data:${MIME[ext(key)]};base64,${b64}`
  }
  return result
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}
const ext = (path: string) => (path.split('.').pop() ?? '').toLowerCase()
