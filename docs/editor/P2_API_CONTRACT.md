# P2 API 与来源保真合同

开工基线 `2651a82322d675a077031b8bea2aec797a52cead`。后端/本合同唯一 writer 为 integration；frontend 仅 `tools/editor-web/**`，独立验收仅 `tools/editor-verification/p2/**` 与 `P2_VERIFICATION.md`。此文固定实现接口，不代表实现或验收已完成。P1 API/ETag/draft/alias/路径安全合同保留。

## 实体与规则

- CRUD 类型新增 `trial/trials`、`rule/rules`。已有 `skill/character/encounter` 启用编辑。纯校验为 POST `/api/validate-entity`，body `{type,mode:"create"|"update",entity,requests?:[],editIntent?:[]}`；成功200，语义422，完整无写。`validate-item` 保持原入口。
- GET list 仍 `[{id,path}]`，GET detail 为磁盘 raw Helper JSON，带 quoted physical SHA ETag。GET 不补默认字段。PUT 支持 raw entity 或 `{entity,requests:[],editIntent?:[]}`；create/If-None-Match:*、update/If-Match、409 current/etag 与 P1 相同。compound 的请求 target 必须为同类型同实体；skill 的缺能力需求为 combat/非note。
- 所有实体一文件、filename=id、跨类型/alias 全局唯一。规则模板为 `rules/rules_combat.json`、id `rules_combat`，初值取实际 R4。导入为每场产生并绑定 `rules_<p>_<n>.json` 来源规则实体；这不是另一套公式，只存原场规则/预算及 presence。规则 UI 仍按工单161只读。
- trial 增加可选 `rulesId`（新建默认 rules_combat）、`runBudget:{maxSteps,maxWait}`；encounters 每项增加可选 `rulesId`。导入绑定的 rules 文件手改，属于该 trial/该场的明确 delta，由统一解析器投影；不相关 global 模板改动不能覆盖该来源。只有该场原绑定规则适用来源字段 delta；明确换绑其他 rulesId 时完整采用目标规则，缺省交同一核心解释，不能因目标规则也在同份旁车中就套空 delta。删掉被绑定规则报引用错误，不回退模板。
- 紧凑 schema 全层拒未知字段。技能保持 CombatActionConfig 字段，`baseWait/statusDuration` 等原 double 字段不降为int。角色 attributes 固定六项，只有 INT 映射；其余 combatOverride 手填。合法缺省/0/false/空串/空数组单独处理，界面显示的默认值不自动写进旧实体。
- 所有请求仍只新建 open；createdAt 未填为空，不读墙钟。triaged/in_progress 样例不授权实现新能力。

## 来源、明确编辑与组装

`content/_imports/<trialId>.json` 是显式 schema 的 Helper 旁车，字段为：

```json
{"schemaVersion":1,"id":"trial_example","sourceKind":"scenario",
 "sourceName":"example.json","sourceSha256":"...","sourceJson":"原始JSON文本",
 "bindings":[{"type":"character","id":"chr_example_mage","sourcePointer":"/units/0","baselineJson":"导入时Helper对象JSON"}],
 "edits":[{"type":"character","id":"chr_example_mage","path":"/instructions","op":"set"}]}
```

绑定包括 skill、character、encounter、trial、rule。JSON字符串保存完整原对象/presence/数组序；不把该旁车/metadata发给 Runtime。CLI hash 来自原文件bytes；HTTP jsonText hash来自上传UTF-8文本，明确不声称它证明未上传的原文件bytes。

读取/打开后未编辑：S0原来源。明确编辑：X>S0；新建：X>D。服务端对当前实体与导入 baseline 的实际值/存在性差异投影，不能只信前端 dirty。相同显示值的明确写入/清空可用 `editIntent:[{op:"set"|"remove",path:"/..."}]`；set 从候选同路径取值，remove 要求该字段真的缺省，必填字段不能移除。保存同时原子更新实体/需求/Markdown/绑定旁车意图。未保存组装意图是 `editIntents:[{type,id,operations:[{op,path}]}]`。取消编辑即移除未保存意图，不改磁盘历史意图。

