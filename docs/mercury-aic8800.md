# Mercury USB Wi-Fi Adapter

对应 TODO：本机插着一个 mercury 的无线网卡，但系统识别不到，无法使用 5G Wi-Fi。

## 结论

这支 Mercury USB 网卡不是 Realtek，而是 AICsemi AIC8800D80 系列：

```text
Bus 001 Device 008: ID a69c:8d80 aicsemi AIC Wlan
```

启动日志显示它先以虚拟 U 盘模式出现：

```text
idVendor=a69c, idProduct=5721, Product: Aic MSC
```

随后已被 `usb_modeswitch` 切到 WLAN 模式：

```text
idVendor=a69c, idProduct=8d80, Product: AIC Wlan
```

问题不在模式切换，而在驱动加载。当前系统已经有 AIC8800 驱动文件：

```text
/lib/modules/6.17.0-35-generic/kernel/drivers/net/wireless/aic8800/aic_load_fw.ko
/lib/modules/6.17.0-35-generic/kernel/drivers/net/wireless/aic8800/aic8800_fdrv.ko
```

配套 firmware 位于：

```text
/lib/firmware/aic8800D80/
```

但 `lsmod` 里没有 `aic_load_fw` / `aic8800_fdrv`，`nmcli device status` 也只看到内置 `ath9k` 网卡 `wlp6s0`。内核日志里有关键报错：

```text
Loading of unsigned module is rejected
```

本机 Secure Boot 开启，并且内核已加载本机 MOK：

```text
SecureBoot enabled
Loaded X.509 cert 'ztj-dell Secure Boot Module Signature key: ...'
```

所以根因是：AIC8800 模块存在，但没有签名或没有被 Secure Boot 接受，导致自动加载失败；网卡停在 `a69c:8d80`，没有生成第二个 Wi-Fi 接口。

签名并加载模块后，实测这支卡会再次重枚举成：

```text
ID 2357:014b TP-Link AIC 8800D80
```

当前已安装的 `aic8800_fdrv.ko` 没有内置这个 alias。实测不能通过 `/sys/bus/usb/drivers/aic8800_fdrv/new_id` 强行追加 `2357 014b`：
驱动内部仍会判定 unsupported，并在错误回收路径触发 kernel Oops。正确修复是用 `/usr/src/AIC8800` 中已经包含 TP/Mercury ID 的源码重编安装模块。

`/usr/src/AIC8800` 源码已补 Ubuntu 24.04 HWE 6.17 兼容：

- `MODULE_IMPORT_NS` 在 6.13+ 内核使用字符串参数。
- 旧 timer API 映射到 `timer_delete*` / `timer_container_of()`。
- cfg80211 6.17 的新增 `link_id` / `radio_idx` 参数已补默认值。

已在 `/tmp/AIC8800-buildcheck` 非安装编译验证通过，产物包含：

```text
alias: usb:v2357p014Bd*dc*dsc*dp*ic*isc*ip*in*
```

## 修复

先重启一次，清掉已经 Oops 的旧模块状态。然后重编安装模块：

```bash
scripts/mercury-aic8800-rebuild-install.sh
```

如果安装时旧 `aic8800_fdrv` / `aic_load_fw` 已经在内存里，安装脚本会提示重启或卸载旧模块；否则 `modprobe` 仍可能继续使用内存里的旧模块。

再运行启用脚本：

```bash
scripts/mercury-aic8800-enable.sh
```

脚本会：

1. 使用本机已注册的 MOK 签名 `aic_load_fw.ko` 和 `aic8800_fdrv.ko`。
2. 执行 `depmod`。
3. 加载 `cfg80211`、`aic_load_fw`、`aic8800_fdrv`。
4. 尝试把当前 `a69c:8d80` 设备绑定到 AIC firmware loader；firmware 后的 `2357:014b` 只有在重编后的 `aic8800_fdrv` alias 存在时才会绑定。
5. 输出 `lsusb` 和 `nmcli device status` 供确认。

脚本需要 sudo 密码，因为要签名系统模块、加载内核模块、写 `/sys/bus/usb/drivers/...`。

如果脚本结束后还没出现新 Wi-Fi 设备，拔插一次 Mercury 网卡，再看：

```bash
nmcli device status
```

成功时应多出一个新的 `wifi` 设备，不再只有内置 `wlp6s0`。

## 当前结果

已成功注册为 NetworkManager Wi-Fi 设备：

```text
wlx4cb7e0569cc4          wifi      disconnected            --
p2p-dev-wlx4cb7e0569cc4  wifi-p2p  disconnected            --
```

内核日志确认 5G 支持已启用：

```text
is 5g support = 1
rwnx_get_countrycode_channels support channel: ... 36 40 44 48 ... 149 153 157 161 165
usb 1-1 wlx4cb7e0569cc4: renamed from wlan0
```

连接 5G Wi-Fi 时可在 GNOME 设置里选择该网卡，或指定接口：

```bash
nmcli dev wifi connect "SSID" password "PASSWORD" ifname wlx4cb7e0569cc4
```

如果接口再次消失，先拔插 Mercury 网卡，再运行：

```bash
scripts/mercury-aic8800-enable.sh
```

## 双 Wi-Fi 路由

当前固定为双 Wi-Fi 分工：

```text
wlx4cb7e0569cc4  -> CU_YTeY_5G, 192.168.1.10/24, 默认上网出口
wlp6s0           -> teleroam,   192.168.0.112/24, 仅访问 teleroam 局域网
```

关键 NetworkManager 配置：

```bash
nmcli con mod CU_YTeY_5G connection.interface-name wlx4cb7e0569cc4 802-11-wireless.ssid CU_YTeY_5G 802-11-wireless.band a ipv4.never-default no ipv4.route-metric 100 ipv6.never-default no ipv6.route-metric 100
nmcli con mod teleroam connection.interface-name wlp6s0 ipv4.never-default yes ipv4.route-metric 700 ipv6.never-default yes ipv6.route-metric 700
nmcli con mod teleroam_5g connection.autoconnect no ipv4.never-default yes ipv4.route-metric 800 ipv6.never-default yes ipv6.route-metric 800
```

当前主路由表应类似：

```text
default via 192.168.1.1 dev wlx4cb7e0569cc4 metric 100
192.168.0.0/24 dev wlp6s0 metric 700
192.168.1.0/24 dev wlx4cb7e0569cc4 metric 100
```

## 维护注意

内核升级后，`/lib/modules/<新内核>/.../aic8800/` 下的模块可能需要重新签名。再次运行 `scripts/mercury-aic8800-enable.sh` 即可。
