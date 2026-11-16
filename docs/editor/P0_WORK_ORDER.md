# P0 施工单：sim-cli、内容目录、需求单

日期：2026-11-15。上级文档：[EDITOR_PLAN.md](EDITOR_PLAN.md)。本单交给执行 Agent，验收由辅助架构按第 7 节逐条进行。

## 1. 目标

做出编辑器的底座：一个能脱离 Unity 运行现有战斗核心的命令行 / 本地 HTTP 程序 `sim-cli`，一个内容目录骨架，以及“备注 / 需求单”的数据格式和汇总。P0 结束后，P1 的前端 Agent 可以只靠 `sim-cli serve` 开始做编辑器界面。

## 2. 范围

**做：**

- `tools/sim-cli`：命令 `catalog`、`validate`、`run-combat`、`run-expedition`、`compare`、`requests`、`selftest`、`serve`。
- `content/` 骨架，`content/_requests/` 三条样例需求，生成 `content/REQUESTS.md`。
- 需求单 JSON Schema：`docs/editor/schemas/request.schema.json`。
- 战斗模块新增一个公开对比方法（第 5 节，战斗专项负责）。
- Unity 侧 JSON 往返一致性检查（第 7 节 A6，工程会话在 Windows 执行）。

**不做：**

- 网页编辑器界面、物品 / 技能 / 角色 / 建筑 schema、`export` 命令（都在 P1 及以后）。
- 基地模拟命令（等基地专项的通用模拟）。
- 修改任何现有 `Runtime/*.cs` 的行为、现有 StreamingAssets 配置、场景、Prefab、UnityClient 代码。
- 改动 `docs/context/` 下的项目上下文。

## 3. 分工与文件负责人

| 子任务 | 负责 | 允许写入的路径 |
| --- | --- | --- |
| P0-A sim-cli 与内容骨架 | 工程 Agent | `tools/sim-cli/**`、`content/**`、`docs/editor/schemas/**`、`docs/editor/P0_VERIFICATION.md` |
| P0-B 公开对比方法 | 战斗专项 Agent | 仅在 `Game/Assets/Prototype/Combat/Runtime/CombatSampleRuns.cs` 中新增第 5 节的公开对比方法；在 `Game/Assets/Prototype/Combat/Tests/EditMode/` 下新增对应用例及其 `.meta`，不改现有测试文件 |
| P0-C Unity JSON 往返检查 | 工程会话（Windows + Unity 6000.3.28f1） | 仅新增 `Game/Assets/Prototype/Editor/SimCliRoundTrip/**`（自带 Editor-only asmdef，含新增文件的 `.meta`）及目录对应的 `Game/Assets/Prototype/Editor/SimCliRoundTrip.meta`，不改现有文件 |

P0-A 在 P0-B 合入前，`compare` 命令可以先返回 `501 not implemented`；其余命令不依赖 P0-B。

## 4. 已验证的前提（2026-11-15，辅助架构在 macOS 上做的一次性验证）

- 环境：.NET SDK 10.0.403，单个 net8.0 控制台项目直接 `Compile Include` 四个 Runtime 目录：`Combat`、`Tactics`、`BaseEconomy`、`Expedition`。
- 编译：0 警告、0 错误。
- 目录数量：条件 37、选择方式 24、效果类型 7、状态类别 9、对象范围 3、作用范围 4。
- 用 `System.Text.Json`（`IncludeFields = true`）读入全部配置并 `RunToCompletion()`，结果如下，作为 A4 的对照基线：

| 文件 | 结果 | 结束 WAIT | 实际行动数 |
| --- | --- | ---: | ---: |
| default.json | Victory | 200 | 13 |
| round2_ambush.json | Victory | 40 | 3 |
| round2_capacity.json | Defeat | 185 | 5 |
| round2_equipment.json | Victory | 120 | 5 |
| round2_one_idle.json | Victory | 300 | 11 |
| round2_pressure.json | Victory | 190 | 11 |
| round2_stalemate.json | Stalemate | 35 | 0 |
| round2_time_tie.json | Victory | 40 | 3 |
| round3_focus_mark.json | Victory | 90 | 8 |
| round3_mp_reserve.json | Victory | 240 | 17 |
| round3_tactics.json | Victory | 135 | 10 |
| round4_area.json | Victory | 80 | 7 |
| round4_cleanse.json | Victory | 150 | 9 |
| round4_control.json | Victory | 40 | 4 |
| round4_mage_library.json | Victory | 230 | 19 |
| round4_meditation.json | Victory | 160 | 12 |
| round4_meditation_risk.json | Victory | 0 | 1 |
| round2_expedition.json | 出征 CompletedAllEncounters | — | 2 场 |
| round4_expedition.json | 出征 CompletedAllEncounters | — | 2 场 |

