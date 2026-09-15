# pi 运行时补丁：一个进程多会话

π7 依赖一处**对 pi 本体的本地改动**：让 `--mode rpc` 的进程能同时持有多个会话，后台会话
继续流式输出而不被切换打断。这个改动不在上游 npm 包里，`resources/pi-win7` 里跑的是
我们打补丁后的编译产物。**每次升级 pi 本体都必须重新套用并重新同步**，否则 App 会退回到
「切会话 = 中断 + 跨项目重启 2-4 秒」的旧行为（功能不崩，但并行能力静默消失）。

## 1. 补丁内容

改动只有 4 个文件，全部在 `packages/coding-agent/src`：

| 文件 | 改动 |
| --- | --- |
| `core/agent-session-runtime.ts` | 新增 `AgentSessionRuntime.openSibling({cwd?, sessionPath?})`：用同一个 `createRuntime` 工厂再建一个独立 runtime，不动当前会话，也不触发 `session_before_switch` |
| `modes/rpc/rpc-types.ts` | 新增 `get_capabilities` / `open_session` / `close_session` / `get_open_sessions` 命令与响应类型；所有命令可带 `sessionId`（`RpcSessionTarget`）；所有事件与 `extension_ui_request` 带 `sessionId`；`RPC_PROTOCOL_VERSION = 2` |
| `modes/rpc/rpc-mode.ts` | 会话句柄表（`s1`、`s2`…）；命令按 `sessionId` 路由；事件打 `sessionId` 标签；会话文件占用检查（同一 JSONL 不允许两个 runtime）；`open_session` 前 `clearExtensionCache()` 保证扩展模块隔离；关闭会话时结算它的扩展对话框 |
| `core/extensions/index.ts` | 导出 `clearExtensionCache` |

补丁文件：`patches/pi-multi-session.patch`（832 行，`git apply` 可直接套用）。

### 协议要点

- 句柄 id（`s1`…）由 `open_session` 返回，**在会话被替换后仍然不变**；它和 pi 的 session id
  不是一回事，`get_open_sessions` 里同时给出 `piSessionId` 与 `sessionFile`。
- 不带 `sessionId` 的命令 = 发给「活动句柄」，`activeHandleId` 由 `open_session`
  （`activate !== false` 时）和 `close_session` 维护。旧客户端行为完全不变。
- 事件行形如 `{...原有事件, sessionId: "s2"}`。
- 同一会话文件只能开一次：命中已有句柄时 `open_session` 直接返回它；`switch_session`
  指向别的句柄已打开的会话文件时返回错误（pi 写 JSONL 没有文件锁，两个 runtime 会互相覆盖）。

## 2. 构建与同步

```powershell
# 1) 编译 pi（只改 coding-agent 时用 build:unbundled，比全量 build 快且不产 bundle/）
cd D:\chenzefeng\Develop\pi\packages\coding-agent
npm run build:unbundled

# 2) 把编译产物同步进随应用打包的运行时（dev 模式默认也从这里启动 pi）
cd D:\chenzefeng\Develop\pi\pi-web
node scripts\sync-pi-runtime.mjs            # 加 --dry-run 先看会覆盖哪些文件
```

`sync-pi-runtime.mjs` 只复制目标里**已存在**的文件，不动 node_modules 的其余部分。

dev 模式（未打包）的 pi 位置按以下顺序解析：`PI_WIN7_CLI` / `PI_WIN7_NODE` 环境变量 →
`pi-web/resources/pi-win7`（与打包一致的布局）→ 仓库内 `packages/coding-agent/dist/cli.js` + PATH 上的 `node`。
另有一个暂存目录时，设置 `PI_WIN7_CLI` 指向其 `dist/cli.win7.js`，`sync-pi-runtime.mjs` 会连它一起同步。

`npm run package` 会先跑 `prepare:resources`，其中有一道**硬检查**：随包运行时里若缺少
`multiSession`（即补丁没同步），打包直接失败并打印上面的步骤。确实要在缺补丁的情况下打包
（App 会退化成单会话模式），设 `PI_WEB_ALLOW_UNPATCHED_RUNTIME=1` 降级为警告。

## 3. 验证

```powershell
cd D:\chenzefeng\Develop\pi\pi-web
$env:PI_SMOKE_SHELL="D:\Program Files\Git\bin\bash.exe"   # 见下方说明
node scripts\pi-multi-session-smoke.mjs
```

22 项检查，全部通过才算补丁在位：能力握手、句柄复用、并发打开同一会话文件只得到一个
runtime（防双击竞态）、后台会话、并发执行（两个 `sleep 2` 必须 ~2.1s 而不是 ~4.2s）、
事件带 `sessionId`、会话文件占用拒绝、关闭运行中的会话会中止它的命令且进程其余部分保持
可用、最后一个会话不可关。
失败时会打印 "the bundled pi runtime is missing the multi-session patch" 并以非 0 退出。

`PI_SMOKE_SHELL` 是 smoke 脚本用的 shell：pi 优先找 Git Bash，找不到才回退 PATH 上的
`bash.exe`（这台机器上是 WSL 的，跑不了 Windows 命令）。

## 4. 升级 pi 本体的步骤（重要）

1. 拉取新版本，`git status` 确认 `patches/pi-multi-session.patch` 能干净套用：
   ```powershell
   cd D:\chenzefeng\Develop\pi
   git apply --check pi-web\patches\pi-multi-session.patch
   ```
2. 冲突时按上表手工重做（改动都很局部：runtime 多一个方法、rpc 层多一张句柄表）。
   重点确认四件事仍然成立：
   - `runRpcMode` 里命令按 `sessionId` 找到对应 runtime，事件带 `sessionId`；
   - `open_session` 复用同一 session file 的既有句柄，且 `switch_session` 拒绝重复占用；
   - `open_session` 之前调用 `clearExtensionCache()`；
   - `shutdown()` 遍历所有句柄 dispose。
3. 按第 2 节重新构建 + 同步（`npm run package` 前必须做）。
4. 按第 3 节跑 smoke，22 项全绿再发版。

## 5. 已知代价与限制（多会话同进程的取舍）

- **扩展模块状态**：扩展的模块级变量在「同一进程 + 同一 cwd + 缓存命中」时会共享，
  所以 `open_session` 前会清一次扩展缓存，让每个会话拿到独立模块实例；代价是每个会话
  重新 import 一次扩展（几十~几百毫秒）。跨会话的 `/reload` 仍会清掉别人的缓存。
- **进程级全局量**：`process.env` 代理设置、undici 全局 dispatcher、`resetApiProviders()`
  后的 API provider 注册表、`trackedDetachedChildPids`、`settings.json` 的内存副本都是
  进程级的——一个会话改全局设置或 `/reload` 会影响同进程的其它会话。同一用户自己的几个
  会话通常无感，但不要在会话间做互相矛盾的设置。
- **资源**：每多开一个会话就多一套 services（模型客户端、资源加载器、工具集）和一份消息
  历史内存；4 个会话并行 = 4 倍 token 消耗。UI 侧必须让用户看得见哪些会话在跑。
- **不做的事**：不提供跨进程共享、不做会话迁移、不支持同一 JSONL 两处同时打开。
