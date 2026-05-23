#!/usr/bin/env bash
# user_mgmt_master.sh — Enterprise User & Group Management  Orchestrator v1.0.0
# Runs all management modules in sequence with full audit logging.
# Usage: ./user_mgmt_master.sh [--dry-run] [--verbose] [--module <name>] [--report-only]
# Cron:  0 1 * * 0  /usr/local/bin/user-mgmt/user_mgmt_master.sh --report-only
set -euo pipefail
trap '_on_error $LINENO "$BASH_COMMAND"' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Error handler ─────────────────────────────────────────────────────────────
_on_error() {
    local line="$1" cmd="$2"
    local msg="Fatal error at line ${line}: ${cmd}"
    if declare -f log &>/dev/null; then
        log "ERROR" "MASTER" "$msg"
    else
        echo "[ERROR] [MASTER] ${msg}" >&2
    fi
    MGMT_STATUS="FAILED"
    FAILED_MODULES+=("MASTER")
    if declare -f _finalize &>/dev/null; then _finalize; fi
    exit 1
}

# ── Source configuration ──────────────────────────────────────────────────────
CONFIG_FILE="${SCRIPT_DIR}/config.conf"
[[ -f "$CONFIG_FILE" ]] || { echo "[FATAL] config.conf not found at ${CONFIG_FILE}" >&2; exit 1; }
# shellcheck source=config.conf
source "$CONFIG_FILE"

# ── Source modules ────────────────────────────────────────────────────────────
for _mod in create_users create_groups sudo_config password_policy \
            password_aging account_locking audit_report; do
    _path="${SCRIPT_DIR}/modules/${_mod}.sh"
    [[ -f "$_path" ]] || { echo "[FATAL] Module missing: ${_path}" >&2; exit 1; }
    # shellcheck disable=SC1090
    source "$_path"
done

# ── Runtime flags ─────────────────────────────────────────────────────────────
DRY_RUN=false
VERBOSE=false
REPORT_ONLY=false
RUN_MODULE=""

for _arg in "$@"; do
    case "$_arg" in
        --dry-run)     DRY_RUN=true       ;;
        --verbose)     VERBOSE=true       ;;
        --report-only) REPORT_ONLY=true   ;;
        --module)      shift; RUN_MODULE="$1" ;;
    esac
done

# ── Colours (terminal only) ───────────────────────────────────────────────────
if [[ -t 1 ]]; then
    CYAN='\033[0;36m';  CYAN_B='\033[1;36m'
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    RED='\033[0;31m';   BLUE='\033[0;34m'
    BOLD='\033[1m';     RESET='\033[0m'
else
    CYAN=''; CYAN_B=''; GREEN=''; YELLOW=''
    RED=''; BLUE=''; BOLD=''; RESET=''
fi

# ── Globals ───────────────────────────────────────────────────────────────────
MGMT_STATUS="SUCCESS"
FAILED_MODULES=()
START_TIME=$(date +%s)
RUN_ID="$(date +%Y%m%d_%H%M%S)_$$"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
    local level="$1" module="$2" msg="$3"
    local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
    local line="[${ts}] [${level}] [${module}] ${msg}"
    case "$level" in
        ERROR) echo -e "${RED}${line}${RESET}" >&2 ;;
        WARN)  echo -e "${YELLOW}${line}${RESET}" ;;
        INFO)  echo -e "${CYAN}${line}${RESET}" ;;
        DEBUG) $VERBOSE && echo -e "${BLUE}${line}${RESET}" || true ;;
    esac
    mkdir -p "${LOG_DIR}"
    echo "$line" >> "${LOG_FILE}"
    # Security-relevant events go to syslog
    if [[ "$level" == "INFO" || "$level" == "ERROR" ]]; then
        logger -p "${SYSLOG_FACILITY}.${level,,}" -t "user-mgmt[${RUN_ID}]" "$msg" 2>/dev/null || true
    fi
}

dry() {
    # Execute command or print it in dry-run mode
    if $DRY_RUN; then
        echo -e "${YELLOW}[DRY-RUN]${RESET} $*"
    else
        "$@"
    fi
}

# ── Root check ────────────────────────────────────────────────────────────────
_check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}[FATAL] This script must be run as root.${RESET}" >&2
        exit 1
    fi
}

