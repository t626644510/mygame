# P2 施工单：战斗编辑器

日期：2026-11-15。上级文档：[EDITOR_PLAN.md](EDITOR_PLAN.md)。前置：P0 全部通过（含 P0-B `CompareScenarios`）；P1 的外壳、ETag、ID 池、需求单面板已交付。界面参照 [editor-plan-wireframes.html](editor-plan-wireframes.html) 的线框 1、2。

> 本单在 P0 交付前写成，sim-cli 接口以 P0 实际交付为准。P0 验收后由辅助架构复核本单，有出入的地方先改本单再开工。

## 1. 目标

User 能在编辑器里完成以下工作：

- 建技能。
- 建角色模板：六维、白名单、指令。
- 建遭遇：敌方站位。
- 在试炼场组队开打。
- 改一条指令后，立刻看到和改之前那一版的第一处行动分歧。
- 导出角色 JSON，或导出成现有 Unity 原型能直接加载的战例。

所有合法性判断和战斗结果都来自 C# 核心，编辑器不自己算。

## 2. 范围

**做：**

- 技能、角色、遭遇、试炼四类实体。
- 战斗规则参数文件。
- 组装器：实体 → `CombatScenario` / `CombatExpeditionConfig`。
- 旧战例导入：`CombatScenario` → 实体。
- 角色指令校验接口。
- 试炼场：单场和连续场次。
- 对比、日志、时间轴。
- 两种导出。

**不做：**

- 六维 → HP / MP / 敏捷系数公式。等战斗专项交付，见 [SPECIALIST_REQUESTS.md](SPECIALIST_REQUESTS.md) R1。
- 全局技能库进入运行时（R2）。本期由组装器把技能拷进战例。
- 装备强化等级参与组装。本期只取装备的基础 `combatBonus`。
- 改动任何 Runtime 行为或旧配置。本期唯一源码例外为下述联场只读日志观察接口；不改变结算、旧 DTO 或旧报告。

## 3. 分工与文件负责人

| 子任务 | 负责 | 允许写入 |
| --- | --- | --- |
| P2-A sim-cli 增量、导入旧战例产生的内容 | 工程 Agent | `tools/sim-cli/**`、`content/{skills,characters,encounters,trials,rules}/**`、`docs/editor/schemas/**` |
| P2-B 战斗模块界面 | 前端 Agent | `tools/editor-web/**` |
| P2-C 原会话联场日志观察 | 战斗 owner（根指定） | 仅 `Combat/Runtime/CombatExpedition.cs` 的私有原文缓存/只读 `ExportEncounterLogText(int encounterIndex)`，新增 `Combat/Tests/EditMode/CombatExpeditionLogTests.cs` 及其 `.meta`；工程仅消费接口，不并写 |

## 4. 数据格式

所有实体一实体一文件，文件名等于 `id`，所有 `id` 进入 P1 的全局 ID 池。

### 4.1 技能 `content/skills/<id>.json`

字段名与 `CombatActionConfig` 完全一致，便于组装器直接拷贝；另外加几个只给编辑器用的字段。

```json
{
  "schemaVersion": 1,
  "id": "mage_firebolt",
  "displayName": "火弹",
  "effectKind": "damage",
  "magnitude": 28,
  "mpCost": 8,
  "baseWait": 40,
  "statusId": "",
  "statusKind": "",
  "statusMagnitude": 0,
  "statusDuration": 0,
  "targetMode": "single",
  "isMagic": true,
  "damageType": "magic",
  "description": "",
  "classTags": ["mage"],
  "draft": false
}
```

- 只给编辑器用的字段：`schemaVersion`、`description`、`classTags`、`draft`。组装时去掉。
- `effectKind`、`statusKind`、`targetMode`、`damageType` 必须在 catalog 里。
- 未实现的效果写 `effectKind: "pending"`。此时必须 `draft: true`，并且存在 `target` 为 `skill:<id>` 的需求单。
- 旧 ID（`mage_*`、`tactics_*` 等）原样保留，不加前缀。新技能建议 `<职业>_<名>`，同样必须符合全局 ID 正则。

### 4.2 角色模板 `content/characters/<id>.json`