- 导入原 Runtime id、头/seed/description(player notice)、每场头/规则/双预算、units/actions 原序及未引用动作保留。Helper安全ID不替换Runtime ID。新建才用 allies→enemies、动作并集按id排序；导入只改实际编辑字段，需要新增动作则稳定追加。
- 导入原白名单/explicit/missing保留；另返核心实际可用列表供显示。只有用户主动编辑白名单才明确 array+explicit=true；改指令不自动扩充学习库或删超槽行。
- hp/mp=0、bonus=0、false、空name/sourceId均不是缺省。新建才用-1/空串推导哨兵。P1默认装备仅基础 equipmentDamageBonus，不投影强化等级；不登记旧instance/source标签为定义。
- imported linked 的 trial.title/parameterNotice 对应 root；各场原头/seed/playerTeam来源层只读，不能把顶层默认广播覆盖。试图通过顶层修改 imported linked seed/playerTeam 报 `source_scope`，不能静默忽略。新建 linked 按trial值生成各场。
- 场景预算 maxEvents/maxWait 与调用预算分开。单场调用默认10000/100000；导入linked未编辑时保原root maxStepsPerBattle/maxWaitPerBattle。明确移除 trial.runBudget 意为删除 Runtime 根的两个调用覆盖字段；由现有 CombatExpeditionConfig 字段初始化及 UnityJson.Read 得到10000/100000，不回写全局R4值或旧来源值。场景预算不随之改动。0/缺省仍按原核心解释，负数/非有限数拒绝；绝不把所有旧场改成R4预算。

## 导入与冲突

CLI `import-scenario <file> --content <root> [--prefix p] [--out receipt]`、`import-expedition` 同参数。p缺省为来源id安全化；trial=`trial_<p>`，single encounter=`enc_<p>`，规则=`rules_<p>_1`；linked encounter/rules按场次后缀，友方角色共享前缀，敌方角色按场次隔离。原动作ID不改。

HTTP POST `/api/import-scenario`、`/api/import-expedition` body `{sourceName,jsonText,prefix?}`，不收服务端任意文件路径。成功 `{ok:true,trialId,created:[{type,id,path}],reused:[{type,id,path}],source:{kind,name,sha256,hashBasis}}`。

先完整计划、核心校验/全库ID/引用/技能等价核对，再统一事务落盘。已有技能只调用 `CombatSession.ActionDefinitionsEquivalent` 判等，等价复用、不等价422/CLI1，报ID/来源/字段差异，全目录不写；不覆盖、不自动改名。角色/遭遇/规则/trial同ID不同内容也拒绝。来源备注是kind=note、owner=combat，不是新功能授权。

C1的17单场、C2的2联场分别独立内容根；C3非空库行为另测。不能把pressure_strike25/18冲突绕过成“全部导入成功”。

## AssemblyBody 与响应

```json
{"trialId":"trial_example",
 "overrides":{"characters":[],"skills":[],"encounters":[]},
 "editIntents":[{"type":"character","id":"chr_example_mage","operations":[{"op":"set","path":"/instructions"}]}]}
```

也支持 `{trial:<完整未保存trial>,overrides?,editIntents?}`；trialId与trial二选一。overrides为完整实体候选，未出现实体取磁盘；不把局部patch误解为完整候选。没有覆盖时全部服务端读磁盘。

- CLI `assemble <trialId> --content root [--out file]` 返回纯 CombatScenario/CombatExpeditionConfig JSON。
- HTTP POST `/api/assemble` 返回 `{ok:true,kind:"scenario"|"expedition",config,bindings:Binding[],ruleContexts:RuleContext[],provenance}`。
- Binding固定 `{encounterIndex,sourcePointer,entityType,entityId,unitId,instructionId,instructionIndex}`；角色绑定可用instructionId空串/index=-1，每条指令另有精确绑定。**所有Helper encounterIndex均从1开始**，与核心report一致；JSON Pointer数组下标仍从0开始。
- RuleContext固定 `{trialId,encounterIndex,rulesId,origin:"source"|"global"|"inline",sourceName,sourceScenarioId,rules}`；rules为当前该场实际规则对象，包含capacity及场景预算，不用前端重算容量。
- provenance固定 `{imported,sourceKind,sourceName,sourceSha256,metadataReadOnly}`；source卡由assemble结果读取，不另开放任意旁车读写路由。

