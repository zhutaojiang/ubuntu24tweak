#!/usr/bin/env python3
"""列出系统中所有通过 GSettings 注册的全局热键，标明来源、动作与（猜测的）中文用途，并检测冲突。

覆盖范围（Wayland/GNOME 下真正会被 WM/Shell 抢占的全局热键）：
  - 窗口管理器  org.gnome.desktop.wm.keybindings
  - GNOME Shell org.gnome.shell.keybindings
  - Mutter      org.gnome.mutter.keybindings / .wayland.keybindings
  - 多媒体键    org.gnome.settings-daemon.plugins.media-keys
  - 自定义快捷键 media-keys custom-keybindings（含命令）
  - 扩展自带热键 各扩展 schemas/ 下 type="as" 的键

注意：应用“内部”快捷键（如 VSCode 的 Ctrl+D、Chrome 的快捷键）不在此列——
它们不是系统级注册，只在该应用获得焦点时生效，无法集中枚举。
"""
import ast
import glob
import os
import re
import subprocess
import unicodedata
from collections import defaultdict

HOME = os.path.expanduser("~")

FIXED_SCHEMAS = [
    ("窗口管理器", "org.gnome.desktop.wm.keybindings"),
    ("GNOME Shell", "org.gnome.shell.keybindings"),
    ("Mutter", "org.gnome.mutter.keybindings"),
    ("Mutter/Wayland", "org.gnome.mutter.wayland.keybindings"),
    ("多媒体/系统键", "org.gnome.settings-daemon.plugins.media-keys"),
]

ACCEL_RE = re.compile(r"^(<[A-Za-z0-9]+>)*([A-Za-z0-9_]+|XF86[A-Za-z0-9_]+)$")

# 已知动作 -> 中文用途（精确匹配）
DESC = {
    # --- WM ---
    "activate-window-menu": "打开窗口标题栏菜单",
    "begin-move": "开始移动窗口（键盘）",
    "begin-resize": "开始调整窗口大小（键盘）",
    "close": "关闭当前窗口",
    "cycle-group": "在同一应用的窗口间循环",
    "cycle-group-backward": "反向：同一应用窗口间循环",
    "cycle-panels": "在系统区域/面板间循环",
    "cycle-panels-backward": "反向：系统区域/面板间循环",
    "cycle-windows": "循环切换所有窗口",
    "cycle-windows-backward": "反向：循环切换所有窗口",
    "minimize": "最小化当前窗口",
    "move-to-monitor-down": "把窗口移到下方显示器",
    "move-to-monitor-up": "把窗口移到上方显示器",
    "move-to-monitor-left": "把窗口移到左侧显示器",
    "move-to-monitor-right": "把窗口移到右侧显示器",
    "move-to-workspace-down": "把窗口移到下一个工作区",
    "move-to-workspace-up": "把窗口移到上一个工作区",
    "move-to-workspace-left": "把窗口移到左侧工作区",
    "move-to-workspace-right": "把窗口移到右侧工作区",
    "move-to-workspace-last": "把窗口移到最后一个工作区",
    "panel-main-menu": "打开主菜单/活动概览",
    "panel-run-dialog": "打开“运行命令”对话框",
    "show-desktop": "显示桌面（最小化全部）",
    "switch-applications": "切换应用程序（Alt+Tab）",
    "switch-applications-backward": "反向切换应用程序",
    "switch-group": "在当前应用的窗口间切换",
    "switch-group-backward": "反向：当前应用窗口间切换",
    "switch-input-source": "切换输入法/键盘布局",
    "switch-input-source-backward": "反向切换输入法",
    "switch-panels": "切换系统区域焦点",
    "switch-panels-backward": "反向切换系统区域焦点",
    "switch-to-workspace-down": "切换到下一个工作区",
    "switch-to-workspace-up": "切换到上一个工作区",
    "switch-to-workspace-left": "切换到左侧工作区",
    "switch-to-workspace-right": "切换到右侧工作区",
    "switch-to-workspace-last": "切换到最后一个工作区",
    "switch-windows": "切换窗口",
    "switch-windows-backward": "反向切换窗口",
    "toggle-maximized": "最大化/还原窗口",
    # --- Shell ---
    "focus-active-notification": "聚焦当前通知",
    "screenshot": "截取整个屏幕（直接存）",
    "screenshot-window": "截取当前窗口",
    "shift-overview-down": "向下切换概览/工作区",
    "shift-overview-up": "向上切换概览/工作区",
    "show-screen-recording-ui": "打开录屏工具",
    "show-screenshot-ui": "打开截图工具（交互）",
    "toggle-application-view": "显示/隐藏应用程序网格",
    "toggle-message-tray": "显示/隐藏通知中心",
    "toggle-quick-settings": "显示/隐藏快速设置面板",
    # --- Mutter ---
    "cancel-input-capture": "取消输入捕获（远控/串流）",
    "rotate-monitor": "旋转显示器方向",
    "switch-monitor": "切换显示器输出模式（投影）",
    "restore-shortcuts": "恢复被应用独占的快捷键",
    # --- media-keys（非 *-static 的逻辑键）---
    "logout": "注销登录",
    "magnifier": "放大镜开关",
    "magnifier-zoom-in": "放大镜放大",
    "magnifier-zoom-out": "放大镜缩小",
    "screenreader": "屏幕阅读器开关",
    "screensaver": "锁定屏幕",
    "terminal": "打开终端",
    # --- 扩展 ---
    "paste-to-screen": "把剪贴板内容贴到桌面（便签）",
}

