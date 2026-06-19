# 类 Windows 文件管理器 + SFTP（Dolphin 主力 + WinSCP 备用）

需求：左树 + 右详细列表 + 预览窗格；本地/远程双侧；拖动复制；SFTP 复用终端免密
或永久记住密码；双击改远程文件。

选型结论：
- **Dolphin**（主力，KDE/Qt，但在 GNOME 上原生跑、能输中文、复用 ssh-agent）——
  唯一在 Linux 上同时满足「左树 + 详细列表 + **预览窗格**」的资源管理器风格工具。
  Total Commander 系（Double Commander）和 Krusader 都被否掉（不是资源管理器风格 /
  不好用）。
- **WinSCP on Wine**（备用，最像 WinSCP 的一站式本地↔远程）。

---

## 1. SSH 免密（与工具无关，先做这步）

痛点：远程密码又长又复杂，不想每次复制粘贴。最稳的解法是把本机公钥推到远程，
之后**终端 / Dolphin / scp 全部免密**：

```bash
ssh-copy-id -i ~/.ssh/id_rsa.pub user@host   # 每台远程输一次长密码，以后免输
```

`~/.ssh/config` 已建脚手架（`Host *` 全局指定 `IdentityFile ~/.ssh/id_rsa` +
keepalive），给每台远程加 `Host 别名` 段即可多主机秒切。推不了 key 的主机，才退而
用 GUI 工具的密码保存（Dolphin→gnome-keyring，WinSCP→会话内加密保存）。

## 2. Dolphin

安装：

```bash
sudo apt install -y dolphin kio-extras ark
```

- `kio-extras` 提供 `sftp://` 协议（**必须**，否则连不了远程）。

布局（左树 + 右详细列表 + 预览窗格，无分屏）已配好。面板可见性存在
`~/.local/share/dolphin/dolphinstaterc` 的 `State=`（Qt `QMainWindow::saveState`
的 base64 二进制：各 dock 名后跟一个可见性标志字节，bit0=visible）。当前：
foldersDock=显示、infoDock=显示、placesDock=显示、terminalDock=隐藏。
详细列表来自 `~/.local/share/dolphin/view_properties/global/.directory` 的
`ViewMode=1`。

热键：`F7` 文件夹树、`F9` Places、`F11` 预览窗格、`F3` 分屏（已关）。

连远程：地址栏输 `sftp://主机/`（配好 `~/.ssh/config` + 推过 key 后免密直进）。
双击远程文件即用关联程序打开，KIO 在保存时回写。

## 3. WinSCP on Wine

### 安装与踩坑

WinSCP.exe 是 **32 位**程序，Wine 需要 32 位支持：

```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y wine winetricks wine32:i386
```

**坑：`could not load kernel32.dll, status c0000135`** —— 旧 `~/.wine` 是装 wine32
之前建的纯 64 位前缀，没有 syswow64。删掉重建为 WoW64 前缀即可：

```bash
rm -rf ~/.wine
WINEDLLOVERRIDES="mscoree,mshtml=d" wineboot -i   # 禁用 Mono/Gecko 弹窗
wineserver -w
```

便携版解压在 `~/winscp/`（`WinSCP.exe` + `WinSCP.ini`）。

### 启动器 + 图标

- `~/.local/bin/winscp`：`exec env WINEDEBUG=-all wine ~/winscp/WinSCP.exe "$@"`
- `~/.local/share/applications/winscp.desktop`：`Icon=winscp`、
  `StartupWMClass=winscp.exe`（让运行窗口与启动器关联）。
- **图标**从 exe 抠出：解析 PE 的 `RT_ICON` 资源，取其中 256×256 的 PNG 条目写到
  `~/.local/share/icons/hicolor/256x256/apps/winscp.png`，再 `gtk-update-icon-cache`。
  （别用「扫描 exe 里所有 PNG 取最大方形」——里面有 2000+ 个工具栏小图会选错。）

### 树左右排列

`WinSCP.ini` → `[Configuration\Interface\Commander]` → `TreeOnLeft=0` 改 `1`
（树移到文件列表左边）。**改前必须先关 WinSCP**，否则退出时会覆盖 ini。

### 中文界面

简体中文语言代码就是 **`chs`**，文件名 `WinSCP.chs`（其实是个资源 DLL）。
**翻译必须与 WinSCP 主版本严格一致**，否则启动弹「删除翻译」提示、选了也不生效。
下载地址带版本号：

```bash
wget -O chs.zip "https://winscp.net/translations/dll/<版本>/chs.zip"   # 如 6.3.6
unzip chs.zip -d ~/winscp/
```

放到 exe 同目录后重启，**Options → Preferences → Environment → Languages** 选
「中文(简体)」。⚠️ 以后升级 WinSCP 要同步换对应版本的 `chs.zip`。

### 中文输入

可以输入。Wine 走 XWayland，fcitx5 的 XIM（`XMODIFIERS=@im=fcitx`）在 WinSCP
窗口里生效（与 WezTerm 走 XWayland 输中文同理，见 docs/wezterm.md）。

### 免密

WinSCP 不复用 ssh-agent：新建会话时在「高级 → SSH → 认证」指定私钥（会提示转
`.ppk`），或直接在会话里存密码（加密保存，符合「永久记住密码」需求）。