格式见 [EDITOR_PLAN.md](EDITOR_PLAN.md#战斗编辑器p2)，补充规则：

- `attributes` 固定六项，顺序为 `strength constitution intelligence spirit agility focus`，整数 0–999。
- 目前只有 `intelligence` 进入战斗。
- `combatOverride` 的 `maxHp`、`maxMp`、`agilityFactor` 必填。
- `instructions[]` 原样使用 `CombatInstruction`，指令 `id` 在角色内唯一。
- `availableActionIds` 中的技能必须存在。草稿技能允许出现在白名单里，但包含它的角色进不了试跑（见 4.6）。
- `defaultEquipment[]` 为 `{slot, itemId}`，`itemId` 必须是 P1 物品表中 `category=equipment` 的物品。

### 4.3 遭遇 `content/encounters/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "enc_goblin_patrol",
  "name": "哥布林巡逻队",
  "description": "",
  "enemies": [
    {"unitId": "goblin_a", "characterId": "chr_goblin_scout", "name": "",
     "row": 0, "column": 1, "hp": -1, "mp": -1, "initialReadyTime": 0,
     "vulnerable": false, "statuses": [],
     "equipmentDamageBonus": -1, "equipmentSourceId": ""}
  ],
  "experiencePool": 0,
  "publicCash": 0,
  "publicDrops": [{"itemId": "expedition_ore", "quantity": 2}],
  "draft": false
}
```

站位槽（`enemies[]`，以及试炼里的 `allies[]`）共用同一结构：

- `hp`、`mp` 填 -1 表示满值。
- `name` 为空时用角色名。
- `equipmentDamageBonus` 填 -1、`equipmentSourceId` 为空时，由装备推导。
- `statuses[]` 原样使用 `CombatStatusConfig`。
- `publicDrops[].itemId` 必须在物品表里（按 id 或 alias 查）。

### 4.4 试炼 `content/trials/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "trial_mage_vs_goblins",
  "title": "法师对哥布林巡逻",
  "parameterNotice": "编辑器组装的试玩配置。",
  "seed": 0,
  "playerTeam": "friendly",
  "allies": [ /* 站位槽，同 4.3 */ ],
  "encounters": [{"encounterId": "enc_goblin_patrol", "waitBefore": 0}],
  "carryTeam": "friendly",
  "draft": false
}
```

- `encounters` 只有 1 项时组装为 `CombatScenario`；多于 1 项时组装为 `CombatExpeditionConfig`。
- 多场时，第一场的 `waitBefore` 必须为 0。

### 4.5 规则参数 `content/rules/rules_combat.json`

```json
{
  "schemaVersion": 1,
  "id": "rules_combat",
  "maxUnitsPerTeam": 6,
  "gridRows": 3,
  "gridColumns": 3,
  "alliesIncludeSelf": true,
  "maxEvents": 3000,
  "maxWait": 20000,
  "capacity": {"baseSlots": 1, "slotsPerIntelligence": 0.1, "minimumSlots": 1,
               "maximumSlots": 6, "secondConditionAtIntelligence": 20,
               "thirdConditionAtIntelligence": 40}
}
```

- 初值取 `round4_mage_library.json`。
- 本期界面只读展示，修改直接改文件。

### 4.6 组装规则（确定性，必须写进 sim-cli 的 README）

1. `units[]` 顺序：先 `allies[]` 按试炼顺序，再 `enemies[]` 按遭遇顺序。同刻行动按这个顺序处理，所以顺序本身会影响结果。
2. `team`：
   - 友方为试炼的 `playerTeam`，敌方固定为 `enemy`。
   - 导入旧战例时，保留原 team 字符串：写入站位槽的扩展字段 `team`，空字符串表示按上面的默认规则。
3. 单位字段的来源：

   | 字段 | 来源 |
   | --- | --- |
   | `intelligence` | `attributes.intelligence` |
   | `maxHp` / `maxMp` / `agilityFactor` | `combatOverride` |
   | `hp` / `mp` | 站位槽；-1 时取满值 |
   | `instructions` / `availableActionIds` / `tags` | 角色模板 |
   | `availableActionIdsExplicit` | 固定 `true` |
   | `equipmentDamageBonus` | 站位槽值 ≥ 0 时用站位槽值；否则为全部 `defaultEquipment` 中 `equipmentDamageBonus` 加成之和 |
   | `equipmentSourceId` | 站位槽非空时用站位槽值；否则用第一件 weapon 的 `itemId`；没有 weapon 时为空 |

4. `actions[]`：所有单位白名单与指令引用到的技能的并集，按 `id` 排序，去掉编辑器字段。引用到 `draft` 技能或不存在的技能时，组装失败，错误信息写明技能 ID 和引用它的角色。
5. 场景级字段：
   - `id`、`title`、`parameterNotice`、`seed` 取自试炼。
   - `randomUsed` 固定 `false`。
   - 其余取自 `rules_combat.json`。
6. 校验：每队人数不超过上限；同队格子不重复；行列在范围内；`unitId` 全场唯一。

### 4.7 旧战例导入

命令：`import-scenario <file> [--prefix p]` 和 `import-expedition <file>`。

- 每个单位 → 一个角色模板，ID 为 `chr_<p>_<unitId>`。`p` 默认取战例 id，把非法字符换成 `_`。
  - `combatOverride` 取单位的 `maxHp`、`maxMp`、`agilityFactor`。
  - `intelligence` 取单位值，其余五项填 0。
- 单位的当前 HP / MP、`initialReadyTime`、`vulnerable`、`statuses`、`equipmentDamageBonus`、`equipmentSourceId`、`team`、`name` 写进站位槽，保证往返一致。
- `actions[]` → 技能文件。已存在同 ID 技能时，用 `CombatSession.ActionDefinitionsEquivalent` 判断：
  - 相同则复用。
  - 不同则报错并停止，不覆盖。
- 敌方单位 → 遭遇；友方 → 试炼的 `allies`。
- 出征：
  - 每场 → 一个遭遇。
  - 场次的 `waitBefore`、`experiencePool`、`publicCash`、`publicDrops` 写入试炼和遭遇。
  - 每场战例里的友方配置应当一致，不一致时报错。
- 导入的实体全部带一条 `kind=note` 的备注，写明来源文件。

## 5. P2-A：sim-cli 增量

| 命令 / 接口 | 作用 |
| --- | --- |
| `assemble <trialId>` / `POST /api/assemble` | body 可以是试炼 ID，也可以是未保存的试炼、角色、技能覆盖集 `{trial, overrides:{characters:[], skills:[], encounters:[]}}`；返回组装好的 JSON，或返回错误列表 |
| `POST /api/character/validate` | body `{character, overrides}`：sim-cli 把该角色和一个内置假人（满血、无指令）组成 1 对 1 战例，返回该角色的 `instructionCapacity`、`conditionTermCapacity` 和逐条 `{capacityAllowed, actionAvailable, validationReason, display}`，全部取自 `CombatSession.GetSnapshot()`。字段语义沿用 C#：例如 MP 不足不算不可用 |
| `POST /api/trial/run` | body 同 assemble；单场返回 `CombatRunResult`，多场返回 `CombatExpeditionReport`；另附 `logText`。多场保留同一次 `CombatExpeditionSession`，按已执行 report.encounterIndex（从1起）调用只读 `ExportEncounterLogText` 取原内部会话原文；不重跑、不反射、不仿写日志 |
| `POST /api/trial/compare` | body `{baseline, variant}`，两者都是 assemble 的 body；内部组装后调用 `CompareScenarios`。多场时只比较第一场，并在返回里注明 |
| `import-scenario` / `import-expedition` | 见 4.7 |
| `refs <id>` | 扩展到技能、角色、遭遇：技能被谁的白名单 / 指令引用、角色被哪些试炼 / 遭遇引用，旧战例只读扫描 |
| `export` | 增加 `skills.json`、`characters.json`、`encounters.json`，规则同 P1。`trials` 不导出，属于编辑器内的试玩配置 |
| `export-scenario <trialId> --out f` | 把组装结果写成独立战例文件，供 Unity 原型加载 |

## 6. P2-B：界面

模块“战斗”启用，分四个子页：技能、角色、遭遇、试炼场。左侧列表区（240px）按子页切换。

### 6.1 技能页

- 表单按 `effectKind` 显示对应字段：
  - 施加状态时，才出现状态 ID、类别、强度、持续时间。
  - 伤害类时，才出现伤害类型。
- 所有选项来自 catalog。效果类型最后一项为“其他（未实现）”：
  - 选中后，效果字段显示紫色虚线。
  - 必须先建需求单才能保存，技能自动变为 draft。
- 右侧“读出来是这样”：用一句话描述配置。
  - 示例：“消耗 8 MP，占用 40 WAIT，对 1 名目标造成 28 点魔法伤害。被沉默时不能使用。”
  - 句式模板按 effectKind × targetMode 写在 `src/features/combat/skillSentence.ts`，只做描述，不做任何判定。
- “谁在用”：来自 `refs`。

### 6.2 角色页

**属性卡**

- 六维数值输入框。目前只有智力影响战斗，其余五项显示虚线边框和提示“尚未接入战斗”。
- `combatOverride` 三项旁标注“手填 · 等公式”。
- 指令槽进度条显示“已用 / 容量 · 条件项上限”，数值来自 `/api/character/validate`。
- 悬停容量时提示解锁规则，例如“智力 20 解锁第 2 项条件，40 解锁第 3 项”。文案读 `rules_combat.json`。

**白名单**

- 侧边可折叠面板，按 `classTags` 分组列出全部技能，复选。
- 草稿技能显示紫色虚线。

**指令列表（核心组件 `RuleList`，P4 行为档案会复用，接口要通用）**

- 每行：拖拽柄（dnd-kit）、序号、句子、状态标签、更多菜单（复制、删除、加备注）。
- 句子：“当 [条件组] 对 [范围] 按 [选择方式] → [技能]”。四个部分都是可点击的标记，颜色区分：
  - 条件蓝、范围和选择方式绿、技能琥珀。
  - 目录外的内容用紫色虚线。
- 点任一标记弹出浮层：
  - 可搜索列表，按 `category` 分组，每项显示 label，悬停显示 `description`。
  - 需要阈值的条件，在浮层底部直接输入阈值。
- 阈值按 `thresholdUnit` 显示：
  - `ratio`：显示 0–100%，存 0–1。
  - `row`：显示前 / 中 / 后排，存 0 / 1 / 2。
  - `count`、`wait`、`points`：显示原单位，`integerThreshold` 时禁止小数。
  - 需要 value 的条件，按 `valueHint` 给输入框；值是状态类别时，用 `statusKinds` 下拉。
- 条件组浮层：
  - 每项条件有“自身 / 目标”切换（`subject`）。
  - 2 项时显示一个且 / 或开关（存为 `operation` all / any）。
  - 3 项时显示两个运算符和括号位置切换：括号直接画在句子里，存为 `operation=mixed`、`operators`、`grouping` left / right。
  - 添加条件按钮在达到上限时禁用，并显示原因。
- 超出指令槽的行：
  - 在第一条超容量行上方画一条分隔线，文字“以下超出指令槽（智力 40 → 5 条）”。
  - 超容量行用虚线、50% 透明，仍可拖回上面。
- 每次改动后防抖 300ms 调 `/api/character/validate`，用返回的 `validationReason` 原文显示在行尾标签的悬停提示里。
- 句子用 catalog 的 label 拼出；C# 的 `display` 原文显示在行展开区，两者都可见。

### 6.3 遭遇页

- 3×3 站位网格：行 = 前 / 中 / 后排，列 0–2，可从左侧角色列表拖入格子。
- 同格占用和超人数直接拒绝放置，提示原因。
- 选中格子后，右侧面板编辑站位槽字段，可覆盖 HP、MP、初始 WAIT、状态等。
- 掉落表：物品选择器 + 数量。

### 6.4 试炼场

参照线框 1 右栏，但这里是整页布局：

- 左栏：
  - 友方 3×3 网格，从角色列表拖入。
  - 遭遇选择，支持添加多场，每场填 `waitBefore`。
  - 运行按钮。
- 中栏：
  - 结局卡：结果、结束 WAIT、行动数、停止原因。
  - 时间轴：横轴 WAIT，每个单位一条泳道，事件点按状态着色（行动 / 跳过 / 状态到期），点击选中。
  - 下方是步骤列表。
- 右栏：选中步骤的详情。
  - 本次行动的 `attempts[]` 逐条列出：哪条指令、通过还是跳过、`reason` 原文。
  - 展开可看每个候选的 `passesCondition`、`eligible`、`reason`。
  - “跳到这条指令”按钮切到角色页并高亮该行。
- 单步：一次运行拿到全部步骤，单步按钮在本地逐条显示，不重复请求。
- 对比：
  - 当试炼涉及的任一角色、技能或遭遇有未保存修改时，顶部出现“与已保存版本对比”按钮。
  - 已保存版本取磁盘内容，当前版本取内存。
  - 结果卡显示第一处分歧（WAIT、序号、双方动作描述）和两边结局。
  - 点击分歧，步骤列表定位到该步。
- 导出：顶栏两个按钮。
  - “导出角色 JSON”：当前角色模板原文，另存到用户选择的位置，用浏览器下载。
  - “导出为战例”：调用 `export-scenario`，写入 `content/_exports/<trialId>.json`，并显示路径。

## 7. 验收标准

执行方写入 `docs/editor/P2_VERIFICATION.md`，首次失败保留。

| # | 项 | 通过条件 |
| --- | --- | --- |
| C1 | 单场往返 | 17 份单场战例（`default.json`、`round2_*`、`round3_*`、`round4_*`，不含出征）逐个 `import-scenario` → `assemble` → 运行：`ExportLogText()` 与直接运行原文件完全相同 |
| C2 | 出征往返 | `round2_expedition.json`、`round4_expedition.json` 经 `import-expedition` → 组装 → 运行：双方逐场日志分别从本次真实 expedition 的 `ExportEncounterLogText` 缓存直取并相同；新增观察接口须证明重复读取/逐场与批量调度不影响报告、carry、预算、奖励和旧报文。未执行场读取明确异常，不返回假空日志 |
| C3 | 技能复用 | 先导入 `round4_mage_library.json`，再导入 `round4_area.json`：同 ID 且等价的技能被复用，不产生重复文件；人为改动一个技能后再导入，导入报错且不覆盖 |
| C4 | 改序对比 | 在导入的 `round2_ambush` 试炼里，于界面中把 mage 第 2 条指令拖到第 1 条：对比卡显示的第一处分歧与 `ComparePriority(round2_ambush)` 的 `firstDivergence` 一致（序号、双方 actionId、targetId、WAIT） |
| C5 | 容量提示 | 把导入的 `round4_mage_library` 法师智力改为 10：超容量分隔线出现在第 2 条之后；各行提示文字与直接调用 `CombatSession.GetSnapshot()` 的 `validationReason` 完全相同 |
| C6 | 条件编辑 | 在界面里分别建出 `(A 且 B) 或 C` 与 `A 且 (B 或 C)` 两条指令，保存的 JSON 为 `operation=mixed`、`operators=["and","or"]`，`grouping` 分别为 left 和 right；`/api/character/validate` 均返回合法 |
| C7 | 阈值单位 | “HP 比例 ≤ 35%”存为 0.35；“位于后排”存为 2；整数阈值输入 2.5 被拒绝 |
| C8 | 待实现流转 | 新建“其他（未实现）”技能：不建需求单无法保存；建了之后技能为 draft；把它加入某角色白名单后，试炼运行报错并写明技能 ID 和角色；`REQUESTS.md` 的 combat 分组出现该需求；export 产物中没有该技能 |
| C9 | 技能读法 | 导出 27 个法师技能的“读出来是这样”句子到 `docs/editor/P2_SKILL_SENTENCES.md`，由辅助架构逐条核对 |
| C10 | 站位 | 遭遇页同格放置被拒；第 7 个敌人被拒（上限读规则文件） |
| C11 | 日志联动 | 点任一步骤能看到全部 attempts 与 reason 原文；“跳到这条指令”能定位到角色页对应行 |
| C12 | 截图 | 1280×800、1920×1080，亮 / 暗主题：角色页（含超容量行和三项条件指令）、试炼场（运行后，显示对比卡），共 8 张 |
| C13 | 响应 | 本机运行 `round4_mage_library` 试炼，从点击运行到结果渲染完成 < 1 秒；记录实测时间 |
| C14 | 构建 | 前端 build / lint 通过；sim-cli 构建 0 警告；两份 README 更新 |

## 8. 交付时回报

格式同 P0 第 8 节，逐条写 C1–C14 的结果。
