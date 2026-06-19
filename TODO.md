[x] 华为备忘录(笔记)同步 @done(2026-06-19)
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
[ ] chrome浏览器有时会卡死，弹出3-4次等待/强制关闭对话框后，才可恢复
[ ] chrome浏览器不能自动弹出用户名、密码，需要手动输入（在测试右键优化时，曾经切x11时可自动弹出，但切回wayland后，就不再自动弹出）
[ ] 现系统登出待登入时，桌面花屏、闪烁、部分区域可见登出前窗口部分内容；按回车、盲输密码、回车，可进入系统，进入后恢复正常
[x] vscode的快捷键：alt+左/右，跳转历史光标位置，现在不是这个键，需要调过来 @done(2026-06-19)
    keybindings.json 增绑 Alt+← → workbench.action.navigateBack、Alt+→ → navigateForward
    （"后退/前进"，在光标历史位置间跳转，含跨文件）。VS Code Linux 默认是 Ctrl+Alt+- / Ctrl+Shift+-。
    用户键位优先级高于默认，无需解绑；Alt+←/→ 不与 GNOME 全局热键冲突。见 docs/vscode-keybindings.md
[x] chrome浏览器右键优化，现在需要连点两次才有效，可能是跟右键手势插件有关系 @done(2026-06-19)
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
[ ] 语音输入法：~/funasr_input_linux
[x] 输入法优化：1、输入字上屏后，下方出现联想候选，此时左右键应不再切换候选，而是光标左右移动；2、还是字上屏后的候选，按数字键应上屏数字，而不是上屏对应的候选的；3、还是上屏后的候选，按空格键应上屏候选，而不是上屏空格；4、大写字母输入时，应直接上屏大写，而不是进入快速输入模式（它有个快捷键super+;，这个快速输入是什么？）@done(2026-06-19)
    主力输入法是 wbx(五笔，table 模块)，非拼音；改的是 conf/table.conf + table/wbx.conf。
    · #1#2 关闭联想：table.conf Prediction=True→False。上屏后无联想候选，左右键回归移光标、数字键回归打数字；拆字时空格选字照常。
    · #3 与 #2 在 table 模块互斥：联想候选是普通候选列表，数字键是其内置选词键、无法在保留候选时单独禁用。选了关闭联想（牺牲“空格接受联想”）。
    · #4 大写直接上屏：wbx.conf QuickPhraseText=ABC…Z 清空。原配置把所有大写字母设成“快速输入(QuickPhrase)”的触发文本，故打大写就进入快捷短语模式。
      “快速输入/快捷短语”= fcitx5 输入缩写展开为预设短语/符号的功能；用户配置里未发现 super+; 绑定，真正触发是 QuickPhraseText。
    · 改完 fcitx5-remote -r 重载即可，无需登出。备份 *.bak.20260619223419。
[x] 类windows的文件管理器，左侧树形结构、支持自动展开，右侧本目录下的子目录、文件列表；支持双侧同时显示、联动显示、拖动复制，一侧本地、一侧sftp，sftp可共享终端中的免密登录或能永久记住密码,且可在左侧树形结构中列出，可直接双击修改远程文件内容 @done(2026-06-19)
    方案：Dolphin（主力，GNOME 上原生 Qt、能输中文、复用 ssh-agent）+ WinSCP on Wine（备用）。
    否掉 Double Commander / Krusader（非资源管理器风格 / 不好用）；只有 Dolphin 同时满足左树+详细列表+预览窗格。
    · 免密（与工具无关）：ssh-copy-id 推公钥到远程，终端/Dolphin/scp 全免密；~/.ssh/config 已建脚手架供多主机切换。
    · Dolphin：apt 装 dolphin+kio-extras+ark；左树(F7)+详细列表(ViewMode=1)+预览窗格(F11)、无分屏，已配好；连远程地址栏 sftp://主机/。
    · WinSCP：WinSCP.exe 是 32 位 → 需 i386+wine32，旧纯 64 位前缀报 c0000135，删 ~/.wine 重建 WoW64。
      图标从 exe 的 RT_ICON 抠 256px PNG；TreeOnLeft=1 树左排；翻译 chs.zip 必须与版本一致(带版本号 URL)；会话密码加密保存。
    · 中文输入：Wine 走 XWayland，fcitx5 XIM 在 WinSCP 里可用。详见 docs/file-manager-sftp.md
[x] 终端鼠标右键复制粘贴：若有选中文本，则复制；若无且有光标，则粘贴 @done(2026-06-19)
    GNOME Terminal/VTE 做不到（右键菜单写死，Wayland 也无法全局拦截鼠标）；改用 WezTerm。
    ~/.config/wezterm/wezterm.lua：智能右键（选中→复制并清选区/否则粘贴）、不做选中即复制、
    仿 Windows Terminal 拆 pane（Ctrl+Shift+E/O 分屏，Alt+方向切焦点，Ctrl+Shift+方向调大小）。
    设默认：gsettings 已设；还需手动 sudo update-alternatives --set x-terminal-emulator /usr/bin/open-wezterm-here。
    tmux 远程仍用；其 mouse on 会截获鼠标，按 Shift 绕过。详见 docs/wezterm.md
[x] 任务栏同一应用多窗口，hover 时显示缩略图或平铺 @done(2026-06-19)
    现状：Ubuntu Dock 原生不支持 hover 触发缩略图。当前配置下——
    · 右键点击图标弹出菜单，菜单内含各窗口的缩略图，点缩略图可跳转到对应窗口；
    · 左键保留 minimize（不弹缩略图）。
    相关设置：show-windows-preview=true, default-windows-preview-to-open=true, click-action='minimize'
    备选：左键也弹缩略图可设 click-action='previews'（或 'focus-or-previews'）；真正鼠标悬停弹出需改用 Dash to Panel。
[x] ~/popular-fonts 安装这些字体 @done(2026-06-19)
    复制到 ~/.local/share/fonts/popular-fonts/ 并 fc-cache 刷新；313 个字体（6 个重复基础字体已跳过）
[x] “文件”应用有个绿色1角标，不知道是什么情况 @done(2026-06-19)
    是 Ubuntu Dock 的通知计数徽章（show-icons-notifications-counter），对应一条未读系统通知，点开/清除后即消失
[x] vscode快捷键：复制行 alt+shift+up/down，删除行 ctrl+d，console.log ctrl+l(extension?) @done(2026-06-19)
    keybindings.json 改绑复制行/删除行；console.log 用 Turbo Console Log 扩展（默认 Ctrl+Alt+L）；见 docs/vscode-keybindings.md
[x] 复制文本/图片后，F3贴在桌面上，右键可重新复制，双击可销毁，拖动可移动，滚动可缩放 @done(2026-06-19)
[x] vscode无法输入中文 @done(2026-06-19)
    统一到 fcitx5（environment.d + im-config），需登出登入生效；见 docs/vscode-chinese-input.md
[x] 列出系统所有注册的热键，哪个应用使用的，显示有无冲突 @done(2026-06-19)
    见 list-hotkeys/（脚本 + hotkeys.md/json + 说明）