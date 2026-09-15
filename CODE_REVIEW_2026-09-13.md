# 代码审查记录：2026-09-13

本次审查对象是当前工作树（包含暂存、未暂存和未跟踪的 pi-web），不是某个发布版本。没有修改产品源码、依赖或已有测试。

审查覆盖：Agent 循环与取消、AI 重试与消息转换、协议与客户端、服务端会话、JSONL 会话持久化、SQLite 后端、TUI、Electron 文件与进程边界、web 消息队列、定时任务、权限扩展、模型配置和运行时同步。采用源码检查、指定测试和临时复现程序；不是逐行检查全部源码，也不是所有供应商和平台的端到端认证。

确认 14 项问题：6 项 P1（优先修复），8 项 P2。以下各项区分实测与静态调用链证据。

## P1：优先修复

### 1. RPC 超限错误回调无法编译，实际执行也会抛异常

位置：[rpc-mode.ts:1062](D:/chenzefeng/Develop/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts:1062)。

新增回调的参数 `error: Error` 遮蔽了外层生成 RPC 错误响应的 `error()` 函数，`output(error(...))` 实际尝试调用 Error 对象。根目录 `tsgo --noEmit` 确认报 TS2349；对实际源码做临时转译并触发该回调，同样得到 TypeError，后续 `shutdown(1)` 不会执行。

建议：分开命名异常对象和错误响应构造器，并覆盖超限输入的错误响应与退出流程。

归因：上一轮助手修复引入。此前仅验证 pi-web 类型检查不足以证明核心源码通过检查。

### 2. 全局 RPC 串行队列造成取消失效和弹窗回复死锁

位置：[rpc-mode.ts:1060](D:/chenzefeng/Develop/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts:1060)。

全部输入，包括 `extension_ui_response` 和 `abort_bash`，必须等待前一个 `handleInputLine()` 完成。`bash` 却会等待 shell 结束才返回；`new_session` 等生命周期命令又可能等待扩展的确认弹窗。

实测实际 RPC 调度源码、替换外部运行时与 I/O 后：

- `bash → abort_bash`：bash 完成前 abort 调用次数为 0；手动让 bash 完成后才变成 1。
- `new_session → confirm → extension_ui_response`：弹窗已发出、回复已送入，但命令始终没有响应。

多会话也共用这条队列，因此一个会话的长操作会阻塞其他会话。

建议：弹窗回复和取消命令走独立控制通道；只对需要互斥的会话状态修改排序，并按会话隔离。不能把全部命令简单串行化。

归因：上一轮助手修复引入；此前将并发处理整体视为缺陷的判断过于宽泛。

### 3. 模型配置导出仍携带认证请求头

位置：[model-config.ts:253](D:/chenzefeng/Develop/pi/pi-web/electron/bridge/model-config.ts:253)。

`exportModelConfig()` 浅拷贝 provider，只删除 `provider.apiKey`，保留 `headers` 及模型配置中的其他字段。pi 的模型配置明确支持认证请求头，因此 `Authorization: Bearer ...`、`x-api-key` 等可以包含真实凭据。

临时假配置实测：普通 apiKey 被删除，但 Authorization 中的假凭据原样出现在导出对象中。用户按“已脱敏”预期分享导出文件时会泄露这类凭据。未读取或导出用户真实密钥。

建议：覆盖 provider、model 和 modelOverrides 中的认证头，建立明确的导出脱敏规则与保留/删除测试。

### 4. 定时任务的项目设置未参与执行

位置：[scheduled-tasks.ts:201](D:/chenzefeng/Develop/pi/pi-web/src/state/scheduled-tasks.ts:201)。

任务保存了 `project`，执行时却只调用当前 store 的 `newSession()`、`send()`，没有使用该项目。当前会话位于 A、任务指定 B 时，任务仍在 A 的工作目录执行。对于修改文件的任务，这会操作错误的项目。

使用真实任务执行函数和假的 pi 操作实测：指定 B 后只出现 `newSession`、`send`，工作目录仍为 A，没有调用 `newSessionIn(B)`。模型/思考设置也在创建新会话前作用于当时可见会话。

建议：先获取属于任务项目的会话句柄，再把所有设置和 prompt 明确发送到该句柄。

### 5. 工作区写入权限可通过目录联接绕过

位置：[permission-gate.ts:47](D:/chenzefeng/Develop/pi/pi-web/extensions/permission-gate.ts:47)。

`insideWorkspace()` 只做字符串路径归一化，不解析符号链接或 Windows junction。工作区中的 `linked` 指向外部目录时，对 `linked/file.txt` 的 write/edit 被放行，而底层文件操作会跟随链接写到工作区外。这是直接文件工具的边界缺陷，不是已声明的 shell 文本扫描局限。

