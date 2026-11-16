# P1 施工单：编辑器外壳 + 物品编辑器

日期：2026-11-15。上级文档：[EDITOR_PLAN.md](EDITOR_PLAN.md)。前置：[P0](P0_WORK_ORDER.md) 的 A1–A5、A9、A10 通过（A6 不阻塞）。验收由辅助架构按第 8 节逐条进行。

## 1. 目标

做出网页编辑器的外壳和第一个可用模块“物品”。User 可以在里面登记全部物品，物品有唯一 ID；能看到每个物品被哪里引用；能挂备注和需求；最后导出成 Unity 能读的运行时 JSON。外壳上的通用件（布局、实体列表、详情面板、备注、校验面板、离线提示、冲突处理）要能被 P2、P3 直接复用。

## 2. 范围

**做：**

- `tools/editor-web` 工程和外壳。
- 物品编辑器：表格、详情、新建、粘贴批量建、删除、备注 / 需求。
- sim-cli 增量：
  - 物品 schema 与校验
  - ID 查询
  - 引用反查
  - 旧配置扫描
  - ETag 冲突控制
  - `export`
- 把现有 5 种物品录入 `content/items/`。

**不做：**

- ID 迁移（改 ID 并改写全部引用），P2 之后再做。
- 战斗、地图、生产模块界面。外壳里显示为禁用，标注“P2”“P3”。
- 消耗品的具体效果。现在一律走“待实现 + 需求”。
- 修改任何旧配置（`Game/Assets/StreamingAssets/Prototype/**`）。

## 3. 分工与文件负责人

| 子任务 | 负责 | 允许写入 |
| --- | --- | --- |
| P1-A sim-cli 增量、物品数据录入 | 工程 Agent | `tools/sim-cli/**`、`content/items/**`、`content/_requests/**`、`docs/editor/schemas/**`、`Game/Assets/StreamingAssets/Content/**`（只经 export 写入） |
| P1-B 编辑器外壳与物品界面 | 前端 Agent | `tools/editor-web/**` |
| P1-C Unity 读取导出物检查 | 工程会话（Windows） | 沿用 P0-C 的 `Game/Assets/Prototype/Editor/SimCliRoundTrip/**` |

## 4. 已知事实（录入和校验时必须处理）

- 同一种矿料有两种写法：
  - 战斗出征配置用 `expedition_ore`（4 处）。
  - 基地 `preparation.json` 用 `expedition-ore`。
  - 两者靠 `Expedition/default.json` 的 `itemMappings` 桥接。
- 基地的淬火砂是 `quenching-sand`。
- 首餐的粮食和简餐在 `BaseEconomy/default.json` 里没有物品 ID，只有价格字段：`grainUnitPrice` 6、`mealUnitPrice` 10。
- 巡卫短剑：
  - `guard-linen-sword-001` 是**实例** ID（字段 `weaponInstanceId`），不是物品定义。
  - 名称来自 `weaponName`。
  - 强化：`oreRequired` 3、`auxiliaryRequired` 2、`enhancementAttackBonus` 4。
- 战斗配置里有 3 个装备来源标签：`training_weapon`、`round3_training_weapon`、`round4_training_weapon`。它们是测试标签，P1 不登记，只在扫描报告里列为“未登记”。

**ID 规则补充（本期定死）：**

- 注册表里的 `id` 必须符合 `^[a-z][a-z0-9_]*$`。
- 旧配置里带连字符的写法记入 `aliases`。校验和引用反查时，`id` 与 `aliases` 视为同一物品。
- 所有 `id` 和 `aliases` 合在一起全局唯一。

## 5. 物品数据格式

一实体一文件：`content/items/<id>.json`，文件名必须与 `id` 相同。

```json
{
  "schemaVersion": 1,
  "id": "eq_patrol_sword",
  "aliases": [],
  "name": "巡卫短剑",
  "category": "equipment",
  "description": "公营战士配发的短剑。",
  "icon": "",
  "stackLimit": 1,
  "baseValue": 40,
  "tags": ["weapon", "public_issue"],
  "equipment": {
    "slot": "weapon",
    "combatBonus": [{"id": "equipmentDamageBonus", "value": 0}],
    "enhancement": [
      {"level": 1, "cash": 0, "attackBonusDelta": 4,
       "materials": [{"itemId": "expedition_ore", "quantity": 3},
                     {"itemId": "quenching_sand", "quantity": 2}]}
    ]
  },
  "consumable": {"effects": []},
  "draft": false
}
```

