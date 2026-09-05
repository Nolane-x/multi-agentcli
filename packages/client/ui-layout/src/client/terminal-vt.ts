/**
 * Small browser-safe VT screen engine for spatial terminal tiles.
 *
 * It is deliberately a screen model, not an append-only ANSI stripper: Remote
 * PTY chunks may address and erase cells, switch to an alternate screen, hide
 * the cursor, scroll, and split control sequences at arbitrary boundaries.
 */

export type TerminalColor = number | `#${string}`

/** One rendered terminal cell and its VT rendition attributes. */
export interface TerminalCell {
  readonly text: string
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly inverse: boolean
  readonly foreground: TerminalColor | undefined
  readonly background: TerminalColor | undefined
}

/** Immutable visible state returned by a terminal screen snapshot. */
export interface TerminalScreenSnapshot {
  readonly rows: readonly string[]
  readonly cursor: {
    readonly row: number
    readonly col: number
    readonly visible: boolean
  }
  readonly alternate: boolean
}

/** Browser-safe stateful VT screen operations used by a terminal pane. */
export interface TerminalScreen {
  write(data: string): void
  resize(rows: number, cols: number): void
  snapshot(): TerminalScreenSnapshot
  cellAt(row: number, col: number): TerminalCell
}

interface Rendition {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  foreground: TerminalColor | undefined
  background: TerminalColor | undefined
}

interface ScreenBuffer {
  cells: TerminalCell[][]
  row: number
  col: number
  savedRow: number
  savedCol: number
  wrapPending: boolean
  scrollTop: number
  scrollBottom: number
}

type ParserMode = 'normal' | 'escape' | 'escape-skip' | 'csi' | 'osc' | 'osc-escape' | 'string' | 'string-escape'

const DEFAULT_RENDITION: Rendition = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  foreground: undefined,
  background: undefined,
}

class VtScreen implements TerminalScreen {
  private rows: number
  private cols: number
  private primary: ScreenBuffer
  private alternateBuffer: ScreenBuffer
  private alternate = false
  private mode: ParserMode = 'normal'
  private csi = ''
  private rendition: Rendition = { ...DEFAULT_RENDITION }
  private cursorVisible = true
  private autoWrap = true

  constructor(rows: number, cols: number) {
    assertGeometry(rows, cols)
    this.rows = rows
    this.cols = cols
    this.primary = this.makeBuffer()
    this.alternateBuffer = this.makeBuffer()
  }

  write(data: string): void {
    for (const char of data) this.consume(char)
  }

  resize(rows: number, cols: number): void {
    assertGeometry(rows, cols)
    if (rows === this.rows && cols === this.cols) return
    const oldRows = this.rows
    this.rows = rows
    this.cols = cols
    this.primary = this.resizeBuffer(this.primary, oldRows)
    this.alternateBuffer = this.resizeBuffer(this.alternateBuffer, oldRows)
  }

  snapshot(): TerminalScreenSnapshot {
    const buffer = this.buffer()
    return {
      rows: buffer.cells.map(row => row.map(cell => cell.text).join('')),
      cursor: { row: buffer.row, col: buffer.col, visible: this.cursorVisible },
      alternate: this.alternate,
    }
  }

