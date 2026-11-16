import type {ContentError, RequestDraft} from '../../types'

export type CombatType = 'skill' | 'character' | 'encounter' | 'trial' | 'rule'
export const combatTypes: CombatType[] = ['skill', 'character', 'encounter', 'trial', 'rule']
export const typeLabels: Record<CombatType, string> = {skill: '技能', character: '角色', encounter: '遭遇', trial: '试炼场', rule: '规则参数'}
export const splitTags = (value: string) => value.split(/[,，]/).map(part => part.trim()).filter(Boolean)
export interface Option {id: string; label: string; description: string; category: string; usesThreshold: boolean; minThreshold: number; maxThreshold: number; defaultThreshold: number; integerThreshold: boolean; thresholdUnit: string; usesValue: boolean; defaultValue: string; valueHint: string}
export interface CombatCatalog {conditions: Option[]; selectors: Option[]; scopes: Option[]; operations: Option[]; groupings: Option[]; subjects: Option[]; effectKinds: Option[]; statusKinds: Option[]; targetModes: Option[]; damageTypes: Option[]}
interface Entity {schemaVersion: number; id: string; draft?: boolean; description?: string}
export interface Skill extends Entity {displayName: string; effectKind: string; magnitude: number; mpCost: number; baseWait: number; statusId?: string; statusKind?: string; statusMagnitude?: number; statusDuration?: number; targetMode?: string; isMagic?: boolean; damageType?: string; classTags?: string[]}
export interface Term {kind: string; threshold?: number; subject?: string; value?: string}
export interface Condition {operation: string; terms: Term[]; operators?: string[]; grouping?: string}
export interface Instruction {id: string; label?: string; condition: Condition; scope: string; selector: string; actionId: string}
export interface Character extends Entity {name: string; role?: string; tags?: string[]; attributes: {id: string; value: number}[]; combatOverride: {maxHp: number; maxMp: number; agilityFactor: number}; availableActionIds?: string[]; instructions: Instruction[]; defaultEquipment: {slot: string; itemId: string}[]}
export interface Status {id: string; kind: string; magnitude: number; appliedAt: number; expiresAt: number}
export interface Slot {unitId: string; characterId: string; name?: string; team?: string; row: number; column: number; hp?: number; mp?: number; initialReadyTime?: number; vulnerable?: boolean; statuses?: Status[]; equipmentDamageBonus?: number; equipmentSourceId?: string}
export type RuntimeAction = Pick<Skill, 'id' | 'displayName' | 'effectKind' | 'magnitude' | 'mpCost' | 'baseWait' | 'statusId' | 'statusKind' | 'statusMagnitude' | 'statusDuration' | 'targetMode' | 'isMagic' | 'damageType'>
export type ActionField = Exclude<keyof RuntimeAction, 'id'>
export interface ActionOverride {actionId: string; fields: Partial<Omit<RuntimeAction, 'id'>>; remove: ActionField[]}
export interface ResolvedAction {encounterIndex: number; encounterId: string; actionId: string; shared: RuntimeAction; local: {fields: ActionOverride['fields']; remove: ActionField[]}; effective: RuntimeAction; sourceName: string}
export interface Encounter extends Entity {name: string; enemies: Slot[]; experiencePool?: number; publicCash?: number; publicDrops?: {itemId: string; quantity: number}[]; actionOverrides?: ActionOverride[]}
export interface Trial extends Entity {title: string; parameterNotice?: string; seed?: number; playerTeam?: string; allies: Slot[]; encounters: {encounterId: string; waitBefore: number; rulesId?: string}[]; carryTeam?: string; rulesId?: string; runBudget?: {maxSteps: number; maxWait: number}}
export interface Rules extends Entity {maxUnitsPerTeam: number; gridRows: number; gridColumns: number; alliesIncludeSelf: boolean; maxEvents: number; maxWait: number; capacity: {baseSlots: number; slotsPerIntelligence: number; minimumSlots: number; maximumSlots: number; secondConditionAtIntelligence: number; thirdConditionAtIntelligence: number}}
export type CombatEntity = Skill | Character | Encounter | Trial | Rules
export interface EditIntent {op: 'set' | 'remove'; path: string}
export interface Session {type: CombatType; entity: CombatEntity; base: CombatEntity; etag: string; isNew: boolean; intents: EditIntent[]; requests: RequestDraft[]; revision: number}
export interface OverrideSet {characters: Character[]; skills: Skill[]; encounters: Encounter[]}
export type AssemblyBody = ({trialId: string} | {trial: Trial}) & {overrides?: OverrideSet; editIntents?: {type: CombatType; id: string; operations: EditIntent[]}[]}
export interface Binding {sourcePointer: string; entityType: string; entityId: string; unitId: string; instructionId: string; encounterIndex: number; instructionIndex: number}
export interface RuleContext {trialId: string; encounterIndex: number; rulesId: string; origin: 'source' | 'global' | 'inline'; sourceName: string; sourceScenarioId: string; rules: Rules}
export interface Provenance {imported: boolean; sourceKind: string; sourceName: string; sourceSha256: string; metadataReadOnly: boolean}
export interface Assembly {ok: boolean; kind: 'scenario' | 'expedition'; config: Record<string, unknown>; bindings: Binding[]; ruleContexts: RuleContext[]; provenance: Provenance; resolvedActions: ResolvedAction[]}
export interface InstructionValidation {id: string; capacityAllowed: boolean; actionAvailable: boolean; validationReason: string; display: string}
export interface CharacterValidation {ok: boolean; instructionCapacity: number; conditionTermCapacity: number; instructions: InstructionValidation[]; ruleContext: RuleContext; availableActions: string[]; resolvedActions: ResolvedAction[]}
export interface Candidate {unitId: string; unitName: string; passesCondition: boolean; eligible: boolean; reason: string; affectedTargetIds: string[]}
export interface Attempt {instructionIndex: number; instructionId: string; display: string; outcome: string; reason: string; reasonCode: string; candidates: Candidate[]}
export interface Effect {kind: string; targetId: string; targetName: string; hpBefore: number; hpAfter: number; hpDelta: number; mpBefore: number; mpAfter: number; mpDelta: number; description: string; statusId: string; statusAppliedAt: number; statusExpiresAt: number; removedStatusIds: string[]}
export interface Step {index: number; time: number; status: string; actorId: string; actorName: string; actionId: string; actionName: string; targetId: string; targetName: string; targetIds: string[]; attempts: Attempt[]; effects: Effect[]; mpBefore: number; mpAfter: number; mpCost: number; baseWait: number; actualWait: number; nextActionTime: number; message: string; controlReason: string}
export interface RunResult {outcome: string; winnerTeam: string; stopReason: string; time: number; executedActionCount: number; steps: Step[]; snapshot: Record<string, unknown>}
export interface ExpeditionResult {expeditionId: string; stopReason: string; finished: boolean; encounters: {encounterIndex: number; encounterId: string; scenarioId: string; outcome: string; stopReason: string; steps: Step[]; executedActionCount: number}[]; finalSnapshot: Record<string, unknown>}
export interface TrialRun {ok: boolean; kind: 'scenario' | 'expedition'; result: RunResult | ExpeditionResult; logText?: string; logs?: {encounterIndex: number; encounterId: string; scenarioId: string; logText: string}[]; bindings: Binding[]}
export interface Comparison {ok: boolean; comparison: {baseline: RunResult; variant: RunResult; firstDivergence: {recordIndex: number; baseline: Step | null; variant: Step | null; description: string} | null; observableImpact: string; onlyDeclaredSettingChanged: boolean}; scope: 'single' | 'first_encounter_only'; bindings: Binding[]}
export interface ValidationState {revision: number; value?: CharacterValidation; errors: ContentError[]}
export type ContextChoice = {trialId: string; encounterIndex: number} | undefined
export const entityName = (entity: CombatEntity) => 'displayName' in entity ? entity.displayName : 'name' in entity ? entity.name : 'title' in entity ? entity.title : entity.id
export const attributeLabels: Record<string, string> = {strength: '力量', constitution: '体质', intelligence: '智力', spirit: '精神', agility: '敏捷', focus: '集中'}
export function newEntity(type: CombatType): CombatEntity {
 const common = {schemaVersion: 1, id: {skill: 'skill_', character: 'chr_', encounter: 'enc_', trial: 'trial_', rule: 'rules_combat'}[type], draft: false, description: ''}
 if (type === 'skill') return {...common, displayName: '', effectKind: 'damage', magnitude: 0, mpCost: 0, baseWait: 40, statusId: '', statusKind: '', statusMagnitude: 0, statusDuration: 0, targetMode: 'single', isMagic: false, damageType: 'legacy', classTags: []}
 if (type === 'character') return {...common, name: '', role: 'combat', tags: [], attributes: Object.keys(attributeLabels).map(id => ({id, value: 0})), combatOverride: {maxHp: 100, maxMp: 30, agilityFactor: 1}, availableActionIds: [], instructions: [], defaultEquipment: []}
 if (type === 'encounter') return {...common, name: '', enemies: [], experiencePool: 0, publicCash: 0, publicDrops: []}
 if (type === 'trial') return {...common, title: '', parameterNotice: '编辑器组装的试玩配置。', seed: 0, playerTeam: 'friendly', carryTeam: 'friendly', allies: [], encounters: [], rulesId: 'rules_combat'}
 throw Error('规则只读，不能从界面新建。')
}