# 带编号的动作基名 -> 模板（{n} 替换为编号）
NUMBERED = {
    "open-new-window-application": "为任务栏第{n}个应用开新窗口",
    "switch-to-application": "切换到任务栏第{n}个应用",
    "switch-to-workspace": "切换到工作区 {n}",
    "move-to-workspace": "把窗口移到工作区 {n}",
    "switch-to-session": "切换到第 {n} 个虚拟终端 (TTY{n})",
}

# 关键词逐词翻译（用于猜测未知动作的用途）
WORDS = {
    "switch": "切换", "move": "移动", "to": "到", "from": "从",
    "workspace": "工作区", "window": "窗口", "windows": "窗口",
    "application": "应用", "applications": "应用", "app": "应用",
    "monitor": "显示器", "session": "会话", "group": "同应用窗口",
    "up": "上", "down": "下", "left": "左", "right": "右", "last": "最后",
    "brightness": "亮度", "volume": "音量", "mute": "静音",
    "toggle": "开关", "show": "显示", "hide": "隐藏", "open": "打开",
    "close": "关闭", "new": "新建", "screenshot": "截图", "screen": "屏幕",
    "paste": "粘贴", "copy": "复制", "minimize": "最小化", "maximize": "最大化",
    "overview": "概览", "magnifier": "放大镜", "zoom": "缩放", "in": "放大",
    "out": "缩小", "lock": "锁定", "rotate": "旋转", "keyboard": "键盘",
    "media": "媒体", "audio": "音频", "play": "播放", "pause": "暂停",
    "next": "下一个", "previous": "上一个", "prev": "上一个", "stop": "停止",
    "power": "电源", "suspend": "挂起", "hibernate": "休眠", "logout": "注销",
    "touchpad": "触摸板", "bluetooth": "蓝牙", "search": "搜索",
    "static": "（硬件键）", "precise": "精细", "quiet": "小幅",
    "status": "状态", "playback": "播放", "screensaver": "屏保",
    "video": "视频", "off": "关", "on": "开", "saver": "保护",
    "calculator": "计算器", "email": "邮件", "battery": "电池",
    "control": "控制", "center": "中心", "input": "输入", "source": "源",
    "active": "当前", "notification": "通知", "desktop": "桌面",
    "begin": "开始", "resize": "调整大小", "cycle": "循环",
    "panel": "面板", "panels": "面板", "run": "运行", "dialog": "对话框",
    "forward": "快进", "rewind": "快退", "random": "随机", "repeat": "循环",
    "eject": "弹出", "home": "主目录", "www": "浏览器", "mic": "麦克风",
    "rfkill": "无线开关", "tray": "托盘", "message": "消息",
}


def run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return ""


def parse_array(value):
    value = value.strip()
    if value in ("@as []", "[]"):
        return []
    if not value.startswith("["):
        return None
    try:
        return [str(x) for x in ast.literal_eval(value)]
    except (ValueError, SyntaxError):
        return None