  cellAt(row: number, col: number): TerminalCell {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new RangeError('terminal cell address is outside the screen')
    }
    const value = this.buffer().cells[row]?.[col]
    if (value === undefined) throw new RangeError('terminal cell address is outside the screen')
    return { ...value }
  }

  private consume(char: string): void {
    switch (this.mode) {
      case 'normal': this.consumeNormal(char); return
      case 'escape': this.consumeEscape(char); return
      case 'escape-skip': this.mode = 'normal'; return
      case 'csi': this.consumeCsi(char); return
      case 'osc': this.consumeOsc(char); return
      case 'osc-escape':
        this.mode = char === '\\' ? 'normal' : 'osc'
        return
      case 'string':
        if (char === '\u001b') this.mode = 'string-escape'
        return
      case 'string-escape':
        this.mode = char === '\\' ? 'normal' : 'string'
        return
    }
  }

  private consumeNormal(char: string): void {
    const buffer = this.buffer()
    switch (char) {
      case '\u001b': this.mode = 'escape'; return
      case '\r': buffer.col = 0; buffer.wrapPending = false; return
      case '\n':
      case '\u000b':
      case '\u000c': this.lineFeed(); return
      case '\b': buffer.col = Math.max(0, buffer.col - 1); buffer.wrapPending = false; return
      case '\t':
        buffer.col = Math.min(this.cols - 1, (Math.floor(buffer.col / 8) + 1) * 8)
        buffer.wrapPending = false
        return
      case '\u0007': return
      default:
        const codePoint = char.codePointAt(0)
        if (codePoint === undefined || codePoint < 0x20 || char === '\u007f') return
        this.put(char)
    }
  }

  private consumeEscape(char: string): void {
    this.mode = 'normal'
    switch (char) {
      case '[': this.csi = ''; this.mode = 'csi'; return
      case ']': this.mode = 'osc'; return
      case 'P':
      case '^':
      case '_': this.mode = 'string'; return
      case '(':
      case ')':
      case '*':
      case '+': this.mode = 'escape-skip'; return
      case '7': this.saveCursor(); return
      case '8': this.restoreCursor(); return
      case 'D': this.lineFeed(); return
      case 'E': this.buffer().col = 0; this.lineFeed(); return
      case 'M': this.reverseIndex(); return
      case 'c': this.resetActiveScreen(); return
      default: return
    }
  }

  private consumeCsi(char: string): void {
    const code = char.charCodeAt(0)
    if (code >= 0x40 && code <= 0x7e) {
      const sequence = this.csi
      this.csi = ''
      this.mode = 'normal'
      this.dispatchCsi(sequence, char)
      return
    }
    // Keep malformed/unbounded host output from growing browser memory forever.
    if (this.csi.length < 256) this.csi += char
    else {
      this.csi = ''
      this.mode = 'normal'
    }
  }

  private consumeOsc(char: string): void {
    if (char === '\u0007') {
      this.mode = 'normal'
      return
    }
    if (char === '\u001b') this.mode = 'osc-escape'
  }

  private dispatchCsi(raw: string, final: string): void {
    const privatePrefix = raw.startsWith('?') ? '?' : ''
    const body = privatePrefix === '' ? raw : raw.slice(1)
    const params = parseParams(body)
    const buffer = this.buffer()
    const first = positiveParam(params[0], 1)

    switch (final) {
      case 'A': this.moveCursor(-first, 0); return
      case 'B': this.moveCursor(first, 0); return
      case 'C': this.moveCursor(0, first); return
      case 'D': this.moveCursor(0, -first); return
      case 'E': this.moveCursor(first, 0); buffer.col = 0; return
      case 'F': this.moveCursor(-first, 0); buffer.col = 0; return
      case 'G': buffer.col = clamp(first - 1, 0, this.cols - 1); buffer.wrapPending = false; return
      case 'd': buffer.row = clamp(first - 1, 0, this.rows - 1); buffer.wrapPending = false; return
      case 'H':
      case 'f': this.positionCursor(params); return
      case 'J': this.eraseDisplay(params[0] ?? 0); return
      case 'K': this.eraseLine(params[0] ?? 0); return
      case 'm': this.applySgr(params); return
      case 's': this.saveCursor(); return
      case 'u': this.restoreCursor(); return
      case 'S': this.scrollUp(first); return
      case 'T': this.scrollDown(first); return
      case 'r': this.setScrollRegion(params); return
      case 'h':
      case 'l':
        if (privatePrefix === '?') this.setPrivateMode(params, final === 'h')
        return
      default: return
    }
  }

  private put(text: string): void {
    const buffer = this.buffer()
    if (buffer.wrapPending && this.autoWrap) {
      buffer.col = 0
      this.lineFeed()
    }
    buffer.wrapPending = false
    const line = buffer.cells[buffer.row]
    if (line === undefined) throw new RangeError('terminal screen row is unavailable')
    line[buffer.col] = cell(text, this.rendition)
    if (buffer.col === this.cols - 1) {
      buffer.wrapPending = this.autoWrap
      return
    }
    buffer.col += 1
  }

  private lineFeed(): void {
    const buffer = this.buffer()
    buffer.wrapPending = false
    if (buffer.row === buffer.scrollBottom) {
      this.scrollUp(1)
      return
    }
    buffer.row = Math.min(this.rows - 1, buffer.row + 1)
  }

  private reverseIndex(): void {
    const buffer = this.buffer()
    buffer.wrapPending = false
    if (buffer.row === buffer.scrollTop) {
      this.scrollDown(1)
      return
    }
    buffer.row = Math.max(0, buffer.row - 1)
  }

  private moveCursor(rowDelta: number, colDelta: number): void {
    const buffer = this.buffer()
    buffer.row = clamp(buffer.row + rowDelta, 0, this.rows - 1)
    buffer.col = clamp(buffer.col + colDelta, 0, this.cols - 1)
    buffer.wrapPending = false
  }

  private positionCursor(params: readonly number[]): void {
    const buffer = this.buffer()
    buffer.row = clamp(positiveParam(params[0], 1) - 1, 0, this.rows - 1)
    buffer.col = clamp(positiveParam(params[1], 1) - 1, 0, this.cols - 1)
    buffer.wrapPending = false
  }

  private eraseDisplay(mode: number): void {
    const buffer = this.buffer()
    if (mode === 2 || mode === 3) {
      buffer.cells = Array.from({ length: this.rows }, () => this.blankRow())
      buffer.wrapPending = false
      return
    }
    if (mode === 1) {
      for (let row = 0; row < buffer.row; row += 1) buffer.cells[row] = this.blankRow()
      this.eraseRange(buffer.row, 0, buffer.col)
      return
    }
    this.eraseRange(buffer.row, buffer.col, this.cols - 1)
    for (let row = buffer.row + 1; row < this.rows; row += 1) buffer.cells[row] = this.blankRow()
  }

  private eraseLine(mode: number): void {
    const buffer = this.buffer()
    if (mode === 2) {
      buffer.cells[buffer.row] = this.blankRow()
      buffer.wrapPending = false
      return
    }
    if (mode === 1) this.eraseRange(buffer.row, 0, buffer.col)
    else this.eraseRange(buffer.row, buffer.col, this.cols - 1)
  }

  private eraseRange(row: number, start: number, end: number): void {
    const line = this.buffer().cells[row]
    if (line === undefined) throw new RangeError('terminal screen row is unavailable')
    for (let col = clamp(start, 0, this.cols - 1); col <= clamp(end, 0, this.cols - 1); col += 1) {
      line[col] = blankCell()
    }
    this.buffer().wrapPending = false
  }

  private applySgr(input: readonly number[]): void {
    const params = input.length === 0 ? [0] : input
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index] ?? 0
      if (code === 0) this.rendition = { ...DEFAULT_RENDITION }
      else if (code === 1) this.rendition.bold = true
      else if (code === 2) this.rendition.dim = true
      else if (code === 3) this.rendition.italic = true
      else if (code === 4) this.rendition.underline = true
      else if (code === 7) this.rendition.inverse = true
      else if (code === 22) { this.rendition.bold = false; this.rendition.dim = false }
      else if (code === 23) this.rendition.italic = false
      else if (code === 24) this.rendition.underline = false
      else if (code === 27) this.rendition.inverse = false
      else if (code >= 30 && code <= 37) this.rendition.foreground = code - 30
      else if (code === 39) this.rendition.foreground = undefined
      else if (code >= 40 && code <= 47) this.rendition.background = code - 40
      else if (code === 49) this.rendition.background = undefined
      else if (code >= 90 && code <= 97) this.rendition.foreground = code - 90 + 8
      else if (code >= 100 && code <= 107) this.rendition.background = code - 100 + 8
      else if (code === 38 || code === 48) {
        const extended = parseExtendedColor(params, index)
        if (extended !== undefined) {
          if (code === 38) this.rendition.foreground = extended.color
          else this.rendition.background = extended.color
          index = extended.lastIndex
        }
      }
    }
  }

  private setPrivateMode(params: readonly number[], enabled: boolean): void {
    for (const code of params) {
      if (code === 25) this.cursorVisible = enabled
      else if (code === 7) this.autoWrap = enabled
      else if (code === 47 || code === 1047 || code === 1049) this.useAlternateScreen(enabled)
    }
  }

  private useAlternateScreen(enabled: boolean): void {
    if (enabled === this.alternate) return
    if (enabled) {
      this.alternateBuffer = this.makeBuffer()
      this.alternate = true
      return
    }
    this.alternate = false
  }

  private setScrollRegion(params: readonly number[]): void {
    const top = clamp(positiveParam(params[0], 1) - 1, 0, this.rows - 1)
    const bottom = clamp(positiveParam(params[1], this.rows) - 1, 0, this.rows - 1)
    if (top >= bottom) return
    const buffer = this.buffer()
    buffer.scrollTop = top
    buffer.scrollBottom = bottom
    buffer.row = 0
    buffer.col = 0
    buffer.wrapPending = false
  }

  private scrollUp(count: number): void {
    const buffer = this.buffer()
    const amount = Math.min(Math.max(1, count), buffer.scrollBottom - buffer.scrollTop + 1)
    for (let index = 0; index < amount; index += 1) {
      buffer.cells.splice(buffer.scrollTop, 1)
      buffer.cells.splice(buffer.scrollBottom, 0, this.blankRow())
    }
  }

  private scrollDown(count: number): void {
    const buffer = this.buffer()
    const amount = Math.min(Math.max(1, count), buffer.scrollBottom - buffer.scrollTop + 1)
    for (let index = 0; index < amount; index += 1) {
      buffer.cells.splice(buffer.scrollBottom, 1)
      buffer.cells.splice(buffer.scrollTop, 0, this.blankRow())
    }
  }

  private saveCursor(): void {
    const buffer = this.buffer()
    buffer.savedRow = buffer.row
    buffer.savedCol = buffer.col
  }

  private restoreCursor(): void {
    const buffer = this.buffer()
    buffer.row = clamp(buffer.savedRow, 0, this.rows - 1)
    buffer.col = clamp(buffer.savedCol, 0, this.cols - 1)
    buffer.wrapPending = false
  }

  private resetActiveScreen(): void {
    if (this.alternate) this.alternateBuffer = this.makeBuffer()
    else this.primary = this.makeBuffer()
    this.rendition = { ...DEFAULT_RENDITION }
    this.cursorVisible = true
    this.autoWrap = true
  }

  private resizeBuffer(buffer: ScreenBuffer, oldRows: number): ScreenBuffer {
    let cells = buffer.cells.map((line) => {
      const resized = line.slice(0, this.cols)
      while (resized.length < this.cols) resized.push(blankCell())
      return resized
    })
    let removed = 0
    if (this.rows < oldRows) {
      removed = oldRows - this.rows
      cells = cells.slice(removed)
    } else {
      while (cells.length < this.rows) cells.push(this.blankRow())
    }
    return {
      cells,
      row: clamp(buffer.row - removed, 0, this.rows - 1),
      col: clamp(buffer.col, 0, this.cols - 1),
      savedRow: clamp(buffer.savedRow - removed, 0, this.rows - 1),
      savedCol: clamp(buffer.savedCol, 0, this.cols - 1),
      wrapPending: false,
      scrollTop: 0,
      scrollBottom: this.rows - 1,
    }
  }

  private buffer(): ScreenBuffer {
    return this.alternate ? this.alternateBuffer : this.primary
  }

  private makeBuffer(): ScreenBuffer {
    return {
      cells: Array.from({ length: this.rows }, () => this.blankRow()),
      row: 0,
      col: 0,
      savedRow: 0,
      savedCol: 0,
      wrapPending: false,
      scrollTop: 0,
      scrollBottom: this.rows - 1,
    }
  }

  private blankRow(): TerminalCell[] {
    return Array.from({ length: this.cols }, blankCell)
  }
}

