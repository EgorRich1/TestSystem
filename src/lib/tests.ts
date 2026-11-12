import { parseDocx, type ParsedTest } from '../parser'
import { KEYS, load, save } from './storage'

export interface TestSource {
  key: string
  title: string
  bundled: boolean
  /** URL of a bundled .docx (relative to the app). */
  url?: string
}

export const BUNDLED: TestSource[] = [
  { key: 'derma-2026', title: 'Тесты Дерма 2026', bundled: true, url: './tests/derma-2026.docx' },
  { key: 'terapia-2026', title: 'Тесты Терапия 2026', bundled: true, url: './tests/terapia-2026.docx' },
]

interface StoredUpload {
  key: string
  test: ParsedTest
}

const cache = new Map<string, ParsedTest>()

export function listUploads(): TestSource[] {
  return load<StoredUpload[]>(KEYS.uploads, []).map((u) => ({ key: u.key, title: u.test.title, bundled: false }))
}

export function findSource(key: string): TestSource | undefined {
  return [...BUNDLED, ...listUploads()].find((s) => s.key === key)
}

export async function loadTest(src: TestSource): Promise<ParsedTest> {
  const hit = cache.get(src.key)
  if (hit) return hit
  let test: ParsedTest
  if (src.url) {
    const res = await fetch(src.url)
    if (!res.ok) throw new Error(`Не удалось загрузить ${src.url} (${res.status})`)
    const { all: _all, joins: _joins, ...parsed } = await parseDocx(await res.arrayBuffer(), src.title)
    test = parsed
  } else {
    const found = load<StoredUpload[]>(KEYS.uploads, []).find((u) => u.key === src.key)
    if (!found) throw new Error('Загруженный тест не найден — загрузите файл ещё раз')
    test = found.test
  }
  cache.set(src.key, test)
  return test
}

/** Parse a user .docx and remember it. `persisted` is false if it did not fit in localStorage. */
export async function addUpload(file: File): Promise<{ source: TestSource; test: ParsedTest; persisted: boolean }> {
  const title = file.name.replace(/\.docx$/i, '')
  const { all: _all, joins: _joins, ...test } = await parseDocx(await file.arrayBuffer(), title)
  if (test.report.found === 0) {
    throw new Error('В файле не найдено ни одного вопроса. Проверьте формат (см. README).')
  }
  const key = `upload-${Date.now()}`
  const uploads = load<StoredUpload[]>(KEYS.uploads, [])
  const persisted = save(KEYS.uploads, [...uploads, { key, test }])
  cache.set(key, test)
  return { source: { key, title, bundled: false }, test, persisted }
}

export function removeUpload(key: string) {
  save(
    KEYS.uploads,
    load<StoredUpload[]>(KEYS.uploads, []).filter((u) => u.key !== key),
  )
  cache.delete(key)
}