这次验证是把四个模块编进同一个程序集、用默认 C# 版本，比 Unity 宽松。正式工程按 6.1 节拆分后需要重新跑一遍。

## 5. P0-B：战斗模块新增公开对比方法

现有 `CombatSampleRuns` 的对比都是固定场景（交换优先级、改智力、改装备），核心的 `FirstDivergence` 是 private，`RunComparison` 要求“只改了声明项”。编辑器需要对比任意两份配置，因此新增：

```csharp
// CombatSampleRuns.cs
public static CombatComparisonReport CompareScenarios(
    CombatScenario baseline, CombatScenario variant,
    string baselineLabel = "baseline", string variantLabel = "variant",
    string changedSetting = "")
```

要求：

- 分别 `new CombatSession(...)` 后 `RunToCompletion()`，用现有 `FirstDivergence` 和 `Impact` 生成报告。
- 不经过 `RunComparison` 的单变量断言；`onlyDeclaredSettingChanged` 固定为 `false`，含义是“没有核验是否只改了一项”。
- `id` 取 `baseline.id + ":compare"`；`baselineConfiguration` / `variantConfiguration` 用会话的 `GetScenario()` 副本。
- 纯新增：现有方法签名、行为和第二到第四轮全部报告输出都不变。
- 按战斗模块惯例补 EditMode 用例：对 `round2_ambush.json`，用 `CompareScenarios(原配置, 交换 mage 第 1、0 条指令后的配置)` 得到的 `firstDivergence`，与 `ComparePriority(原配置)` 的 `firstDivergence` 序列化后相同。

## 6. P0-A：sim-cli 规格

### 6.1 工程结构

```
tools/sim-cli/
  MyGame.Sim.sln
  src/Prototype.Combat/Prototype.Combat.csproj
  src/Prototype.BaseEconomy/Prototype.BaseEconomy.csproj
  src/Prototype.Tactics/Prototype.Tactics.csproj        引用 Combat
  src/Prototype.Expedition/Prototype.Expedition.csproj  引用 Combat、BaseEconomy
  src/MyGame.Sim.Cli/MyGame.Sim.Cli.csproj              引用以上全部
  README.md
```

- **一个 asmdef 对应一个 csproj**，引用关系与 asmdef 完全一致。这样 Unity 里跨模块访问不到的 internal 成员，在这里也访问不到。
- Runtime 的四个 csproj 用 `<Compile Include="../../../../Game/Assets/Prototype/<模块>/Runtime/**/*.cs" />` 链接源码。**P0-A 禁止复制或改写任何 Runtime 源文件。**
- Runtime 的四个 csproj：`TargetFramework=netstandard2.1`、`LangVersion=9.0`、`Nullable=disable`、`ImplicitUsings=disable`、`TreatWarningsAsErrors=true`。这样 Unity 6 不支持的 API 或语法会在这里先报错。
- CLI 项目：`net8.0`，只依赖 BCL，不引入第三方 NuGet 包。HTTP 用 `System.Net.HttpListener` 或 ASP.NET Core Minimal API 均可，二选一，在 README 说明理由。
- 同时支持 macOS 和 Windows。所有路径用 `Path.Combine`，输出统一用 LF。

### 6.2 JSON 层（`UnityJson`）

- **读取**：`JsonSerializer` 设 `IncludeFields = true`，读入后按 Unity JsonUtility 的语义递归补默认值：
  - `string` 为 null → `""`
  - 数组为 null → 空数组
  - 带 `[Serializable]` 的类字段为 null → `new()`
  - 不补 `availableActionIds` 的 presence 语义，这件事由 Runtime 的 `availableActionIdsExplicit` 自己处理。
- **普通输出**：
  - `IncludeFields = true`、`WriteIndented = true`
  - `Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping`，中文不转义
  - UTF-8 无 BOM、LF、文件末尾一个换行
  - 不写任何墙钟时间
- **selftest**：读和写都必须与 `GenerateRound4Reports.ps1` 完全相同。
  - 读取用裸 `JsonSerializer`，不做上面的补默认值，否则报告里的 `baselineConfiguration` 会和脚本输出不同。
  - 写出用默认 Encoder（中文转义为 `\uXXXX`）、`IncludeFields`、`WriteIndented`，再加一个 `"\n"`。