function cell(text: string, rendition: Rendition): TerminalCell {
  return { text, ...rendition }
}

function blankCell(): TerminalCell {
  return { text: ' ', ...DEFAULT_RENDITION }
}

function parseParams(raw: string): number[] {
  if (raw === '') return []
  return raw.split(';').map((value) => {
    if (value === '') return 0
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
}

function positiveParam(value: number | undefined, fallback: number): number {
  return value === undefined || value === 0 ? fallback : Math.max(1, value)
}

function parseExtendedColor(
  params: readonly number[],
  index: number,
): { readonly color: TerminalColor; readonly lastIndex: number } | undefined {
  const mode = params[index + 1]
  const colorIndex = index + 2
  const colorValue = params[colorIndex]
  if (mode === 5 && colorValue !== undefined) {
    return { color: clamp(colorValue, 0, 255), lastIndex: colorIndex }
  }
  const red = params[colorIndex]
  const green = params[index + 3]
  const blue = params[index + 4]
  if (mode === 2 && red !== undefined && green !== undefined && blue !== undefined) {
    const r = clamp(red, 0, 255)
    const g = clamp(green, 0, 255)
    const b = clamp(blue, 0, 255)
    return { color: `#${hex(r)}${hex(g)}${hex(b)}`, lastIndex: index + 4 }
  }
  return undefined
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function assertGeometry(rows: number, cols: number): void {
  if (!Number.isSafeInteger(rows) || rows <= 0 || !Number.isSafeInteger(cols) || cols <= 0) {
    throw new RangeError('terminal geometry must use positive safe integers')
  }
}

/**
 * Create one stateful VT screen model.
 * @param rows Initial visible row count.
 * @param cols Initial visible column count.
 * @returns A stateful browser-safe VT screen.
 */
export function createTerminalScreen(rows: number, cols: number): TerminalScreen {
  return new VtScreen(rows, cols)
}
