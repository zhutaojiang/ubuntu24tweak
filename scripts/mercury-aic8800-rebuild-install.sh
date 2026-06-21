#!/bin/bash
set -euo pipefail

SRC="/usr/src/AIC8800/drivers/aic8800"
KVER="$(uname -r)"
MODDEST="/lib/modules/${KVER}/kernel/drivers/net/wireless/aic8800"
MOK_PRIV="/var/lib/shim-signed/mok/MOK.priv"
MOK_DER="/var/lib/shim-signed/mok/MOK.der"

if [[ "${EUID}" -ne 0 ]]; then
    exec sudo "$0" "$@"
fi

if [[ ! -d "$SRC" ]]; then
    echo "Missing source tree: $SRC" >&2
    exit 1
fi

if journalctl -k -b --no-pager | grep -q 'aicwf_usb_free_urb.*aic8800_fdrv'; then
    echo "The current boot has already hit an aic8800_fdrv kernel Oops." >&2
    echo "Reboot first, then run this script again before plugging/binding the adapter." >&2
    exit 1
fi

cd "$SRC"

echo "Building AIC8800 modules from $SRC ..."
make clean
make

if ! modinfo aic8800_fdrv/aic8800_fdrv.ko | grep -qi 'v2357p014B'; then
    echo "Build finished, but aic8800_fdrv.ko still lacks alias 2357:014b." >&2
    echo "Check CONFIG_USB_BT/source selection before installing." >&2
    exit 1
fi

if mokutil --sb-state 2>/dev/null | grep -qi 'enabled'; then
    if [[ ! -r "$MOK_PRIV" || ! -r "$MOK_DER" ]]; then
        echo "Secure Boot is enabled but MOK key files are not readable." >&2
        exit 1
    fi

    echo "Signing rebuilt modules ..."
    kmodsign sha512 "$MOK_PRIV" "$MOK_DER" aic_load_fw/aic_load_fw.ko
    kmodsign sha512 "$MOK_PRIV" "$MOK_DER" aic8800_fdrv/aic8800_fdrv.ko
fi

echo "Installing modules to $MODDEST ..."
mkdir -p "$MODDEST"
install -p -m 644 aic_load_fw/aic_load_fw.ko "$MODDEST/"
install -p -m 644 aic8800_fdrv/aic8800_fdrv.ko "$MODDEST/"
depmod -a "$KVER"

echo
echo "Installed module aliases:"
modinfo aic8800_fdrv | grep -Ei '2357|014b|a69c|8d8'

echo
if lsmod | grep -q '^aic8800_fdrv\|^aic_load_fw'; then
    echo "New modules are installed, but an old AIC module is already loaded."
    echo "Reboot once, or unplug the adapter and unload the old modules with:"
    echo "  sudo modprobe -r aic8800_fdrv aic_load_fw"
    echo
fi

echo "Done. After the new modules are loaded, plug/replug the Mercury adapter, then run:"
echo "  scripts/mercury-aic8800-enable.sh"
