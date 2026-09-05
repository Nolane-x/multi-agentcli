import { describe, expect, it } from 'vitest'
import { createTerminalScreen } from '@deepseek-ai/dsh-client-ui-layout/src/client/terminal-vt.ts'

describe('spatial terminal VT screen', () => {
  it('applies cursor addressing and erase commands instead of appending a log', () => {
    const screen = createTerminalScreen(4, 12)
    screen.write('alpha\r\nbeta')
    screen.write('\u001b[1;3HXY')
    screen.write('\u001b[2;1H\u001b[2Kdone')

    expect(screen.snapshot().rows).toEqual([
      'alXYa       ',
      'done        ',
      '            ',
      '            ',
    ])
    expect(screen.snapshot().cursor).toMatchObject({ row: 1, col: 4, visible: true })
  })

  it('keeps parser state across Remote output chunk boundaries', () => {
    const screen = createTerminalScreen(3, 10)
    screen.write('hello')
    screen.write('\u001b[')
    screen.write('2J')
    screen.write('\u001b[3;2')
    screen.write('H!')

    expect(screen.snapshot().rows).toEqual([
      '          ',
      '          ',
      ' !        ',
    ])
    expect(screen.snapshot().cursor).toMatchObject({ row: 2, col: 2 })
  })

  it('tracks SGR presentation state on cells without leaking escape bytes into text', () => {
    const screen = createTerminalScreen(2, 8)
    screen.write('\u001b[1;31mR\u001b[22;39mN')

    expect(screen.snapshot().rows[0]).toBe('RN      ')
    expect(screen.cellAt(0, 0)).toMatchObject({ text: 'R', bold: true, foreground: 1 })
    expect(screen.cellAt(0, 1)).toMatchObject({ text: 'N', bold: false, foreground: undefined })
  })

  it('supports the alternate screen and restores the primary screen exactly', () => {
    const screen = createTerminalScreen(2, 10)
    screen.write('primary')
    screen.write('\u001b[?1049h')
    screen.write('menu')

    expect(screen.snapshot()).toMatchObject({ alternate: true })
    expect(screen.snapshot().rows[0]).toBe('menu      ')

    screen.write('\u001b[?25l\u001b[?1049l')
    expect(screen.snapshot()).toMatchObject({ alternate: false })
    expect(screen.snapshot().rows[0]).toBe('primary   ')
    expect(screen.snapshot().cursor.visible).toBe(false)
  })

  it('ignores OSC metadata while preserving following terminal content', () => {
    const screen = createTerminalScreen(2, 12)
    screen.write('\u001b]0;Codex workspace')
    screen.write('\u0007ready')
    screen.write('\u001b]133;D;0\u001b\\> ')

    expect(screen.snapshot().rows[0]).toBe('ready>      ')
  })

  it('scrolls on the bottom edge and resizes while preserving the newest visible cells', () => {
    const screen = createTerminalScreen(3, 6)
    screen.write('one\r\ntwo\r\nthree\r\nfour')
    expect(screen.snapshot().rows).toEqual(['two   ', 'three ', 'four  '])

    screen.resize(2, 8)
    expect(screen.snapshot().rows).toEqual(['three   ', 'four    '])
    expect(screen.snapshot().cursor).toMatchObject({ row: 1, col: 4 })
  })
})
