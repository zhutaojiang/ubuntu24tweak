- [/] 复制文本/图片后，F3贴在桌面上，右键可重新复制，双击可销毁，拖动可移动，滚动可缩放 
  - [x] 复制文本可贴屏幕 @done(2026-06-19)
  - [ ] 长文本应能自动换行--可显示完整内容
  - [x] 现在鼠标滚动缩放突然失效了 @done(2026-06-23)
  - [x] 当它在某应用（终端除外）上面时，不能拖动；在桌面上，若右键弹出系统菜单后，就不能拖动了 @done(2026-06-23)
    根因(三项同源)：贴纸用 `Main.layoutManager.uiGroup.add_child()` 加进 shell chrome，但没登记进 stage 输入区。
      X11 下 shell 给覆盖层设了输入形状，普通 uiGroup 子节点在应用窗口/桌面上方时鼠标事件直接穿透到下面的窗口/桌面：
      → 压在应用上收不到 button-press 故不能拖；→ 桌面右键穿透到 nautilus 弹系统菜单并抢 grab；→ 滚轮事件也到不了。
    解法：改用 `Main.layoutManager.addChrome(actor)`(affectsInputRegion 默认 true)把 actor 经变换(含缩放)的边界
      登记进 stage 输入区，shell 才能在贴纸区域收到 按下/释放/滚动；销毁时 `removeChrome`。滚轮缩放也改回 actor 级
      `scroll-event`(输入区已含本 actor，无需再全局 captured-event)。已 install.sh 装到 ~/.local/share/...，
      X11 下 Alt+F2→r 重启 shell 或注销重登生效。
  - [ ] 复制图片可贴屏幕
- [ ] 全局 ctrl+f1 截图，可直接贴在屏幕上，或选择复制到剪贴板，双击可以销毁，拖动可以移动；鼠标滚轮可缩放。此功能可参照windows下的snipaste。
- [x] 想实现内网穿透，通过一台有公网域名/IP的服务器作中转，用frp软件实现远程ssh连接本机。 @done(2026-06-21)
    [2026-06-21] 已完成公网服务器 frps systemd 化，服务 active 并监听公网 frp 端口；本机已安装 frpc 0.68.0 到
      ~/.local/bin/frpc，写入用户级 systemd 服务 ~/.config/systemd/user/frpc.service 并 enable/start，远端已监听转发端口。
      已启用本机用户 linger。仓库文档仅保留占位符，不写真实域名/IP/密码/密钥。
    [2026-06-21 完成] 用户已运行 `scripts/frp-ssh-tunnel-local-prereq.sh`，本机 `ssh.service` 已 enabled/active，
      监听 22；本机 `frpc.service` active，远端 `frps.service` active，远端已监听 frp 控制端口和 SSH 转发端口。
      用 `ssh -p <转发端口> <本机用户名>@<公网域名>` 非交互测试已到达本机 SSH 认证阶段；实际使用时输入本机用户密码登录。
      后续安全加固：改 SSH 密钥登录并关闭密码登录，另给 frp 增加 token。