## 角色预览

POST `/api/character/validate` body `{character,overrides?,context?}`。context二选一：`{trialId,encounterIndex}` 或 `{rules:<完整规则实体>}`。同trial/场次走**同一组装规则解析器**。无context按当前 trial/encounter 的角色稳定引用求候选，不把原 sourcePointer 下标当当前场次；删场或重排后仍仅一个当前候选则自动解析，多解422 `context_required` 并列可选来源，禁止默用新global。无当前试炼引用的新建角色使用唯一global模板。

返回顶层 `{ok:true,characterId,unitId,ruleContext,instructionCapacity,conditionTermCapacity,instructions:[{id,capacityAllowed,actionAvailable,validationReason,display}],availableActions:string[]}`。数值/原文全部从真实 CombatSession snapshot/GetAvailableActions取得。actionAvailable不是MP是否足够/现在能否出手。预览不执行战斗；draft/pending不得借预览成为已实现运行能力，若不能构造合法诊断配置则明确422。

## 运行、比较与导出

- POST `/api/trial/run` 接AssemblyBody；CLI `run-trial <trialId> --content root [--out report] [--log file]`。单场 `{ok:true,kind:"scenario",result:CombatRunResult,logText,bindings,ruleContexts}`；log为原ExportLogText字符/UTF8字节，不仿造。
- linked `{ok:true,kind:"expedition",result:CombatExpeditionReport,logs:[{encounterIndex,encounterId,scenarioId,logText}],logText,bindings,ruleContexts}`。根已指定战斗owner新增只读 `ExportEncounterLogText(int encounterIndex)`：工程保留同一次真实expedition实例，按report.encounterIndex从1起直取同次内部battle原文缓存；不反射、不重放、不仿日志。未落记录InvalidOperationException、超配置范围ArgumentOutOfRangeException。DTO/结算/carry/预算/旧报告不改。source交付前入口如未接通明确不可用，不填假数据；P0重放历史不倒改。
- POST `/api/trial/compare` body `{baseline:{trialId},variant:AssemblyBody}`。baseline严格磁盘版本，不接受overrides；variant带所有相关未保存候选。返回 `{ok:true,comparison,scope:"single"|"first_encounter_only",baseline,variant,bindings}`；comparison来自 CompareScenarios，多场只比首场并明确标注。onlyDeclaredSettingChanged仍false，不用标签伪造单变量证明。
- CLI `export-scenario <trialId> --content root --out file` 的目标文件为纯 Runtime 配置，stdout 为 `{ok:true,path,sha256,kind}` 回执，sha256 对应该配置文件；回执不能覆盖目标。HTTP POST `/api/export-scenario` body `{trialId}`，固定写当前content根 `_exports/<trialId>.json`，返回相同回执，path为content相对路径。不接受任意HTTP目标路径。
- P1 `/api/export` 和CLI export保留items语义，扩展skills/characters/encounters表；trials不导出。合法draft剔除，其余有效项可出；被导出active定义实际依赖draft/未支持能力则失败，整个目标目录不变。所有Helper来源/编辑metadata/notes/draft剥离。没有R2全局库Runtime消费重构，不声称旧Unity加载这些新表；独立战例导出供原核读取。
- refs仍P1 `{sourceType,sourceId,path,jsonPointer,quantity,legacy,direction}` 数组，扩skill白名单/指令、character槽、encounter试炼及rule绑定；旧原例只读扫描。quantity无明确值为null。

## 当前明确边界

规则UI只读；R1六维派生/R2全局Runtime库/R3新装备/P3/C均不实施。baseWait是效果后的基础间隔，仍受当前核心系数影响。全部JSON schema只用简单对象/对象数组，严格未知字段与类型校验；Helper旁车不入Runtime。HTTP仅loopback/原CORS/安全content与固定export路径。测试根与服务身份由各owner隔离，未获根安排不启动Unity/普通Player或UIAutomation。

## 同一来源内部技能差异与编辑投影

