import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let _pasteKeybindingId = null;
let _screenshotKeybindingId = null;
let _widgets = [];
let _activeSnip = null;

// 缩放档位阶梯(%)：100% 以下每档 10%，100%→200% 每档 20%，再往上每档 50%。
// 每拨动一次走一档，按下标进退 → 数值永远干净、上下严格可逆。
const ZOOM_STOPS = [
    30, 40, 50, 60, 70, 80, 90,
    100, 120, 140, 160, 180, 200,
    250, 300,
];
const ZOOM_DEFAULT_INDEX = ZOOM_STOPS.indexOf(100);

class StickerWidget {
    constructor(content, x, y) {
        const baseStyle = `
            background-color: rgba(255, 255, 255, 0.97);
            border: 1px solid rgba(0, 0, 0, 0.35);
            border-radius: 10px;
            box-shadow: 0 6px 28px rgba(0, 0, 0, 0.35);
        `;
        // 文本贴纸限定宽度并自动换行；图片贴纸按图自适应、仅留 3px 白边。
        const extraStyle = content.kind === 'image'
            ? 'padding: 3px;'
            : 'min-width: 120px; max-width: 480px;';

        this._actor = new St.Button({
            reactive: true,
            track_hover: true,
            style: baseStyle + extraStyle,
            x: x,
            y: y,
        });

        this._box = new St.BoxLayout({ vertical: true });
        this._actor.set_child(this._box);

        // 右键“重新复制”：文本写回纯文本，图片写回 image/png 原始字节。
        this._recopy = null;

        if (content.kind === 'image')
            this._buildImage(content);
        else
            this._buildText(content.text);

        this._scale = 1.0;
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._lastClickTime = 0;
        this._motionId = null;
        this._releaseId = null;
        this._grab = null;
        this._zoomLabel = null;
        this._zoomLabelTimeout = 0;
        this._scrollSign = 0;
        this._lastScrollTime = 0;
        this._zoomIndex = ZOOM_DEFAULT_INDEX;

        this._buttonPressId = this._actor.connect('button-press-event',
            this._onButtonPress.bind(this));

        this._scrollId = this._actor.connect('scroll-event',
            this._onScroll.bind(this));

        // addChrome 而非 uiGroup.add_child：把本 actor 的(经变换、含缩放的)边界
        // 登记进 stage 输入区(affectsInputRegion 默认 true)。X11 下 shell 给覆盖层
        // 设了输入形状，普通 uiGroup 子节点在应用窗口/桌面上方时事件会穿透到下面的
        // 窗口，导致贴纸压在应用上无法拖动、桌面右键反而弹系统菜单、滚轮也收不到。
        // 登记输入区后，shell 才能在贴纸所在区域收到 按下/释放/滚动 事件。
        Main.layoutManager.addChrome(this._actor);
        this._actor.get_parent().set_child_above_sibling(this._actor, null);
    }

    _buildText(text) {
        this._label = new St.Label({
            text,
            style: 'padding: 10px 14px; color: #111111; font-size: 14px;',
            x_expand: true,
        });
        try {
            this._label.clutter_text.line_wrap = true;
            this._label.clutter_text.line_wrap_mode = 2;
        } catch (e) {
            log('[float-sticker] line_wrap failed: ' + e);
        }
        this._box.add_child(this._label);
        this._recopy = () => St.Clipboard.get_default().set_text(
            St.ClipboardType.CLIPBOARD, text);
    }

    _buildImage(content) {
        let pixbuf = content.pixbuf;
        let w = pixbuf.get_width();
        let h = pixbuf.get_height();

        let dw, dh;
        if (content.displayWidth && content.displayHeight) {
            dw = Math.max(1, Math.round(content.displayWidth));
            dh = Math.max(1, Math.round(content.displayHeight));
        } else {
            // 普通剪贴板图片初始按最大边等比缩到屏内尺寸，之后仍可滚轮缩放。
            const MAX_W = 600, MAX_H = 700;
            let fit = Math.min(1, MAX_W / w, MAX_H / h);
            dw = Math.max(1, Math.round(w * fit));
            dh = Math.max(1, Math.round(h * fit));
        }

        // St.ImageContent 继承自 Clutter.Image，像素经 set_data 写入(St 没有 set_bytes)。
        let imageContent = St.ImageContent.new_with_preferred_size(w, h);
        let fmt = pixbuf.get_has_alpha()
            ? Cogl.PixelFormat.RGBA_8888
            : Cogl.PixelFormat.RGB_888;
        try {
            imageContent.set_data(
                pixbuf.get_pixels(),
                fmt,
                w, h,
                pixbuf.get_rowstride()
            );
        } catch (e) {
            log('[float-sticker] set_data failed: ' + e);
        }

        let img = new St.Widget({ width: dw, height: dh, x_expand: true });
        img.set_content(imageContent);
        this._box.add_child(img);

        // 右键重新复制：从当前 pixbuf 现编码一份 PNG 到全新的 GBytes 再写剪贴板。
        // 不能复用 get_content 回调里的原始 bytes —— X11 下那是剪贴板内部
        // 匿名文件映射的视图，回调返回后即失效，复用会让 MetaAnonymousFile 创建
        // 失败(剪贴板设不上→粘贴还是旧文本，且 X11 取数超时→整桌面卡几秒)。
        this._recopy = () => {
            try {
                let [ok, buf] = pixbuf.save_to_bufferv('png', [], []);
                if (ok) {
                    St.Clipboard.get_default().set_content(
                        St.ClipboardType.CLIPBOARD, 'image/png',
                        GLib.Bytes.new(buf));
                }
            } catch (e) {
                log('[float-sticker] recopy failed: ' + e);
            }
        };
    }

