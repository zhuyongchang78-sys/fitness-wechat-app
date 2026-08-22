# 免费图匹配报告

- 本地动作总数：**1324**
- 匹配到免费图：**385**（匹配率 29.1%）
  - FreeExerciseDB（公共领域）：370
  - Wikimedia Commons GIF：4
  - wger.de（CC-BY-SA）：11
  - 精确名匹配：145，宽松匹配（仅去复数）：17，模糊匹配（变式->基础动作）：223
- 未匹配：**939**，清单见 `scripts/unmatched-exercises.json`

## 产出文件

- `prototype/matched-open-exercise-data.js`：`window.MATCHED_EXERCISES`，字段与 `open-exercise-data.js` 一致，可直接合并进公开原型。
- `scripts/unmatched-exercises.json`：仍未找到免费图的动作，可手动补图或暂时不放图。

## 许可说明

- 动作**文字数据**（名称、步骤、部位、器械、目标肌群）来自你本地 MIT 数据集，可自由使用。
- **FreeExerciseDB**：代码与数据为 Unlicense（公共领域），可自由商用、无需署名；但“仓库许可”不完全等于“每张照片的权利”，正式商用前建议抽查个别图片来源。
- **wger**：图片为 CC 授权，需保留 `author` / `license` / `licenseUrl` / `sourceUrl` 署名字段；`license_author` 为空时回退为 `wger.de contributors`。
- **Wikimedia**：沿用你已有的署名字段。
- 图片当前为**热链**到 FreeExerciseDB / wger 的站点；用于正式产品时建议下载到本地仓库（与现有 `assets/open-exercises/` 一致），避免外站变动影响显示。
- 少量同名不同变式（宽握/窄握）可能配到近似图，使用前请抽查。
