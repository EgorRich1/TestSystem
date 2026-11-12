import { useEffect, useState } from 'react'

/**
 * Finds the yellow "Правильный ответ: …" panel that Moodle screenshots end with.
 * Returns the y (0..1 of the height) where the picture should be cut to hide it, or null.
 */
async function findAnswerPanel(src: string): Promise<number | null> {
  const img = new Image()
  img.src = src
  await img.decode()
  const w = 160
  const h = Math.round((img.naturalHeight / img.naturalWidth) * w)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const yellowRow = (y: number) => {
    let n = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      // Pale yellow / beige: high red & green, clearly less blue.
      if (r > 225 && g > 205 && b > 150 && b < 232 && r - b > 18 && Math.abs(r - g) < 30) n++
    }
    return n / w > 0.35
  }

  // Scan up from the bottom: find the lowest yellow band and its top edge.
  let y = h - 1
  const limit = Math.floor(h * 0.55)
  while (y > limit && !yellowRow(y)) y--
  if (y <= limit) return null
  const bottom = y
  let gap = 0
  while (y > limit && gap < 3) {
    if (yellowRow(y)) gap = 0
    else gap++
    y--
  }
  const top = y + gap + 1
  if (bottom - top < h * 0.025) return null
  return Math.max(0, (top - h * 0.01) / h)
}

interface Props {
  src: string
  alt: string
  /** Hide the "Правильный ответ" panel of a Moodle screenshot until revealed. */
  hideAnswer?: boolean
  className?: string
}

export function QuestionImage({ src, alt, hideAnswer = false, className = '' }: Props) {
  const [cut, setCut] = useState<number | null>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let alive = true
    setCut(null)
    if (!hideAnswer) return
    findAnswerPanel(src)
      .then((c) => alive && setCut(c))
      .catch(() => alive && setCut(null))
    return () => {
      alive = false
    }
  }, [src, hideAnswer])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setZoom(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoom])

  const cropped = hideAnswer && cut !== null && ratio !== null

  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className={`block w-full cursor-zoom-in overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:ring-slate-700 ${className}`}
        style={cropped ? { aspectRatio: `${1} / ${ratio! * cut!}` } : undefined}
        aria-label="Открыть картинку целиком"
      >
        <img
          src={src}
          alt={alt}
          className="block w-full"
          onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
        />
      </button>
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-slate-950/85 p-2 sm:p-6"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Картинка"
        >
          <div
            className="max-w-full shrink-0 overflow-hidden rounded-lg bg-white"
            style={
              cropped
                ? { aspectRatio: `${1} / ${ratio! * cut!}`, width: `min(100%, 1280px, calc(94dvh / ${ratio! * cut!}))` }
                : undefined
            }
          >
            <img src={src} alt={alt} className={cropped ? 'block w-full' : 'block max-h-[94dvh] w-auto max-w-full'} />
          </div>
        </div>
      )}
    </>
  )
}
