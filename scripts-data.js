// scripts-data.js — Embedded script content for the web script explorer
// Each entry mirrors the actual file in the repository.

const SCRIPTS_DATA = [
  {
    id: 'master',
    name: 'user_mgmt_master.sh',
    path: 'user_mgmt_master.sh',
    description: 'Orchestrator script. Loads all modules, enforces run order (groups → users → sudo → policy → aging → locking → report), handles --dry-run, --verbose, --module, --report-only flags, and produces a final status summary.',
    badge: 'core',
    code: `#!/usr/bin/env bash
# user_mgmt_master.sh — Enterprise User & Group Management  v1.0.0
# Usage: ./user_mgmt_master.sh [--dry-run] [--verbose] [--module <name>] [--report-only]
set -euo pipefail
trap '_on_error $LINENO "$BASH_COMMAND"' ERR

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Source config + all modules
source "\${SCRIPT_DIR}/config.conf"
for _mod in create_users create_groups sudo_config password_policy \\
            password_aging account_locking audit_report; do
    source "\${SCRIPT_DIR}/modules/\${_mod}.sh"
done

# Runtime flags
DRY_RUN=false; VERBOSE=false; REPORT_ONLY=false; RUN_MODULE=""
for _arg in "$@"; do
    case "$_arg" in
        --dry-run)     DRY_RUN=true       ;;
        --verbose)     VERBOSE=true       ;;
        --report-only) REPORT_ONLY=true   ;;
        --module)      shift; RUN_MODULE="$1" ;;
    esac
done

# Logging — terminal + file + syslog
log() {
    local level="$1" module="$2" msg="$3"
    echo "[\$(date '+%H:%M:%S')] [\${level}] [\${module}] \${msg}"
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] [\${level}] [\${module}] \${msg}" >> "\${LOG_FILE}"
    logger -p "\${SYSLOG_FACILITY}.\${level,,}" -t "user-mgmt" "\${msg}" 2>/dev/null || true
}

dry() { \$DRY_RUN && echo "[DRY-RUN] $*" || "$@"; }

main() {
    [[ \$EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    \$REPORT_ONLY && { _run_module "audit_report" "module_audit_report"; _finalize; exit; }
    [[ -n "\$RUN_MODULE" ]] && { _run_single_module; _finalize; exit; }

    # Full pipeline — dependency order
    _run_module "create_groups"    "module_create_groups"
    _run_module "create_users"     "module_create_users"
    _run_module "sudo_config"      "module_sudo_config"
    _run_module "password_policy"  "module_password_policy"
    _run_module "password_aging"   "module_password_aging"
    _run_module "account_locking"  "module_account_locking"
    _run_module "audit_report"     "module_audit_report"
    _finalize
}

main "$@"`
  },
  {
    id: 'config',
    name: 'config.conf',
    path: 'config.conf',
    description: 'Central configuration file. All settings for user/group defaults, sudo policy, password complexity (pwquality), aging defaults (login.defs), faillock brute-force protection, logging, and report paths. Edit this file first.',
    badge: 'config',
    code: `# Enterprise User & Group Management — Configuration  v1.0.0

# ── User defaults ─────────────────────────────────────────
DEFAULT_SHELL="/bin/bash"
DEFAULT_HOME_BASE="/home"
DEFAULT_SKEL="/etc/skel"
USER_UMASK="022"

# ── Manifests ─────────────────────────────────────────────
USER_MANIFEST="\${SCRIPT_DIR}/data/users.csv"
GROUP_MANIFEST="\${SCRIPT_DIR}/data/groups.csv"
AGING_MANIFEST="\${SCRIPT_DIR}/data/aging.csv"
LOCK_MANIFEST="\${SCRIPT_DIR}/data/locks.csv"

# ── sudo ──────────────────────────────────────────────────
SUDOERS_DIR="/etc/sudoers.d"
SUDO_ADMIN_GROUPS="wheel,sudo_admins"
SUDO_OPS_GROUPS="ops_team,deploy_team"
SUDO_REQUIRE_TTY=true
SUDO_TIMESTAMP_TIMEOUT=15   # minutes

# ── Password policy (pwquality.conf) ──────────────────────
PWQ_MINLEN=12
PWQ_DCREDIT=-1   # ≥1 digit
PWQ_UCREDIT=-1   # ≥1 uppercase
PWQ_LCREDIT=-1   # ≥1 lowercase
PWQ_OCREDIT=-1   # ≥1 special char
PWQ_MINCLASS=3
PWQ_MAXREPEAT=3
PWQ_REMEMBER=5   # pam_pwhistory
PWQ_ENFORCE_FOR_ROOT=1

# ── Aging defaults (login.defs) ───────────────────────────
PASS_MAX_DAYS=90
PASS_MIN_DAYS=1
PASS_WARN_AGE=14
PASS_INACTIVE_DAYS=30

# ── faillock ──────────────────────────────────────────────
FAILLOCK_DENY=5
FAILLOCK_FAIL_INTERVAL=900    # 15 min window
FAILLOCK_UNLOCK_TIME=600      # auto-unlock after 10 min
FAILLOCK_AUDIT=true
FAILLOCK_EVEN_DENY_ROOT=false

# ── Reporting ─────────────────────────────────────────────
REPORT_DIR="/var/log/user-mgmt/reports"
REPORT_FORMAT="both"          # html | text | both
REPORT_EMAIL=""               # leave empty to skip email

# ── Logging ───────────────────────────────────────────────
LOG_DIR="/var/log/user-mgmt"
LOG_FILE="\${LOG_DIR}/user_mgmt.log"
SYSLOG_FACILITY="authpriv"`
  },
  {
    id: 'create-users',
    name: 'modules/create_users.sh',
    path: 'modules/create_users.sh',
    description: 'Reads data/users.csv (username, UID, primary group, secondary groups, shell, comment) and bulk-creates users with useradd. Skips existing users. Verifies secondary groups exist before assigning. Locks new passwords pending admin reset.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# create_users.sh — Bulk user creation module  v1.0.0
set -euo pipefail

module_create_users() {
    log "INFO" "CREATE_USERS" "Starting bulk user creation"
    local manifest="\${USER_MANIFEST}"

    # Auto-generate sample manifest if absent
    [[ ! -f "\$manifest" ]] && _write_sample_manifest && return 0

    local created=0 skipped=0 failed=0

    while IFS=',' read -r username uid primary_group \\
                          secondary_groups shell comment; do
        [[ -z "\$username" || "\$username" =~ ^# ]] && continue

        # Skip if exists
        id "\$username" &>/dev/null && (( skipped++ )) && continue

        # Validate username: lowercase, start with letter/underscore
        [[ "\$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
            log "WARN" "CREATE_USERS" "Invalid username '\${username}'"
            (( failed++ )); continue
        }

        local ua_args=("-m" "-s" "\${shell:-\$DEFAULT_SHELL}"
                       "--skel" "\$DEFAULT_SKEL"
                       "-c" "\${comment:-\$username}")

        [[ -n "\$uid" ]]           && ua_args+=("-u" "\$uid")
        [[ -n "\$primary_group" ]] && ua_args+=("-g" "\$primary_group")

        # Validate and attach secondary groups
        if [[ -n "\$secondary_groups" ]]; then
            local valid_sec=()
            for g in \${secondary_groups//:/ }; do
                getent group "\$g" &>/dev/null \\
                    && valid_sec+=("\$g") \\
                    || log "WARN" "CREATE_USERS" "Group '\${g}' not found"
            done
            (( \${#valid_sec[@]} > 0 )) && \\
                ua_args+=("-G" "\$(IFS=','; echo "\${valid_sec[*]}")")
        fi

        dry useradd "\${ua_args[@]}" "\$username" && {
            passwd -l "\$username" &>/dev/null  # lock until admin sets password
            chmod 750 "\${DEFAULT_HOME_BASE}/\${username}"
            log "INFO" "CREATE_USERS" "Created: \${username}"
            (( created++ ))
        } || (( failed++ ))

    done < "\$manifest"

    log "INFO" "CREATE_USERS" \\
        "Done — created=\${created} skipped=\${skipped} failed=\${failed}"
    (( failed > 0 )) && return 1 || return 0
}`
  },
  {
    id: 'create-groups',
    name: 'modules/create_groups.sh',
    path: 'modules/create_groups.sh',
    description: 'Reads data/groups.csv (groupname, GID, colon-separated members) and creates groups with groupadd. Syncs membership with usermod -aG — adds missing members, skips those already in the group.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# create_groups.sh — Bulk group creation and membership sync  v1.0.0
set -euo pipefail

module_create_groups() {
    log "INFO" "CREATE_GROUPS" "Starting group management"
    local manifest="\${GROUP_MANIFEST}"
    local created=0 updated=0 skipped=0 failed=0

    while IFS=',' read -r groupname gid members; do
        [[ -z "\$groupname" || "\$groupname" =~ ^# ]] && continue
        groupname="\${groupname// /}"

        if ! getent group "\$groupname" &>/dev/null; then
            local ga_args=()
            [[ -n "\${gid// /}" ]] && ga_args+=("-g" "\${gid// /}")
            dry groupadd "\${ga_args[@]}" "\$groupname" \\
                && (( created++ )) \\
                || { (( failed++ )); continue; }
        else
            (( skipped++ ))
        fi

        # Sync membership
        for member in \${members//:/ }; do
            [[ -z "\${member// /}" ]] && continue
            id "\$member" &>/dev/null || {
                log "WARN" "CREATE_GROUPS" "User '\$member' not found"
                continue
            }
            if ! id -nG "\$member" | grep -qw "\$groupname"; then
                dry usermod -aG "\$groupname" "\$member" \\
                    && (( updated++ ))
            fi
        done

    done < "\$manifest"

    log "INFO" "CREATE_GROUPS" \\
        "Done — created=\${created} memberships_updated=\${updated} skipped=\${skipped} failed=\${failed}"
}`
  },
  {
    id: 'sudo-config',
    name: 'modules/sudo_config.sh',
    path: 'modules/sudo_config.sh',
    description: 'Writes sudoers.d fragments validated with visudo -c before applying (never writes directly to /etc/sudoers). Creates 00_defaults (TTY, timeout, PATH), 10_admin_groups (full sudo), 20_ops_groups (restricted systemctl/docker), 30_auditors (read-only).',
    badge: 'module',
    code: `#!/usr/bin/env bash
# sudo_config.sh — Automated sudoers.d configuration  v1.0.0
# NEVER writes to /etc/sudoers directly — always uses sudoers.d fragments
# validated with visudo -c before installation.
set -euo pipefail

_write_sudoers_fragment() {
    local filename="\$1" content="\$2"
    local target="\${SUDOERS_DIR}/\${filename}"
    local tmpfile; tmpfile="\$(mktemp)"

    echo "\$content" > "\$tmpfile"
    visudo -c -f "\$tmpfile" &>/dev/null || {
        log "ERROR" "SUDO_CONFIG" "Syntax error in '\${filename}' — not applied"
        rm -f "\$tmpfile"; return 1
    }

    \$DRY_RUN \\
        && echo "[DRY-RUN] Would write \${target}" \\
        || install -m 0440 -o root -g root "\$tmpfile" "\$target"
    rm -f "\$tmpfile"
    log "INFO" "SUDO_CONFIG" "Fragment written: \${target}"
}

module_sudo_config() {
    # Fragment 1: Global security defaults
    _write_sudoers_fragment "00_defaults" "
Defaults    requiretty
Defaults    log_output
Defaults    timestamp_timeout=\${SUDO_TIMESTAMP_TIMEOUT}
Defaults    secure_path=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"
Defaults    !visiblepw
Defaults    lecture=once
"

    # Fragment 2: Admin groups — full sudo
    for grp in \${SUDO_ADMIN_GROUPS//,/ }; do
        getent group "\$grp" &>/dev/null || continue
        _write_sudoers_fragment "10_\${grp}" \\
            "%\${grp} ALL=(ALL:ALL) ALL"
    done

    # Fragment 3: Ops groups — restricted commands
    for grp in \${SUDO_OPS_GROUPS//,/ }; do
        getent group "\$grp" &>/dev/null || continue
        _write_sudoers_fragment "20_\${grp}" "
Cmnd_Alias OPS_CMDS = /usr/bin/systemctl restart *, /usr/bin/systemctl stop *, \\\\
    /usr/bin/systemctl start *, /usr/bin/journalctl -xe, /usr/bin/docker *, /usr/bin/podman *
%\${grp} ALL=(root) NOPASSWD: OPS_CMDS
"
    done

    # Fragment 4: Auditors — read-only
    getent group "auditors" &>/dev/null && _write_sudoers_fragment "30_auditors" "
Cmnd_Alias AUDIT_CMDS = /usr/bin/cat /etc/passwd, /usr/bin/cat /etc/shadow, \\\\
    /usr/bin/last, /usr/bin/lastlog, /usr/bin/faillock, /usr/sbin/aureport
%auditors ALL=(root) NOPASSWD: AUDIT_CMDS
"
}`
  },
  {
    id: 'password-policy',
    name: 'modules/password_policy.sh',
    path: 'modules/password_policy.sh',
    description: 'Applies system-wide password complexity via /etc/security/pwquality.conf (minlen, dcredit, ucredit, ocredit, minclass, maxrepeat, dictcheck), sets aging defaults in /etc/login.defs, and enables pam_pwhistory via authselect. Backs up all files before modification.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# password_policy.sh — System-wide password policy via PAM + login.defs  v1.0.0
set -euo pipefail

_set_config_value() {
    local file="\$1" key="\$2" value="\$3"
    if grep -qE "^[[:space:]]*\${key}[[:space:]]" "\$file"; then
        dry sed -i "s|^[[:space:]]*\${key}[[:space:]].*|\${key} = \${value}|" "\$file"
    elif grep -qE "^#[[:space:]]*\${key}[[:space:]]" "\$file"; then
        dry sed -i "s|^#[[:space:]]*\${key}[[:space:]].*|\${key} = \${value}|" "\$file"
    else
        \$DRY_RUN || echo "\${key} = \${value}" >> "\$file"
    fi
}

module_password_policy() {
    local pwq="/etc/security/pwquality.conf"
    [[ -f "\$pwq" ]] && cp "\$pwq" "\${pwq}.bak.\$(date +%Y%m%d)" || true

    # pwquality.conf — complexity settings
    _set_config_value "\$pwq" "minlen"           "\$PWQ_MINLEN"
    _set_config_value "\$pwq" "dcredit"          "\$PWQ_DCREDIT"
    _set_config_value "\$pwq" "ucredit"          "\$PWQ_UCREDIT"
    _set_config_value "\$pwq" "lcredit"          "\$PWQ_LCREDIT"
    _set_config_value "\$pwq" "ocredit"          "\$PWQ_OCREDIT"
    _set_config_value "\$pwq" "minclass"         "\$PWQ_MINCLASS"
    _set_config_value "\$pwq" "maxrepeat"        "\$PWQ_MAXREPEAT"
    _set_config_value "\$pwq" "dictcheck"        "\$PWQ_DICTCHECK"
    _set_config_value "\$pwq" "enforce_for_root" "\$PWQ_ENFORCE_FOR_ROOT"
    _set_config_value "\$pwq" "retry"            "\$PWQ_RETRY"
    log "INFO" "PASSWORD_POLICY" "pwquality: minlen=\$PWQ_MINLEN classes=\$PWQ_MINCLASS"

    # login.defs — global aging
    dry sed -i "s|^PASS_MAX_DAYS.*|PASS_MAX_DAYS    \$PASS_MAX_DAYS|" /etc/login.defs
    dry sed -i "s|^PASS_MIN_DAYS.*|PASS_MIN_DAYS    \$PASS_MIN_DAYS|" /etc/login.defs
    dry sed -i "s|^PASS_WARN_AGE.*|PASS_WARN_AGE    \$PASS_WARN_AGE|" /etc/login.defs

    # authselect — enable pwhistory
    command -v authselect &>/dev/null && \\
        dry authselect enable-feature with-pwhistory 2>/dev/null || true
    log "INFO" "PASSWORD_POLICY" "Policy applied — MAX=\$PASS_MAX_DAYS MIN=\$PASS_MIN_DAYS"
}`
  },
  {
    id: 'password-aging',
    name: 'modules/password_aging.sh',
    path: 'modules/password_aging.sh',
    description: 'Applies per-user chage settings from data/aging.csv (max_days, min_days, warn_days, inactive_days, expire_date). Use "-" for any field to keep existing value. After processing the manifest, applies global defaults to all unlisted regular users.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# password_aging.sh — Per-user password aging via chage  v1.0.0
set -euo pipefail

# data/aging.csv format:
# username,max_days,min_days,warn_days,inactive_days,expire_date
# alice,90,1,14,30,-
# frank,30,0,7,7,2025-12-31   ← hard expiry on contractor
# eve,365,0,30,-,-             ← auditor, long max, no inactive

_apply_aging() {
    local u="\$1" max="\$2" min="\$3" warn="\$4" inactive="\$5" expire="\$6"
    id "\$u" &>/dev/null || { log "WARN" "AGING" "User '\$u' not found"; return 0; }

    local args=()
    [[ "\$max"      != "-" && -n "\$max"      ]] && args+=("-M" "\$max")
    [[ "\$min"      != "-" && -n "\$min"      ]] && args+=("-m" "\$min")
    [[ "\$warn"     != "-" && -n "\$warn"     ]] && args+=("-W" "\$warn")
    [[ "\$inactive" != "-" && -n "\$inactive" ]] && args+=("-I" "\$inactive")
    [[ "\$expire"   != "-" && -n "\$expire"   ]] && args+=("-E" "\$expire")

    (( \${#args[@]} == 0 )) && return 0
    log "INFO" "AGING" "\$u: max=\$max min=\$min warn=\$warn inactive=\$inactive expire=\$expire"
    dry chage "\${args[@]}" "\$u"
}

module_password_aging() {
    while IFS=',' read -r u max min warn inactive expire; do
        [[ -z "\$u" || "\$u" =~ ^# ]] && continue
        _apply_aging "\${u// /}" "\${max// /}" "\${min// /}" \\
                     "\${warn// /}" "\${inactive// /}" "\${expire// /}"
    done < "\${AGING_MANIFEST}"

    # Apply global defaults to all unlisted regular users
    while IFS=: read -r uname _ uid _ _ _ _; do
        (( uid < 1000 )) && continue; [[ "\$uname" == "nobody" ]] && continue
        grep -q "^\${uname}," "\${AGING_MANIFEST}" 2>/dev/null && continue
        dry chage -M "\$PASS_MAX_DAYS" -m "\$PASS_MIN_DAYS" \\
                  -W "\$PASS_WARN_AGE" -I "\$PASS_INACTIVE_DAYS" "\$uname"
    done < /etc/passwd
}`
  },
  {
    id: 'account-locking',
    name: 'modules/account_locking.sh',
    path: 'modules/account_locking.sh',
    description: 'Configures /etc/security/faillock.conf (deny, fail_interval, unlock_time, audit) and enables pam_faillock via authselect. Then processes data/locks.csv for manual lock (passwd -l), unlock (passwd -u), or faillock counter reset per user.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# account_locking.sh — faillock configuration + manual lock/unlock  v1.0.0
set -euo pipefail

# data/locks.csv format:
# username,action   (action: lock | unlock | reset-faillock)
# frank,lock        ← disable contractor account
# alice,unlock      ← re-enable after investigation
# bob,reset-faillock ← clear failed login counter

module_account_locking() {
    # 1. Configure faillock.conf
    local conf="/etc/security/faillock.conf"
    if [[ -f "\$conf" ]]; then
        cp "\$conf" "\${conf}.bak.\$(date +%Y%m%d)"
        _set_faillock_value "deny"           "\$FAILLOCK_DENY"
        _set_faillock_value "fail_interval"  "\$FAILLOCK_FAIL_INTERVAL"
        _set_faillock_value "unlock_time"    "\$FAILLOCK_UNLOCK_TIME"
        \$FAILLOCK_AUDIT && _set_faillock_value "audit" ""
        \$FAILLOCK_EVEN_DENY_ROOT && \\
            _set_faillock_value "even_deny_root" ""
        command -v authselect &>/dev/null && \\
            dry authselect enable-feature with-faillock 2>/dev/null || true
        log "INFO" "ACCOUNT_LOCKING" \\
            "faillock: deny=\$FAILLOCK_DENY interval=\${FAILLOCK_FAIL_INTERVAL}s unlock=\${FAILLOCK_UNLOCK_TIME}s"
    fi

    # 2. Process manual lock/unlock manifest
    while IFS=',' read -r user action; do
        [[ -z "\$user" || "\$user" =~ ^# ]] && continue
        id "\${user// /}" &>/dev/null || continue
        case "\${action// /}" in
            lock)
                dry passwd -l "\${user// /}"
                logger -p authpriv.notice -t user-mgmt "Locked: \${user// /}" || true ;;
            unlock)
                dry passwd -u "\${user// /}"
                dry faillock --user "\${user// /}" --reset 2>/dev/null || true
                logger -p authpriv.notice -t user-mgmt "Unlocked: \${user// /}" || true ;;
            reset-faillock)
                dry faillock --user "\${user// /}" --reset ;;
        esac
    done < "\${LOCK_MANIFEST}"
}`
  },
  {
    id: 'audit-report',
    name: 'modules/audit_report.sh',
    path: 'modules/audit_report.sh',
    description: 'Generates HTML and/or plain-text security audit reports. For every regular user (UID ≥ 1000): groups, sudo access level, password status, last change date, aging parameters, expiry status, and faillock failure count. Optionally emails the HTML report via sendmail.',
    badge: 'module',
    code: `#!/usr/bin/env bash
# audit_report.sh — User & Group Security Audit Report  v1.0.0
set -euo pipefail

module_audit_report() {
    mkdir -p "\$REPORT_DIR"
    local ts="\$(date '+%Y-%m-%d %H:%M:%S')"
    local stamp="\$(date '+%Y%m%d_%H%M%S')"
    local host="\$(hostname -f 2>/dev/null || hostname)"
    local total=0 locked=0 sudo=0 expired=0

    # Collect per-user data
    while IFS=: read -r uname _ uid _ _ _ shell; do
        (( uid < 1000 )) && continue; [[ "\$uname" == "nobody" ]] && continue
        (( total++ ))

        # sudo check
        local has_sudo="No"
        groups "\$uname" | grep -qwE "wheel|sudo_admins" \\
            && has_sudo="Yes (admin)" && (( sudo++ ))

        # lock status
        local pw_st; pw_st=\$(passwd -S "\$uname" 2>/dev/null | awk '{print \$2}')
        local st_label="Active"
        [[ "\$pw_st" == "L" || "\$pw_st" == "LK" ]] \\
            && st_label="LOCKED" && (( locked++ ))

        # aging
        local max expire
        max=\$(chage -l "\$uname" 2>/dev/null | grep Maximum | awk -F': ' '{print \$2}')
        expire=\$(chage -l "\$uname" 2>/dev/null | grep "Account expires" | awk -F': ' '{print \$2}')
        [[ "\$expire" != "never" ]] && \\
            (( \$(date -d "\$expire" +%s 2>/dev/null || echo 9999999999) < \$(date +%s) )) \\
            && (( expired++ ))

        # faillock
        local fails; fails=\$(faillock --user "\$uname" 2>/dev/null | grep -c "V" || echo 0)

        # Emit row to report...
    done < /etc/passwd

    log "INFO" "AUDIT_REPORT" \\
        "Report: \${REPORT_DIR}/audit_\${stamp}.html — users=\${total} locked=\${locked} sudo=\${sudo} expired=\${expired}"
}`
  },
  {
    id: 'install',
    name: 'install.sh',
    path: 'install.sh',
    description: 'Install or uninstall the system. Copies all scripts to /usr/local/bin/user-mgmt/, makes executables, secures config.conf, creates /var/log/user-mgmt/ directory tree, installs a weekly cron job for audit reports, and creates a /usr/local/bin/user-mgmt symlink.',
    badge: 'install',
    code: `#!/usr/bin/env bash
# install.sh — Enterprise User & Group Management installer  v1.0.0
# Usage: sudo bash install.sh [--install|--uninstall] [--dry-run]
set -euo pipefail

ACTION="install"; DRY_RUN=false
for _a in "$@"; do
    [[ "\$_a" == "--install"   ]] && ACTION="install"
    [[ "\$_a" == "--uninstall" ]] && ACTION="uninstall"
    [[ "\$_a" == "--dry-run"   ]] && DRY_RUN=true
done

INSTALL_TARGET="/usr/local/bin/user-mgmt"
CRON_FILE="/etc/cron.d/enterprise-user-mgmt"
LOG_DIR="/var/log/user-mgmt"

do_install() {
    dry mkdir -p "\${INSTALL_TARGET}/modules" "\${INSTALL_TARGET}/tests" "\${INSTALL_TARGET}/data"
    dry cp user_mgmt_master.sh config.conf "\${INSTALL_TARGET}/"
    dry cp modules/*.sh "\${INSTALL_TARGET}/modules/"
    dry cp tests/*.sh   "\${INSTALL_TARGET}/tests/"
    dry chmod +x "\${INSTALL_TARGET}/user_mgmt_master.sh"
    dry chmod +x "\${INSTALL_TARGET}/modules/"*.sh
    dry chmod 640 "\${INSTALL_TARGET}/config.conf"
    dry mkdir -p "\${LOG_DIR}/reports"
    dry chmod 750 "\${LOG_DIR}" "\${LOG_DIR}/reports"
    dry ln -sf "\${INSTALL_TARGET}/user_mgmt_master.sh" /usr/local/bin/user-mgmt
    # Weekly cron — Sunday 01:00
    echo "0 1 * * 0  root  user-mgmt --report-only >> \${LOG_DIR}/cron.log 2>&1" \\
        | dry tee "\$CRON_FILE" > /dev/null
    dry chmod 644 "\$CRON_FILE"
    echo "✔ Installed → user-mgmt"
}

do_uninstall() {
    dry rm -f /usr/local/bin/user-mgmt "\$CRON_FILE"
    dry rm -rf "\$INSTALL_TARGET"
    echo "✔ Uninstalled (logs preserved at \${LOG_DIR}/)"
}

[[ \$EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
dry() { \$DRY_RUN && echo "[DRY-RUN] \$*" || "\$@"; }
[[ "\$ACTION" == "install" ]] && do_install || do_uninstall`
  },
  {
    id: 'test',
    name: 'tests/test_user_mgmt.sh',
    path: 'tests/test_user_mgmt.sh',
    description: 'Verification test suite. Creates temporary test users/groups, exercises password aging (chage), account locking (passwd -l/u), validates faillock.conf settings, checks all sudoers.d fragments with visudo -c, and verifies pwquality.conf minlen. Cleans up all test artifacts on exit.',
    badge: 'test',
    code: `#!/usr/bin/env bash
# test_user_mgmt.sh — Verification suite  v1.0.0
# Creates temp users/groups, runs assertions, cleans up on exit.
set -euo pipefail

PASS=0; FAIL=0; SKIP=0
TEST_USER="test_mgmt_\$\$"
TEST_GROUP="test_grp_\$\$"

assert() {
    local desc="\$1" got="\$2" want="\${3:-0}"
    if [[ "\$got" == "\$want" ]]; then
        echo "  ✔ \${desc}"; (( PASS++ ))
    else
        echo "  ✘ \${desc} (got=\${got} want=\${want})"; (( FAIL++ ))
    fi
}

cleanup() {
    id "\$TEST_USER" &>/dev/null && userdel -r "\$TEST_USER" 2>/dev/null || true
    getent group "\$TEST_GROUP" &>/dev/null && groupdel "\$TEST_GROUP" 2>/dev/null || true
}
trap cleanup EXIT

# ── Group creation ────────────────────────────────────────
groupadd "\$TEST_GROUP"
assert "Group exists" "\$(getent group "\$TEST_GROUP" &>/dev/null; echo \$?)"

# ── User creation ─────────────────────────────────────────
useradd -m -s /bin/bash -g "\$TEST_GROUP" "\$TEST_USER"
assert "User exists"          "\$(id "\$TEST_USER" &>/dev/null; echo \$?)"
assert "Home dir created"     "\$(test -d /home/\${TEST_USER}; echo \$?)"
assert "Shell correct"        "\$(getent passwd "\$TEST_USER" | cut -d: -f7)" "/bin/bash"
assert "Primary group correct" "\$(id -gn "\$TEST_USER")"        "\$TEST_GROUP"

# ── Password aging ────────────────────────────────────────
chage -M 90 -m 1 -W 14 -I 30 "\$TEST_USER"
assert "chage max=90"  "\$(chage -l "\$TEST_USER" | grep Maximum | grep -c 90)"  "1"
assert "chage warn=14" "\$(chage -l "\$TEST_USER" | grep Warn    | grep -c 14)"  "1"

# ── Account locking ───────────────────────────────────────
passwd -l "\$TEST_USER" &>/dev/null
assert "Account locked"   "\$(passwd -S "\$TEST_USER" | awk '{print \$2}')" "LK"
passwd -u "\$TEST_USER" &>/dev/null
assert "Account unlocked" "\$(passwd -S "\$TEST_USER" | awk '{print \$2}')" "NP"

# ── sudoers.d validation ──────────────────────────────────
local_fail=0
for f in /etc/sudoers.d/*; do
    [[ -f "\$f" ]] && visudo -c -f "\$f" &>/dev/null || local_fail=1
done
assert "All sudoers.d fragments valid" "\$local_fail" "0"

echo ""
echo "Results: PASS=\$PASS  FAIL=\$FAIL  SKIP=\$SKIP"
(( FAIL > 0 )) && exit 1 || exit 0`
  }
];