- [x] 语音输入法：~/funasr_input_linux. 1、验证输入法可用（重登后生效）；2、改用fast (nano与Ollama并存GPU不够)；3、润色用本地LLM qwen2.5:3b @done(2026-06-21)
- [x] 本机插着一个mercury的无线网卡，但好像系统识别不到，无法使用5g wifi @done(2026-06-21)
    已定位：不是 Realtek，而是 AICsemi AIC8800D80 USB 网卡。启动时先枚举为虚拟U盘 `a69c:5721 Aic MSC`，
      已被 usb_modeswitch 切到 WLAN 模式 `a69c:8d80 AIC Wlan`，但 NetworkManager 只看到内置 `ath9k/wlp6s0`。
    系统里已有驱动 `/lib/modules/6.17.0-35-generic/kernel/drivers/net/wireless/aic8800/{aic_load_fw.ko,aic8800_fdrv.ko}`，
      firmware 也在 `/lib/firmware/aic8800D80/`；真正阻塞点是 Secure Boot：journal 有 `Loading of unsigned module is rejected`，
      两个 AIC 模块 `modinfo -F signer` 为空，故自动加载被拒，网卡停在 `a69c:8d80`，没有生成新 wifi 接口。
    本机已加载 `ztj-dell Secure Boot Module Signature key`，修复路径=用现有 MOK 签这两个模块 → depmod → modprobe →
      绑定/重插设备。已写 `scripts/mercury-aic8800-enable.sh` 和 `docs/mercury-aic8800.md`；当前会话无免密 sudo，
      需要用户输入 sudo 密码后运行脚本完成实测。若运行后仍未出现新 wifi 设备，拔插一次 Mercury 网卡再看 `nmcli device status`。
    [2026-06-21 复测] 用户运行后签名成功，`aic_load_fw/aic8800_fdrv` 已加载，firmware 已上传；设备最终重枚举为
      `2357:014b TP-Link AIC 8800D80`，但当前驱动没有内置这个 alias，仍未生成 wifi 接口。
    [2026-06-21 再复测] `new_id 2357 014b` 不能用：驱动内部打印 `aicwf_usb_probe pid:0x2357 vid:0x014B unsupport`，
      随后在 `aicwf_usb_free_urb` 空指针 Oops，脚本被内核杀掉。已撤掉危险强绑逻辑。源码 `/usr/src/AIC8800`
      已含 `USB_PRODUCT_ID_MERCURY 0x014b`，但已安装模块缺 alias；正确路径=重启清掉 Oops 状态后运行
      `scripts/mercury-aic8800-rebuild-install.sh` 从源码重编/签名/安装，再运行 enable 脚本验证。
    [2026-06-21 编译修复] 用户重跑 rebuild 时暴露 `/usr/src/AIC8800` 不兼容 6.17：`MODULE_IMPORT_NS`、timer API、
      cfg80211 回调签名/CAC 事件参数均已在本地源码修补。已复制到 `/tmp/AIC8800-buildcheck` 非安装编译通过，产物确认含
      `alias: usb:v2357p014Bd*...`。下一步：再次运行 `./scripts/mercury-aic8800-rebuild-install.sh` 安装签名模块，
      再拔插网卡/运行 enable，检查 `nmcli device status`。
    [2026-06-21 安装后] 新模块已安装且 `modules.alias` 含 `2357:014b`，但内核当前只自动加载了 `aic_load_fw`，
      `2357:014b` 接口仍绑在通用 USB driver。enable 脚本已改为：仅当新 alias 存在时，才 bind `2357:014b`
      到 `aic8800_fdrv`（不会再向旧模块强塞 `new_id`）。
    [2026-06-21 完成] enable 后 NetworkManager 已看到新接口 `wlx4cb7e0569cc4` 和 `p2p-dev-wlx4cb7e0569cc4`；
      kernel 日志显示 `is 5g support = 1`，支持 36/40/44/48/52/.../165 等 5G 信道，接口从 `wlan0` rename 为
      `wlx4cb7e0569cc4`。后续直接在 GNOME Wi-Fi 或 `nmcli dev wifi connect ... ifname wlx4cb7e0569cc4` 连 5G SSID。
      若接口偶发消失，优先怀疑 USB 接触/供电/省电重置，先拔插后跑 `scripts/mercury-aic8800-enable.sh`。
    [2026-06-21 dpkg修复] 后续 apt 安装其它包时暴露 `aic8800d80fdrvpackage` 处于 half-configured：vendor postinst
      在模块已经加载时仍直接 `insmod /usr/src/AIC8800/.../aic_load_fw.ko`，内核返回 `File exists`，导致 dpkg 配置失败。
      已写 `scripts/aic8800-fix-dpkg-half-configured.sh`：先确认已安装模块存在、`aic8800_fdrv.ko` 含 `2357:014b` alias，
      再备份 `/var/lib/dpkg/info/aic8800d80fdrvpackage.postinst`，替换成幂等版 postinst（`depmod` + `modprobe ... || true`），
      执行 `dpkg --configure aic8800d80fdrvpackage`，不覆盖当前已签名且可用的模块。用户已执行脚本；复查包状态为
      `ii / install ok installed`，`wlx4cb7e0569cc4` 仍连接 5G。
