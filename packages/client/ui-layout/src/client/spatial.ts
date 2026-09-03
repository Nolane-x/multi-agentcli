/** Spatial-agent canvas policy. Kept pure so layout and visibility stay deterministic and testable. */

/** Minimal Session-list facts the spatial selector needs. */
export interface SpatialSessionSummary<Id extends string = string> {
  readonly id: Id
  readonly parentId?: Id
  readonly origin?: 'subagent'
  readonly running: boolean
}

type SpatialSessionMap<Id extends string> = Readonly<Partial<Record<Id, SpatialSessionSummary<Id>>>>

/** Minimal background-job facts required to truthfully surface one-shot delegations. */
export interface SpatialJobSummary<JobId extends string = string> {
  readonly id: JobId
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/** One active parent-owned one-shot subagent job projected onto the canvas. */
export interface SpatialSubagentJob<OwnerId extends string = string, JobId extends string = string> {
  readonly ownerId: OwnerId
  readonly job: SpatialJobSummary<JobId>
}

type SpatialJobsByOwner<OwnerId extends string, JobId extends string> = Readonly<Partial<
  Record<OwnerId, readonly SpatialJobSummary<JobId>[]>
>>

/** Graph-derived identity used by the canvas instead of relying on visual order. */
export interface SpatialAgentLineage<Id extends string = string> {
  readonly rootId: Id
  readonly parentId?: Id
  /** Parent-edge distance from this Session to the locally-known canonical root. */
  readonly depth: number
}

/**
 * Grid dimension used by the mosaic. The shell deliberately starts at 2×2:
 * one agent therefore occupies roughly one quarter of the canvas, 1–4 agents
 * share 2×2 sizing, 5–9 share 3×3 sizing, and so on.
 * @param agentCount Number of agent tiles to fit.
 * @returns The square grid dimension.
 */
export function mosaicDimension(agentCount: number): number {
  if (!Number.isFinite(agentCount) || agentCount < 0) {
    throw new RangeError('agentCount must be a finite non-negative number')
  }
  const count = Math.max(1, Math.floor(agentCount))
  return Math.max(2, Math.ceil(Math.sqrt(count)))
}

/**
 * Percentage of one tile edge before inter-tile gaps are subtracted in CSS.
 * @param agentCount Number of agent tiles to fit.
 * @returns The percentage occupied by one grid cell.
 */
export function mosaicCellPercent(agentCount: number): number {
  return 100 / mosaicDimension(agentCount)
}

/** Follow parent links to the highest locally-known ancestor, cycle-safe. */
function rootOf<Id extends string>(start: Id, byId: SpatialSessionMap<Id>): Id {
  let cursor = start
  const path: Id[] = []
  const positions = new Map<Id, number>()
  while (!positions.has(cursor)) {
    positions.set(cursor, path.length)
    path.push(cursor)
    const parent = byId[cursor]?.parentId
    if (parent === undefined || byId[parent] === undefined) return cursor
    cursor = parent
  }
  // A corrupt cycle has no canonical top. Use only the cycle members (not an
  // attached descendant) so every member of the connected family converges on
  // the same stable lexical root.
  const cycleStart = positions.get(cursor) ?? 0
  return path.slice(cycleStart).sort()[0] ?? start
}

/**
 * Derive one Session's locally-known parent relation and depth. This uses the
 * same cycle-safe root authority as family selection, so presentation cannot
 * accidentally elect the first rendered tile as leader.
 * @param id Session whose lineage is requested.
 * @param byId Locally-known Session summaries keyed by ID.
 * @returns The canonical root, direct parent, and parent-edge depth.
 */
export function spatialAgentLineage<Id extends string>(
  id: Id,
  byId: SpatialSessionMap<Id>,
): SpatialAgentLineage<Id> {
  const rootId = rootOf(id, byId)
  const parentId = byId[id]?.parentId
  let cursor = id
  let depth = 0
  const seen = new Set<Id>()
  while (cursor !== rootId && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = byId[cursor]?.parentId
    if (parent === undefined || byId[parent] === undefined) break
    cursor = parent
    depth += 1
  }
  return {
    rootId,
    ...(parentId !== undefined ? { parentId } : {}),
    depth,
  }
}

/** Whether one locally-known Session belongs under the selected root. */
function descendsFrom<Id extends string>(
  candidate: Id,
  root: Id,
  byId: SpatialSessionMap<Id>,
): boolean {
  let cursor: Id | undefined = candidate
  const seen = new Set<Id>()
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === root) return true
    seen.add(cursor)
    cursor = byId[cursor]?.parentId
  }
  // In a cycle, compare the cycle's canonical root with the selected root.
  return cursor === undefined ? false : rootOf(cursor, byId) === root
}

/**
 * Select the Sessions represented by the spatial canvas.
 *
 * With a current Session, the canvas follows that Session's complete locally
 * known agent family (top ancestor + descendants). Continuable children stay
 * visible after they become idle/ready, so follow-up and inspection do not
 * disappear at the exact moment work finishes. Unrelated historical Sessions
 * remain in Harness' workspace browser.
 *
 * Without a current Session there is no family anchor, so only actively
 * running Sessions surface as ambient work.
 * @param orderedIds Session IDs in their preferred display order.
 * @param byId Locally-known Session summaries keyed by ID.
 * @param current Current Session used as the family anchor, if any.
 * @returns Session IDs that should appear on the spatial canvas.
 */
export function canvasAgentIds<Id extends string>(
  orderedIds: readonly Id[],
  byId: SpatialSessionMap<Id>,
  current: Id | undefined,
): Id[] {
  const order = [...orderedIds]
  const present = new Set(order)
  for (const id of Object.keys(byId) as Id[]) {
    if (!present.has(id)) order.push(id)
  }

  if (current === undefined || byId[current] === undefined) {
    return order.filter(id => byId[id]?.running === true)
  }

  const root = rootOf(current, byId)
  return order.filter(id => byId[id] !== undefined && descendsFrom(id, root, byId))
}

/**
 * Select active one-shot subagent jobs owned by the Sessions represented on the
 * canvas. These jobs are real child-agent executions but do not own a Harness
 * Session transcript, so callers must present lifecycle/status only rather
 * than fabricating a conversation surface.
 * @param orderedOwnerIds Canvas Session IDs in their preferred display order.
 * @param jobsByOwner Active and historical jobs keyed by owning Session.
 * @returns Active subagent jobs projected onto the canvas.
 */
export function canvasSubagentJobs<OwnerId extends string, JobId extends string>(
  orderedOwnerIds: readonly OwnerId[],
  jobsByOwner: SpatialJobsByOwner<OwnerId, JobId>,
): SpatialSubagentJob<OwnerId, JobId>[] {
  const result: SpatialSubagentJob<OwnerId, JobId>[] = []
  for (const ownerId of orderedOwnerIds) {
    for (const job of jobsByOwner[ownerId] ?? []) {
      if (job.kind !== 'subagent') continue
      if (job.status !== 'running' && job.status !== 'stopping') continue
      result.push({ ownerId, job })
    }
  }
  return result
}
