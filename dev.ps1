# Development wrapper for i18n extension
# Called by Kawa Code when launching extension in dev mode on Windows

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
& npx tsx src/index.ts
