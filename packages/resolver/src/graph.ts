export type ResourceKind = 'feed' | 'user'
export type ResourceNode =
  | string
  | { id: string; kind: ResourceKind | 'event-feed' | 'user-data' }

export interface ResourceEdge {
  from: string
  to: string
  kind: string
}

export class ResourceGraph {
  private readonly edges = new Map<string, ResourceEdge[]>()
  private readonly kinds = new Map<string, ResourceKind>()

  addResource(id: string, kind: ResourceKind): this {
    this.kinds.set(id, kind)
    return this
  }

  private node(input: ResourceNode): string {
    if (typeof input === 'string') {
      if (!this.kinds.has(input)) {
        if (input.startsWith('feed:')) this.kinds.set(input, 'feed')
        else if (input.startsWith('user:')) this.kinds.set(input, 'user')
      }
      return input
    }
    this.kinds.set(input.id, input.kind === 'event-feed' || input.kind === 'feed' ? 'feed' : 'user')
    return input.id
  }

  addEdge(fromInput: ResourceNode, toInput: ResourceNode, kind: string): this {
    const from = this.node(fromInput)
    const to = this.node(toInput)
    const list = this.edges.get(from) ?? []
    if (!list.some((edge) => edge.to === to && edge.kind === kind)) {
      list.push({ from, to, kind })
      list.sort((a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind))
      this.edges.set(from, list)
    }
    return this
  }

  detectCycles(): string[][] {
    const nodes = new Set([...this.kinds.keys(), ...this.edges.keys()])
    for (const list of this.edges.values()) {
      for (const edge of list) nodes.add(edge.to)
    }

    const cycles: string[][] = []
    const state = new Map<string, 0 | 1 | 2>()
    const stack: string[] = []
    const seen = new Set<string>()

    const visit = (node: string): void => {
      state.set(node, 1)
      stack.push(node)
      for (const { to } of this.edges.get(node) ?? []) {
        if (state.get(to) === 1) {
          const start = stack.indexOf(to)
          const cycle = [...stack.slice(start), to]
          const key = cycle.slice(0, -1).sort().join('\u0000')
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push(cycle)
          }
        } else if (!state.has(to)) {
          visit(to)
        }
      }
      stack.pop()
      state.set(node, 2)
    }

    for (const node of [...nodes].sort()) {
      if (!state.has(node)) visit(node)
    }
    return cycles
  }

  assertNoFeedEdges(): void {
    for (const [from, edges] of this.edges) {
      if (edges.length > 0 && this.kinds.get(from) === 'feed') {
        throw new Error(`Feed resources cannot have outgoing edges: ${from}`)
      }
    }
  }
}
