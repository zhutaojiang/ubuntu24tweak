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

let _keybindingId = null;
let _widgets = [];

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
            this._buildImage(content.pixbuf);
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

    _buildImage(pixbuf) {
        let w = pixbuf.get_width();
        let h = pixbuf.get_height();

        // 初始按最大边等比缩到屏内尺寸，之后仍可滚轮缩放。
        const MAX_W = 600, MAX_H = 700;
        let fit = Math.min(1, MAX_W / w, MAX_H / h);
        let dw = Math.max(1, Math.round(w * fit));
        let dh = Math.max(1, Math.round(h * fit));

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
        _keybindingId = Main.wm.addKeybinding(
            'paste-to-screen',
            this.getSettings('org.gnome.shell.extensions.float-sticker'),
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            _pasteToScreen
        );
    }

    disable() {
        if (_keybindingId) {
            Main.wm.removeKeybinding('paste-to-screen');
            _keybindingId = null;
        }
        while (_widgets.length)
            _widgets[0].destroy();
    }
}
