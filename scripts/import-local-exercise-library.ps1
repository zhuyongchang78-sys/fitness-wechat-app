param(
  [string]$ZipPath = 'D:\desktop\动作库.zip'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mediaRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'prototype\assets\exercise-media'))
$dataOutput = [IO.Path]::GetFullPath((Join-Path $projectRoot 'prototype\exercise-data.js'))

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "找不到动作库压缩包：$ZipPath"
}

[IO.Directory]::CreateDirectory($mediaRoot) | Out-Null

$existingNames = @{}
if (Test-Path -LiteralPath $dataOutput) {
  try {
    $existingText = [IO.File]::ReadAllText($dataOutput, [Text.Encoding]::UTF8)
    $existingJson = $existingText -replace '^\s*window\.REAL_EXERCISES\s*=\s*', '' -replace ';\s*$', ''
    $existingItems = $existingJson | ConvertFrom-Json
    foreach ($item in $existingItems) {
      if ($item.name -match '[\u4e00-\u9fff]') {
        $existingNames[[string]$item.id] = [string]$item.name
      }
    }
  } catch {
    Write-Warning '未能读取旧版中文动作名称，将继续使用数据集英文名称。'
  }
}

$partMap = @{
  'back'='背'; 'chest'='胸'; 'shoulders'='肩'; 'neck'='肩';
  'upper legs'='腿'; 'lower legs'='腿'; 'cardio'='腿';
  'waist'='核心'; 'upper arms'='手臂'; 'lower arms'='手臂'
}
$equipmentMap = @{
  'body weight'='徒手'; 'dumbbell'='哑铃'; 'barbell'='杠铃'; 'ez barbell'='杠铃';
  'olympic barbell'='杠铃'; 'trap bar'='杠铃'
}
$targetMap = @{
  'abs'='腹肌'; 'pectorals'='胸大肌'; 'biceps'='肱二头肌'; 'glutes'='臀肌';
  'delts'='三角肌'; 'triceps'='肱三头肌'; 'upper back'='上背'; 'lats'='背阔肌';
  'calves'='小腿'; 'quads'='股四头肌'; 'forearms'='前臂';
  'cardiovascular system'='心肺系统'; 'hamstrings'='腘绳肌'; 'spine'='竖脊肌';
  'traps'='斜方肌'; 'adductors'='内收肌'; 'abductors'='外展肌';
  'serratus anterior'='前锯肌'; 'levator scapulae'='肩胛提肌'
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $jsonEntry = $archive.GetEntry('exercises-dataset-main/data/exercises.json')
  if (-not $jsonEntry) { throw '压缩包中缺少 data/exercises.json。' }

  $reader = New-Object IO.StreamReader($jsonEntry.Open(), [Text.Encoding]::UTF8)
  try { $sourceItems = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }

  $mediaEntries = $archive.Entries | Where-Object {
    $_.FullName -like 'exercises-dataset-main/images/*.jpg' -or
    $_.FullName -like 'exercises-dataset-main/videos/*.gif'
  }

  $copied = 0
  foreach ($entry in $mediaEntries) {
    $fileName = [IO.Path]::GetFileName($entry.FullName)
    if (-not $fileName) { continue }
    $destination = [IO.Path]::GetFullPath((Join-Path $mediaRoot $fileName))
    if (-not $destination.StartsWith($mediaRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "检测到不安全的压缩包路径：$($entry.FullName)"
    }
    $inputStream = $entry.Open()
    $outputStream = [IO.File]::Open($destination, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    $copied++
  }

  $result = foreach ($item in $sourceItems) {
    $id = [string]$item.id
    $displayName = if ($existingNames.ContainsKey($id)) { $existingNames[$id] } else { [string]$item.name }
    $part = if ($partMap.ContainsKey([string]$item.body_part)) { $partMap[[string]$item.body_part] } else { '全部' }
    $equipment = if ($equipmentMap.ContainsKey([string]$item.equipment)) { $equipmentMap[[string]$item.equipment] } else { '器械' }
    $target = if ($targetMap.ContainsKey([string]$item.target)) { $targetMap[[string]$item.target] } else { [string]$item.target }
    $steps = @($item.instruction_steps.zh)
    if (-not $steps.Count) { $steps = @([string]$item.instructions.zh) }

    [ordered]@{
      id = $id
      name = $displayName
      englishName = [string]$item.name
      part = $part
      equipment = $equipment
      target = $target
      muscleGroup = [string]$item.muscle_group
      secondaryMuscles = @($item.secondary_muscles)
      image = 'assets/exercise-media/' + [IO.Path]::GetFileName([string]$item.image)
      gif = 'assets/exercise-media/' + [IO.Path]::GetFileName([string]$item.gif_url)
      steps = $steps
      attribution = [string]$item.attribution
      privateOnly = $true
    }
  }

  $json = $result | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($dataOutput, "window.REAL_EXERCISES = $json;`r`n", (New-Object Text.UTF8Encoding($false)))

  Write-Output "动作数据：$($result.Count) 条"
  Write-Output "媒体文件：$copied 个"
  Write-Output "本地数据：$dataOutput"
  Write-Output "本地媒体：$mediaRoot"
} finally {
  $archive.Dispose()
}
