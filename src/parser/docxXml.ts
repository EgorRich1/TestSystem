/**
 * Low-level reading of word/document.xml + word/styles.xml.
 *
 * Turns the document body into a flat list of visual "lines" (a paragraph,
 * or a piece of a paragraph between <w:br/> breaks). Every line keeps its
 * text split into segments with the *effective* run formatting: docDefaults →
 * paragraph style chain → character style chain → direct <w:rPr>, plus
 * paragraph shading from <w:pPr>.
 */

export interface Fmt {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** Hex colour, null for auto/black. */
  color: string | null
  highlight: string | null
  shading: string | null
  hidden: boolean
}

type PartialFmt = Partial<Fmt>

export interface Segment {
  text: string
  fmt: Fmt
}

export interface Line {
  segs: Segment[]
  /** Normalised visible text. */
  text: string
  /** Paragraph is an auto-numbered list item (<w:numPr>). */
  numbered: boolean
  /** Paragraph style is a heading / title style. */
  headingStyle: boolean
  /** Line contains a picture. */
  hasImage: boolean
  /** Relationship ids (r:embed) of the pictures in this line. */
  images: string[]
  /** Index of the source <w:p> (several lines can share one). */
  para: number
}

export type XmlParser = (xml: string) => Document

/** Map relationship id → target ("media/image1.jpg") from word/_rels/document.xml.rels. */
export function readRels(relsXml: string | null, parse: XmlParser): Map<string, string> {
  const map = new Map<string, string>()
  if (!relsXml) return map
  const els = parse(relsXml).getElementsByTagName('Relationship')
  for (let i = 0; i < els.length; i++) {
    const id = els[i].getAttribute('Id')
    const target = els[i].getAttribute('Target')
    const mode = els[i].getAttribute('TargetMode')
    if (id && target && mode !== 'External') map.set(id, target.replace(/^\/?word\//, '').replace(/^\//, ''))
  }
  return map
}

const EMPTY: Fmt = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: null,
  highlight: null,
  shading: null,
  hidden: false,
}

/* ------------------------------------------------------------------ */
/* DOM helpers that work with both the browser DOM and @xmldom/xmldom  */
/* ------------------------------------------------------------------ */

function local(n: Node): string {
  const el = n as Element
  return el.localName || (el.nodeName || '').replace(/^.*:/, '')
}

function children(el: Element): Element[] {
  const out: Element[] = []
  const nodes = el.childNodes
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeType === 1) out.push(nodes[i] as Element)
  }
  return out
}

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null
  for (const c of children(el)) if (local(c) === name) return c
  return null
}

function attr(el: Element | null, name: string): string | null {
  if (!el) return null
  const v = el.getAttribute('w:' + name)
  if (v !== null && v !== '') return v
  // Fallback for documents using a different prefix.
  const attrs = el.attributes
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i]
    if ((a.localName || a.name.replace(/^.*:/, '')) === name) return a.value
  }
  return null
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** r:embed of <a:blip> (DrawingML) or r:id of <v:imagedata> (VML) anywhere below `el`. */
function imageIds(el: Element): string[] {
  const out: string[] = []
  const walk = (e: Element) => {
    const n = local(e)
    if (n === 'blip' || n === 'imagedata') {
      const attrs = e.attributes
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i]
        const ln = a.localName || a.name.replace(/^.*:/, '')
        const isRel = a.namespaceURI === REL_NS || a.name.startsWith('r:')
        if ((ln === 'embed' || ln === 'id') && isRel && a.value) out.push(a.value)
      }
    }
    children(e).forEach(walk)
  }
  walk(el)
  return out
}

const OFF = new Set(['0', 'false', 'off', 'none'])

function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined
  const v = attr(el, 'val')
  return v === null ? true : !OFF.has(v.toLowerCase())
}

function normColor(v: string | null): string | null {
  if (!v) return null
  const u = v.toUpperCase()
  if (u === 'AUTO' || u === '000000') return null
  return u
}

function normFill(v: string | null): string | null {
  if (!v) return null
  const u = v.toUpperCase()
  if (u === 'AUTO' || u === 'FFFFFF' || u === 'NONE') return null
  return u
}

