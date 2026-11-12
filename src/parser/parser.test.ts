import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseDocx, parseDocxXml } from './index'
import type { BuildResult } from './questions'

const xml = (s: string) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document

/* ------------------------------------------------------------------ */
/* Helpers to rebuild real paragraphs from the two files               */
/* ------------------------------------------------------------------ */

type RunFmt = { b?: boolean; i?: boolean; hl?: string; color?: string; u?: boolean; shd?: string; style?: string }
type Run = string | [string, RunFmt]

function rPr(f: RunFmt) {
  return (
    '<w:rPr>' +
    (f.style ? `<w:rStyle w:val="${f.style}"/>` : '') +
    (f.b ? '<w:b/><w:bCs/>' : '') +
    (f.i ? '<w:i/>' : '') +
    (f.color ? `<w:color w:val="${f.color}"/>` : '') +
    (f.u ? '<w:u w:val="single"/>' : '') +
    (f.hl ? `<w:highlight w:val="${f.hl}"/>` : '') +
    (f.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${f.shd}"/>` : '') +
    '</w:rPr>'
  )
}

function p(runs: Run[] | string, pPr = ''): string {
  const list: Run[] = typeof runs === 'string' ? [runs] : runs
  const body = list
    .map((r) => {
      if (typeof r === 'string') {
        return r === '\n' ? '<w:r><w:br/></w:r>' : `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`
      }
      return `<w:r>${rPr(r[1])}<w:t xml:space="preserve">${r[0]}</w:t></w:r>`
    })
    .join('')
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`
}

function doc(...paras: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paras.join('')}</w:body></w:document>`
}

/** A paragraph holding a picture, shaped like the ones in «Тесты Дерма 2026» (№728–738). */
function picture(rId: string, text = '') {
  return `<w:p>${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}<w:r><w:drawing><wp:inline><wp:extent cx="5731200" cy="4419600"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

const STYLES = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>
<w:style w:type="character" w:styleId="Answer"><w:name w:val="Answer"/><w:rPr><w:b/><w:highlight w:val="green"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`

const parse = (...paras: string[]) => parseDocxXml(doc(...paras), STYLES, 't', xml)

const B_HL: RunFmt = { b: true, hl: 'yellow' }
const B: RunFmt = { b: true }

/* ------------------------------------------------------------------ */
/* Unit tests on real samples                                          */
/* ------------------------------------------------------------------ */

describe('Дерма: highlight + bold + leading dash, wrapped option lines', () => {
  // «Тесты Дерма 2026», question 1 (options broken into PDF-width lines).
  const r = parse(
    p([['К дерматовенерологическим учреждениям', B], [' ', B], ['относятся:', B]], '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p('Выберите один ответ:'),
    p('кожно-венерологический кабинет'),
    p('кабинет врача-дерматовенеролога в'),
    p('поликлинике'),
    p([['-', B_HL], ['кожно-венерологический диспансер', B_HL], [' ', B]]),
    p('кабинет врача-дерматовенеролога в мсч'),
    p('дерматовенерологическое отделение'),
    p(''),
  )
  const q = r.questions[0]

  it('reads question text and joins the wrapped option', () => {
    expect(q.text).toBe('К дерматовенерологическим учреждениям относятся:')
    expect(q.options.map((o) => o.text)).toEqual([
      'кожно-венерологический кабинет',
      'кабинет врача-дерматовенеролога в поликлинике',
      'кожно-венерологический диспансер',
      'кабинет врача-дерматовенеролога в мсч',
      'дерматовенерологическое отделение',
    ])
  })

  it('marks the highlighted option as the only correct one and strips the dash', () => {
    expect(q.options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(['кожно-венерологический диспансер'])
    expect(q.type).toBe('single')
  })
})

describe('Дерма: multiple answers with options split into many runs', () => {
  // «Тесты Дерма 2026», question «Основные синдромы при ИППП» (one run is "-д" + "изурии…").
  const r = parse(
    p([['Основные синдромы при ИППП:', B]]),
    p('Выберите один или несколько ответов:'),
    p([['-', B_HL], ['боли и отека яичка', B_HL]]),
    p([['-д', B_HL], ['изурии и выделений из уретры у', B_HL], [' ', B_HL], ['мужчин', B_HL]]),
    p([['-', B_HL], ['аномальных выделений из влагалища', B_HL]]),
    p([['-', B_HL], ['генитальных язв и эрозий', B_HL]]),
    p('Мюнхгаузена'),
    p([['-', B_HL], ['болей внизу живота у женщин', B_HL], [' ', B]]),
  )
  const q = r.questions[0]
  it('detects 5 correct of 6 and type multiple', () => {
    expect(q.options).toHaveLength(6)
    expect(q.options.filter((o) => o.isCorrect)).toHaveLength(5)
    expect(q.options[1].text).toBe('дизурии и выделений из уретры у мужчин')
    expect(q.options[4]).toMatchObject({ text: 'Мюнхгаузена', isCorrect: false })
    expect(q.type).toBe('multiple')
  })
})

describe('Дерма: ✅ marker region (no formatting difference)', () => {
  // «Тесты Дерма 2026», question 542.
  const r = parse(
    p([['542 - Инкубационный период при гонорее в настоящее время составляет:', B]]),
    p('Выберите один ответ:'),
    p(['2-10 дней  ', '✅']),
    p('14 дней'),
    p('1-2 дня'),
    p('30 дней'),
    p([['543 - Противопоказаниями для забора секрета предстательной железы является все перечисленное, кроме:', B]]),
    p('Выберите один ответ:'),
    p('острого орхоэпидидимита'),
    p('острого уретрита'),
    p('торпидного уретрита ✅'),
  )
  it('uses the check mark, strips it, keeps the source number', () => {
    expect(r.questions).toHaveLength(2)
    const q = r.questions[0]
    expect(q.number).toBe(542)
    expect(q.text).toBe('Инкубационный период при гонорее в настоящее время составляет:')
    expect(q.options.find((o) => o.isCorrect)?.text).toBe('2-10 дней')
    expect(r.questions[1].options.find((o) => o.isCorrect)?.text).toBe('торпидного уретрита')
    expect(r.report.markings.check).toBe(2)
  })

  it('does not take numeric options like "2-10 дней" for a new question', () => {
    expect(r.questions[0].options).toHaveLength(4)
  })
})

describe('Дерма: every option highlighted means all correct', () => {
  // «Тесты Дерма 2026», question 329 «Пиодермии вызываются» — plus a normal one so
  // the document has a baseline where highlight is a marker, not a base style.
  const r = parse(
    p([['329. Пиодермии вызываются:', B]]),
    p('Выберите один или несколько ответов:'),
    p([['-синегнойной палочкой', B_HL]]),
    p([['-стафилококками', B_HL]]),
    p([['-стрептококками', B_HL]]),
    p([['-протеем', B_HL]]),
    p(''),
    p([['330. К стафилодермиям не относят:', B]]),
    p('Выберите один ответ:'),
    p('остиофолликулит'),
    p([['-', B_HL], ['вульгарное импетиго', B_HL]]),
    p('сикоз'),
    p('фурункул'),
  )
  it('keeps the question and flags it', () => {
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].options.every((o) => o.isCorrect)).toBe(true)
    expect(r.report.issues.some((i) => i.kind === 'all-correct' && i.number === 329)).toBe(true)
  })
})

describe('Терапия: headings, numbering and hidden text', () => {
  const red = { color: 'EE0000', u: true }
  const r = parse(
    p([['Анафилактический шок', red]]),
    p('1  Противошоковый набор включает следующие лекарственные препараты:'),
    p('Выберите один или несколько ответов:'),
    p([['Антигистаминные препараты II поколения в каплях или таблетках', B_HL]]),
    p('Антибиотики'),
    p([['Антигистаминные препараты I поколения в растворе', B_HL]]),
    p([['Эпинефрин', B_HL]]),
    p([['Преднизолон в растворе', B_HL]]),
    p(''),
    p('2 Препаратом выбора для оказания первой медицинской помощи при анафилаксии следует считать:'),
    p('Выберите один ответ:'),
    p(['\uFEFF\uFEFF', ['Эпинефрин', B_HL]]),
    p(['\uFEFF\uFEFF', 'Антигистаминный препарат']),
    p(['\uFEFF\uFEFF', 'Введение коллоидных растворов']),
    // Invisible white text found in the file — must be ignored.
    p([['Республики Беларусь Выберите один ответ: Уравнивание прав', { color: 'FFFFFF' }]]),
    p([['Биоэтика', red]]),
    p('9 Для поражения сердечно-сосудистой системы при анафилаксии характерно:'),
    p('Выберите один или несколько ответов:'),
    p('Симптомы «острого живота»'),
    p([['Острая сердечная недостаточность', B_HL], ' ']),
    // bCs only (complex-script bold) is not visible on Cyrillic: not a marking.
    p('Артериальная гипотония'),
  )

  it('splits questions by number and anchor, assigns sections', () => {
    expect(r.questions.map((q) => q.number)).toEqual([1, 2, 9])
    expect(r.questions[0].section).toBe('Анафилактический шок')
    expect(r.questions[2].section).toBe('Биоэтика')
  })

  it('detects answers and types', () => {
    expect(r.questions[0].type).toBe('multiple')
    expect(r.questions[0].options.filter((o) => o.isCorrect)).toHaveLength(4)
    expect(r.questions[1].type).toBe('single')
    expect(r.questions[1].options.map((o) => o.text)).toEqual([
      'Эпинефрин',
      'Антигистаминный препарат',
      'Введение коллоидных растворов',
    ])
    expect(r.questions[2].type).toBe('single') // anchor says "несколько", but only one is marked
  })
})

describe('Терапия: anchor glued to text by line breaks', () => {
  // «Тесты Терапия 2026», questions 375 and 117 (one paragraph with <w:br/>s / glued anchor).
  const r = parse(
    p(['375 Сердечно-легочная реанимация - это', '\n', 'Выберите один ответ:', '\n', 'восстановление сознание пациента', '\n', ['комплекс мероприятий по восстановлению всех жизненно важных органов и систем', B_HL]]),
    p('проведение непрямого массажа'),
    p(''),
    p('117 Наиболее достоверные признаки гемолитического посттрансфузионного осложнения (период шока):'),
    p('Выберите один или несколько ответов: беспокойство больного'),
    p([['изменение цвета плазмы (гемоглобинемия)', B_HL]]),
    p('тахикардия'),
  )
  it('finds both questions', () => {
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].text).toBe('Сердечно-легочная реанимация - это')
    expect(r.questions[0].options).toHaveLength(3)
    expect(r.questions[1].options[0]).toMatchObject({ text: 'беспокойство больного', isCorrect: false })
    expect(r.questions[1].options[1].isCorrect).toBe(true)
  })
})