# ── Dependency check ──────────────────────────────────────────────────────────
_check_deps() {
    local deps=(useradd usermod userdel groupadd groupmod groupdel
                chage passwd visudo faillock chcon logger)
    local missing=()
    for dep in "${deps[@]}"; do
        command -v "$dep" &>/dev/null || missing+=("$dep")
    done
    if (( ${#missing[@]} > 0 )); then
        log "ERROR" "MASTER" "Missing dependencies: ${missing[*]}"
        exit 1
    fi
    log "INFO" "MASTER" "All dependencies satisfied"
}

# ── Banner ────────────────────────────────────────────────────────────────────
_banner() {
    echo -e "${CYAN_B}"
    cat <<'EOF'
  ╔══════════════════════════════════════════════════════════════╗
  ║     ENTERPRISE USER & GROUP MANAGEMENT  v1.0.0              ║
  ║     Clearance Protocol — Identity & Access Automation       ║
  ╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${RESET}"
    if $DRY_RUN; then
        echo -e "${YELLOW}  ⚠  DRY-RUN MODE — no changes will be applied${RESET}\n"
    fi
}

# ── Run a single module safely ────────────────────────────────────────────────
_run_module() {
    local name="$1" fn="$2"
    log "INFO" "MASTER" "── Starting module: ${name}"
    local t0; t0=$(date +%s)
    if declare -f "$fn" &>/dev/null; then
        if "$fn"; then
            local elapsed=$(( $(date +%s) - t0 ))
            log "INFO" "MASTER" "── Module ${name} completed in ${elapsed}s"
        else
            log "ERROR" "MASTER" "── Module ${name} returned non-zero"
            FAILED_MODULES+=("$name")
            MGMT_STATUS="PARTIAL"
        fi
    else
        log "WARN" "MASTER" "── Module function '${fn}' not found, skipping"
    fi
}

# ── Finalize: summary + report ────────────────────────────────────────────────
_finalize() {
    local elapsed=$(( $(date +%s) - START_TIME ))
    local mins=$(( elapsed / 60 )) secs=$(( elapsed % 60 ))

    echo ""
    echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"
    if [[ "$MGMT_STATUS" == "SUCCESS" ]]; then
        echo -e "${GREEN}  ✔ COMPLETED SUCCESSFULLY  (${mins}m ${secs}s)${RESET}"
    else
        echo -e "${RED}  ✘ COMPLETED WITH ERRORS  (${mins}m ${secs}s)${RESET}"
        echo -e "${RED}    Failed modules: ${FAILED_MODULES[*]:-none}${RESET}"
    fi
    echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"
    echo ""

    log "INFO" "MASTER" "Run ${RUN_ID} finished — status=${MGMT_STATUS} elapsed=${elapsed}s"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    _check_root
    _banner
    _check_deps

    if [[ -n "$RUN_MODULE" ]]; then
        # Run a single named module
        case "$RUN_MODULE" in
            users)          _run_module "create_users"    "module_create_users"   ;;
            groups)         _run_module "create_groups"   "module_create_groups"  ;;
            sudo)           _run_module "sudo_config"     "module_sudo_config"    ;;
            policy)         _run_module "password_policy" "module_password_policy";;
            aging)          _run_module "password_aging"  "module_password_aging" ;;
            locking)        _run_module "account_locking" "module_account_locking";;
            report)         _run_module "audit_report"    "module_audit_report"   ;;
            *)              echo "Unknown module: ${RUN_MODULE}"; exit 1 ;;
        esac
    elif $REPORT_ONLY; then
        _run_module "audit_report" "module_audit_report"
    else
        # Full pipeline
        _run_module "create_groups"    "module_create_groups"
        _run_module "create_users"     "module_create_users"
        _run_module "sudo_config"      "module_sudo_config"
        _run_module "password_policy"  "module_password_policy"
        _run_module "password_aging"   "module_password_aging"
        _run_module "account_locking"  "module_account_locking"
        _run_module "audit_report"     "module_audit_report"
    fi

    _finalize
    [[ "$MGMT_STATUS" == "FAILED" ]] && exit 1 || exit 0
}

main "$@"