| 字段 | 规则 |
| --- | --- |
| `category` | `material` `equipment` `consumable` `currency` `key` |
| `stackLimit` | 整数 ≥ 1；`equipment` 必须为 1 |
| `baseValue` | 整数 ≥ 0。参考价，只用于 P3 的增值分析，不是游戏内售价 |
| `equipment` / `consumable` | 结构始终存在（JsonUtility 不允许 null）。非本类型时写成空默认值：`slot: ""`、空数组 |
| `equipment.slot` | `weapon` `armor` `accessory` |
| `equipment.combatBonus[].id` | 必须出现在 `catalog.combatBonusFields`（目前只有 `equipmentDamageBonus`）；否则该物品必须 `draft: true` 且有指向它的需求单 |
| `equipment.enhancement` | `level` 从 1 起连续递增；`materials[].itemId` 必须存在（按 id 或 alias），`quantity ≥ 1` |
| `consumable.effects[]` | `{ "kind": string, "note": string }`。目前没有任何已实现效果，非空即要求 `draft: true` + 需求单 |
| `draft` | true 时不进入 export |

需要录入的 5 种物品：

| id | aliases | 名称 | category | baseValue | 依据 |
| --- | --- | --- | --- | ---: | --- |
| `expedition_ore` | `expedition-ore` | 出征矿料 | material | 4 | 出征掉落、强化消耗 |
| `quenching_sand` | `quenching-sand` | 淬火砂 | material | 6 | `auxiliaryUnitPrice` 6 |
| `mat_grain` | — | 粮食 | material | 6 | `grainUnitPrice` 6 |
| `con_simple_meal` | — | 简餐 | consumable | 10 | `mealUnitPrice` 10 |
| `eq_patrol_sword` | — | 巡卫短剑 | equipment | 40 | 强化表照第 4 节 |

`expedition_ore` 的参考价 4 和巡卫短剑的 40 是占位值，在 description 里注明“参考价待定”。

## 6. P1-A：sim-cli 增量

### 6.1 校验 `validate --content`

在 P0 的基础上增加：

- 物品 schema 与第 5 节规则。
- `id` 与文件名一致。
- `id` 加 `aliases` 全局唯一。这一条跨所有实体类型，后续 P2、P3 的实体也纳入同一个 ID 池。
- `_requests` 的 `target` 为 `item:<id>` 时，目标必须存在（按 id 或 alias）。

### 6.2 新命令与接口

| 命令 / 接口 | 作用 |
| --- | --- |
| `GET /api/ids/{id}` | `{exists, type, canonicalId, path, viaAlias}`，给编辑器做“ID 是否可用”的实时检查 |
| `refs <id>` / `GET /api/refs/{id}` | 列出全部引用：`[{sourceType, sourceId, path, jsonPointer, quantity, legacy}]`。来源包括 `content/` 下实体，以及对旧配置 `Game/Assets/StreamingAssets/Prototype/**` 的只读扫描。旧配置扫描的字段固定为：`itemId` `oreItemId` `auxiliaryItemId` `combatItemId` `preparationItemId` `equipmentSourceId`；`weaponInstanceId` 视为实例，不计入 |
| `legacy-scan [--out f]` | 输出旧配置中所有物品类 ID 的登记情况：`registered`（命中 id）、`alias`（命中 aliases）、`unregistered`，附出现位置 |
| `export --content content --out Game/Assets/StreamingAssets/Content` | 见 6.4 |
| `DELETE /api/content/item/{id}` | 有引用时返回 409 和引用列表，不删除 |

### 6.3 ETag 冲突控制（所有实体通用）

- `GET /api/content/{type}/{id}` 返回 `ETag`，取值为文件字节的 SHA-256。
- `PUT` 更新时必须带 `If-Match`；新建时必须带 `If-None-Match: *`。不匹配返回 409，body 里带磁盘上的当前内容。
- `PUT` 不允许修改 `id`：路径 id 与 body 的 `id` 不同时返回 422。

### 6.4 export

1. 先跑完整 `validate --content`，有错误就退出码 1，不写任何文件。
2. 写出 `items.json`：`{schemaVersion, items:[...]}`。按 `id` 排序，去掉 `draft: true` 的物品，保留 `aliases`。
3. 写出 `manifest.json`：`{schemaVersion, contentHash, files:[{path, sha256, count}]}`。不写时间。
4. 只写自己清单里的文件。上次 export 产出、这次不再产出的文件要删除。目录里其他文件（包括 Unity 生成的 `.meta`）不动。
5. JSON 写法：对象 + 对象数组，2 空格缩进，UTF-8 无 BOM，LF。
6. 同一份内容连续 export 两次，产物逐字节相同。

### 6.5 Unity 读取（P1-C）

- 在 Windows Unity 上 batchmode 执行：用 `JsonUtility.FromJson` 读 `items.json`，所有字段值与源 JSON 一致。
- 首次 export 后由 Unity 生成新目录的 `.meta`，一起提交。

