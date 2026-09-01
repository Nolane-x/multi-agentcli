/** Spatial-agent canvas geometry. Kept pure so layout policy is deterministic and testable. */

/**
 * Grid dimension used by the mosaic. The shell deliberately starts at 2×2:
 * one agent therefore occupies roughly one quarter of the canvas, 1–4 agents
 * share 2×2 sizing, 5–9 share 3×3 sizing, and so on.
 */
export function mosaicDimension(agentCount: number): number {
  if (!Number.isFinite(agentCount) || agentCount < 0) {
    throw new RangeError('agentCount must be a finite non-negative number')
  }
  const count = Math.max(1, Math.floor(agentCount))
  return Math.max(2, Math.ceil(Math.sqrt(count)))
}

/** Percentage of one tile edge before inter-tile gaps are subtracted in CSS. */
export function mosaicCellPercent(agentCount: number): number {
  return 100 / mosaicDimension(agentCount)
}