实际 `round2_expedition.json` 的 `pressure_strike` 首场 magnitude18、次场12。逐输入隔离仍有此源内差异；不能覆盖共享定义或改Runtime ID。普通skill实体保首次定义18；第二场ETaged encounter显式保存：

```json
{"actionOverrides":[{"actionId":"pressure_strike","fields":{"magnitude":12},"remove":[]}]}
```

`actionOverrides[]` 各项仅 actionId/fields/remove，actionId必须是已有skill并在同encounter内唯一。fields为严格typed对象，允许字段按实际CombatActionConfig共13字段**排除id后12项**：displayName/effectKind/magnitude/mpCost/baseWait/statusId/statusKind/statusMagnitude/statusDuration/targetMode/isMagic/damageType。不发明第13个可覆盖字段，也不整对象替换。类型/范围/目录仍按核心及skill schema；optional Runtime字符串可保其合法null/空值，不能把数字null当0。

每个字段恰三态：

1. fields无该键且remove无该名：继承当前共享定义；不是恢复原sourceRaw值。
2. fields有该键：固定本场typed值，包括0/false/空串；优先于共享同字段改动。
3. remove含该名：输出Runtime动作中省略此字段，让同一核心处理缺省；**不同于继承共享值**。不允许fields/remove同时含同名、remove重复或含id。必需核心字段删除导致核心无效时422。

先按共享skill的实际变更字段投影，再应用本场fields/remove；首次导入还记录这些局部差异的baseline。删除原本本场固定字段（回到三态1）时，必须明确用当前共享字段重置该Runtime字段，不能sourceRaw压回旧12。共享18→20使第一场20、第二场保持12；本场12→14只改该场；删掉第二场magnitude固定值后实际20，保存重读保持，再设本场值以最后有效状态为准。原始0/false/presence差异按typed fields/remove承载，不用truthy判定。

导入前已存在库是C3边界：对新来源输入的每个同ID定义分别与**导入前**现有skill做ActionDefinitionsEquivalent；任何不等整笔拒绝。只有同一次输入内部的来源场差异可显式进入该场override，不能把外部非等价偷偷改成本地variant。首次绑定baselineJson永久保留；复用时记录实际复用Helper对象，save不重置baseline，intent同path最后op有效。

已知source/hash重导入先读取既有binding与当前实体/本场override，实际解析每场定义核对原输入：未改18base+12local仍等价则no-op，保全部baseline/intent/notes；任何真实不等拒绝且全目录不写。不仅凭hash跳过当前定义检查，也不把合法已有local12错误拿去与global18当新冲突。

assemble/run/character preview增加 `resolvedActions:[{encounterIndex,encounterId,actionId,shared:ActionConfig,local:{fields,remove},effective:ActionConfig,sourceName}]`。界面把“共享定义 / 第n场来源覆盖 / 实际值”明确显示；编辑共享skill影响未固定字段，编辑encounter.actionOverrides仅该场，移除本场字段是继承而非清空/省略。三处都从同一解析器取effective动作；shared/effective 显示对象经公开 NormalizeActionDefinition 填同一核心缺省（含无来源的新角色预览），不因此改写实际 Runtime 配置或来源 presence。技能读法在场上下文使用effective配置。

指令完整数组、slots/encounters增删重排是明确修改，按稳定entityId/unitId/instructionId重定位或整数组替换，不能对旧sourcePointer数组下标盲写。sourcePointer仅用于首次来源绑定，不取代当前实体身份。场景maxEvents/maxWait允许0走核心fallback；显式调用预算/runBudget/linked根预算必须正，0不作missing。

导入单场明确增加到两场或以上时，当前 runtime kind 转为 expedition，原 provenance.sourceKind 仍为 scenario。首场保原 Runtime ID/头/字段及原序，新增场按现有新建模板；外层采用现有新建 expedition 包装（id=trialId、title/parameterNotice/carryTeam 取当前 trial），未覆盖调用预算由现有核心10000/100000解释。原场景字段不得泄到外层。导入 linked 删到一场仍保 linked 包装和原根来源语义；不因当前数量擅自丢失来源层。
