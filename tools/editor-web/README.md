# Helper：本地内容编辑器（P1）

本期开放物品定义、来源 / 用途反查、备注与需求、批量粘贴和运行时导出。战斗 P2、地图 / 生产 P3 入口保持禁用。界面只编辑数据；规则由现有 C# Runtime 与 sim-cli 执行。

## 启动顺序

先按 [sim-cli README](../sim-cli/README.md) 安装精确的 .NET SDK **8.0.428**。前端已验证 Node **24.12.0**、npm **11.6.2**；依赖版本由 `package-lock.json` 固定。

在仓库根的第一个 PowerShell 终端启动模拟器：

```powershell
# 如果 SDK 装在 work/，把此处替换成该 dotnet.exe 的绝对路径。
$dotnet = 'dotnet'
Set-Location tools/sim-cli
& $dotnet build . -c Release -warnaserror --no-incremental -m:1
Set-Location ../..
& $dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --content content --port 5185
```

再在第二个终端启动前端：

```powershell
Set-Location tools/editor-web
npm.cmd ci --cache ../../work/p1-frontend-npm-cache
npm.cmd run dev
```

打开 [http://127.0.0.1:5175/#/items](http://127.0.0.1:5175/#/items)。Vite 仅监听 `127.0.0.1`，把 `/api` 代理到 `127.0.0.1:5185`，保留 ETag 与并发条件头。端口被占时直接失败，不自动换端口。Windows 使用 `npm.cmd`，无需更改 PowerShell 执行策略。

隔离测试时，模拟器必须显式指向测试内容与导出目录：

```powershell
& $dotnet tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll serve --content work/my-test/content --export-out work/my-test/runtime --port 5186

# 在前端终端设置后启动，避免连接到正式内容。
$env:SIM_API_URL = 'http://127.0.0.1:5186'
npm.cmd run dev -- --port 5176
```

`dev-service.mjs` 是需要服务身份记录时使用的同一 Vite 入口。它在指定的本地工作目录写入 PID、实际 Node 路径、参数、启动时间和 API 地址；Ctrl+C 关闭自己的服务。

```powershell
node verification/dev-service.mjs --port 5175 --identity-dir ../../work/my-editor-service
```

## 操作

- Ctrl / Cmd+K 打开 ID、别名、名称搜索，方向键选择，Enter 打开；Esc 关闭对话框或详情。所有控件可用 Tab 到达，并有可见焦点。
- Ctrl / Cmd+S 保存。首次保存后 ID 锁定；修改显示名不会改 ID。离开未保存内容时，用页面内对话框选择保存、放弃或继续编辑。
- 校验来自 sim-cli：字段下显示后端原文，问题面板可跳到实体与字段。300ms 防抖纯校验不落盘；最终 PUT 仍重新校验并核对 ETag。
- 冲突时并排显示磁盘与本地字段。“用磁盘的”加载当前文件；“保留我的”只以收到的精确当前 ETag 重试，再次冲突仍会拦截。
- 断线后 5 秒内显示连接横幅，保留内存修改并禁用保存。模拟器恢复后自动重新连接；内容列表刷新不会覆盖当前草稿。
- 从表格粘贴支持 TSV / CSV（含引号、换行与转义引号），可手动匹配表头。逐行检查类型、数值和全局 ID；仅导入合格新行，错误行可连同表头复制后修改。
- 未实现的加成或消耗品效果必须附非备注需求，与物品原子保存为草稿。需求不会由编辑器自动分拣或派发。P0 样例状态不代表真实工作获授权。
- “导出可用内容”导出已保存的有效定义，清楚显示被排除的草稿数量。草稿本身不会进入产物；活动定义引用草稿、缺能力或其他校验错误由后端拒绝，失败不改产物。

参考价不是游戏内售价。矿料参考价 4、巡卫短剑参考价 40 尚待确认；短剑强化消耗 3 矿料、2 淬火砂与攻击增量 4 仅对应现有 preparation 测试参数。旧别名不改写旧配置，实例 ID 不登记为物品定义。

## 检查与可重放证据

```powershell
npm.cmd run build
npm.cmd run lint

# 原始 stdout/stderr 字节分开保存，receipt 内 SHA-256 对同一批字节计算。
# 必须使用尚不存在的证据目录，避免抹去失败记录。
node verification/capture-check.mjs build ../../outputs/my-editor-check/build
node verification/capture-check.mjs lint ../../outputs/my-editor-check/lint
```

浏览器脚本使用项目锁定的 Playwright。Windows 默认复用已安装的 Edge，不下载重复浏览器、不共享用户 profile；每次创建隔离 context。其他位置可设 `EDITOR_BROWSER_PATH`。截图需要一个真实模拟器服务，内容为 60 项且包含五个正式定义；脚本本身不造假数据或 mock HTTP。

```powershell
node verification/capture-ui.mjs http://127.0.0.1:5175 ../../outputs/my-editor-check/screenshots 60

# 会修改指定隔离夹具；拒绝指向正式 content/。
npm.cmd run test:browser -- http://127.0.0.1:5176 ../../work/my-test/content ../../outputs/my-editor-check/browser
```

截图脚本生成 1280×800 / 1920×1080 各亮暗四张，记录真实浏览器版本、文件哈希、页面溢出、详情宽度、表格容器滚动及虚拟行数量。交互脚本检查粘贴、需求草稿、导出排除与重复哈希、磁盘冲突双分支，以及真实浏览器键盘事件。真实进程停启的 B10 与 Unity 读取的 B8 由各自进程负责人及独立验收执行；脚本不操作 Unity，不以网络 mock 冒充停服。

构建目录、依赖、缓存和本地证据不入 Git；只提交源码、配置和依赖锁文件。完整验收以 [P1_VERIFICATION.md](../../docs/editor/P1_VERIFICATION.md) 为准。

## 实现入口

`src/api.ts` 对应 [固定 API 合同](../../docs/editor/P1_API_CONTRACT.md)，`src/store.ts` 保存当前编辑会话，`src/components/` 包含可复用表格、字段、对话框、需求、粘贴与冲突视图。React 18 / TypeScript strict / Vite、Tailwind 3、Zustand、TanStack Table + Virtual；本地 shadcn 风格按钮与 Radix Dialog、Lucide 图标。参考：[shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、[TanStack Virtual](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual)。

正文复用仓库已跟踪的 Noto Sans CJK 字体，代码与数值使用本地 `@fontsource/jetbrains-mono`，不依赖远端字体服务。Noto 的原始许可与来源见 `Game/Assets/Prototype/Art/Fonts/OFL.txt`、`SOURCE.txt` 和仓库 `THIRD_PARTY_NOTICES.md`；依赖的许可随各 npm 包保留。开发服务器仅精确允许编辑器根与该 OTF 文件，生产构建将字体打包为普通 `/assets/` URL，并随资产保留同源 `NotoSansCJKsc-OFL.txt` / `NotoSansCJKsc-SOURCE.txt`。
