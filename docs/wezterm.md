# WezTerm：智能右键复制/粘贴 + 拆 pane

替换 GNOME Terminal 的原因：GNOME Terminal/VTE 把“右键弹出上下文菜单”写死在源码里，
没有任何 gsettings 开关能改成“选中→复制、未选中→粘贴”；Wayland 下也无法用
xbindkeys/xdotool 全局拦截右键。WezTerm 的鼠标绑定可用 Lua 编程，能精确实现该行为，
且原生支持拆 pane。

## 安装

```bash
# 本机已通过 apt 安装（/usr/bin/wezterm）
wezterm --version
```

## 配置文件

`~/.config/wezterm/wezterm.lua`（已写好）。校验配置是否可加载：

```bash
wezterm show-keys >/dev/null && echo OK
```

## 设为默认终端

```bash
# 1) x-terminal-emulator（Ctrl+Alt+T、各类“在终端打开”都走这个）
sudo update-alternatives --set x-terminal-emulator /usr/bin/open-wezterm-here

# 2) GNOME 默认应用（已设，用户级无需 sudo）
gsettings set org.gnome.desktop.default-applications.terminal exec 'wezterm'
gsettings set org.gnome.desktop.default-applications.terminal exec-arg '-e'
```

Ctrl+Alt+T 绑定的是 `org.gnome.settings-daemon.plugins.media-keys terminal`，
它启动 x-terminal-emulator，因此上面第 1 步设好后 Ctrl+Alt+T 自动打开 WezTerm。

## 行为说明

### 智能右键（核心需求）
- **有选中文本** → 复制到剪贴板（同时写 primary）并清除选区
- **无选中文本** → 粘贴系统剪贴板

### 智能 Ctrl+C / Ctrl+V（仿 PowerShell）
- **Ctrl+C**：有选中文本 → 复制并清选区；无选中 → 照常发送 Ctrl+C 中止程序。
  这就是 Windows PowerShell 的行为——不会因为 Ctrl+C 改成复制而阻断 SIGINT。
- **Ctrl+V**：粘贴系统剪贴板。
  （代价：Ctrl+V 被终端层拦截，应用内的 Ctrl+V 字面量/quoted-insert 用不了，与 Windows Terminal 同样取舍。）

### 不做“选中即复制”
默认 WezTerm 松开鼠标会把选区写入 primary。已改为：选择文本只保留高亮、不写任何剪贴板；
复制只通过智能右键、智能 Ctrl+C 或 `Ctrl+Shift+C` 显式触发。左键点击仍可打开链接。

### 拆 pane（仿 Windows Terminal）
| 快捷键 | 作用 |
|---|---|
| `Ctrl+Shift+E` | 左右分屏 |
| `Ctrl+Shift+O` | 上下分屏 |
| `Ctrl+Shift+W` | 关闭当前 pane |
| `Ctrl+Shift+Z` | 放大/还原当前 pane |
| `Alt+方向键` | 在 pane 间移动焦点 |
| `Ctrl+Shift+方向键` | 调整 pane 大小 |

复制/粘贴：智能 `Ctrl+C` / `Ctrl+V`（见下）；`Ctrl+Shift+C` / `Ctrl+Shift+V` 也仍可用。

## 中文输入（fcitx5）

GNOME 的 Wayland 合成器(mutter)**不实现**第三方输入法所需的 `input_method_v2`
协议，所以 fcitx5 无法把候选词送进 WezTerm 这类原生 Wayland 程序——`GTK_IM_MODULE`/
`QT_IM_MODULE` 只对 GTK/Qt 程序有效，WezTerm 两者都不是。

解法：在 `wezterm.lua` 里强制走 XWayland(X11)，此时 fcitx5 的 XIM
(`XMODIFIERS=@im=fcitx`)生效：

```lua
config.enable_wayland = false
config.use_ime = true
```

- 改后须**关闭所有 WezTerm 窗口再重开**（连接级设置，重载配置不够）。
- 代价：分数缩放下字体可能略不如原生 Wayland 锐利；删掉这两行即可还原。
- 前提：`fcitx5-modules`(含 xim 服务)已装，本机已具备。

> 同理：任何非 GTK/Qt 的原生 Wayland 程序在 GNOME 下都吃不到 fcitx5，
> 都得走 XWayland 才能输中文。

## 中文字体

不配 `config.font` 时，中文会 fallback 到系统宋体（衬线、横线太细，终端里发糊）。
拉丁/数字用 WezTerm 内置的 JetBrains Mono，中文 fallback 到 **Noto Sans Mono CJK SC**
（思源等宽黑体，笔画清晰、真等宽，系统已装）：

```lua
config.font = wezterm.font_with_fallback {
  'JetBrains Mono',
  'Noto Sans Mono CJK SC',
}
```

`wezterm ls-fonts` 可验证 fallback 链。想更进一步可装 Sarasa Mono SC（更纱黑体等宽，
Latin 严格半宽对齐 CJK），本机未装。

## 与 tmux 共存（远程 SSH）

- 本地：用 WezTerm 原生 pane，不需要 tmux。
- 远程：继续在服务器上用 tmux（断线会话不丢，WezTerm 本地 pane 给不了这点）。
- 注意：tmux 开启 `mouse on` 后会**自己截获鼠标事件**，此时 WezTerm 的智能右键
  传不进去。在 tmux 里复制可用 tmux copy-mode，或**按住 Shift + 鼠标**绕过 tmux、
  改用 WezTerm 原生选择/右键。