- [x] dolphin: 左树右列表，中文都是仿宋，需要调整 @done(2026-06-20)
    走过的两条弯路(均无效，已回退)：
      ① 改 ~/.config/kdeglobals [General] font= —— 无效。GNOME 下未装 plasma-integration，没人把 kdeglobals 喂给 Qt。已还原(备份 kdeglobals.bak.20260620154739)。
      ② 加 fontconfig 规则给 "Noto Sans" append Noto Sans CJK SC —— 无效。Qt 的中文回退不吃 fontconfig 排序(见下)。已删。
    真·根因(用 QT_LOGGING_RULES="qt.text.font.match=true" 抓 Dolphin 日志锤死)：
      · GNOME 会话 Qt 自动走 qgtk3 platformtheme(系统仅此一个插件)，UI 字体直接取自 GNOME font-name="Noto Sans"(纯拉丁、无 CJK 字形)。
      · 中文要字形回退，而 Qt 自建的回退族列表是【按家族名字母序】排的，取第一个含中文的家族：
        Noto Sans → 'Adobe 仿宋 Std' → 'AR PL UKai…' → 'Arial' → … → 'Noto Sans CJK SC'(排在很后)。
        装了 ~/popular-fonts(313 字体)后，字母序最靠前的中文字体变成 Adobe 仿宋 Std → 全 UI 仿宋。预览区走另一字体路径故幸免。
      · 这是 Qt 内部行为、不读 fontconfig 优先级，所以 kdeglobals / fontconfig 都改不动它。
    解法(用户选"改全局界面字体")：gsettings set org.gnome.desktop.interface font-name 'Noto Sans CJK SC 10'。
      Qt 的主家族本身即含中文字形→根本不触发回退→不再仿宋。原值 'Noto Sans,  10'(空格×2)，回退即恢复。
      副作用极小：GTK 应用界面字体一并变 CJK SC，但其拉丁字形与 Noto Sans 几乎一致，且 GTK 中文本就经 Pango 回退到 CJK SC。
    已实测(同样抓 qt.text.font.match 日志)：Dolphin 主家族变 'Noto Sans CJK SC'、日志中再无任何仿宋/Adobe 仿宋 Std 回退请求。即时生效，无需注销。
- [x] chrome浏览器有时会卡死，弹出3-4次等待/强制关闭对话框后，才可恢复 @done(2026-06-20)
    根因=显卡驱动栈，非 Chrome 本身。本机三台显示器全接在独显 RTX 3050(card1)上，Intel UHD 630 闲置；
      此前独显跑的是开源 nouveau + NVK(Mesa 实验性 Vulkan) + zink(GL-over-Vulkan) 实验栈。
    两个致命问题：①nouveau 无法给 Ampere(RTX30系) 重新调频→GPU 永久锁最低频→整桌面/打字回显都卡(用户主诉"打字比键盘慢")；
      ②NVK+zink 极易丢 GL 上下文→Chrome GPU 进程反复崩溃重启→GPU 标签页冻结→弹"等待/强制关闭"，重启几次才恢复。
    日志铁证(journal)：GL_CONTEXT_LOST_KHR / "Restarting GPU process due to unrecoverable error" /
      "GPU process exited unexpectedly: exit_code=512|8704" / vaInitialize failed。
    解法：装官方闭源驱动 `sudo ubuntu-drivers install`(得 nvidia-driver-595-open) + 重启。已实测：
      nouveau 卸载、nvidia 595.71.05 加载、GL 渲染器从 zink/NVK 变为 "NVIDIA GeForce RTX 3050/PCIe/SSE2"、
      pstate 动态调频恢复(空闲P3/292MHz↔最高2100MHz)。用户实测整体"已经好多了"。
    副作用：装闭源驱动后 GDM 默认进 X11。试过切回 Wayland 但登不进——org.gnome.Shell@wayland 启动即被
      信号杀死(journal: "Failed with result 'signal'")、弹回登录界面；高度怀疑 DVI 竖屏 rotation=left 在
      NVIDIA Wayland 下触发合成器崩溃(已知 bug)。
    决定：日常用 X11、不再切 Wayland。理由——现硬件(三台~60Hz、全 scale=1、一台竖屏旋转)下 Wayland/X11
      性能效率无可感知差别(之前的卡是 nouveau 锁频，与会话类型无关)；而旋转在 X11 反而更稳。
    固化：登录界面(greeter)布局——把 ~/.config/monitors.xml 复制到 /var/lib/gdm3/.config/monitors.xml(属主 gdm)，
      greeter 即显示 DP主屏+DVI竖屏(文件内含 DVI-D-0/1 两套连接器命名，X11/Wayland greeter 均适用)。已实测正常。
      保留登录界面的 Wayland 选项(用户不禁用，WaylandEnable 维持默认注释态)；知道选了 Wayland 会崩、避免选即可。
    第4项 Chrome 密码下拉：X11 下原生自动弹出(根因 xdg-popup 是原生 Wayland 专属)，已实测弹出；
      desktop 里的 --disable-features=OzoneBubblesUsePlatformWidgets 在 X11 下为空操作、留着无害。
    第20项 crxMouse 右键手势：X11 下行为与原生 Wayland 不同，待重新核对/微调。