/** Read an <w:rPr> (or the rPr-like part of anything) into a partial format. */
function readRPr(rPr: Element | null): PartialFmt {
  const f: PartialFmt = {}
  if (!rPr) return f
  const b = onOff(child(rPr, 'b'))
  if (b !== undefined) f.bold = b
  const i = onOff(child(rPr, 'i'))
  if (i !== undefined) f.italic = i
  const u = child(rPr, 'u')
  if (u) f.underline = !OFF.has((attr(u, 'val') ?? 'single').toLowerCase())
  const s = onOff(child(rPr, 'strike')) ?? onOff(child(rPr, 'dstrike'))
  if (s !== undefined) f.strike = s
  const c = child(rPr, 'color')
  if (c) f.color = normColor(attr(c, 'val'))
  const h = child(rPr, 'highlight')
  if (h) {
    const v = attr(h, 'val')
    f.highlight = v && !OFF.has(v.toLowerCase()) ? v : null
  }
  const shd = child(rPr, 'shd')
  if (shd) f.shading = normFill(attr(shd, 'fill'))
  const hid = onOff(child(rPr, 'vanish')) ?? onOff(child(rPr, 'webHidden'))
  if (hid !== undefined) f.hidden = hid
  return f
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

interface StyleDef {
  id: string
  name: string
  type: string
  basedOn: string | null
  rPr: PartialFmt
  pShading: string | null | undefined
  numbered: boolean
}

export class Styles {
  private defs = new Map<string, StyleDef>()
  private defaults: PartialFmt = {}
  private defaultPara: string | null = null

  constructor(stylesXml: string | null, parse: XmlParser) {
    if (!stylesXml) return
    const doc = parse(stylesXml)
    const root = doc.documentElement
    const dd = child(root, 'docDefaults')
    this.defaults = readRPr(child(child(dd, 'rPrDefault'), 'rPr'))
    for (const s of children(root)) {
      if (local(s) !== 'style') continue
      const id = attr(s, 'styleId') ?? ''
      const pPr = child(s, 'pPr')
      const shd = child(pPr, 'shd')
      const def: StyleDef = {
        id,
        name: attr(child(s, 'name'), 'val') ?? id,
        type: attr(s, 'type') ?? 'paragraph',
        basedOn: attr(child(s, 'basedOn'), 'val'),
        rPr: readRPr(child(s, 'rPr')),
        pShading: shd ? normFill(attr(shd, 'fill')) : undefined,
        numbered: !!child(pPr, 'numPr'),
      }
      this.defs.set(id, def)
      const isDefault = attr(s, 'default')
      if (def.type === 'paragraph' && (isDefault === '1' || isDefault === 'true')) {
        this.defaultPara = id
      }
    }
  }

  private chain(id: string | null): StyleDef[] {
    const out: StyleDef[] = []
    const seen = new Set<string>()
    let cur = id
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const d = this.defs.get(cur)
      if (!d) break
      out.unshift(d)
      cur = d.basedOn
    }
    return out
  }

  paragraph(id: string | null) {
    const chain = this.chain(id ?? this.defaultPara)
    let rPr: PartialFmt = { ...this.defaults }
    let shading: string | null = null
    let numbered = false
    for (const d of chain) {
      rPr = { ...rPr, ...d.rPr }
      if (d.pShading !== undefined) shading = d.pShading
      if (d.numbered) numbered = true
    }
    const last = chain[chain.length - 1]
    const heading = !!last && /heading|title|заголов|название/i.test(last.name + ' ' + last.id)
    return { rPr, shading, numbered, heading }
  }

  character(id: string | null): PartialFmt {
    let rPr: PartialFmt = {}
    for (const d of this.chain(id)) rPr = { ...rPr, ...d.rPr }
    return rPr
  }
}

/* ------------------------------------------------------------------ */
/* Body → lines                                                        */
/* ------------------------------------------------------------------ */

export function normalizeText(s: string): string {
  return s
    .replace(/\uFEFF|\u200B|\u200C|\u200D|\u2060|\u00AD/g, '')
    .replace(/[\u00A0\u2007\u202F\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** White text with no background is invisible in Word — treat as hidden. */
function invisible(f: Fmt): boolean {
  return f.hidden || (f.color === 'FFFFFF' && !f.highlight && !f.shading)
}

const CONTAINERS = new Set([
  'body', 'tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'customXml', 'txbxContent',
])
const RUN_CONTAINERS = new Set([
  'hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'customXml', 'fldSimple', 'moveTo',
])

export function readLines(documentXml: string, stylesXml: string | null, parse: XmlParser): Line[] {
  const styles = new Styles(stylesXml, parse)
  const doc = parse(documentXml)
  const body = doc.getElementsByTagName('w:body')[0] ?? child(doc.documentElement, 'body')
  const lines: Line[] = []
  let paraIdx = 0

  const visit = (el: Element) => {
    for (const c of children(el)) {
      const n = local(c)
      if (n === 'p') readParagraph(c)
      else if (CONTAINERS.has(n)) visit(c)
    }
  }

  const readParagraph = (p: Element) => {
    const pPr = child(p, 'pPr')
    const pStyle = attr(child(pPr, 'pStyle'), 'val')
    const ps = styles.paragraph(pStyle)
    const pShd = child(pPr, 'shd')
    const paraShading = pShd ? normFill(attr(pShd, 'fill')) : ps.shading
    const numbered = !!child(pPr, 'numPr') || ps.numbered
    const idx = paraIdx++

    let segs: Segment[] = []
    let images: string[] = []
    const flush = () => {
      const text = normalizeText(segs.map((s) => s.text).join(''))
      lines.push({ segs, text, numbered, headingStyle: ps.heading, hasImage: images.length > 0, images, para: idx })
      segs = []
      images = []
    }

    const readRun = (r: Element) => {
      const rPr = child(r, 'rPr')
      const rStyle = attr(child(rPr, 'rStyle'), 'val')
      const fmt: Fmt = {
        ...EMPTY,
        ...ps.rPr,
        ...styles.character(rStyle),
        ...readRPr(rPr),
      }
      if (paraShading && !fmt.shading) fmt.shading = paraShading
      const hide = invisible(fmt)
      for (const c of children(r)) {
        const n = local(c)
        if (n === 't') {
          if (!hide) segs.push({ text: c.textContent ?? '', fmt })
        } else if (n === 'tab' || n === 'ptab') {
          if (!hide) segs.push({ text: ' ', fmt })
        } else if (n === 'noBreakHyphen') {
          if (!hide) segs.push({ text: '-', fmt })
        } else if (n === 'br' || n === 'cr') {
          flush()
        } else if (n === 'drawing' || n === 'pict' || n === 'object' || n === 'AlternateContent') {
          for (const id of imageIds(c)) if (!images.includes(id)) images.push(id)
        }
      }
    }

    const walk = (el: Element) => {
      for (const c of children(el)) {
        const n = local(c)
        if (n === 'r') readRun(c)
        else if (RUN_CONTAINERS.has(n)) walk(c)
      }
    }
    walk(p)
    flush()
  }

  if (body) visit(body)
  return lines
}