## 7. P1-B：编辑器外壳与物品界面

### 7.1 技术栈

- Vite + React 18 + TypeScript（strict）
- Tailwind CSS 3 + shadcn/ui，图标 lucide-react，状态 Zustand
- 表格用 TanStack Table：物品会到几百条，需要排序、筛选和虚拟滚动
- 不引入路由库以外的其他 UI 框架
- 路由用 hash：`#/items`、`#/items/<id>`

### 7.2 外壳布局

```
┌ 顶栏 44px：产品名 · 全局 ID 搜索(⌘K) · sim-cli 状态 · 需求单(数量) · 校验状态 ┐
├ 模块栏 56px ┬ 主区（各模块自定） ┬ 详情面板 360px（可收起） ┤
│ 物品        │                    │                          │
│ 战斗 P2     │                    │                          │
│ 地图 P3     │                    │                          │
│ 生产 P3     │                    │                          │
├─────────────┴ 问题面板（可收起，0 / 180px）：校验错误、警告；点击跳到对应实体和字段 ┤
```

- 详情面板停靠在右侧，主区相应变窄，不能浮层遮住表格。窗口宽度 < 1100px 时改为覆盖式抽屉。
- 最小支持宽度 1024px。编辑器是桌面工具，不做手机布局，但 1024px 下不能出现页面级横向滚动。

### 7.3 视觉规范

| 项 | 规定 |
| --- | --- |
| 字体 | 正文 Noto Sans SC；ID、数值、代码 JetBrains Mono，数值列用 `tabular-nums` |
| 字号 | 表格 13px；表单 14px；面板标题 12px 大写字距 0.06em；页面标题 18px |
| 颜色 | 中性色用带一点蓝的灰（shadcn `slate`），强调色蓝 `#2C56C9`（暗色 `#7FA0F5`）。语义色：通过绿、警告琥珀、错误红；“待实现”固定用紫色，并且**一律虚线边框**，保证色弱也能区分 |
| 主题 | 跟随系统亮 / 暗，顶栏可手动切换；两套都要过验收截图 |
| 间距 | 4px 基准；面板内边距 12px；表格行高 32px；表单行间距 12px |
| 圆角 | 输入框和按钮 6px，面板不加圆角和阴影，用 1px 分隔线区分 |
| 动效 | 只用于面板展开收起（150ms），尊重 `prefers-reduced-motion` |

### 7.4 通用状态与交互

| 场景 | 行为 |
| --- | --- |
| sim-cli 未启动或断开 | 5 秒内顶部出现横幅：“本地模拟器未连接”，附一键复制启动命令；编辑内容保留在内存，保存按钮禁用；恢复后横幅自动消失，不需要刷新页面 |
| 加载 | 表格用骨架行，不用整页转圈 |
| 空状态 | 说明这里会出现什么，并给两个入口：“新建物品”“从表格粘贴” |
| 未保存 | 标签和列表行显示圆点；离开当前实体时用页面内对话框确认，不用浏览器 `confirm()` |
| 保存 | ⌘/Ctrl+S；成功后轻提示“已保存”；字段级错误显示在字段下方，用 C# / sim-cli 返回的原文 |
| 冲突（409） | 对话框并排列出“磁盘上的版本”和“我的修改”的字段差异，选“保留我的”或“用磁盘的”，不允许静默覆盖 |
| 全局搜索 ⌘/Ctrl+K | 按 ID、别名、名称搜索所有实体，回车跳转 |
| 键盘 | Esc 关闭对话框和抽屉；Tab 顺序与视觉顺序一致；所有可交互元素有可见焦点框 |

### 7.5 物品模块

**表格（主区）**

- 列：ID、名称、类型、堆叠、参考价、来源、用途、状态。
- 来源和用途显示引用数量，来自 `refs`。
  - 没有来源的材料，来源格标琥珀色“无来源”。
  - 待实现的物品，状态格显示紫色虚线标签。
  - 有别名的物品，ID 下方小字显示别名。
- 顶部是类型分段筛选（带数量）和搜索框。列可以排序。

**详情（右侧面板）**

- ID：
  - 新建时，先选类型，自动带出前缀（`mat_` `eq_` `con_` `cur_` `key_`），再输入其余部分。
  - 实时检查格式和可用性（`/api/ids`）。
  - 首次保存后锁定，显示锁形图标；悬停提示“ID 已锁定，如需更改请联系工程（迁移功能后续提供）”。
