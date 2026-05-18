<#
.SYNOPSIS
    Laptop-side production deploy orchestration (STUB — Phase R4).

.DESCRIPTION
    Validates preconditions including "staging at same SHA for N hours,"
    snapshots production Turso, SSHes to superglitch to pull tagged images,
    apply production migrations, and recreate the neuroglitch Compose project.

    THIS IS A STUB. The script prints the actions it WOULD take and exits
    without making changes. Phase R7 implements the real body.

.PARAMETER Sha
    The full git SHA to deploy. Must currently be running in staging at the
    same SHA for at least the configured soak window (default 2 hours).

.PARAMETER ConfirmProd
    Required flag. Without it, the script refuses to proceed. This is a
    deliberate operator-gesture-required safeguard.

.EXAMPLE
    .\deploy-prod.ps1 -Sha abc1234... -ConfirmProd

.NOTES
    Status: Phase R4 STUB. NOT ACTIVE. No SSH, no Docker, no Turso changes.
    Refusal conditions documented in runtime/deployment/compose-governance.md §4.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^[0-9a-f]{7,40}$')]
    [string]$Sha,

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmProd,

    [Parameter(Mandatory = $false)]
    [string]$SshAlias = 'superglitch',

    [Parameter(Mandatory = $false)]
    [int]$SoakHours = 2
)

Write-Output ""
Write-Output "============================================================"
Write-Output "  deploy-prod.ps1  ──  STUB (Phase R4 — NOT ACTIVE)"
Write-Output "============================================================"
Write-Output ""

if (-not $ConfirmProd) {
    Write-Output "REFUSING: -ConfirmProd flag not present."
    Write-Output ""
    Write-Output "Production deploys require explicit operator confirmation via"
    Write-Output "the -ConfirmProd switch. This is a deliberate gesture-required"
    Write-Output "safeguard, separate from any approval gate in the deploy pipeline."
    Write-Output ""
    Write-Output "If this script were active, this refusal would happen before"
    Write-Output "any SSH session or remote action."
    Write-Output ""
    exit 1
}

Write-Output "If this script were active (Phase R7), it would perform:"
Write-Output ""
Write-Output "  1. VERIFY (laptop):"
Write-Output "      - git working tree clean"
Write-Output "      - CI green for SHA: $Sha"
Write-Output "      - SHA reachable from origin/main"
Write-Output "      - staging tier currently running SHA $Sha for at least $SoakHours hour(s)"
Write-Output "      - GHCR image tags exist for prod-grade SHA"
Write-Output ""
Write-Output "  2. SNAPSHOT (host):"
Write-Output "      ssh $SshAlias 'cd /opt/neuroglitch/construction-dashboard && runtime/deployment/snapshot-prod.sh'"
Write-Output "      (Turso PITR before any migration; refuses to proceed if snapshot fails.)"
Write-Output ""
Write-Output "  3. SSH to $SshAlias and execute:"
Write-Output "      cd /opt/neuroglitch/construction-dashboard"
Write-Output "      git fetch && git checkout $Sha"
Write-Output "      runtime/deployment/apply-migrations.sh production"
Write-Output "      docker compose \"
Write-Output "        -f runtime/compose/base.yml \"
Write-Output "        -f runtime/compose/overrides/production.yml \"
Write-Output "        -p neuroglitch \"
Write-Output "        up -d --force-recreate app sidecar worker"
Write-Output ""
Write-Output "  4. HEALTH CHECK:"
Write-Output "      runtime/deployment/health-check.sh production"
Write-Output ""
Write-Output "  5. TAG and RECORD:"
Write-Output "      git tag prod-$(Get-Date -Format yyyy-MM-dd).<N> $Sha"
Write-Output "      git push --tags"
Write-Output "      Append entry to planning/ops-log-<year>.md"
Write-Output ""
Write-Output "REFUSAL CONDITIONS (would block before any SSH):"
Write-Output "  - working tree dirty"
Write-Output "  - CI not green for SHA"
Write-Output "  - staging not at $Sha (or soak window not met)"
Write-Output "  - GHCR images missing"
Write-Output "  - snapshot-prod.sh would fail"
Write-Output ""
Write-Output "STUB exiting without action."
Write-Output ""

exit 0
