#!/usr/bin/env bash
# sudo_config.sh — Automated sudoers.d configuration  v1.0.0
# Writes validated sudoers fragments via visudo -c.  Never writes direct to /etc/sudoers.
# Sourced by user_mgmt_master.sh or run standalone.
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    source "${SCRIPT_DIR}/config.conf"
    DRY_RUN=false; VERBOSE=false
    for _a in "$@"; do
        [[ "$_a" == "--dry-run" ]] && DRY_RUN=true
        [[ "$_a" == "--verbose" ]] && VERBOSE=true
    done
    log() { echo "[$(date '+%H:%M:%S')] [$1] [$2] $3"; }
    dry() { $DRY_RUN && echo "[DRY-RUN] $*" || "$@"; }
fi

# ── Write and validate a sudoers fragment ────────────────────────────────────
_write_sudoers_fragment() {
    local filename="$1" content="$2"
    local target="${SUDOERS_DIR}/${filename}"
    local tmpfile; tmpfile="$(mktemp)"

    echo "$content" > "$tmpfile"

    # Validate with visudo before applying
    if ! visudo -c -f "$tmpfile" &>/dev/null; then
        log "ERROR" "SUDO_CONFIG" "Syntax error in sudoers fragment '${filename}' — not applied"
        rm -f "$tmpfile"
        return 1
    fi

    if $DRY_RUN; then
        echo "[DRY-RUN] Would write ${target}:"
        cat "$tmpfile"
        rm -f "$tmpfile"
    else
        install -m "$SUDOERS_FILE_MODE" -o root -g root "$tmpfile" "$target"
        log "INFO" "SUDO_CONFIG" "Wrote validated sudoers fragment: ${target}"
    fi
    rm -f "$tmpfile"
}

module_sudo_config() {
    log "INFO" "SUDO_CONFIG" "Configuring sudo rules"

    # Ensure sudoers.d is included in /etc/sudoers
    if ! grep -q '#includedir\|@includedir' /etc/sudoers 2>/dev/null; then
        log "WARN" "SUDO_CONFIG" "/etc/sudoers does not include ${SUDOERS_DIR} — sudoers.d fragments will not be read"
    fi

    mkdir -p "$SUDOERS_DIR"

    # ── Fragment 1: Admin groups — full sudo ─────────────────────────────────
    local admin_rules=""
    for grp in ${SUDO_ADMIN_GROUPS//,/ }; do
        if getent group "$grp" &>/dev/null; then
            admin_rules+=$'\n'"## ${grp} — full administrative access"$'\n'
            admin_rules+="%${grp} ALL=(ALL:ALL) ALL"$'\n'
        else
            log "WARN" "SUDO_CONFIG" "Admin group '${grp}' does not exist — skipping"
        fi
    done

    if [[ -n "$admin_rules" ]]; then
        local content
        content="## Managed by enterprise-user-mgmt — do not edit manually
## Admin groups — full sudo
## Generated: $(date '+%Y-%m-%d %H:%M:%S')
${admin_rules}"
        _write_sudoers_fragment "10_admin_groups" "$content"
    fi

    # ── Fragment 2: Ops team — restricted commands ────────────────────────────
    # Ops can: restart services, manage containers, view logs — NOT modify users/sudo
    local ops_rules=""
    for grp in ${SUDO_OPS_GROUPS//,/ }; do
        if getent group "$grp" &>/dev/null; then
            ops_rules+=$'\n'"## ${grp} — restricted operational commands"$'\n'
            ops_rules+="Cmnd_Alias OPS_CMDS_${grp^^} = /usr/bin/systemctl restart *, /usr/bin/systemctl stop *, \\
    /usr/bin/systemctl start *, /usr/bin/journalctl -xe, \\
    /usr/bin/docker *, /usr/bin/podman *, \\
    /usr/sbin/service * restart"$'\n'
            ops_rules+="%${grp} ALL=(root) NOPASSWD: OPS_CMDS_${grp^^}"$'\n'
        else
            log "WARN" "SUDO_CONFIG" "Ops group '${grp}' does not exist — skipping"
        fi
    done

    if [[ -n "$ops_rules" ]]; then
        local content
        content="## Managed by enterprise-user-mgmt — do not edit manually
## Ops groups — restricted operational sudo
## Generated: $(date '+%Y-%m-%d %H:%M:%S')
${ops_rules}"
        _write_sudoers_fragment "20_ops_groups" "$content"
    fi

    # ── Fragment 3: Global security defaults ─────────────────────────────────
    local tty_line="" log_line=""
    $SUDO_REQUIRE_TTY && tty_line="Defaults    requiretty" || tty_line="Defaults    !requiretty"
    $SUDO_LOG_OUTPUT  && log_line="Defaults    log_output" || log_line="# log_output disabled"

    local defaults_content
    defaults_content="## Managed by enterprise-user-mgmt — do not edit manually
## Global sudo security defaults
## Generated: $(date '+%Y-%m-%d %H:%M:%S')

## Require a real TTY — prevents sudo from cron/scripts unless explicitly allowed
${tty_line}

## Log all sudo session output to /var/log/sudo-io/
${log_line}

## Timestamp timeout — ask for password after N minutes of inactivity
Defaults    timestamp_timeout=${SUDO_TIMESTAMP_TIMEOUT}

## Restrict PATH to safe executables
Defaults    secure_path=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"

## Do not allow sudo over SSH unless the user has a tty
Defaults    !visiblepw

## Show a warning when sudo is invoked (optional)
Defaults    lecture=once

## Fail if sudo is called by a user not in sudoers (no silent ignore)
Defaults    !exempt_group
"
    _write_sudoers_fragment "00_defaults" "$defaults_content"

    # ── Fragment 4: Auditors — read-only commands ──────────────────────────────
    if getent group "auditors" &>/dev/null; then
        local auditor_content
        auditor_content="## Managed by enterprise-user-mgmt — do not edit manually
## Auditors — read-only system inspection
Cmnd_Alias AUDIT_CMDS = /usr/bin/cat /etc/passwd, /usr/bin/cat /etc/group, \\
    /usr/bin/cat /etc/shadow, /usr/bin/last, /usr/bin/lastlog, \\
    /usr/bin/faillock, /usr/sbin/aureport, /usr/sbin/ausearch, \\
    /usr/bin/journalctl
%auditors ALL=(root) NOPASSWD: AUDIT_CMDS
"
        _write_sudoers_fragment "30_auditors" "$auditor_content"
    fi

    log "INFO" "SUDO_CONFIG" "Sudo configuration complete"
    return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_sudo_config
fi