临时目录实测：gate 返回 allow=true，realpath 指向外部目录；没有实际修改工作区外的用户文件。

建议：现有目标解析真实路径；新文件检查最近的现有父目录及链接，按真实工作区根校验。若承诺严格隔离，还需要处理检查与写入之间的路径变化。

### 6. 编辑/移除队列消息时使用错误命令，导致消息丢失

位置：[store.ts:313](D:/chenzefeng/Develop/pi/pi-web/src/state/store.ts:313)。

`requeueQueue()` 发送 `type: "followUp"`，pi RPC 接收的是 `type: "follow_up"`。`followUp` 只是部分事件字段及 streamingBehavior 的取值，并不是命令名称。

编辑两条 follow-up 消息之一的实测调用顺序是 `clear_queue → followUp`。第二步被拒绝时，原队列已经清空，尚未恢复的消息丢失。

建议：使用正式 RpcCommand 类型校验命令；修正名称，并为清空后恢复失败提供明确的恢复机制。

## P2：正确性与健壮性

### 7. 点击已被消费的队列行会清掉其余消息

位置：[store.ts:339](D:/chenzefeng/Develop/pi/pi-web/src/state/store.ts:339)。

`mutateQueue()` 先 clear_queue，再查目标是否仍存在。若目标刚被 agent 消费，`at < 0` 直接返回 false；clear_queue 返回的其他消息没有重新入队。

实测：界面保留旧行，运行时返回不包含旧行但包含其他消息的队列，函数仅调用 clear_queue 就退出。即使修复第 6 项，这条分支仍会丢消息。

建议：目标缺失也恢复其他条目；进一步把“按条目更新”实现为本体原子操作，并固定会话句柄。

### 8. 定时任务在 prompt 被接受时即标记完成

位置：[scheduled-tasks.ts:205](D:/chenzefeng/Develop/pi/pi-web/src/state/scheduled-tasks.ts:205)。

RPC prompt 响应表示前置检查/接收成功，并不表示模型和工具执行结束。`await pi.send()` 后立即写 completed 并发“已完成”通知，因此之后发生的模型错误、工具错误或中断不会回写到任务状态，errors-only 通知也无法反映这些失败。

实测：send 返回但 pi store 仍为 streaming 时，任务已是 completed。

建议：关联具体会话与本次运行，监听最终结束和错误状态；重复任务在本次运行结算后再推进调度时间。

### 9. @文件附件可能读取错误项目的同名文件

位置：[Composer.tsx:154](D:/chenzefeng/Develop/pi/pi-web/src/components/Composer.tsx:154)。

文件候选来自 `listFiles(sessionCwd)`，保存为 `src/foo.ts` 等相对路径；buildPrompt 将该相对路径直接传给主进程。主进程 read-file 使用 `path.resolve(filePath)`，基准是 Electron 进程 cwd，不是会话 cwd 或列表返回的 filesRoot。

静态调用链确认：切换到项目 B 后选 `@src/foo.ts`，会读 Electron 启动目录下的同名文件，或得到 ENOENT。成功时错误内容会被加入 prompt。

建议：选择附件时将列表所属 filesRoot 和相对路径一起绑定，发送前按该根解析，避免切换会话改变已选附件的含义。

### 10. Excel 预览会错配工作表名称、行号和列位置

位置：[documents.ts:187](D:/chenzefeng/Develop/pi/pi-web/src/lib/documents.ts:187)、[documents.ts:203](D:/chenzefeng/Develop/pi/pi-web/src/lib/documents.ts:203)。

工作表内容按 sheet1.xml、sheet2.xml 文件名排序，再按 workbook 中的名称顺序配对；但正确关联由关系 ID 决定。读取行和单元格时又直接 push，忽略 row.r 和 cell.r，所以空行、空列会被压掉。

在实际 Electron 22.3.27 / Chromium 108 中，用调换工作表顺序且仅填 A3、C3 的 ZIP fixture 实测：名为 Second 的页显示了 First 的数据，A3/C3 被变成第一行连续两列。未调用外部 Office 服务。

建议：读取 workbook.xml.rels，根据 r:id 取目标；按行/单元格坐标补齐空位。PPT 的幻灯片顺序也采用类似文件名排序，需一并检查关系映射。

### 11. undici 5 代理实现忽略 NO_PROXY

位置：[http-dispatcher.ts:136](D:/chenzefeng/Develop/pi/packages/coding-agent/src/core/http-dispatcher.ts:136)。

当前 coding-agent 依赖为 undici 5.29.0，走 legacy 分支。只要存在 HTTP(S)_PROXY，就为所有目标建立 ProxyAgent，没有 NO_PROXY 例外，也没有按请求协议分别选择代理。