def looks_like_accels(items):
    return bool(items) and all(ACCEL_RE.match(i) for i in items)


def normalize(accel):
    mods = re.findall(r"<([A-Za-z0-9]+)>", accel)
    key = re.sub(r"<[A-Za-z0-9]+>", "", accel)
    alias = {"primary": "ctrl", "control": "ctrl", "ctl": "ctrl"}
    norm_mods = sorted({alias.get(m.lower(), m.lower()) for m in mods})
    nkey = key.lower() if len(key) == 1 else key
    return "+".join(norm_mods + [nkey])


def describe(action):
    """返回动作的中文用途：精确表 > 编号模板 > *-static 硬件键 > 逐词猜测。"""
    if action in DESC:
        return DESC[action]
    m = re.match(r"^(.*)-(\d+)$", action)
    if m and m.group(1) in NUMBERED:
        return NUMBERED[m.group(1)].format(n=m.group(2))
    # *-static：多为笔记本/键盘上的功能键
    base = action[:-7] if action.endswith("-static") else action
    tokens = re.split(r"[-_]", base)
    zh = "".join(WORDS.get(t.lower(), t) for t in tokens if t)
    if action.endswith("-static"):
        zh += " 硬件键"
    # 若仍夹杂英文（猜不全），标注「？」提示为推测
    guessed = bool(re.search(r"[A-Za-z]", zh)) or action not in DESC
    return zh + ("  ?" if re.search(r"[A-Za-z]", zh) else "")


def collect():
    rows = []  # (source, action, accels, desc)

    for label, schema in FIXED_SCHEMAS:
        for line in run(["gsettings", "list-recursively", schema]).splitlines():
            parts = line.split(" ", 2)
            if len(parts) != 3:
                continue
            _, key, value = parts
            items = parse_array(value)
            if items is None or not looks_like_accels(items):
                continue
            rows.append((label, key, items, describe(key)))

    cklist = parse_array(run(["gsettings", "get",
        "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings"])) or []
    for path in cklist:
        base = ["gsettings", "get",
                f"org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:{path}"]
        name = run(base + ["name"]).strip().strip("'")
        command = run(base + ["command"]).strip().strip("'")
        binding = run(base + ["binding"]).strip().strip("'")
        accels = parse_array(binding)
        if accels is None:
            accels = [binding] if binding else []
        accels = [a for a in accels if ACCEL_RE.match(a)]
        if accels:
            rows.append(("自定义", name or command,
                         accels, f"运行: {command}"))

    ext_dirs = glob.glob(f"{HOME}/.local/share/gnome-shell/extensions/*/schemas") + \
        glob.glob("/usr/share/gnome-shell/extensions/*/schemas")
    for sdir in ext_dirs:
        uuid = os.path.basename(os.path.dirname(sdir))
        for xml in glob.glob(f"{sdir}/*.gschema.xml"):
            text = open(xml, encoding="utf-8", errors="ignore").read()
            sid = re.search(r'<schema[^>]*id="([^"]+)"', text)
            if not sid:
                continue
            sid = sid.group(1)
            for km in re.finditer(r'<key name="([^"]+)" type="as">', text):
                key = km.group(1)
                value = run(["gsettings", "--schemadir", sdir, "get", sid, key]).strip()
                items = parse_array(value)
                if items and looks_like_accels(items):
                    rows.append((f"扩展:{uuid.split('@')[0]}", key,
                                 items, describe(key)))
    return rows


# ---------- 表格渲染（按 CJK 显示宽度对齐）----------
def width(s):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def pad(s, w):
    return s + " " * max(0, w - width(s))


def table(headers, data):
    cols = list(zip(*([headers] + data))) if data else [[h] for h in headers]
    widths = [max(width(str(c)) for c in col) for col in cols]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    def fmt(row):
        return "| " + " | ".join(pad(str(c), w) for c, w in zip(row, widths)) + " |"

    out = [line, fmt(headers), line]
    out += [fmt(r) for r in data]
    out.append(line)
    return "\n".join(out)


def find_conflicts(rows):
    norm = defaultdict(list)
    for src, act, accs, _ in rows:
        for a in accs:
            norm[normalize(a)].append((src, act, a))
    return {k: v for k, v in norm.items() if len(v) > 1}