### 6.3 命令

退出码统一：`0` 成功；`1` 校验失败或内容错误；`2` 用法错误或 IO 错误。错误信息写到 stderr，结果 JSON 写到 stdout 或 `--out` 指定的文件。

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `catalog [--out f]` | 无 | `{schemaVersion, conditions, selectors, scopes, operations, groupings, subjects, effectKinds, statusKinds, targetModes, damageTypes, combatBonusFields}`。前十项是对应 `CombatTacticsCatalog.Get*()` 的原样输出；`combatBonusFields` 目前固定为 `[{"id":"equipmentDamageBonus","label":"装备伤害加值","source":"CombatUnitConfig.equipmentDamageBonus"}]` |
| `validate <scenario.json>` | 战例文件 | `{ok, error, units:[{id, instructionCapacity, conditionTermCapacity, instructions:[{id, display, capacityAllowed, actionAvailable, validationReason}]}]}`。`new CombatSession` 抛出的 `ArgumentException` 原文放进 `error`，`ok=false`，退出码 1；构造成功时字段取自 `GetSnapshot()`，CLI 自己不算容量 |
| `validate --content <dir>` | 内容目录 | P0 只校验 `_requests/`：符合 schema、ID 不重复、`target` 格式正确。输出 `{ok, errors:[{path, code, message}], warnings:[]}` |
| `run-combat <scenario.json> [--max-steps n] [--max-wait w] [--log f]` | 战例 | `CombatRunResult` JSON；`--log` 另存 `ExportLogText()` 原文 |
| `run-expedition <expedition.json>` | 出征配置 | `CombatExpeditionSession.RunToEnd()` 的报告 |
| `compare <baseline.json> <variant.json>` | 两份战例 | `CombatSampleRuns.CompareScenarios(...)` 的报告（依赖 P0-B） |
| `requests [--content dir] [--out f]` | 内容目录 | 生成 `REQUESTS.md`，默认 `content/REQUESTS.md` |
| `requests new --kind k --owner o --target t --title s` | 参数 | 分配下一个 `REQ-NNNN`，写入 `_requests/`，打印新 ID |
| `selftest round4 --out dir` | 无 | 按 `GenerateRound4Reports.ps1` 的同样调用生成 `ROUND4_{MEDITATION,MEDITATION_RISK,AREA,CLEANSE,CONTROL}_REPORT.json/.md` |
| `serve [--port 5178] [--content dir]` | 无 | 本地 HTTP，见 6.5 节 |

### 6.4 需求单