- [x] 现系统登出待登入时，桌面花屏、闪烁、部分区域可见登出前窗口部分内容；按回车、盲输密码、回车，可进入系统，进入后恢复正常 @done(2026-06-20)
    根因=nouveau 模式设置问题。换闭源 nvidia 595 后即消失(实为第1项装驱动那轮就已好)；用户实测花屏/闪烁不再出现、登录界面正常。
- [x] chrome浏览器不能自动弹出已保存的用户名、密码，需要手动输入（在测试右键优化时，曾经切x11时可自动弹出，但切回wayland后，就不再自动弹出）@done(2026-06-20)
    根因=原生 Wayland 后端下 Chrome 把 autofill 下拉做成 xdg-popup 创建失败（二进制有 "Failed to create XdgPopup"）→ 下拉不显示。
    非密码丢失：keyring(secrets+pkcs11)在跑、密码管理器默认开启、密码已存；切 X11(XWayland)能弹、切回原生 Wayland 不弹，与第20项的取舍死锁。
    无损解：启动参数加 --disable-features=OzoneBubblesUsePlatformWidgets，让气泡/下拉改用窗口内渲染、绕开 xdg-popup，
      下拉恢复且完全保留原生 Wayland（不动第20项右键、不退化 fcitx 中文输入与 HiDPI）。已实测：弹。
    固化：写进用户级覆盖 ~/.local/share/applications/google-chrome.desktop 三处 Exec（优先于系统文件、不怕升级覆盖、覆盖 Dock/链接/新窗口/无痕全入口）。
    否掉：整体切 X11(毁第20项)、升级(已是最新149.0.7827.155无更新)。备选未采：Bitwarden/KeePassXC 扩展(自带填充UI、不依赖原生浮层)。见 docs/chrome-password-autofill-wayland.md
- [x] 华为备忘录(笔记)同步 @done(2026-06-19)
    华为备忘录无官方 API / 无 Linux 客户端 / 网页版不支持批量导出文字 → "真·自动双向同步"做不到。
    实际诉求=继续用已固定在 Chrome 的网页版，只是它空闲很快超时掉登录、要反复重登。
    方案：网页版当客户端 + 会话保活（不重建同步）。
    · 掉线两因：①服务端空闲超时(滑动过期,改不了,但可在过期前制造已登录请求续命) ②浏览器未"信任"/退出清cookie。
    · ①一次性持久化：登录勾"信任此设备"；Chrome 关闭"关窗清Cookie"或给 cloud.huawei.com 设保留数据 → 消除开机重登。
    · ②保活用户脚本 huawei-notes-keepalive.user.js(Tampermonkey)：空闲满8分钟自动悄悄重载页面续命，
      检测到在编辑/有选中则跳过(不打断)，被踢回登录页弹桌面通知，不存任何密码，右下角角标显示状态。
      RELOAD_AFTER_IDLE_MIN 若仍掉线就调小；需实测华为是滑动过期(保活有效)还是绝对过期(保活无效)。
    · ③自动重登(存密码本地)用户选择不做。备选C:GDPR"数据下载"导出加密zip(每条笔记JSON+HTML)做一次性整库备份。
    见 huawei-notes-sync/（脚本 + README.md）
- [x] vscode的快捷键：alt+左/右，跳转历史光标位置，现在不是这个键，需要调过来 @done(2026-06-19)
    keybindings.json 增绑 Alt+← → workbench.action.navigateBack、Alt+→ → navigateForward
    （"后退/前进"，在光标历史位置间跳转，含跨文件）。VS Code Linux 默认是 Ctrl+Alt+- / Ctrl+Shift+-。
    用户键位优先级高于默认，无需解绑；Alt+←/→ 不与 GNOME 全局热键冲突。见 docs/vscode-keybindings.md
