#!/bin/bash
set -euo pipefail

KVER="$(uname -r)"
MODDIR="/lib/modules/${KVER}/kernel/drivers/net/wireless/aic8800"
LOAD_FW="${MODDIR}/aic_load_fw.ko"
FDRV="${MODDIR}/aic8800_fdrv.ko"
MOK_PRIV="/var/lib/shim-signed/mok/MOK.priv"
MOK_DER="/var/lib/shim-signed/mok/MOK.der"

if [[ "${EUID}" -ne 0 ]]; then
    exec sudo "$0" "$@"
fi

have() {
    command -v "$1" >/dev/null 2>&1
}

show_state() {
    echo
    echo "== USB devices =="
    lsusb | grep -Ei 'a69c|368b|aic|wlan' || true

    echo
    echo "== NetworkManager devices =="
    if have nmcli; then
        nmcli device status
    else
        ip link
    fi

    echo
    echo "== AIC modules =="
    lsmod | grep -E '(^aic_load_fw|^aic8800_fdrv|^cfg80211)' || true
}

require_file() {
    if [[ ! -e "$1" ]]; then
        echo "Missing: $1" >&2
        exit 1
    fi
}

sign_if_possible() {
    local module="$1"
    local signer
    signer="$(modinfo -F signer "$module" 2>/dev/null || true)"

    if [[ -n "$signer" ]]; then
        echo "Already signed: $module ($signer)"
        return
    fi

    if [[ ! -r "$MOK_PRIV" || ! -r "$MOK_DER" ]]; then
        echo "Unsigned module and MOK key is not readable: $module" >&2
        echo "Either disable Secure Boot or sign it manually with an enrolled MOK key." >&2
        exit 1
    fi

    echo "Signing: $module"
    kmodsign sha512 "$MOK_PRIV" "$MOK_DER" "$module"
}

bind_current_aic_devices() {
    local driver="$1"
    local vendor="$2"
    local product="$3"
    local dev vendor_file product_file target targetname

    [[ -d "/sys/bus/usb/drivers/${driver}" ]] || return 0

    # new_id may fail with "File exists" if the id is already registered.
    printf '%s %s' "$vendor" "$product" >"/sys/bus/usb/drivers/${driver}/new_id" 2>/dev/null || true

    for dev in /sys/bus/usb/devices/*; do
        vendor_file="${dev}/idVendor"
        product_file="${dev}/idProduct"
        [[ -r "$vendor_file" && -r "$product_file" ]] || continue
        [[ "$(cat "$vendor_file")" == "$vendor" && "$(cat "$product_file")" == "$product" ]] || continue

        for target in "$dev" "$dev":*; do
            [[ -e "$target" ]] || continue
            [[ -e "${target}/driver" ]] && continue

            targetname="$(basename "$target")"
            echo "Binding ${targetname} to ${driver}"
            printf '%s' "$targetname" >"/sys/bus/usb/drivers/${driver}/bind" 2>/dev/null || true
        done
    done
}

require_file "$LOAD_FW"
require_file "$FDRV"

echo "Before:"
show_state

if mokutil --sb-state 2>/dev/null | grep -qi 'enabled'; then
    sign_if_possible "$LOAD_FW"
    sign_if_possible "$FDRV"
fi

depmod -a "$KVER"

echo
echo "Loading modules..."
modprobe cfg80211
modprobe aic_load_fw
modprobe aic8800_fdrv

bind_current_aic_devices aic_load_fw a69c 8d80

echo
echo "Waiting for firmware handoff..."
sleep 5

# Different AIC8800D80 adapters re-enumerate to different post-firmware ids.
bind_current_aic_devices aic8800_fdrv 368b 8d83
bind_current_aic_devices aic8800_fdrv 368b 8d8c
bind_current_aic_devices aic8800_fdrv 368b 8d81
bind_current_aic_devices aic8800_fdrv a69c 8d81
if lsusb | grep -qi '2357:014b'; then
    if ! modinfo aic8800_fdrv 2>/dev/null | grep -qi 'v2357p014B'; then
        echo
        echo "Detected 2357:014b after firmware handoff, but the installed aic8800_fdrv"
        echo "module does not contain this USB alias. Do not force-bind it with new_id:"
        echo "this driver rejects the id internally and can trigger a kernel Oops."
        echo
        echo "Reboot once, then run:"
        echo "  scripts/mercury-aic8800-rebuild-install.sh"
        exit 1
    fi

    bind_current_aic_devices aic8800_fdrv 2357 014b
fi

echo
echo "After:"
show_state

echo
echo "If no new Wi-Fi interface appeared, unplug and replug the Mercury adapter, then run:"
echo "  nmcli device status"
