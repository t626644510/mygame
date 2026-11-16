# 内容目录

编辑源独立于 Unity StreamingAssets。一个实体一个 JSON 文件，Git 管理。P1 提供物品 schema、引用扫描、需求关联和确定性 export；其他模块按 [EDITOR_PLAN.md](../docs/editor/EDITOR_PLAN.md) 的阶段推进。

| 目录 | 用途 |
| --- | --- |
| `items/` | 物品定义（个体实例属于运行时） |
| `skills/`、`characters/`、`encounters/` | 技能、角色模板、遭遇 |
| `buildings/`、`recipes/`、`layouts/` | 建筑定义、配方、布局 |
| `scenarios/` | 可选的完整 CombatScenario 调试输入 |
| `_requests/` | 需求单，每个文件为 `REQ-NNNN.json` |
| `REQUESTS.md` | `sim-cli requests` 生成，不手改 |

实体 `id` 使用 `^[a-z][a-z0-9_]*$`，新实体按规划使用 `mat_ eq_ con_ cur_ key_ chr_ bld_ rcp_ enc_` 等前缀。所有实体的 ID 和 aliases 共用唯一池，首次保存后 ID 锁定。旧连字符写法登记在 aliases 中，旧配置保持原样；引用反查将 canonical ID 与 alias 视为同一物品。有引用时不可删除，ID 迁移留待后续工单。

当前五个正式定义为 `expedition_ore`、`quenching_sand`、`mat_grain`、`con_simple_meal`、`eq_patrol_sword`。前两项分别桥接旧 `expedition-ore`、`quenching-sand`；短剑实例 ID 不登记为定义别名，三个 training_weapon 测试标签不登记。参考价 4/40 和 3 矿 + 2 砂、攻击 +4 的强化数据保留其测试来源，不表示正式经济平衡。

需求单遵循 [request.schema.json](../docs/editor/schemas/request.schema.json)。必填字段为 `schemaVersion id kind owner target title status createdAt`；文件名须与 ID 一致，ID 跨文件不重复。`target` 为 `global` 或 `item|skill|character|encounter|building|recipe|layout|scenario:<id-or-alias>`；P1 校验 item 目标必须实际存在。物品与新增关联需求可通过 compound PUT 一起校验并保存。

`createdAt` 空串表示未填写；显式日期采用真实 `yyyy-MM-dd`。程序不读取当前时钟。新需求始终为 `open`；真实分拣权在总策划或 User。三条 `REQ-0001`–`0003` **仅为工单规定的格式样例**，其中 `triaged`、`in_progress` 不代表真实需求已分拣、批准或开工。R1/R2/R3/R5/P4 不因这些样例而授权。

在仓库根运行：

```sh
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll validate --content content
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll refs expedition-ore --content content
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll export --content content --out Game/Assets/StreamingAssets/Content
```

物品规则见 [item.schema.json](../docs/editor/schemas/item.schema.json) 与 [P1_WORK_ORDER.md](../docs/editor/P1_WORK_ORDER.md)。合法 draft 不进入导出，其他有效物品仍可导出；未实现能力必须登记需求，不因样例状态而变成已实现能力。export 先完整校验，失败不写目标文件，成功保留目标目录其他文件与全部 `.meta`。工具安装、全部命令与 HTTP 约定见 [sim-cli README](../tools/sim-cli/README.md)。
