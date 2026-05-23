#!/usr/bin/env bash
# password_policy.sh — System-wide password policy via PAM + login.defs  v1.0.0
# Configures /etc/security/pwquality.conf, /etc/login.defs, PAM pam_pwquality,
# and pam_pwhistory.  Non-destructive: backs up originals before modifying.
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

# ── Safe file edit helper: backup + sed-replace or append ────────────────────
_set_config_value() {
    local file="$1" key="$2" value="$3"
    if grep -qE "^[[:space:]]*${key}[[:space:]]" "$file" 2>/dev/null; then
        dry sed -i "s|^[[:space:]]*${key}[[:space:]].*|${key} = ${value}|" "$file"
    elif grep -qE "^#[[:space:]]*${key}[[:space:]]" "$file" 2>/dev/null; then
        dry sed -i "s|^#[[:space:]]*${key}[[:space:]].*|${key} = ${value}|" "$file"
    else
        $DRY_RUN || echo "${key} = ${value}" >> "$file"
        $DRY_RUN && echo "[DRY-RUN] Appending to ${file}: ${key} = ${value}"
    fi
}

_set_logindefs_value() {
    local file="/etc/login.defs" key="$1" value="$2"
    if grep -qE "^[[:space:]]*${key}[[:space:]]" "$file" 2>/dev/null; then
        dry sed -i "s|^[[:space:]]*${key}[[:space:]].*|${key}    ${value}|" "$file"
    elif grep -qE "^#[[:space:]]*${key}[[:space:]]" "$file" 2>/dev/null; then
        dry sed -i "s|^#[[:space:]]*${key}[[:space:]].*|${key}    ${value}|" "$file"
    else
        $DRY_RUN || echo "${key}    ${value}" >> "$file"
        $DRY_RUN && echo "[DRY-RUN] Appending to /etc/login.defs: ${key}    ${value}"
    fi
}

module_password_policy() {
    log "INFO" "PASSWORD_POLICY" "Applying system-wide password policy"

    # ── 1. pwquality.conf ──────────────────────────────────────────────────────
    local pwq_conf="/etc/security/pwquality.conf"
    if [[ ! -f "$pwq_conf" ]]; then
        log "WARN" "PASSWORD_POLICY" "${pwq_conf} not found — pam_pwquality may not be installed"
    else
        # Backup
        if ! $DRY_RUN; then
            cp "${pwq_conf}" "${pwq_conf}.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        fi

        log "INFO" "PASSWORD_POLICY" "Configuring ${pwq_conf}"
        _set_config_value "$pwq_conf" "minlen"           "$PWQ_MINLEN"
        _set_config_value "$pwq_conf" "dcredit"          "$PWQ_DCREDIT"
        _set_config_value "$pwq_conf" "ucredit"          "$PWQ_UCREDIT"
        _set_config_value "$pwq_conf" "lcredit"          "$PWQ_LCREDIT"
        _set_config_value "$pwq_conf" "ocredit"          "$PWQ_OCREDIT"
        _set_config_value "$pwq_conf" "minclass"         "$PWQ_MINCLASS"
        _set_config_value "$pwq_conf" "maxrepeat"        "$PWQ_MAXREPEAT"
        _set_config_value "$pwq_conf" "maxclassrepeat"   "$PWQ_MAXCLASSREPEAT"
        _set_config_value "$pwq_conf" "gecoscheck"       "$PWQ_GECOSCHECK"
        _set_config_value "$pwq_conf" "dictcheck"        "$PWQ_DICTCHECK"
        _set_config_value "$pwq_conf" "enforce_for_root" "$PWQ_ENFORCE_FOR_ROOT"
        _set_config_value "$pwq_conf" "retry"            "$PWQ_RETRY"
        log "INFO" "PASSWORD_POLICY" "pwquality.conf configured (minlen=${PWQ_MINLEN}, classes=${PWQ_MINCLASS})"
    fi

    # ── 2. login.defs — global aging defaults ─────────────────────────────────
    if [[ -f "/etc/login.defs" ]]; then
        if ! $DRY_RUN; then
            cp /etc/login.defs "/etc/login.defs.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        fi
        log "INFO" "PASSWORD_POLICY" "Configuring /etc/login.defs aging defaults"
        _set_logindefs_value "PASS_MAX_DAYS"  "$PASS_MAX_DAYS"
        _set_logindefs_value "PASS_MIN_DAYS"  "$PASS_MIN_DAYS"
        _set_logindefs_value "PASS_WARN_AGE"  "$PASS_WARN_AGE"
        log "INFO" "PASSWORD_POLICY" "login.defs: MAX=${PASS_MAX_DAYS} MIN=${PASS_MIN_DAYS} WARN=${PASS_WARN_AGE}"
    else
        log "WARN" "PASSWORD_POLICY" "/etc/login.defs not found"
    fi

    # ── 3. PAM — ensure pam_pwquality and pam_pwhistory are configured ────────
    # RHEL 9: authselect manages PAM.  We use authselect with the with-pwhistory feature.
    if command -v authselect &>/dev/null; then
        log "INFO" "PASSWORD_POLICY" "Configuring PAM via authselect"
        if $DRY_RUN; then
            echo "[DRY-RUN] authselect select sssd with-pwhistory without-nullok --force"
            echo "[DRY-RUN] authselect enable-feature with-pwhistory"
        else
            # Apply current profile with pwhistory enabled
            local current_profile
            current_profile=$(authselect current --raw 2>/dev/null | head -1 || echo "sssd")
            authselect select "$current_profile" with-pwhistory without-nullok --force 2>/dev/null \
                || log "WARN" "PASSWORD_POLICY" "authselect select returned non-zero — check profile name"
            authselect enable-feature with-pwhistory 2>/dev/null || true
            log "INFO" "PASSWORD_POLICY" "authselect: pwhistory feature enabled (remember=${PWQ_REMEMBER})"
        fi

        # Set pam_pwhistory remember count in the PAM config
        local pam_pwhistory_conf="/etc/pam.d/system-auth"
        if [[ -f "$pam_pwhistory_conf" ]]; then
            if grep -q "pam_pwhistory" "$pam_pwhistory_conf"; then
                dry sed -i "s|pam_pwhistory.so.*|pam_pwhistory.so remember=${PWQ_REMEMBER} enforce_for_root|" \
                    "$pam_pwhistory_conf" || true
            fi
        fi
    else
        log "WARN" "PASSWORD_POLICY" "authselect not available — manually verify PAM pam_pwquality and pam_pwhistory configuration"
    fi

    log "INFO" "PASSWORD_POLICY" "Password policy applied successfully"
    return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_password_policy
fi
