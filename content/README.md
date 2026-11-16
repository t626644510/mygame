# 内容目录（P0 骨架）

编辑源独立于 Unity StreamingAssets。一个实体一个 JSON 文件，Git 管理；P0 仅建立目录及需求单，没有物品、技能、角色、地图等领域 schema，也没有 export。目录和未来格式参考 [EDITOR_PLAN.md](../docs/editor/EDITOR_PLAN.md)。

| 目录 | 用途 |
| --- | --- |
| `items/` | 物品定义（个体实例属于运行时） |
| `skills/`、`characters/`、`encounters/` | 技能、角色模板、遭遇 |
| `buildings/`、`recipes/`、`layouts/` | 建筑定义、配方、布局 |
| `scenarios/` | 可选的完整 CombatScenario 调试输入 |
| `_requests/` | 需求单，每个文件为 `REQ-NNNN.json` |
| `REQUESTS.md` | `sim-cli requests` 生成，不手改 |

实体 `id` 使用 `^[a-z][a-z0-9_]*$`，新实体按规划使用 `mat_ eq_ con_ cur_ key_ chr_ bld_ rcp_ enc_` 等前缀。符合格式的旧 ID 保留；旧连字符写法将由后续 aliases 迁移处理。实体全局唯一、锁定 ID、引用保护与迁移属于后续工单，P0 不宣称已实现。

需求单遵循 [request.schema.json](../docs/editor/schemas/request.schema.json)。必填字段为 `schemaVersion id kind owner target title status createdAt`；文件名须与 ID 一致，ID 跨文件不重复。`target` 为 `global` 或 `item|skill|character|encounter|building|recipe|layout|scenario:<id>`。P0 不校验实体是否存在。

`createdAt` 空串表示未填写；显式日期采用真实 `yyyy-MM-dd`。程序不读取当前时钟。新需求始终为 `open`；真实分拣权在总策划或 User。三条 `REQ-0001`–`0003` **仅为工单规定的格式样例**，其中 `triaged`、`in_progress` 不代表真实需求已分拣、批准或开工。R1/R2/R3/R5/P4 不因这些样例而授权。

在仓库根运行：

```sh
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll validate --content content
dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll requests
```

HTTP 实体 PUT 的基础格式检查不替代未来领域 schema。工具安装、全部命令与 HTTP 约定见 [sim-cli README](../tools/sim-cli/README.md)。