- 基本字段：名称、类型、描述、堆叠、参考价、标签（可输入新标签，回车生成）。
- 类型扩展块：
  - 装备：槽位、战斗加成行（字段下拉来自 `catalog.combatBonusFields`，末尾一项“其他（未实现）”）、强化表（行可增删，材料用可搜索的物品选择器）。
  - 消耗品：效果列表。每加一条效果都标“待实现”，并弹出需求单表单。
  - 切换类型时，如果其他扩展块有内容，先用页面内对话框确认会清空。
- 被引用：按来源分组列出，旧配置的条目带“旧配置”标签且只读，可复制路径。
- 删除：
  - 有引用时按钮禁用，悬停显示“被 N 处引用”。
  - 无引用时，删除前用页面内对话框确认。

**备注与需求（详情面板标签页“备注 (n)”）**

- 列出 `target` 为 `item:<id>` 的全部需求单，显示状态标签。
- 新建表单字段：kind、owner、title、body、expected、field。
  - owner 按 kind 给默认值：`new_item_property` → engineering，`balance` → planning，`bug` → engineering，`note` → planning。
- 每个字段标签旁悬停时出现“备注”小图标，点开即预填 `field`。
- 选“其他（未实现）”时强制弹出需求表单。不填写就不能保存，物品自动标 `draft: true`。

**从表格粘贴**

- 对话框里粘贴 TSV 或 CSV。第一行是表头，按名称自动匹配列：ID / 名称 / 类型 / 堆叠 / 参考价 / 标签，可手动改匹配。
- 预览表逐行显示状态：新建 / ID 冲突 / 格式错误，错误原因写清楚。
- 只导入合格的行，结果提示“已导入 8 条，跳过 2 条”，跳过的行可以复制出来修改后重贴。

## 8. 验收标准

执行方写入 `docs/editor/P1_VERIFICATION.md`，首次失败记录保留。

| # | 项 | 通过条件 |
| --- | --- | --- |
| B1 | 数据录入 | 第 5 节 5 种物品存在且通过校验；巡卫短剑强化 1 级 = `expedition_ore` ×3 + `quenching_sand` ×2、攻击 +4，与 `preparation.json` 的 3 / 2 / 4 一致 |
| B2 | 旧配置扫描 | `legacy-scan`：`expedition_ore` 与 `expedition-ore` 都解析到同一物品（后者为 alias）；`quenching-sand` 为 alias；三个 `*training_weapon` 列为 unregistered；`guard-linen-sword-001` 不出现在物品类结果中 |
| B3 | ID 规则 | 以下四种情况在界面和 API（422）都被拒绝：重复 id、与他人 alias 重复、格式不合规、对已有文件 PUT 不同 id |
| B4 | 引用与删除 | `expedition_ore` 的引用包含旧出征配置、`preparation.json` 和巡卫短剑强化表；删除按钮禁用；API DELETE 返回 409 并附引用 |
| B5 | 粘贴 | 粘贴 10 行，其中 1 行 ID 重复、1 行类型非法：导入 8 条，2 条显示原因 |
| B6 | 需求单 | 给 `con_simple_meal` 加“恢复饥饿”效果，被迫创建需求单；物品变为 draft；`REQUESTS.md` 的 engineering 分组出现该条 |
| B7 | export | draft 物品不在 `items.json`；产物中没有 `notes`、`draft` 字段；连续两次 export 的 SHA-256 相同；人为制造一个校验错误后 export 退出码 1，且目标目录文件未变 |
| B8 | Unity 读取 | P1-C：Unity `JsonUtility` 读取 `items.json` 字段全部正确（Windows 执行，可晚于其他项） |
| B9 | 冲突 | 编辑器打开某物品后在磁盘上改同一文件，再在编辑器保存：出现冲突对话框，两种选择都能正确落盘 |
| B10 | 离线 | 关掉 sim-cli：5 秒内出现横幅，已改内容不丢；重启 sim-cli 后横幅消失，保存可用 |
| B11 | 截图 | 1280×800、1920×1080，亮 / 暗主题，共 4 张：物品表 60 行（另造测试数据）+ 打开详情面板；无页面级横向滚动，表格在自身容器内滚动，详情面板不遮挡表格 |
| B12 | 键盘 | ⌘/Ctrl+S、⌘/Ctrl+K、Esc 生效；只用键盘能完成“新建物品并保存” |
| B13 | 构建 | `npm run build` 无 TypeScript 错误；`npm run lint` 无错误；`tools/editor-web/README.md` 写清启动顺序（先 sim-cli serve，再前端 dev） |

B11 的截图由辅助架构做视觉验收，不通过的项会以需求单（kind `bug`，owner `engineering`）退回。

## 9. 交付时回报

格式同 P0 第 8 节：先写需要拍板的事，再写替我们做的决定，最后逐条写 B1–B13 的验证结果。有跳过或失败，不能写“P1 完成”。
