# list-hotkeys —— 列出系统全局热键并检测冲突

对应 TODO 第 9 项：列出系统所有注册的热键、由哪个组件/应用使用、并显示有无冲突。

## 它能查什么

Wayland/GNOME 下真正会被窗口管理器/Shell 抢占的**系统级**全局热键，来自 6 类 GSettings 来源：

| 来源 | GSettings schema |
| --- | --- |
| 窗口管理器 | `org.gnome.desktop.wm.keybindings` |
| GNOME Shell | `org.gnome.shell.keybindings` |
| Mutter | `org.gnome.mutter.keybindings` |
| Mutter/Wayland | `org.gnome.mutter.wayland.keybindings` |
| 多媒体/系统键 | `org.gnome.settings-daemon.plugins.media-keys` |
| 自定义快捷键 | media-keys `custom-keybindings`（含命令） |
| 扩展自带热键 | 各扩展 `schemas/` 下 `type="as"` 的键 |

**查不到的**：应用“内部”快捷键（VSCode 的 `Ctrl+D`、Chrome 的快捷键等）。它们不向系统注册，只在该应用获得焦点时生效，没有统一接口可枚举。

## 用法

```bash
python3 list-hotkeys.py            # 终端表格（默认）+ 冲突检测
python3 list-hotkeys.py --md       # 输出 Markdown 到 stdout
python3 list-hotkeys.py --json     # 输出 JSON 到 stdout
python3 list-hotkeys.py --export . # 生成 hotkeys.md 和 hotkeys.json
```

## 产物

- `hotkeys.md` —— Markdown 表格快照，可直接贴进文档。
- `hotkeys.json` —— 结构化数据（`summary` / `hotkeys` / `conflicts`），供其它脚本消费。

> 两个产物为自动生成，改了快捷键或装了新扩展后重跑 `--export .` 刷新即可。

## 中文用途是怎么来的

三级策略：①已知 GNOME 动作用手写精确中文；②带编号的（如 `switch-to-application-1`）套模板；③扩展/未知动作用关键词词典逐词拼译。第③类结果在终端会标 `?` 提示为推测。

## 冲突判定

把加速键归一化后比较：`<Primary>`=`<Control>`=`<Ctrl>`，忽略修饰键顺序与单字母大小写。同一组合被两个及以上不同动作占用即记为冲突。GNOME 默认配置本身无冲突。
