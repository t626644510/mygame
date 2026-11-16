declare module 'dagre' {
 class Graph {
  setGraph(options: {rankdir: string; nodesep?: number; ranksep?: number}): this
  setDefaultEdgeLabel(factory: () => Record<string, unknown>): this
  setNode(id: string, size: {width: number; height: number}): this
  setEdge(source: string, target: string): this
  node(id: string): {x: number; y: number}
 }
 const dagre: {graphlib: {Graph: typeof Graph}; layout: (graph: Graph) => void}
 export default dagre
}