def render_table(rows):
    data = [(src, ", ".join(acc), act, desc) for src, act, acc, desc in rows]
    out = [table(["来源", "快捷键", "动作 (gsettings key)", "中文用途（猜测）"], data)]
    n_acc = sum(len(acc) for _, _, acc, _ in rows)
    out.append(f"\n合计 {n_acc} 个绑定 / {len(rows)} 个动作；带 “?” 的为逐词推测，仅供参考。")
    conflicts = find_conflicts(rows)
    if not conflicts:
        out.append("✓ 未发现重复/冲突的热键。")
    else:
        out.append(f"\n⚠ 发现 {len(conflicts)} 组重复热键：")
        cdata = [(k, raw, src, act)
                 for k, lst in sorted(conflicts.items()) for src, act, raw in lst]
        out.append(table(["归一化组合", "原始写法", "来源", "动作"], cdata))
    return "\n".join(out)


def render_md(rows):
    def cell(s):
        return s.replace("|", "\\|")
    n_acc = sum(len(acc) for _, _, acc, _ in rows)
    conflicts = find_conflicts(rows)
    lines = [
        "# 系统全局热键清单",
        "",
        f"> 自动生成，请勿手改。运行 `python3 list-hotkeys.py --export .` 刷新。",
        "",
        f"合计 **{n_acc}** 个绑定 / **{len(rows)}** 个动作，"
        f"冲突 **{len(conflicts)}** 组。带 `?` 的中文用途为逐词推测。",
        "",
        "| 来源 | 快捷键 | 动作 (gsettings key) | 中文用途（猜测） |",
        "| --- | --- | --- | --- |",
    ]
    for src, act, accs, desc in rows:
        keys = ", ".join(f"`{a}`" for a in accs)
        lines.append(f"| {cell(src)} | {keys} | `{cell(act)}` | {cell(desc)} |")
    lines.append("")
    lines.append("## 冲突")
    if not conflicts:
        lines.append("")
        lines.append("✓ 未发现重复/冲突的热键。")
    else:
        lines += ["", "| 归一化组合 | 原始写法 | 来源 | 动作 |",
                  "| --- | --- | --- | --- |"]
        for k, lst in sorted(conflicts.items()):
            for src, act, raw in lst:
                lines.append(f"| `{k}` | `{raw}` | {cell(src)} | `{cell(act)}` |")
    lines.append("")
    return "\n".join(lines)


def build_json(rows):
    conflicts = find_conflicts(rows)
    return {
        "summary": {
            "bindings": sum(len(acc) for _, _, acc, _ in rows),
            "actions": len(rows),
            "conflicts": len(conflicts),
        },
        "hotkeys": [
            {"source": src, "accelerators": accs, "action": act, "desc_zh": desc}
            for src, act, accs, desc in rows
        ],
        "conflicts": [
            {"normalized": k,
             "entries": [{"source": s, "action": a, "accelerator": r} for s, a, r in lst]}
            for k, lst in sorted(conflicts.items())
        ],
    }


def main():
    import argparse
    import json

    ap = argparse.ArgumentParser(description="列出系统全局热键，标注中文用途并检测冲突。")
    ap.add_argument("--md", action="store_true", help="输出 Markdown 表格到 stdout")
    ap.add_argument("--json", action="store_true", help="输出 JSON 到 stdout")
    ap.add_argument("--export", metavar="DIR",
                    help="把 hotkeys.md 与 hotkeys.json 写入指定目录")
    args = ap.parse_args()

    rows = collect()
    rows.sort(key=lambda r: (r[0], r[1]))

    if args.export:
        os.makedirs(args.export, exist_ok=True)
        md_path = os.path.join(args.export, "hotkeys.md")
        json_path = os.path.join(args.export, "hotkeys.json")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(render_md(rows))
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(build_json(rows), f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"已写入:\n  {md_path}\n  {json_path}")
    elif args.md:
        print(render_md(rows))
    elif args.json:
        print(json.dumps(build_json(rows), ensure_ascii=False, indent=2))
    else:
        print(render_table(rows))


if __name__ == "__main__":
    main()
