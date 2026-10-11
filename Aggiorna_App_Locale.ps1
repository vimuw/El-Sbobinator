param([switch]$NoPull, [switch]$Dev)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Comando fallito (codice $LASTEXITCODE): $Executable $Arguments"
    }
}

$projectRoot = $PSScriptRoot
try {
    if (-not $NoPull) {
        $branch = & git -C $projectRoot branch --show-current
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
            throw "L'aggiornamento da GitHub richiede il branch main. Usa -NoPull per verificare un altro checkout."
        }
        Invoke-Checked 'git' @('-C', $projectRoot, 'fetch', 'origin', 'main')
        $localCommit = & git -C $projectRoot rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Impossibile leggere HEAD.' }
        $remoteCommit = & git -C $projectRoot rev-parse origin/main
        if ($LASTEXITCODE -ne 0) { throw 'Impossibile leggere origin/main.' }
        if ($localCommit -ne $remoteCommit) {
            $changes = & git -C $projectRoot status --porcelain
            if ($LASTEXITCODE -ne 0 -or $changes) {
                throw "Ci sono modifiche locali: salvale prima di aggiornare main. Nessun file e stato sovrascritto."
            }
            Invoke-Checked 'git' @('-C', $projectRoot, 'merge', '--ff-only', 'origin/main')
        }
    }
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        Invoke-Checked $launcher.Source @('-3.11', (Join-Path $projectRoot 'scripts\build_release.py'), 'update-local')
    } else {
        $python = Get-Command python.exe -ErrorAction Stop
        Invoke-Checked $python.Source @((Join-Path $projectRoot 'scripts\build_release.py'), 'update-local')
    }
} catch {
    Write-Error "Aggiornamento locale interrotto: $_" -ErrorAction Continue
    exit 1
}
