# P3 施工单：地图编辑器 + 配方 + 生产链静态检查

日期：2026-11-15。上级文档：[EDITOR_PLAN.md](EDITOR_PLAN.md)。前置条件：

- P1 外壳与物品表已交付。
- P3-A 寻路由基地专项交付（第 5 节）。P3-B、P3-C 中不依赖寻路的部分可以先做。

界面参照 [editor-plan-wireframes.html](editor-plan-wireframes.html) 的线框 4。

> 本单在 P0 交付前写成，sim-cli 接口以实际交付为准，开工前由辅助架构复核。

## 1. 目标

User 能定义建筑（大小、入口、功能、造价、可做的配方），在格子地图上摆出基地布局。摆放时编辑器实时检查四件事：重叠、越界、入口被堵、不可达，并显示通行距离。User 还能定义配方，看到“物品 → 配方 → 物品”的生产链图，编辑器报出：

- 缺来源的材料
- 没去处的产物
- 循环
- 不赚钱的环节

**重要前提：** 现在的游戏运行时没有通用建筑和配方系统，只有首餐那一个写死的厨房。本期的建筑、配方、布局是**设计数据加静态检查**，不进入游戏运行。界面上要常驻一行说明：“建筑与配方目前只做设计和静态检查，游戏运行时尚未接入。”动态验证（账本推演、沙盘回放）在 P4。

## 2. 范围

**做：**

- 建筑定义、布局、配方三类实体。
- 基地物品来源 / 去处规则文件。
- 寻路接入（P3-A）。
- 布局校验与距离场。
- 生产链分析。
- 首餐布局导入。
- 三个界面：建筑、布局画布、配方与链图。

**不做：**

- 居民、行为档案、账本推演、回放（P4）。
- 分区（住宅区 / 公共区）。数据结构预留，界面不做。
- 修改 `BaseSession` 的行为；首餐与备战两段剧本保持原样。

## 3. 分工与文件负责人

| 子任务 | 负责 | 允许写入 |
| --- | --- | --- |
| P3-A 支持障碍的寻路函数 | 基地专项 Agent | `Game/Assets/Prototype/BaseEconomy/Runtime/` 下**新增**文件；`BaseEconomy/Tests/Editor/` 下新增用例。不改 `BaseSession.cs` |
| P3-B sim-cli 增量、导入内容 | 工程 Agent | `tools/sim-cli/**`、`content/{buildings,recipes,layouts,rules}/**`、`docs/editor/schemas/**` |
| P3-C 界面 | 前端 Agent | `tools/editor-web/**` |

## 4. 数据格式