describe('Generic formatting rules', () => {
  it('reads marking inherited from a character style', () => {
    const r = parse(
      p('1. Вопрос со стилем?'),
      p('Выберите один ответ:'),
      p('первый'),
      p([['второй', { style: 'Answer' }]]),
      p('третий'),
    )
    expect(r.questions[0].options.map((o) => o.isCorrect)).toEqual([false, true, false])
  })

  it('reads paragraph shading as a marking', () => {
    const r = parse(
      p('1. Вопрос с заливкой?'),
      p('Выберите один ответ:'),
      p('первый'),
      p('второй', '<w:shd w:val="clear" w:color="auto" w:fill="C6EFCE"/>'),
      p('третий'),
    )
    expect(r.questions[0].options.map((o) => o.isCorrect)).toEqual([false, true, false])
  })

  it('ignores formatting shared by all options (all bold → only highlight counts)', () => {
    const r = parse(
      p('1. Все варианты жирные?'),
      p('Выберите один ответ:'),
      p([['альфа', B]]),
      p([['бета', B_HL]]),
      p([['гамма', B]]),
    )
    expect(r.questions[0].options.map((o) => o.isCorrect)).toEqual([false, true, false])
  })

  it('treats an option as marked only if most of its text is marked', () => {
    const r = parse(
      p('1. Частичное выделение?'),
      p('Выберите один или несколько ответов:'),
      p([['почти всё выделено', B_HL], [' кроме', {}]]),
      p([['чуть', B_HL], [' выделено, а остальное — обычный текст', {}]]),
      p('ничего'),
    )
    expect(r.questions[0].options.map((o) => o.isCorrect)).toEqual([true, false, false])
  })

  it('prefers highlight over italic noise (Latin names in italics)', () => {
    const r = parse(
      p('1. К кератомикозам не относится:'),
      p('Выберите один ответ:'),
      p([['Tinea nigra', { i: true }]]),
      p('разноцветный лишай'),
      p([['эритразма', B_HL]]),
    )
    expect(r.questions[0].options.map((o) => o.isCorrect)).toEqual([false, false, true])
  })

  it('reports questions without any marked answer and drops them', () => {
    const r = parse(p('1. Без ответа?'), p('Выберите один ответ:'), p('да'), p('нет'))
    expect(r.questions).toHaveLength(0)
    expect(r.report.issues[0]).toMatchObject({ kind: 'no-correct', excluded: true })
  })

  it('handles files without "Выберите" lines and strips а)/б) labels', () => {
    const r = parse(
      p('1. Столица Франции?'),
      p('а) Лион'),
      p([['б) Париж', { b: true }]]),
      p('в) Марсель'),
      p('2. Чётные числа?'),
      p([['а) 2', { color: 'FF0000' }]]),
      p('б) 3'),
      p([['в) 4', { color: 'FF0000' }]]),
    )
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].options.map((o) => o.text)).toEqual(['Лион', 'Париж', 'Марсель'])
    expect(r.questions[0].options[1].isCorrect).toBe(true)
    expect(r.questions[1].type).toBe('multiple')
  })
})

