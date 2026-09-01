import { describe, expect, it } from 'vitest'
import {
  mosaicCellPercent,
  mosaicDimension,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/spatial.ts'

describe('spatial agent mosaic geometry', () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 2],
    [4, 2],
    [5, 3],
    [9, 3],
    [10, 4],
    [16, 4],
    [17, 5],
    [25, 5],
  ])('maps %i visible agents to a %ix%i sizing grid', (count, dimension) => {
    expect(mosaicDimension(count)).toBe(dimension)
  })

  it('keeps tile sizing derived from the same dimension authority', () => {
    expect(mosaicCellPercent(1)).toBe(50)
    expect(mosaicCellPercent(5)).toBeCloseTo(100 / 3)
    expect(mosaicCellPercent(10)).toBe(25)
  })

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN])('rejects invalid agent counts: %s', count => {
    expect(() => mosaicDimension(count)).toThrow(RangeError)
  })
})
