# VS Code 自定义快捷键

三个常用编辑快捷键的配置，全部通过 `~/.config/Code/User/keybindings.json` 实现。

| 功能 | 快捷键 | 命令 | 说明 |
|------|--------|------|------|
| 复制行 上/下 | `Alt+Shift+↑` / `Alt+Shift+↓` | `editor.action.copyLinesUp/DownAction` | Linux 上本就是此默认值，显式绑定以防被覆盖 |
| 删除整行 | `Ctrl+D` | `editor.action.deleteLines` | 覆盖默认的「添加下一个匹配项到选区」 |
| 插入 console.log | `Ctrl+Alt+L` | `turboConsoleLog.displayLogMessage` | 需 Turbo Console Log 扩展（沿用扩展默认键） |

## 说明

### 复制行 / 删除行
纯快捷键改绑，无需扩展。`keybindings.json` 中已写入。

`Ctrl+D` 默认是多光标「添加下一个匹配项到选区」（Sublime 风格）。被覆盖后，该功能仍可用：
- `Ctrl+F2`：选中文件内全部匹配项
- 命令面板搜索 "Add Selection To Next Find Match"

### console.log（Ctrl+Alt+L）
使用扩展 **Turbo Console Log**（`chakrounanas.turbo-console-log`）。选中变量后按 `Ctrl+Alt+L`，
自动生成带文件名、行号、变量名的日志，例如：

```js
console.log("file.ts:12 ~ foo:", foo)
```

安装命令（已执行）：

```bash
code --install-extension ChakrounAnas.turbo-console-log
```

沿用扩展自带的默认快捷键 `Ctrl+Alt+L`，未做改绑（`keybindings.json` 中不含 console.log 条目）。

Turbo Console Log 其他常用命令（可按需在命令面板使用或自行绑定）：
- 注释所有由它生成的日志 / 取消注释 / 删除所有日志

## 系统冲突检查
已对照 `list-hotkeys/hotkeys.md`：`Alt+Shift+↑/↓`、`Ctrl+D`、`Ctrl+Alt+L` 均不与 GNOME
全局热键冲突（输入法切换在本机是 `Super+Space`，非 `Alt+Shift`）。