    _onButtonPress(actor, event) {
        let button = event.get_button();
        let time = event.get_time();

        if (button === Clutter.BUTTON_PRIMARY) {
            if (time - this._lastClickTime < 300) {
                this.destroy();
                return Clutter.EVENT_STOP;
            }
            this._lastClickTime = time;

            this._actor.get_parent().set_child_above_sibling(this._actor, null);

            let [x, y] = event.get_coords();
            this._dragging = true;
            this._dragStartX = x - this._actor.x;
            this._dragStartY = y - this._actor.y;

            this._grab = global.stage.grab(this._actor);
            this._motionId = this._actor.connect('motion-event',
                this._onMotion.bind(this));
            this._releaseId = this._actor.connect('button-release-event',
                this._onRelease.bind(this));
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_SECONDARY) {
            if (this._recopy) this._recopy();
            this._actor.get_parent().set_child_above_sibling(this._actor, null);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion() {
        if (!this._dragging) return Clutter.EVENT_PROPAGATE;
        let [x, y] = global.get_pointer();
        this._actor.x = x - this._dragStartX;
        this._actor.y = y - this._dragStartY;
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        this._dragging = false;
        if (this._motionId) {
            this._actor.disconnect(this._motionId);
            this._motionId = null;
        }
        if (this._releaseId) {
            this._actor.disconnect(this._releaseId);
            this._releaseId = null;
        }
        if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
        }
    }

    _onRelease() {
        this._endDrag();
        return Clutter.EVENT_STOP;
    }

    _onScroll(actor, event) {
        // 本设备每个物理滚动档位的 smooth delta 不恒定(实测约 0.8~2.3)、且一档会
        // 拆成数量不定的子事件(含惯性尾)，所以按 delta 大小算缩放必然忽大忽小、上下
        // 不可逆。改为“一次物理拨动 = 恰好一格 10%”：用方向 + 安静间隔(QUIET_MS)把
        // 同一档的连串子事件归并成一步。数值始终是 10 的倍数，上一格/下一格严格可逆。
        let sign;
        let dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.SMOOTH) {
            let [, dy] = event.get_scroll_delta();
            if (dy === 0) return Clutter.EVENT_PROPAGATE; // 滚动停止事件
            sign = dy < 0 ? -1 : 1;                       // <0 上滚放大
        } else if (dir === Clutter.ScrollDirection.UP) {
            sign = -1;
        } else if (dir === Clutter.ScrollDirection.DOWN) {
            sign = 1;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        // 新的一次拨动 = 改变了方向，或距上一个滚动事件超过 QUIET_MS 的安静间隔。
        const QUIET_MS = 50;
        let now = event.get_time();
        let newFlick = sign !== this._scrollSign ||
            (now - this._lastScrollTime) > QUIET_MS;
        this._scrollSign = sign;
        this._lastScrollTime = now;

        if (newFlick) {
            this._zoomStep(sign < 0 ? 1 : -1);
            this._showZoom();
        }
        return Clutter.EVENT_STOP;
    }

    _zoomStep(dir) {
        // dir>0 放大(下标+1)，dir<0 缩小(下标-1)；走阶梯，步进随比例变大。
        let i = Math.min(ZOOM_STOPS.length - 1,
            Math.max(0, this._zoomIndex + (dir > 0 ? 1 : -1)));
        if (i === this._zoomIndex) return;       // 已到顶/到底
        this._zoomIndex = i;
        this._scale = ZOOM_STOPS[i] / 100;
        this._actor.set_scale(this._scale, this._scale);
    }

    _showZoom() {
        if (!this._zoomLabel) {
            this._zoomLabel = new St.Label({
                style: 'background-color: rgba(0,0,0,0.78); color: #ffffff; '
                     + 'font-size: 12px; padding: 2px 7px; border-radius: 7px;',
            });
            // 放在 uiGroup 而非缩放的贴纸里：百分比本身不随图一起缩放，始终清晰。
            Main.layoutManager.uiGroup.add_child(this._zoomLabel);
        }
        this._zoomLabel.text = Math.round(this._scale * 100) + '%';
        // 贴纸默认以左上角为缩放原点，故左上角坐标 = actor.x/y，不随缩放漂移。
        this._zoomLabel.set_position(
            Math.round(this._actor.x + 4),
            Math.round(this._actor.y + 4));
        this._zoomLabel.get_parent().set_child_above_sibling(this._zoomLabel, null);
        this._zoomLabel.show();

        if (this._zoomLabelTimeout)
            GLib.Source.remove(this._zoomLabelTimeout);
        this._zoomLabelTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            if (this._zoomLabel)
                this._zoomLabel.hide();
            this._zoomLabelTimeout = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._endDrag();
        if (this._buttonPressId) {
            this._actor.disconnect(this._buttonPressId);
            this._buttonPressId = null;
        }
        if (this._scrollId) {
            this._actor.disconnect(this._scrollId);
            this._scrollId = null;
        }
        if (this._zoomLabelTimeout) {
            GLib.Source.remove(this._zoomLabelTimeout);
            this._zoomLabelTimeout = 0;
        }
        if (this._zoomLabel) {
            this._zoomLabel.destroy();
            this._zoomLabel = null;
        }
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        let i = _widgets.indexOf(this);
        if (i !== -1) _widgets.splice(i, 1);
    }
}

// ── 截图选区叠加层 ────────────────────────────────────────────────
// Ctrl+F1 进入：全屏半透明蒙版 + 拖拽框选 + 8-向手柄调整 + 贴屏/复制/保存

const MIN_SEL = 5;

class SnipSelection {
    constructor() {
        this._bounds = this._getScreenBounds();

        this._sel = { x: 0, y: 0, w: 0, h: 0 };
        this._mode = 'INIT'; // INIT | SELECTING | SELECTED | MOVING | RESIZING
        this._motionId = null;
        this._releaseId = null;
        this._dragGrab = null;
        this._dragBaseX = 0;
        this._dragBaseY = 0;
        this._selectStartX = 0;
        this._selectStartY = 0;
        this._dragStartSel = null;
        this._hSign = 0;  // resize handle direction: -1/0/1
        this._vSign = 0;
        this._cursor = null;
        this._actors = [];
        this._cancelTimeoutId = 0;
        this._commitTimeoutId = 0;
        this._capturedEventId = 0;
        this._modalGrab = null;
        this._destroyed = false;
        this._committing = false;
        this._root = null;

        this._createUI();
    }