两个 localhost 测试服务器实测：设置 `NO_PROXY=127.0.0.1` 后，请求本地服务仍向代理发 CONNECT；代理拒绝后，本来可直连的服务请求失败。没有访问公网。

建议：按目标 URL 应用 NO_PROXY 和 HTTP/HTTPS 对应代理规则，测试 localhost、域名后缀和端口例外。

### 12. 文件预览的读取限制未限制实际内存和 I/O

位置：[main.ts:624](D:/chenzefeng/Develop/pi/pi-web/electron/main.ts:624)。

read-bytes 先同步读取整个文件，之后才 subarray 截取默认 24 MB。大文件仍会完整分配内存并阻塞 Electron 主进程；相邻 read-file 也没有大小限制，文本显示端的行数截断发生得更晚。

证据为完整处理器的执行顺序，未为复现而分配超大文件或耗尽内存。

建议：通过文件句柄只读指定长度，文本路径也限制实际读取；采用异步 I/O，让 RPC 转发不受预览文件阻塞。

### 13. JSONL reader 进入失败态后仍会在 EOF 交付被拒绝内容

位置：[jsonl.ts:65](D:/chenzefeng/Develop/pi/packages/coding-agent/src/modes/rpc/jsonl.ts:65)。

超限后只设 failed，未清空 buffer；onEnd 又不检查 failed，直接 emitLine(buffer)。同时，正常行后跟随超限无换行尾部的单个 chunk，会绕过首次检查，直到下一次 data 才被发现。

实际 reader 实测：输入 16 MB + 1 字符时触发一次 error；随后 EOF 仍向 onLine 交付了这 16,777,217 个字符。未传 onError 的其他调用者还会静默停止解析后续行。

建议：失败时清空并停止 reader；EOF 遵守失败态和长度限制；逐行消费后检查剩余尾部；所有调用者明确接收错误。

归因：上一轮助手新增的长度保护不完整。

### 14. 运行时同步失败却返回成功退出码

位置：[sync-pi-runtime.mjs:96](D:/chenzefeng/Develop/pi/pi-web/scripts/sync-pi-runtime.mjs:96)。

目标目录不存在时设置 failed=true，但最终退出码只检查 missing。使用临时空 dist 和不存在的目标执行 dry-run，输出 target does not exist，退出码仍是 0。自动化可继续打包旧运行时，产生“源码已修复但程序没有更新”的结果。

建议：退出状态同时考虑 failed 和 missing；覆盖目标缺失、部分目标失败和完整同步成功。

## 验证结果与边界

| 检查范围 | 结果 |
| --- | --- |
| 根源码 `node_modules/.bin/tsgo --noEmit` | 失败：rpc-mode.ts:1062，TS2349 |
| pi-web `npm run typecheck` | 通过 |
| 根目录 `npm run check:pinned-deps` | 失败：pi-web 的测试、资源及 release 副本中有 9 处非精确依赖版本 |
| client：connection、requests、disposal、sessions、state | 31 通过 |
| server：server、sessions、protocol、conformance | 15 通过、27 未通过；失败输出为 Windows 上 Unix socket listen EACCES，不能据此断言服务逻辑有 27 个缺陷 |
| agent：agent-loop | 23 通过 |
| ai：retry、OpenAI/Anthropic 消息转换 | 23 通过 |
| coding-agent：会话保存、文件操作、http-dispatcher、rpc-jsonl | 38 通过 |
| protocol：framing、protocol、CBOR | 147 通过 |
| SQLite：repository、conformance、branch-query | 49 通过；Node 输出 SQLite 实验性提示 |
| tui：terminal、wrap-ansi、terminal-image | 102 通过、2 未通过：路径分隔符的期望与 Windows 输出不同 |
| web：store、event-batcher、permission-gate、model-config-portable | 69 通过 |

以上指定测试合计 497 通过、29 未通过。另有临时源码复现程序和实际 Electron 文件解析检查，不计入上述测试数。

复现中的凭据、项目路径、shell 操作和会话均为假数据或模拟实现；代理测试只访问本地测试服务器。没有执行真实模型请求、构建/发布产品、修改会话记录或提交代码。临时程序已清理。

未执行全仓测试套件、真实供应商端到端调用和实际 Windows 7 系统测试。TUI 的两项断言失败和 Unix transport 的平台可运行性仍需对应平台验证。Electron 的 `DecompressionStream("deflate-raw")` 在当前 Chromium 108 实测可用，因此没有将“解压 API 不兼容”列为问题。

先修复 P1 项并添加可失败的回归测试，再处理 P2；当前不能仅凭 web 类型检查和已有正常路径测试通过就认定整体稳定。
