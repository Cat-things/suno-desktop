import { z } from 'zod'

export const MIN_WINDOW_WIDTH = 480
export const MIN_WINDOW_HEIGHT = 360

export const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(MIN_WINDOW_WIDTH).max(16384),
  height: z.number().int().min(MIN_WINDOW_HEIGHT).max(16384),
  maximized: z.boolean()
})

export type WindowState = z.infer<typeof windowStateSchema>

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 820, maximized: false }

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** How much of the title bar must be on screen for a saved position to be reused. */
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 32

export function parseWindowState(raw: unknown): WindowState {
  const parsed = windowStateSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...DEFAULT_WINDOW_STATE }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

/**
 * Drops a saved position that would put the window off-screen (for example after unplugging a
 * monitor) and shrinks the window to fit the primary work area.
 */
export function fitToDisplays(
  state: WindowState,
  workAreas: readonly Rect[],
  primary: Rect
): WindowState {
  const width = Math.min(state.width, primary.width)
  const height = Math.min(state.height, primary.height)
  const sized: WindowState = {
    width: Math.max(MIN_WINDOW_WIDTH, width),
    height: Math.max(MIN_WINDOW_HEIGHT, height),
    maximized: state.maximized
  }
  if (state.x === undefined || state.y === undefined) return sized

  const titleBar: Rect = { x: state.x, y: state.y, width: sized.width, height: MIN_VISIBLE_HEIGHT }
  const visible = workAreas.some((area) => {
    const o = overlap(titleBar, area)
    return o.width >= MIN_VISIBLE_WIDTH && o.height >= MIN_VISIBLE_HEIGHT
  })
  return visible ? { ...sized, x: state.x, y: state.y } : sized
}