### 4.1 建筑 `content/buildings/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "bld_kitchen",
  "name": "厨房",
  "description": "",
  "footprint": {"w": 2, "h": 2},
  "walkableFootprint": false,
  "entrance": {"x": 1, "y": 2},
  "function": "workshop",
  "recipeIds": ["rcp_simple_meal"],
  "workSlots": 1,
  "storageSlots": 4,
  "ownership": "both",
  "buildCost": {"cash": 30, "workTicks": 40,
    "materials": [{"itemId": "mat_timber", "quantity": 6}]},
  "draft": false
}
```

| 字段 | 规则 |
| --- | --- |
| `footprint` | `w`、`h` 为 1–16 的整数 |
| `entrance` | 相对占地左上角的格子坐标。`walkableFootprint=false` 时，入口必须在占地**外侧**且与占地正交相邻（例如 2×2 建筑下方正中为 `{1,2}`）；`walkableFootprint=true`（只用于点状设施，如旧首餐厨房）时，入口可以在占地内 |
| `function` | `workshop` `storage` `housing` `shop` `public_service` `decoration`，或 `pending`。`pending` 必须 `draft: true` 并带需求单（kind `new_building_function`，owner `base`） |
| `recipeIds` | 只有 `workshop` 可以非空；配方必须存在 |
| `ownership` | `public` `private` `both` |
| `buildCost.materials[].itemId` | 必须在物品表中 |

### 4.2 配方 `content/recipes/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "rcp_simple_meal",
  "name": "简餐",
  "inputs": [{"itemId": "mat_grain", "quantity": 1}],
  "outputs": [{"itemId": "con_simple_meal", "quantity": 1}],
  "workTicks": 3,
  "workerTags": ["cook"],
  "draft": false
}
```

- `inputs`、`outputs` 中的物品必须存在。
- `outputs` 至少 1 项。
- `workTicks ≥ 1`。
- 配方不写“在哪座建筑做”，由建筑的 `recipeIds` 单向引用。

### 4.3 布局 `content/layouts/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "layout_first_meal_near",
  "name": "首餐·近厨房",
  "width": 10,
  "height": 5,
  "movementTicksPerTile": 1,
  "tiles": [{"x": 4, "y": 0, "kind": "blocked"}],
  "buildings": [
    {"instanceId": "kitchen_01", "buildingId": "bld_legacy_kitchen",
     "x": 3, "y": 2, "rotation": 0, "ownership": "private"}
  ],
  "spawns": [
    {"id": "supplier", "x": 1, "y": 2, "role": "supplier"},
    {"id": "customer", "x": 0, "y": 2, "role": "customer"}
  ],
  "zones": [],
  "draft": false
}
```

- 地图尺寸：`width`、`height` 为 1–256。
- `tiles` 只记录非默认格。默认格为可通行；`kind` 取 `blocked` 或 `water`，两者都不可通行。
- 旋转：`rotation` 取 0 / 90 / 180 / 270，顺时针。旋转后占地的宽高按需交换，入口随之旋转。具体换算写进 sim-cli 的 README，前端和 sim-cli 用同一个算法，并用 D6 的样例对账。
- 归属：实例的 `ownership` 只能是 `public` 或 `private`，并且必须被建筑定义的 `ownership` 允许。
- `zones` 是预留字段，本期始终为空数组。

### 4.4 基地物品流规则 `content/rules/base_item_flows.json`

生产链分析需要知道链外的来源和去处：

```json
{
  "schemaVersion": 1,
  "id": "rules_base_item_flows",
  "sources": [
    {"itemId": "mat_grain", "kind": "resident_sale", "note": "首餐供粮者开局自有"},
    {"itemId": "quenching_sand", "kind": "resident_sale", "note": "备战辅料商许禾"}
  ],
  "sinks": [
    {"itemId": "con_simple_meal", "kind": "resident_need", "note": "顾客消费"}
  ]
}
```

- `sources[].kind`：`starting` `resident_sale` `external_market` `gathering`。
- `sinks[].kind`：`resident_need` `external_sale`。
- 战斗掉落（遭遇的 `publicDrops`、旧出征配置）、强化消耗、建筑造价由 sim-cli 自动计入，不需要写在这里。

## 5. P3-A：寻路（基地专项）

新增纯函数，不引用 UnityEngine：

```csharp
namespace Prototype.BaseEconomy
{
    public static class BasePathfinding
    {
        // blocked: length = width * height, index = y * width + x
        public static GridPosition[] FindPath(int width, int height, bool[] blocked,
                                              GridPosition from, GridPosition to);
        public static int[] DistanceField(int width, int height, bool[] blocked,
                                          GridPosition from); // -1 = unreachable
    }
}
```

要求：

- 四方向、每步代价 1 的最短路。
- 返回的路径包含起点和终点。不可达时返回空数组。
- **确定性的同长度取舍：** 没有障碍时，结果必须与现有 `BaseSession.MoveToward` 的“先走 x 再走 y”逐格相同。有障碍时，同样优先 x 方向；写清楚取舍规则，并用测试固定下来。
- 起点或终点越界、或位于障碍格时，抛 `ArgumentException`。
- 不修改 `BaseSession`：现有首餐与备战测试（44 项）必须继续通过。

## 6. P3-B：sim-cli 增量

| 命令 / 接口 | 作用 |
| --- | --- |
| `validate --content` | 加入第 4 节全部规则，另加布局校验（下表）；配方、建筑造价、物品流规则中的物品引用都按 id 或 alias 检查 |
| `layout-check <layoutId>` / `POST /api/layout/check` | body 可以是未保存的布局；返回 `{errors:[{code, message, instanceId, x, y}], warnings:[]}` |
| `POST /api/layout/distance` | body `{layout, from:{instanceId}|{x,y}}`；返回 `DistanceField` 结果（扁平数组）+ `[{instanceId, tiles, ticks}]` 到各建筑入口和出生点的距离；`ticks = tiles × movementTicksPerTile` |
| `analyze-chain [--out f]` / `GET /api/chain` | 见第 7 节 |
| `import-first-meal` | 从 `BaseEconomy/default.json` 生成 `layout_first_meal_near`、`layout_first_meal_far` 两个布局，和建筑 `bld_legacy_kitchen`（1×1、`walkableFootprint=true`、入口 `{0,0}`、`function=workshop`、`recipeIds=["rcp_simple_meal"]`），并生成配方 `rcp_simple_meal`（`grainPerMeal` → `productionTicks`）。不重复生成已存在的实体 |
| `refs` | 扩展到建筑、配方：建筑被哪些布局使用、配方被哪些建筑引用、物品被哪些配方和造价引用 |
| `export` | 增加 `buildings.json`、`recipes.json`、`layouts.json`、`base_item_flows.json` |

布局校验错误码：

| code | 条件 |
| --- | --- |
| `out_of_bounds` | 占地或入口超出地图 |
| `overlap` | 两个实例占地重叠，或占地压在不可通行格上 |
| `entrance_blocked` | 入口格不可通行，或被其他实例占地覆盖（`walkableFootprint` 的占地视为可通行） |
| `unreachable` | 任一入口或出生点与其他入口 / 出生点不连通。可达性判断调用 `BasePathfinding`，不另写算法 |
| `ownership_not_allowed` | 实例归属不被建筑定义允许 |
| 警告 `far_from_storage` | 工坊入口到最近仓储入口超过 12 格。阈值写在 `base_item_flows.json` 之外的常量里，在 README 注明 |

## 7. 生产链分析

`analyze-chain` 输出：

```json
{
  "items": [{"itemId": "...", "sources": [...], "sinks": [...], "flags": ["no_source"]}],
  "recipes": [{"recipeId": "...", "buildings": ["bld_kitchen"],
               "inputValue": 6, "outputValue": 10, "workTicks": 3,
               "valueAddedPerTick": 1.3333, "flags": []}],
  "cycles": [["rcp_a", "rcp_b"]],
  "graph": {"nodes": [...], "edges": [...]}
}
```

| flag | 条件 |
| --- | --- |
| `no_source` | 物品是某配方的输入、强化材料或建筑造价，但不是任何配方的产出，不是掉落，也不在 `sources` 里 |
| `no_sink` | 物品是某配方的产出，但不是任何配方的输入、强化材料、造价，也不在 `sinks` 里 |
| `no_building` | 配方没有被任何建筑引用 |
| `non_positive_margin` | `valueAddedPerTick ≤ 0`，其中 `valueAddedPerTick = (Σ产出数量×baseValue − Σ投入数量×baseValue) ÷ workTicks` |
| `cycle` | 配方之间形成环（按“A 的产出是 B 的输入”建图，求强连通分量） |

- 数值保留 4 位小数，用 invariant culture。
- `graph` 供前端画图：节点分 `item`、`recipe` 两类，边为 `item → recipe`（投入）和 `recipe → item`（产出），边上带数量。

## 8. P3-C：界面

模块“地图”和“生产”启用。

### 8.1 建筑页（地图模块）

- 表单字段同 4.1。
- 占地编辑器：
  - 一个小网格，拖拽右下角改 `w` / `h`。
  - 点占地外的相邻格设为入口，入口用箭头标记。
  - `walkableFootprint` 勾选后，允许把入口设在占地内。
- 功能下拉最后一项为“其他（未实现）”，流程同 P1、P2 的待实现。
- 配方多选只在 `workshop` 时可用。

### 8.2 布局画布（地图模块，主界面）

**渲染**

- 地形和格线用 Canvas 2D 绘制。
- 建筑、入口、选中框、距离数字用叠加层绘制，SVG 或第二层 Canvas 均可。
- 不引入游戏引擎或画布库。

**视图**

- 滚轮缩放（25%–400%，以指针为中心）。
- 空格加拖动、或中键拖动平移。
- “适配窗口”按钮。

**左侧面板**

- 建筑列表：缩略占地图 + 名称 + 尺寸 + 功能；可搜索。
- 地形笔刷：可通行 / 障碍 / 水，在画布上按住拖动连续涂抹。

**放置**

- 点选建筑后，幽灵占地跟随指针并吸附格子：合法时为绿色，不合法时为红色，并在指针旁显示原因（如“与 kitchen_01 重叠”）。
- 不合法位置仍然允许放下：放下后进入问题面板，export 时被拦截。这样 User 可以先摆后调。
- 快捷键：
  - R：旋转。
  - Shift：连续放置。
  - Esc 或右键：取消。

**编辑**

- 拖动已放置的实例可移动。
- Delete 删除；⌘/Ctrl+Z 撤销、⌘/Ctrl+Shift+Z 重做，至少保留 50 步。

**图层开关**

- 地形、建筑、入口、格线、距离叠加。

**距离叠加**

- 以选中实例的入口为起点，调用 `/api/layout/distance`。
- 格子按通行格数着色：
  - 三段色阶：≤ 4 格、5–8 格、≥ 9 格。
  - 色值与图例写死在组件里，亮暗主题各一套。
- 不可达格画斜纹。

**右侧面板**

- 实例属性：建筑、坐标、旋转、归属。
- 到其他建筑入口和出生点的距离表（格数与 tick）。

**问题面板**

- 列出 `layout-check` 的结果，点击后画布居中定位并闪烁该格。
- 防抖：布局变动后 300ms 调一次 `layout-check`。

### 8.3 配方页与链图（生产模块）

**配方表单**

- 投入和产出用物品选择器 + 数量填写，另填工时、工人标签。
- 右侧只读显示 `analyze-chain` 给出的：投入价值、产出价值、单位工时增值。增值 ≤ 0 时标琥珀色。
- 显示“被哪些建筑使用”。

**链图**

- 用 `@xyflow/react` 渲染、`dagre` 自动布局，从左到右。允许引入这两个依赖。
- 节点：物品画圆角块、配方画方块。
- 有 flag 的节点用红色描边并带角标，悬停显示原因。
- 点节点跳到对应的物品或配方编辑页。
- 顶部筛选：“只看有问题的”“只看与选中物品相关的链”。

**物品流规则**

- 在生产模块里有一个小表格页，编辑 `base_item_flows.json` 的 sources 和 sinks。

## 9. 验收标准

执行方写入 `docs/editor/P3_VERIFICATION.md`，首次失败保留。

| # | 项 | 通过条件 |
| --- | --- | --- |
| D1 | 寻路兼容（P3-A） | 10×5 无障碍地图上，所有起止点对的 `FindPath` 与“先 x 后 y”逐格相同；有障碍的 5 个固定样例结果固定；基地 44 项既有 EditMode 测试继续通过（Windows Unity 实跑） |
| D2 | 首餐导入 | `import-first-meal` 后，在近、远两个布局里：从厨房入口出发到供粮者的距离为 2 / 7 格，到顾客为 3 / 8 格。按基地 README 的公式 `max(2×d(厨,粮)×每格tick + 加工tick, d(客,厨)×每格tick)`，可推出首餐 tick 7 / 17 |
| D3 | 布局校验 | 越界、重叠、入口被堵、不可达、归属不允许各造一例，`layout-check` 全部报出且错误码正确；export 被拦截；界面点击问题能定位到格子 |
| D4 | 生产链 | 在 P1 物品基础上：`rcp_simple_meal` 的 `valueAddedPerTick` 为 1.3333（(10−6)/3）；新建 `mat_moon_silk` 并作为某配方的输入，被标 `no_source`；把一个配方产出改成另一个配方的输入、再反向连回去，被标 `cycle`；未被任何建筑引用的配方标 `no_building` |
| D5 | 旋转 | 3×2（w=3、h=2）、入口在下方正中 `{1,2}` 的建筑顺时针旋转 90°：占地变为 2×3，入口位于左侧正中；前端预览与 sim-cli 校验结果一致；保存的 `rotation` 为 90 |
| D6 | 撤销 | 连续放置、移动、删除共 10 步后，逐步撤销能回到初始布局，再全部重做回到最终布局 |
| D7 | 画布性能 | 128×128 地图、300 个实例、距离叠加打开时，缩放和平移的帧率 ≥ 50 fps（用浏览器性能面板记录，附截图） |
| D8 | export | 产物包含四个新文件，没有 `draft` 实体和备注；两次 export 逐字节相同 |
| D9 | 截图 | 1280×800、1920×1080，亮 / 暗主题：布局画布（打开距离叠加，含一个错误）、链图（含红色问题节点），共 8 张 |
| D10 | 构建 | 前端 build / lint 通过；sim-cli 构建 0 警告；README 更新（包括旋转换算和 `far_from_storage` 阈值） |

## 10. 交付时回报

格式同 P0 第 8 节，逐条写 D1–D10 的结果。
