# Time FontForge's own GUI: launch -> main font window visible, then memory.
# Usage: powershell -File bench/fontforge_gui.ps1 <font> [runs]
param([string]$Font, [int]$Runs = 3)

$ff = 'C:\Program Files\FontForgeBuilds'
$env:HOME = "$ff\"; $env:PYTHONHOME = "$ff\"; $env:AUTOTRACE = 'potrace'
$env:PATH = "$ff;$ff\bin;$env:PATH"
$env:PYTHONPATH = (Get-ChildItem "$ff\lib" -Directory -Filter 'python*' | Select-Object -First 1).FullName
$name = [IO.Path]::GetFileName($Font)

foreach ($i in 1..$Runs) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process "$ff\bin\fontforge.exe" -ArgumentList '-nosplash', "`"$Font`"" -PassThru
    $window = $null
    while ($sw.Elapsed.TotalSeconds -lt 60) {
        $p.Refresh()
        # The font view's title is "<fontname>  <file> (<encoding>)"
        if ($p.MainWindowTitle -like "*$name*") { $window = $sw.Elapsed.TotalMilliseconds; break }
        Start-Sleep -Milliseconds 10
    }
    Start-Sleep -Seconds 3   # let it finish drawing and settle
    $p.Refresh()
    [pscustomobject]@{
        run = $i; font = $name
        window_ms = [math]::Round($window)
        working_set_mb = [math]::Round($p.WorkingSet64 / 1MB, 1)
        private_mb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    } | ConvertTo-Json -Compress
    Stop-Process -Id $p.Id -Force
    Start-Sleep -Milliseconds 500
}