    _getScreenBounds() {
        let monitors = Main.layoutManager.monitors || [];
        if (monitors.length === 0)
            return { x: 0, y: 0, w: global.stage.width, h: global.stage.height };

        let x1 = monitors[0].x;
        let y1 = monitors[0].y;
        let x2 = monitors[0].x + monitors[0].width;
        let y2 = monitors[0].y + monitors[0].height;

        for (let m of monitors) {
            x1 = Math.min(x1, m.x);
            y1 = Math.min(y1, m.y);
            x2 = Math.max(x2, m.x + m.width);
            y2 = Math.max(y2, m.y + m.height);
        }

        return {
            x: x1,
            y: y1,
            w: Math.max(1, x2 - x1),
            h: Math.max(1, y2 - y1),
        };
    }

    _addActor(actor) {
        this._root.add_child(actor);
        this._actors.push(actor);
    }

    _createUI() {
        let b = this._bounds;

        this._root = new St.Widget({
            reactive: true,
            can_focus: true,
            x: b.x, y: b.y,
            width: b.w,
            height: b.h,
        });
        this._root.connect('button-press-event', this._onCapturePress.bind(this));
        this._root.connect('key-press-event', this._onKeyPress.bind(this));
        Main.layoutManager.addChrome(this._root);

        // 捕获层：透明全屏，响应初始框选 & 移动选区
        this._capture = new St.Widget({
            reactive: true,
            can_focus: true,
            x: 0, y: 0, width: b.w, height: b.h,
        });
        this._capture.connect('button-press-event', this._onCapturePress.bind(this));
        this._capture.connect('motion-event', this._onCaptureHover.bind(this));
        this._capture.connect('key-press-event', this._onKeyPress.bind(this));
        this._addActor(this._capture);

        // 暗色蒙版 (4 块，中央挖空)
        for (let i = 0; i < 4; i++) {
            let m = new St.Widget({
                reactive: false,
                style: 'background-color: rgba(0,0,0,0.45);',
            });
            this._addActor(m);
            this._masks = this._masks || [];
            this._masks.push(m);
        }

        // 选区边框
        this._border = new St.Widget({ style: 'border: 2px solid #4A9EFF;' });
        this._border.hide();
        this._addActor(this._border);

        // 8 个缩放手柄
        this._handles = [];
        // 角 + 边中点，signX/signY 指示拖拽方向
        let hDefs = [
            [-1, -1], [0, -1], [1, -1],
            [1,  0], [1,  1], [0,  1],
            [-1, 1], [-1,  0],
        ];
        for (let i = 0; i < 8; i++) {
            let h = new St.Widget({
                reactive: true,
                width: 10, height: 10,
                style: 'background-color: #fff; border: 2px solid #4A9EFF; '
                     + 'border-radius: 2px;',
            });
            h.hide();
            h._handleIdx = i;
            h._signX = hDefs[i][0];
            h._signY = hDefs[i][1];
            h.connect('button-press-event', this._onHandlePress.bind(this));
            this._addActor(h);
            this._handles.push(h);
        }

        // 操作提示
        this._hint = new St.Label({
            text: '拖拽框选截图区域，Esc 取消',
            style: 'color: #fff; font-size: 15px; background-color: rgba(0,0,0,0.55); '
                 + 'padding: 7px 18px; border-radius: 7px;',
        });
        let pm = Main.layoutManager.primaryMonitor;
        this._hint.set_position(
            pm.x - b.x + Math.round((pm.width - 240) / 2),
            pm.y - b.y + Math.round(pm.height * 0.32));
        this._addActor(this._hint);

        // 初始全暗
        this._updateMasks();
        this._raiseInteractiveChrome();
        this._capturedEventId = global.stage.connect('captured-event',
            this._onCapturedEvent.bind(this));
        this._modalGrab = Main.pushModal(this._root);
        if (this._modalGrab &&
            (this._modalGrab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            Main.popModal(this._modalGrab);
            this._modalGrab = null;
        }
        this._capture.grab_key_focus();
        this._armCancelTimeout();
    }

    _updateMasks() {
        let s = this._normalizeSelection(this._sel), b = this._bounds;
        let lx = s.x - b.x, ly = s.y - b.y;
        let isInit = this._mode === 'INIT';
        if (isInit || s.w <= 0 || s.h <= 0) {
            this._masks[0].set_position(0, 0);
            this._masks[0].set_size(b.w, b.h);
            for (let i = 1; i < 4; i++) this._masks[i].hide();
            return;
        }
        // 上方
        this._masks[0].set_position(0, 0);
        this._masks[0].set_size(b.w, Math.max(0, ly));
        // 下方
        this._masks[1].set_position(0, ly + s.h);
        this._masks[1].set_size(b.w, Math.max(0, b.h - (ly + s.h)));
        // 左方
        this._masks[2].set_position(0, ly);
        this._masks[2].set_size(Math.max(0, lx), s.h);
        // 右方
        this._masks[3].set_position(lx + s.w, ly);
        this._masks[3].set_size(Math.max(0, b.w - (lx + s.w)), s.h);
        for (let i = 0; i < 4; i++) this._masks[i].show();
    }

    _updateBorder() {
        let s = this._normalizeSelection(this._sel);
        if (s.w > 0 && s.h > 0) {
            this._border.set_position(
                s.x - this._bounds.x - 1,
                s.y - this._bounds.y - 1);
            this._border.set_size(s.w + 2, s.h + 2);
            this._border.show();
        } else {
            this._border.hide();
        }
    }

    _updateHandles() {
        let r = this._normalizeSelection(this._sel);
        if (r.w <= 0 || r.h <= 0) {
            for (let h of this._handles) h.hide();
            return;
        }
        let hw = 5; // half handle size
        let lx = r.x - this._bounds.x, ly = r.y - this._bounds.y;
        let cx = lx + r.w / 2, cy = ly + r.h / 2;
        let pos = [
            [lx - hw, ly - hw],
            [cx - hw, ly - hw],
            [lx + r.w - hw, ly - hw],
            [lx + r.w - hw, cy - hw],
            [lx + r.w - hw, ly + r.h - hw],
            [cx - hw, ly + r.h - hw],
            [lx - hw, ly + r.h - hw],
            [lx - hw, cy - hw],
        ];
        for (let i = 0; i < 8; i++) {
            this._handles[i].set_position(Math.round(pos[i][0]), Math.round(pos[i][1]));
            this._handles[i].show();
        }
    }

    _updateHintPos() {
        let [minW, natW] = this._hint.get_preferred_width(-1);
        let [minH, natH] = this._hint.get_preferred_height(-1);
        let r = this._normalizeSelection(this._sel), b = this._bounds;

        let x = r.x - b.x + (r.w - natW) / 2;
        let y = r.y - b.y + r.h + 12;
        if (y + natH > b.h)
            y = r.y - b.y - natH - 12;
        x = Math.round(Math.max(0, Math.min(x, b.w - natW)));
        y = Math.round(Math.max(0, Math.min(y, b.h - natH)));

        this._hint.set_position(x, y);
        this._hint.show();
        this._raiseInteractiveChrome();
    }

    _refreshUI() {
        this._updateMasks();
        this._updateBorder();
        if (this._mode !== 'SELECTING' && this._mode !== 'INIT') {
            this._updateHandles();
            this._updateHintPos();
        }
        this._raiseInteractiveChrome();
    }

    // ── 事件 ──────────────────────────────────────────────────

    _onCapturedEvent(actor, event) {
        let type = event.type();
        if (type === Clutter.EventType.KEY_PRESS)
            return this._handleKeyEvent(event);

        if (this._committing &&
            (type === Clutter.EventType.MOTION ||
             type === Clutter.EventType.BUTTON_PRESS ||
             type === Clutter.EventType.BUTTON_RELEASE))
            return Clutter.EVENT_STOP;

        if (this._mode === 'SELECTED' && type === Clutter.EventType.MOTION) {
            this._updateCursorAtPointer();
            return Clutter.EVENT_PROPAGATE;
        }

        if (this._mode === 'SELECTING' ||
            this._mode === 'MOVING' ||
            this._mode === 'RESIZING') {
            if (type === Clutter.EventType.MOTION)
                return this._onMotion();
            if (type === Clutter.EventType.BUTTON_RELEASE)
                return this._onRelease();
            if (type === Clutter.EventType.BUTTON_PRESS)
                return this._onRelease();
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onKeyPress(actor, event) {
        return this._handleKeyEvent(event);
    }

    _handleKeyEvent(event) {
        this._armCancelTimeout();
        let key = event.get_key_symbol();
        let ch = '';
        try {
            let unicode = event.get_key_unicode();
            if (unicode)
                ch = String.fromCodePoint(unicode).toLowerCase();
        } catch (e) {
            ch = '';
        }

        if (key === Clutter.KEY_Escape) {
            this.destroy();
            return Clutter.EVENT_STOP;
        }
        if (this._mode !== 'SELECTED')
            return Clutter.EVENT_PROPAGATE;

        if (key === Clutter.KEY_t || key === Clutter.KEY_T || ch === 't')
            return this._commitFromKey('paste');
        if (key === Clutter.KEY_c || key === Clutter.KEY_C || ch === 'c')
            return this._commitFromKey('copy');
        if (key === Clutter.KEY_s || key === Clutter.KEY_S || ch === 's')
            return this._commitFromKey('save');

        return Clutter.EVENT_PROPAGATE;
    }

    _commitFromKey(action) {
        if (this._committing)
            return Clutter.EVENT_STOP;
        this._commit(action);
        return Clutter.EVENT_STOP;
    }

    _onCapturePress(actor, event) {
        if (this._committing)
            return Clutter.EVENT_STOP;
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        if (this._mode === 'SELECTING' ||
            this._mode === 'MOVING' ||
            this._mode === 'RESIZING')
            return this._onRelease();

        this._armCancelTimeout();

        let [x, y] = event.get_coords();
        let handleHit = this._hitHandle(x, y);
        if (this._mode === 'SELECTED' && handleHit) {
            this._beginResize(handleHit.signX, handleHit.signY, x, y);
            return Clutter.EVENT_STOP;
        }

        // 已有选区 → 点击内部 = 移动
        if (this._mode === 'SELECTED' && this._hitSel(x, y)) {
            this._resetCursor();
            this._mode = 'MOVING';
            this._dragBaseX = x - this._sel.x;
            this._dragBaseY = y - this._sel.y;
            this._beginGrab();
            return Clutter.EVENT_STOP;
        }

        // 其它情况 → 开始新框选
        this._resetCursor();
        this._mode = 'SELECTING';
        this._selectStartX = x;
        this._selectStartY = y;
        this._sel = { x, y, w: 0, h: 0 };
        this._border.hide();
        for (let h of this._handles) h.hide();
        this._hint.hide();
        this._updateMasks();
        this._beginGrab();
        return Clutter.EVENT_STOP;
    }

    _onCaptureHover() {
        if (this._committing ||
            this._mode === 'SELECTING' ||
            this._mode === 'MOVING' ||
            this._mode === 'RESIZING')
            return Clutter.EVENT_PROPAGATE;

        this._updateCursorAtPointer();
        return Clutter.EVENT_PROPAGATE;
    }

    _onHandlePress(actor, event) {
        if (this._committing)
            return Clutter.EVENT_STOP;
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._armCancelTimeout();

        let [x, y] = event.get_coords();
        this._beginResize(actor._signX, actor._signY, x, y);
        return Clutter.EVENT_STOP;
    }

    _beginResize(signX, signY, x, y) {
        this._mode = 'RESIZING';
        this._hSign = signX;
        this._vSign = signY;
        this._dragBaseX = x;
        this._dragBaseY = y;
        this._dragStartSel = { ...this._sel };
        this._setResizeCursor(signX, signY);
        this._beginGrab();
    }

    _beginGrab() {
        if (!this._dragGrab) {
            try {
                this._dragGrab = global.stage.grab(this._root);
            } catch (e) {
                log('[float-sticker] drag grab failed: ' + e);
            }
        }
        if (!this._motionId) {
            this._motionId = this._root.connect('motion-event',
                this._onMotion.bind(this));
        }
        if (!this._releaseId) {
            this._releaseId = this._root.connect('button-release-event',
                this._onRelease.bind(this));
        }
    }

    _endGrab() {
        if (this._motionId) { this._root.disconnect(this._motionId); this._motionId = null; }
        if (this._releaseId) { this._root.disconnect(this._releaseId); this._releaseId = null; }
        if (this._dragGrab) {
            this._dragGrab.dismiss();
            this._dragGrab = null;
        }
    }

    _onMotion() {
        if (this._committing)
            return Clutter.EVENT_STOP;
        this._armCancelTimeout();
        let [x, y] = global.get_pointer();

        if (this._mode === 'SELECTING') {
            let sx = this._selectStartX, sy = this._selectStartY;
            this._sel = this._normalizeSelection({
                x: Math.min(sx, x),
                y: Math.min(sy, y),
                w: Math.abs(x - sx),
                h: Math.abs(y - sy),
            });
            this._updateMasks();
            this._updateBorder();
        } else if (this._mode === 'MOVING') {
            this._sel.x = x - this._dragBaseX;
            this._sel.y = y - this._dragBaseY;
            this._sel = this._clampSelection(this._sel);
            this._refreshUI();
        } else if (this._mode === 'RESIZING') {
            let dx = x - this._dragBaseX;
            let dy = y - this._dragBaseY;
            this._sel = this._resizeSelection(this._dragStartSel, dx, dy);
            this._refreshUI();
        }
        return Clutter.EVENT_STOP;
    }

    _onRelease() {
        if (this._committing)
            return Clutter.EVENT_STOP;
        this._endGrab();
        this._armCancelTimeout();
        if (this._mode === 'SELECTING') {
            if (this._sel.w < MIN_SEL && this._sel.h < MIN_SEL) {
                this._mode = 'INIT';
                this._sel = { x: 0, y: 0, w: 0, h: 0 };
                this._border.hide();
                this._hint.set_text('拖拽框选截图区域，Esc 取消');
                this._hint.show();
                this._updateMasks();
            } else {
                this._sel = this._normalizeSelection(this._sel);
                this._mode = 'SELECTED';
                this._hint.set_text('T 贴屏幕   C 复制   S 保存   Esc 取消');
                this._refreshUI();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._destroyed && this._mode === 'SELECTED')
                        this._updateHintPos();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else if (this._mode === 'MOVING' || this._mode === 'RESIZING') {
            this._sel = this._normalizeSelection(this._sel);
            this._mode = 'SELECTED';
            this._resetCursor();
            this._hint.set_text('T 贴屏幕   C 复制   S 保存   Esc 取消');
            this._updateHintPos();
        }
        return Clutter.EVENT_STOP;
    }

    _hitSel(x, y) {
        let s = this._normalizeSelection(this._sel);
        return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    }

    _hitHandle(x, y) {
        let r = this._normalizeSelection(this._sel);
        if (r.w <= 0 || r.h <= 0)
            return null;

        let cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        let handles = [
            [r.x, r.y, -1, -1],
            [cx, r.y, 0, -1],
            [r.x + r.w, r.y, 1, -1],
            [r.x + r.w, cy, 1, 0],
            [r.x + r.w, r.y + r.h, 1, 1],
            [cx, r.y + r.h, 0, 1],
            [r.x, r.y + r.h, -1, 1],
            [r.x, cy, -1, 0],
        ];
        const HIT = 10;
        for (let [hx, hy, signX, signY] of handles) {
            if (Math.abs(x - hx) <= HIT && Math.abs(y - hy) <= HIT)
                return { signX, signY };
        }
        return null;
    }

    _normalizeSelection(sel) {
        let b = this._bounds;
        let x1 = Math.min(sel.x, sel.x + sel.w);
        let y1 = Math.min(sel.y, sel.y + sel.h);
        let x2 = Math.max(sel.x, sel.x + sel.w);
        let y2 = Math.max(sel.y, sel.y + sel.h);

        x1 = Math.max(b.x, Math.min(x1, b.x + b.w));
        y1 = Math.max(b.y, Math.min(y1, b.y + b.h));
        x2 = Math.max(b.x, Math.min(x2, b.x + b.w));
        y2 = Math.max(b.y, Math.min(y2, b.y + b.h));

        return {
            x: x1,
            y: y1,
            w: Math.max(0, x2 - x1),
            h: Math.max(0, y2 - y1),
        };
    }

    _clampSelection(sel) {
        let b = this._bounds;
        let s = this._normalizeSelection(sel);
        s.x = Math.max(b.x, Math.min(s.x, b.x + b.w - s.w));
        s.y = Math.max(b.y, Math.min(s.y, b.y + b.h - s.h));
        return s;
    }

    _resizeSelection(startSel, dx, dy) {
        let b = this._bounds;
        let s = this._normalizeSelection(startSel);
        let left = s.x;
        let top = s.y;
        let right = s.x + s.w;
        let bottom = s.y + s.h;

        if (this._hSign < 0)
            left = Math.max(b.x, Math.min(left + dx, right - MIN_SEL));
        else if (this._hSign > 0)
            right = Math.min(b.x + b.w, Math.max(right + dx, left + MIN_SEL));

        if (this._vSign < 0)
            top = Math.max(b.y, Math.min(top + dy, bottom - MIN_SEL));
        else if (this._vSign > 0)
            bottom = Math.min(b.y + b.h, Math.max(bottom + dy, top + MIN_SEL));

        return {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top,
        };
    }

    _updateCursorAtPointer() {
        let [x, y] = global.get_pointer();
        let handleHit = this._hitHandle(x, y);
        if (handleHit)
            this._setResizeCursor(handleHit.signX, handleHit.signY);
        else
            this._resetCursor();
    }

    _setResizeCursor(signX, signY) {
        let cursor = null;
        if (signX === 0)
            cursor = Meta.Cursor.NORTH_RESIZE;
        else if (signY === 0)
            cursor = Meta.Cursor.EAST_RESIZE;
        else if (signX === signY)
            cursor = Meta.Cursor.NW_RESIZE;
        else
            cursor = Meta.Cursor.NE_RESIZE;

        if (this._cursor === cursor)
            return;

        try {
            global.display.set_cursor(cursor);
            this._cursor = cursor;
        } catch (e) {
            log('[float-sticker] set cursor failed: ' + e);
        }
    }

    _resetCursor() {
        if (!this._cursor)
            return;
        try {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        } catch (e) {
            log('[float-sticker] reset cursor failed: ' + e);
        }
        this._cursor = null;
    }

    _raiseInteractiveChrome() {
        let parent = this._root;
        if (!parent)
            return;

        parent.set_child_above_sibling(this._capture, null);
        if (this._masks) {
            for (let m of this._masks)
                parent.set_child_above_sibling(m, null);
        }
        if (this._border)
            parent.set_child_above_sibling(this._border, null);
        if (this._handles) {
            for (let h of this._handles)
                parent.set_child_above_sibling(h, null);
        }
        if (this._hint)
            parent.set_child_above_sibling(this._hint, null);
    }

    _armCancelTimeout() {
        if (this._cancelTimeoutId) {
            GLib.Source.remove(this._cancelTimeoutId);
            this._cancelTimeoutId = 0;
        }
        this._cancelTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 180, () => {
                this._cancelTimeoutId = 0;
                log('[float-sticker] snip overlay auto-cancelled after timeout');
                this.destroy();
                return GLib.SOURCE_REMOVE;
            });
    }

    // ── 提交 ──────────────────────────────────────────────────

    _commit(action) {
        if (this._committing)
            return;
        this._committing = true;
        this._hint.set_text('正在处理截图...');
        this._hint.show();
        this._raiseInteractiveChrome();

        let r = this._normalizeSelection(this._sel);
        let x = Math.round(r.x), y = Math.round(r.y);
        let w = Math.round(r.w), h = Math.round(r.h);
        log(`[float-sticker] snip commit ${action}: x=${x} y=${y} w=${w} h=${h}`);
        let tmpPath = GLib.build_filenamev([
            GLib.get_tmp_dir(), `float-sticker-ss-${Date.now()}.png`]);
        this._commitTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 10, () => {
                this._commitTimeoutId = 0;
                Main.notify('截图失败', '截图处理超时');
                this.destroy();
                return GLib.SOURCE_REMOVE;
            });

        let screenshot = null;
        try {
            screenshot = new Shell.Screenshot();
        } catch (e) {
            log('[float-sticker] Shell.Screenshot construct failed: ' + e);
            Main.notify('截图失败', '无法初始化截图服务');
            this.destroy();
            return;
        }

        let file = Gio.File.new_for_path(tmpPath);
        let stream = null;
        try {
            stream = file.replace(
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            log('[float-sticker] create screenshot stream failed: ' + e);
            Main.notify('截图失败', '无法创建临时截图文件');
            this.destroy();
            return;
        }

        if (this._root)
            this._root.hide();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;

            screenshot.screenshot_area(x, y, w, h, stream, (src, res) => {
                let filename = null;
                try {
                    let [success] = screenshot.screenshot_area_finish(res);
                    stream.close(null);
                    if (success)
                        filename = tmpPath;
                } catch (e) {
                    log('[float-sticker] screenshot_area failed: ' + e);
                    try {
                        stream.close(null);
                    } catch (closeError) {
                        log('[float-sticker] close screenshot stream failed: ' + closeError);
                    }
                }

                if (!filename) {
                    Main.notify('截图失败', '无法截取选区');
                    this.destroy();
                    return;
                }

                let pixbuf = null;
                try {
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);
                    let f = Gio.File.new_for_path(filename);
                    f.delete(null);
                } catch (e) {
                    log('[float-sticker] load screenshot failed: ' + e);
                }

                if (!pixbuf) {
                    Main.notify('截图失败', '无法读取截图文件');
                    this.destroy();
                    return;
                }

                try {
                    if (action === 'paste') {
                        // Image stickers have 3px padding; offset the actor so
                        // the captured pixels line up with the selected area.
                        _widgets.push(new StickerWidget(
                            { kind: 'image', pixbuf, displayWidth: w, displayHeight: h },
                            Math.round(r.x - 4),
                            Math.round(r.y - 4)));
                    } else if (action === 'copy') {
                        let [ok, buf] = pixbuf.save_to_bufferv('png', [], []);
                        if (ok) {
                            St.Clipboard.get_default().set_content(
                                St.ClipboardType.CLIPBOARD, 'image/png',
                                GLib.Bytes.new(buf));
                            Main.notify('截图已复制', '已写入剪贴板');
                        }
                    } else if (action === 'save') {
                        let pics = GLib.get_user_special_dir(
                            GLib.UserDirectory.DIRECTORY_PICTURES);
                        if (!pics)
                            pics = GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
                        GLib.mkdir_with_parents(pics, 0o755);
                        let ts = new Date().toISOString()
                            .replace(/[:.]/g, '-').slice(0, 19);
                        let savePath = GLib.build_filenamev(
                            [pics, `Screenshot_${ts}.png`]);
                        pixbuf.savev(savePath, 'png', [], []);
                        Main.notify('截图已保存', savePath);
                    }
                } catch (e) {
                    log('[float-sticker] commit error: ' + e);
                    Main.notify('截图处理失败', String(e));
                }

                this.destroy();
            }, null);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── 销毁 ──────────────────────────────────────────────────

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._endGrab();
        this._resetCursor();
        if (this._cancelTimeoutId) {
            GLib.Source.remove(this._cancelTimeoutId);
            this._cancelTimeoutId = 0;
        }
        if (this._commitTimeoutId) {
            GLib.Source.remove(this._commitTimeoutId);
            this._commitTimeoutId = 0;
        }
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
        if (this._modalGrab) {
            Main.popModal(this._modalGrab);
            this._modalGrab = null;
        }
        if (this._root) {
            Main.layoutManager.removeChrome(this._root);
            this._root.destroy();
            this._root = null;
        }
        this._actors = [];
        if (_activeSnip === this) _activeSnip = null;
    }
}

function _startScreenshot() {
    if (_activeSnip) return;
    _activeSnip = new SnipSelection();
}

function _spawn(content) {
    let m = Main.layoutManager.primaryMonitor;
    let off = _widgets.length * 30;
    _widgets.push(new StickerWidget(content, m.x + 80 + off, m.y + 80 + off));
}

function _pasteTextFallback(clipboard) {
    clipboard.get_text(St.ClipboardType.CLIPBOARD, (c, text) => {
        if (text && text.trim().length > 0)
            _spawn({ kind: 'text', text });
    });
}

function _pasteToScreen() {
    let clipboard = St.Clipboard.get_default();

    // 先看剪贴板里有没有图片类型(get_mimetypes 返回可用 MIME 列表)，
    // 优先 image/png，否则任意 image/*；没有图片再回退到文本。
    let mimetypes = [];
    try {
        mimetypes = clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) || [];
    } catch (e) {
        log('[float-sticker] get_mimetypes failed: ' + e);
    }
    let imgMime = mimetypes.includes('image/png')
        ? 'image/png'
        : mimetypes.find(m => m.startsWith('image/'));

    if (!imgMime) {
        _pasteTextFallback(clipboard);
        return;
    }

    clipboard.get_content(St.ClipboardType.CLIPBOARD, imgMime, (clip, bytes) => {
        let pixbuf = null;
        if (bytes && bytes.get_size() > 0) {
            try {
                let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
            } catch (e) {
                log('[float-sticker] image decode failed: ' + e);
            }
        }
        if (pixbuf)
            _spawn({ kind: 'image', pixbuf });
        else
            _pasteTextFallback(clipboard);
    });
}

export default class FloatStickerExtension extends Extension {
    enable() {
        _pasteKeybindingId = Main.wm.addKeybinding(
            'paste-to-screen',
            this.getSettings('org.gnome.shell.extensions.float-sticker'),
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            _pasteToScreen
        );
        _screenshotKeybindingId = Main.wm.addKeybinding(
            'screenshot-to-screen',
            this.getSettings('org.gnome.shell.extensions.float-sticker'),
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            _startScreenshot
        );
    }

    disable() {
        if (_pasteKeybindingId) {
            Main.wm.removeKeybinding('paste-to-screen');
            _pasteKeybindingId = null;
        }
        if (_screenshotKeybindingId) {
            Main.wm.removeKeybinding('screenshot-to-screen');
            _screenshotKeybindingId = null;
        }
        if (_activeSnip) _activeSnip.destroy();
        while (_widgets.length)
            _widgets[0].destroy();
    }
}
