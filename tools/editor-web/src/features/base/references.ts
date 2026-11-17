interface Identified {id: string; aliases?: string[]}
// Match ContentProject.Lookup: canonical first, then exact ordinal aliases.
export function referenceIndex<T extends Identified>(entities: T[]): ReadonlyMap<string, T> {
 const index = new Map(entities.map(entity => [entity.id, entity]))
 for (const entity of entities) for (const alias of entity.aliases || []) if (!index.has(alias)) index.set(alias, entity)
 return index
}
export const resolveReference = <T extends Identified>(index: ReadonlyMap<string, T>, reference: string) => index.get(reference)