- [x] chrome浏览器右键优化，现在需要连点两次才有效，可能是跟右键手势插件有关系 @done(2026-06-19)
    元凶=扩展 crxMouse: Mouse Gestures (jlgkpaicikihijadgifklkbpdajbkhjo)，确为右键手势插件。
    根因：Wayland 下 Chrome 右键菜单在 mousedown 瞬间弹出，crxMouse 无法在那一刻区分“点击 vs 手势”，
    于是“右键单击出菜单”与“右键拖动出手势”在 Wayland 上天然互斥。
    · crxMouse 设置项 cancelcontextmenu（标签：消除Linux/Mac右键菜单对本扩展的影响(双击弹出右键菜单)）：
      开=手势全站可用但菜单需双击；关=菜单单击但手势失效。代码里该抑制仅在非 Windows 平台启用。
    · 试过切 X11 后端(--ozone-platform=x11)：分站点不一致(Google单击菜单/无手势，其他站双击菜单/有手势)，
      重 JS 页面会抢 contextmenu 事件，且 XWayland 连累 fcitx 中文输入与 HiDPI → 放弃，留原生 Wayland。
    · 也试过 X11+抑制关 不行。结论：crxMouse 在此环境做不到全站两全。
    最终选择：保留右键手势、菜单双击 = 切回原生 Wayland + cancelcontextmenu 重新勾上(默认推荐模式)。
      备选：cancelcontextmenu 关 + 把手势辅助键(gholdkey)设为“按住 Ctrl 才启用手势”(gholdkeytype=true)，
      可得“菜单单击 + Ctrl+右键拖手势”，全站一致但每次手势要按修饰键。
    [2026-06-20 X11 复测] 现已定居真·X11 桌面(非 XWayland 强制，见第1项)。原以为 X11 菜单在 mouseup 才弹、
      能让 crxMouse 区分点击/手势从而两全——实测不行：cancelcontextmenu 取消勾选=有菜单单击但手势失效，
      与 Wayland 同样的硬互斥。用户不接受 gholdkey 修饰键方案。
    维持现状(最优)：cancelcontextmenu 勾上 = 手势可用 + 菜单需双击。
      唯一别扭(菜单双击)的零副作用缓解：需要菜单时按键盘 菜单键(☰)/Shift+F10 对焦点元素单次弹出原生菜单。
    待折腾(有空再试)：换支持“时间/位移阈值判定”的手势扩展，理论可“右键不动=菜单、右键拖=手势”共存且无修饰键——
      候选：Gesturefy、smartUp Gestures(crxMouse 的菜单抑制是二元开关、无阈值，故做不到)。试成功再回填结论。
- [x] 输入法优化：1、输入字上屏后，下方出现联想候选，此时左右键应不再切换候选，而是光标左右移动；2、还是字上屏后的候选，按数字键应上屏数字，而不是上屏对应的候选的；3、还是上屏后的候选，按空格键应上屏候选，而不是上屏空格；4、大写字母输入时，应直接上屏大写，而不是进入快速输入模式（它有个快捷键super+;，这个快速输入是什么？）@done(2026-06-19)
    主力输入法是 wbx(五笔，table 模块)，非拼音；改的是 conf/table.conf + table/wbx.conf。
    · #1#2 关闭联想：table.conf Prediction=True→False。上屏后无联想候选，左右键回归移光标、数字键回归打数字；拆字时空格选字照常。
    · #3 与 #2 在 table 模块互斥：联想候选是普通候选列表，数字键是其内置选词键、无法在保留候选时单独禁用。选了关闭联想（牺牲“空格接受联想”）。
    · #4 大写直接上屏：wbx.conf QuickPhraseText=ABC…Z 清空。原配置把所有大写字母设成“快速输入(QuickPhrase)”的触发文本，故打大写就进入快捷短语模式。
      “快速输入/快捷短语”= fcitx5 输入缩写展开为预设短语/符号的功能；用户配置里未发现 super+; 绑定，真正触发是 QuickPhraseText。
    · 改完 fcitx5-remote -r 重载即可，无需登出。备份 *.bak.20260619223419。