- Schema 写在 `docs/editor/schemas/request.schema.json`，字段见 [EDITOR_PLAN.md](EDITOR_PLAN.md#备注与需求单)。
- 必填：`schemaVersion id kind owner target title status createdAt`。
- `id`：`^REQ-\d{4}$`，文件名与 `id` 一致。
- `owner`：`combat` `base` `engineering` `art` `world` `planning`。
- `target`：`<type>:<id>` 或 `global`。`type` 取 `item skill character encounter building recipe layout scenario` 之一。P0 不校验目标实体是否存在，因为 P0 还没有实体。
- `REQUESTS.md` 格式：
  - 先按 `owner` 分节，节内按 `status` 排序（open、triaged、in_progress 在前，done、rejected 折叠到末尾）。
  - 每条一行：ID、标题、target、kind、status。正文缩进放在下一段。
  - 文件头注明“由 sim-cli 生成，勿手改”。不写生成时间。
- 样例需求固定三条，覆盖三个 owner 和三种 status：
  - `REQ-0001` 咏唱型技能（combat，open）
  - `REQ-0002` 寻路支持障碍格（base，triaged）
  - `REQ-0003` 物品定义与实例分离（engineering，in_progress）

### 6.5 本地 HTTP（给 P1 编辑器用）

- 只监听 `127.0.0.1`。CORS 只放行 `http://localhost:*` 和 `http://127.0.0.1:*`。
- 所有路径参数先规范化，必须落在 `--content` 目录内，否则返回 400。

| 方法 | 路径 | 对应 |
| --- | --- | --- |
| GET | `/api/catalog` | `catalog` |
| POST | `/api/validate` | body 为战例 JSON，对应 `validate` |
| POST | `/api/run-combat` | body 为战例 JSON |
| POST | `/api/run-expedition` | body 为出征 JSON |
| POST | `/api/compare` | body `{baseline, variant}` |
| GET | `/api/content/{type}` | 列出该类型全部实体（`[{id, path}]`） |
| GET / PUT / DELETE | `/api/content/{type}/{id}` | 读 / 写 / 删单个实体文件。PUT 先跑该类型校验，失败返回 422 和错误列表 |
| GET | `/api/requests` | 全部需求单 |
| POST | `/api/requests` | 新建，服务端分配 ID |
| GET | `/api/health` | `{ok, version, contentRoot, gitCommit}`，`gitCommit` 读不到时为空字符串 |

HTTP 返回的 JSON 必须与同名 CLI 命令的输出逐字节一致（同一份序列化代码）。

## 7. 验收标准

执行方把每项的命令、输出摘要和是否通过写进 `docs/editor/P0_VERIFICATION.md`。首次失败也要保留记录，不能只写最终通过。

| # | 项 | 通过条件 |
| --- | --- | --- |
| A1 | 构建 | `dotnet build tools/sim-cli -c Release` 在 macOS 和 Windows 都 0 警告 0 错误；Runtime 项目确为 netstandard2.1 / C# 9 |
| A2 | 不复制、现有行为不变 | `tools/sim-cli` 下没有 Runtime 的 .cs 副本；`git diff main -- Game/` 仅可包含第 3 节明列的 P0-B 与 P0-C 路径及变更：P0-B 新增公开对比方法和对应用例，P0-C 新增独立 Editor 检查，含各自对应的 `.meta`。其余现有 `Game/` 文件不变；现有 Runtime 方法签名、行为和第二到第四轮报告输出保持不变 |
| A3 | 目录一致 | `catalog` 前十项与 `CombatTacticsCatalog.Get*()` 序列化后逐项相同；数量为条件 37、选择方式 24、效果 7、状态 9、对象范围 3、作用范围 4 |
| A4 | 运行结果 | 对 19 份配置跑 `run-combat` / `run-expedition`，结果、结束 WAIT、行动数与第 4 节表格一致；如有不同，先写清原因再判定 |
| A5 | 报告一致 | `selftest round4 --out a/` 与 `pwsh GenerateRound4Reports.ps1 -OutputDirectory b/` 的 10 个 `ROUND4_*_REPORT.{json,md}` 逐文件 SHA-256 相同 |
| A6 | Unity 往返（P0-C） | 对 19 份配置：CLI 读入后写出的文件，与原文件分别用 Unity `JsonUtility.FromJson` 加载并 `RunToCompletion()`，两边 `ExportLogText()` 完全相同。在 Windows Unity 6000.3.28f1 上 batchmode 执行，不启动 Player。A6 不阻塞 P1 开工 |
| A7 | 校验 | ① `round4_mage_library.json` 把 mage 智力改为 10 后跑 `validate`，每条指令的 `capacityAllowed` 和 `validationReason` 与直接调 `CombatSession.GetSnapshot()` 的结果相同；② 两个角色用同一 ID 的配置返回退出码 1，`error` 为 C# 抛出的原文 |
| A8 | 对比 | `compare round2_ambush.json <交换 mage 第 1、0 条后的副本>` 的 `firstDivergence`，与 `ComparePriority(round2_ambush)` 的结果序列化后相同 |
| A9 | 需求单 | 三条样例生成 `REQUESTS.md`，分组和排序正确；故意造三种错误（kind 非法、ID 重复、target 格式错），`validate --content` 全部报出，退出码 1 |
| A10 | HTTP | 只绑定 127.0.0.1；`../` 路径返回 400；PUT 后 GET 内容一致；`/api/catalog` 与 `catalog` 输出逐字节相同 |
| A11 | 确定性 | 同一输入连续跑两次 `run-combat`、`compare`、`requests`，输出逐字节相同；输出里没有墙钟时间 |
| A12 | 文档 | `tools/sim-cli/README.md` 写清 macOS / Windows 的安装、构建、每个命令的示例；`content/README.md` 写清目录约定和 ID 规则（可链接 EDITOR_PLAN） |

## 8. 交付时回报

按以下顺序回报，没有内容的类别省略：

1. 需要 User 或总策划拍板的事。
2. 执行方替我们做的决定，例如 HTTP 实现选型、遇到歧义时的取舍。
3. 已验证、没验证、跳过的项，逐条对应 A1–A12。

任何一项跳过或失败，都不能写“P0 完成”。