describe('Pictures', () => {
  it('attaches a picture between the question and the answers to the question', () => {
    const r = parse(
      p('5. Дерматоскопическая картина, представленная на фото, характерна для:'),
      picture('rId7'),
      p('Выберите один ответ:'),
      p('кератоакантомы'),
      p([['контагиозного моллюска', B_HL]]),
      p('красного плоского лишая'),
    )
    const q = r.questions[0]
    expect(q.type).toBe('single')
    expect(q.images).toEqual(['rId7'])
    expect(q.options).toHaveLength(3)
    expect(q.options[1].isCorrect).toBe(true)
  })

  it('attaches a picture inside the question text', () => {
    const r = parse(picture('rId3', '6. Что изображено?'), p('Выберите один ответ:'), p([['псориаз', B_HL]]), p('экзема'))
    expect(r.questions[0].text).toBe('Что изображено?')
    expect(r.questions[0].images).toEqual(['rId3'])
  })

  it('attaches pictures that follow an answer to that answer', () => {
    const r = parse(
      p('7. Где изображена чесотка?'),
      p('Выберите один ответ:'),
      p([['вариант А', B_HL]]),
      picture('rId10'),
      p('вариант Б'),
      picture('rId11'),
    )
    const q = r.questions[0]
    expect(q.images).toBeUndefined()
    expect(q.options.map((o) => o.images)).toEqual([['rId10'], ['rId11']])
  })

  it('turns "N - <picture>" without answers into a self-check question', () => {
    const r = parse(
      p([['727 - Семь дерматоскопических признаков меланомы включают, кроме:', B]]),
      p('Выберите один ответ:'),
      p('асиметричные пигментные глобулы'),
      p(['древовидные сосуды ', '✅']),
      p('атипичные сосуды'),
      p([['728 - ', B]]),
      picture('rId5'),
      p(''),
      p([['729 - ', B]]),
      picture('rId6'),
      p([['739 - Какое образование не рекомендуется удалять электрохирургическим методом:', B]]),
      p('Выберите один ответ:'),
      p('папиллому'),
      p(['меланому ', '✅']),
    )
    expect(r.questions.map((q) => [q.number, q.type])).toEqual([
      [727, 'single'],
      [728, 'self'],
      [729, 'self'],
      [739, 'single'],
    ])
    expect(r.questions[0].options).toHaveLength(3)
    expect(r.questions[1]).toMatchObject({ text: '', options: [], images: ['rId5'] })
    expect(r.report.selfCheck).toBe(2)
    expect(r.report.issues.filter((i) => i.kind === 'image-only')).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/* The real bundled files                                              */
/* ------------------------------------------------------------------ */

const load = (f: string) => parseDocx(readFileSync(resolve(__dirname, '../../public/tests', f)), f, xml)

describe('real file: Тесты Дерма 2026', () => {
  let r: BuildResult
  beforeAll(async () => {
    r = await load('derma-2026.docx')
  }, 60_000)

  it('parses all questions', () => {
    expect(r.report.found).toBe(764)
    expect(r.questions.length).toBe(764)
    expect(r.report.selfCheck).toBe(11)
    expect(r.report.markings.highlight).toBeGreaterThan(380)
    expect(r.report.markings.check).toBeGreaterThan(340)
  })

  it('every usable question has ≥2 options and ≥1 correct answer', () => {
    for (const q of r.questions.filter((x) => x.type !== 'self')) {
      expect(q.options.length).toBeGreaterThanOrEqual(2)
      const n = q.options.filter((o) => o.isCorrect).length
      expect(n).toBeGreaterThan(0)
      expect(q.type).toBe(n > 1 ? 'multiple' : 'single')
    }
  })

  it('imports the 11 screenshot-only questions (728–738) with their pictures', () => {
    const self = r.questions.filter((q) => q.type === 'self')
    expect(self.map((q) => q.number)).toEqual([728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738])
    expect(self[0].images).toEqual(['media/image1.jpg'])
    expect(self[10].images).toEqual(['media/image11.jpg'])
    expect(r.images['media/image1.jpg']).toMatch(/^data:image\/jpeg;base64,\/9j\//)
    expect(Object.keys(r.images)).toHaveLength(11)
    expect(r.report.issues.filter((i) => i.kind === 'orphan')).toHaveLength(0)
  })

  it('question 727 does not swallow the picture questions after it', () => {
    const q = r.questions.find((x) => x.number === 727)!
    expect(q.options).toHaveLength(8)
    expect(q.images).toBeUndefined()
  })

  it('question 401 (✅ region) is parsed correctly', () => {
    const q = r.questions.find((x) => x.number === 401)!
    expect(q.text).toBe('Microsporum gypseum является:')
    expect(q.options.find((o) => o.isCorrect)?.text).toBe('почвенным грибом')
  })

  it('question "Основателем венской дерматологической школы" → Гебру', () => {
    const q = r.questions.find((x) => x.text.startsWith('Основателем венской'))!
    expect(q.options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(['Гебру'])
  })
})

describe('real file: Тесты Терапия 2026', () => {
  let r: BuildResult
  beforeAll(async () => {
    r = await load('terapia-2026.docx')
  }, 60_000)

  it('parses all questions', () => {
    expect(r.report.found).toBe(624)
    expect(r.questions.length).toBe(624)
  })

  it('question 3: Эпинефрин — внутримышечно', () => {
    const q = r.questions.find((x) => x.number === 3)!
    expect(q.section).toBe('Анафилактический шок')
    expect(q.options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(['Внутримышечно'])
  })

  it('hidden white text does not leak into options', () => {
    for (const q of r.all) for (const o of q.options) expect(o.text).not.toMatch(/3G|Да14:43/)
  })

  it('flags "Выберите один ответ" questions with several marked answers', () => {
    const mism = r.report.issues.filter((i) => i.kind === 'hint-mismatch').map((i) => i.number)
    expect(mism).toContain(179)
  })
})
