#!/usr/bin/env bash
# install.sh — Enterprise User & Group Management  installer  v1.0.0
# Usage: sudo bash install.sh [--install|--uninstall] [--dry-run]
set -euo pipefail
trap 'echo "[ERROR] Install failed at line $LINENO" >&2; exit 1' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_TARGET="/usr/local/bin/user-mgmt"
CRON_FILE="/etc/cron.d/enterprise-user-mgmt"
LOG_DIR_INST="/var/log/user-mgmt"

# ── Flags ──────────────────────────────────────────────────────────────────────
ACTION="install"
DRY_RUN=false
for _a in "$@"; do
    [[ "$_a" == "--install"   ]] && ACTION="install"
    [[ "$_a" == "--uninstall" ]] && ACTION="uninstall"
    [[ "$_a" == "--dry-run"   ]] && DRY_RUN=true
done

dry() { $DRY_RUN && echo "[DRY-RUN] $*" || "$@"; }

# ── Colours ────────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

[[ $EUID -ne 0 ]] && { echo -e "${RED}Must be run as root${RESET}" >&2; exit 1; }

# ── Banner ─────────────────────────────────────────────────────────────────────
echo -e "${CYAN}${BOLD}"
cat <<'EOF'
  ╔══════════════════════════════════════════════════════╗
  ║   Enterprise User & Group Management  v1.0.0        ║
  ║   Clearance Protocol — Installer                    ║
  ╚══════════════════════════════════════════════════════╝
EOF
echo -e "${RESET}"
$DRY_RUN && echo -e "${YELLOW}  ⚠  DRY-RUN MODE — no changes will be applied${RESET}\n"

# ── Check dependencies ─────────────────────────────────────────────────────────
check_deps() {
    local deps=(useradd groupadd chage passwd visudo faillock)
    local missing=()
    for d in "${deps[@]}"; do
        command -v "$d" &>/dev/null || missing+=("$d")
    done
    if (( ${#missing[@]} > 0 )); then
        echo -e "${RED}  Missing dependencies: ${missing[*]}${RESET}"
        echo -e "${YELLOW}  Install with: dnf install shadow-utils util-linux sudo pam${RESET}"
        exit 1
    fi
    echo -e "${GREEN}  ✔ All dependencies found${RESET}"
}

# ── Install ────────────────────────────────────────────────────────────────────
do_install() {
    echo -e "\n${CYAN}Installing Enterprise User & Group Management...${RESET}"
    check_deps

    # 1. Copy files to install location
    dry mkdir -p "${INSTALL_TARGET}/modules"
    dry mkdir -p "${INSTALL_TARGET}/tests"
    dry mkdir -p "${INSTALL_TARGET}/data"
    dry cp "${SCRIPT_DIR}/user_mgmt_master.sh" "${INSTALL_TARGET}/"
    dry cp "${SCRIPT_DIR}/config.conf"          "${INSTALL_TARGET}/"
    dry cp "${SCRIPT_DIR}/modules/"*.sh         "${INSTALL_TARGET}/modules/"
    dry cp "${SCRIPT_DIR}/tests/"*.sh           "${INSTALL_TARGET}/tests/"

    # 2. Make scripts executable
    dry chmod +x "${INSTALL_TARGET}/user_mgmt_master.sh"
    dry chmod +x "${INSTALL_TARGET}/modules/"*.sh
    dry chmod +x "${INSTALL_TARGET}/tests/"*.sh

    # 3. Secure config.conf (contains email/SMTP, no credentials but still sensitive)
    dry chmod 640 "${INSTALL_TARGET}/config.conf"
    dry chown root:root "${INSTALL_TARGET}/config.conf"

    # 4. Create log directory
    dry mkdir -p "$LOG_DIR_INST"
    dry chmod 750 "$LOG_DIR_INST"
    dry mkdir -p "${LOG_DIR_INST}/reports"
    dry chmod 750 "${LOG_DIR_INST}/reports"

    # 5. Create symlink for convenience
    dry ln -sf "${INSTALL_TARGET}/user_mgmt_master.sh" /usr/local/bin/user-mgmt

    # 6. Set up weekly cron (audit report + aging check)
    dry tee "$CRON_FILE" > /dev/null <<CRON
# Enterprise User & Group Management — weekly audit report
# Runs every Sunday at 1:00 AM
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 1 * * 0  root  ${INSTALL_TARGET}/user_mgmt_master.sh --report-only >> /var/log/user-mgmt/cron.log 2>&1
CRON
    dry chmod 644 "$CRON_FILE"

    echo -e "\n${GREEN}${BOLD}  ✔ Installation complete!${RESET}"
    echo -e "${CYAN}  Installed to: ${INSTALL_TARGET}${RESET}"
    echo -e "${CYAN}  Config:       ${INSTALL_TARGET}/config.conf${RESET}"
    echo -e "${CYAN}  Logs:         ${LOG_DIR_INST}/${RESET}"
    echo -e "${CYAN}  Cron:         ${CRON_FILE}${RESET}"
    echo -e "\n${BOLD}  Quick-start:${RESET}"
    echo -e "    Edit config:  vi ${INSTALL_TARGET}/config.conf"
    echo -e "    Run (dry):    user-mgmt --dry-run"
    echo -e "    Run (full):   user-mgmt"
    echo -e "    Report only:  user-mgmt --report-only"
    echo -e "    Single module: user-mgmt --module users|groups|sudo|policy|aging|locking|report\n"
}

# ── Uninstall ──────────────────────────────────────────────────────────────────
do_uninstall() {
    echo -e "\n${YELLOW}Uninstalling Enterprise User & Group Management...${RESET}"
    dry rm -f /usr/local/bin/user-mgmt
    dry rm -f "$CRON_FILE"
    dry rm -rf "$INSTALL_TARGET"
    echo -e "${GREEN}  ✔ Uninstalled${RESET}"
    echo -e "${YELLOW}  Note: logs at ${LOG_DIR_INST}/ were preserved${RESET}"
}

case "$ACTION" in
    install)   do_install   ;;
    uninstall) do_uninstall ;;
esac