- [x] 类windows的文件管理器，左侧树形结构、支持自动展开，右侧本目录下的子目录、文件列表；支持双侧同时显示、联动显示、拖动复制，一侧本地、一侧sftp，sftp可共享终端中的免密登录或能永久记住密码,且可在左侧树形结构中列出，可直接双击修改远程文件内容 @done(2026-06-19)
    方案：Dolphin（主力，GNOME 上原生 Qt、能输中文、复用 ssh-agent）+ WinSCP on Wine（备用）。
    否掉 Double Commander / Krusader（非资源管理器风格 / 不好用）；只有 Dolphin 同时满足左树+详细列表+预览窗格。
    · 免密（与工具无关）：ssh-copy-id 推公钥到远程，终端/Dolphin/scp 全免密；~/.ssh/config 已建脚手架供多主机切换。
    · Dolphin：apt 装 dolphin+kio-extras+ark；左树(F7)+详细列表(ViewMode=1)+预览窗格(F11)、无分屏，已配好；连远程地址栏 sftp://主机/。
    · WinSCP：WinSCP.exe 是 32 位 → 需 i386+wine32，旧纯 64 位前缀报 c0000135，删 ~/.wine 重建 WoW64。
      图标从 exe 的 RT_ICON 抠 256px PNG；TreeOnLeft=1 树左排；翻译 chs.zip 必须与版本一致(带版本号 URL)；会话密码加密保存。
    · 中文输入：Wine 走 XWayland，fcitx5 XIM 在 WinSCP 里可用。详见 docs/file-manager-sftp.md
- [x] 终端鼠标右键复制粘贴：若有选中文本，则复制；若无且有光标，则粘贴 @done(2026-06-19)
    GNOME Terminal/VTE 做不到（右键菜单写死，Wayland 也无法全局拦截鼠标）；改用 WezTerm。
    ~/.config/wezterm/wezterm.lua：智能右键（选中→复制并清选区/否则粘贴）、不做选中即复制、
    仿 Windows Terminal 拆 pane（Ctrl+Shift+E/O 分屏，Alt+方向切焦点，Ctrl+Shift+方向调大小）。
    设默认：gsettings 已设；还需手动 sudo update-alternatives --set x-terminal-emulator /usr/bin/open-wezterm-here。
    tmux 远程仍用；其 mouse on 会截获鼠标，按 Shift 绕过。详见 docs/wezterm.md
- [x] 任务栏同一应用多窗口，hover 时显示缩略图或平铺 @done(2026-06-19)
    现状：Ubuntu Dock 原生不支持 hover 触发缩略图。当前配置下——
    · 右键点击图标弹出菜单，菜单内含各窗口的缩略图，点缩略图可跳转到对应窗口；
    · 左键保留 minimize（不弹缩略图）。
    相关设置：show-windows-preview=true, default-windows-preview-to-open=true, click-action='minimize'
    备选：左键也弹缩略图可设 click-action='previews'（或 'focus-or-previews'）；真正鼠标悬停弹出需改用 Dash to Panel。
- [x] ~/popular-fonts 安装这些字体 @done(2026-06-19)
    复制到 ~/.local/share/fonts/popular-fonts/ 并 fc-cache 刷新；313 个字体（6 个重复基础字体已跳过）
- [x] “文件”应用有个绿色1角标，不知道是什么情况 @done(2026-06-19)
    是 Ubuntu Dock 的通知计数徽章（show-icons-notifications-counter），对应一条未读系统通知，点开/清除后即消失
- [x] vscode快捷键：复制行 alt+shift+up/down，删除行 ctrl+d，console.log ctrl+l(extension?) @done(2026-06-19)
    keybindings.json 改绑复制行/删除行；console.log 用 Turbo Console Log 扩展（默认 Ctrl+Alt+L）；见 docs/vscode-keybindings.md
- [x] 复制文本/图片后，F3贴在桌面上，右键可重新复制，双击可销毁，拖动可移动，滚动可缩放 @done(2026-06-19)
- [x] vscode无法输入中文 @done(2026-06-19)
    统一到 fcitx5（environment.d + im-config），需登出登入生效；见 docs/vscode-chinese-input.md
- [x] 列出系统所有注册的热键，哪个应用使用的，显示有无冲突 @done(2026-06-19)
    见 list-hotkeys/（脚本 + hotkeys.md/json + 说明）
