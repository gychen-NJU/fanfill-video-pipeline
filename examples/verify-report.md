# PV 成片核验报告

- 文件：`10_h3video\pv\未来再见_PV_v2_1080p.mp4`
- 生成：2026-09-28 14:30:23
- 大小：210.5 MB｜码率 10647 kbps

## 1. 基本规格

| 项 | 实测 | 要求 | 结论 |
|---|---|---|---|
| 时长 | 165.875s | 165.86 ±0.05s | ✅ |
| 分辨率 | 1920x1080 | 1920x1080 | ✅ |
| 帧率 | 24/1 | 24/1 | ✅ |
| 视频编码 | h264 | h264 | ✅ |
| 音频编码 | aac | aac | ✅ |

## 2. 响度

| 项 | 实测 | 要求 | 结论 |
|---|---|---|---|
| 整体响度 I | -14.1 LUFS | -14 ±1 LUFS | ✅ |
| 真峰值 TP | -1 dBFS | ≤ -1 dBTP | ✅ |

## 3. 指定画面抽帧（人眼复核用）

- 48s（段5 v1_growth）：要求4.1 星海绘卷→然后向着明天 的成长转化 → `verify/mandated_48s.jpg`
- 68s（段7 v1_xinyan）：要求4.2 会一直记得薪炎永燃（薪火传承） → `verify/mandated_68s.jpg`
- 86s（段9 c1_lantern）：要求4.3 携愿的灯 星消的夜（屏幕截图115） → `verify/mandated_86s.jpg`
- 134s（段14 c2_moon）：要求4.4 仲夏的梦 红月的夜（月下1） → `verify/mandated_134s.jpg`

## 4. 字幕

| 歌词行数 | 24/24 | 全部出现 | ✅ |
| 字体一致性 | Microsoft YaHei | 单一字体 | ✅ |
- 样式：Lyric/Microsoft YaHei、Title/Microsoft YaHei、Info/Microsoft YaHei、Small/Microsoft YaHei

## 5. 原创性（成片帧 vs 参考原图，SSIM 越低越"二创"）

| 抽样最大 SSIM | 0.522（34s vs ref_德丽莎2022生日.jpg） | < 0.90 | ✅ |
- 抽样 41 帧（每 4 秒 1 帧），逐帧与其所属段的参考图比较

## 6. 段间接缝（相邻段末帧 / 首帧 SSIM）

| 接点 | 类型 | 末帧 | 首帧 | SSIM | 结论 |
|---|---|---|---|---|---|
| 1→2 | 链式衔接 | intro_title | intro_origin | 0.866 | ✅ |
| 2→3 | 链式衔接 | intro_origin | intro_credits | 0.929 | ✅ |
| 3→4 | 硬切 | intro_credits | v1_story | 0.346 | ✅ |
| 4→5 | 转场 | v1_story | v1_growth | 0.469 | ✅ |
| 5→6 | 硬切 | v1_growth | v1_miss | 0.325 | ✅ |
| 6→7 | 硬切 | v1_miss | v1_xinyan | 0.433 | ✅ |
| 7→8 | 转场 | v1_xinyan | c1_bloom | 0.429 | ✅ |
| 8→9 | 硬切 | c1_bloom | c1_lantern | 0.406 | ✅ |
| 9→10 | 硬切 | c1_lantern | c1_heart | 0.416 | ✅ |
| 10→11 | 转场 | c1_heart | bridge_wake | 0.345 | ✅ |
| 11→12 | 链式衔接 | bridge_wake | inter_a | 0.788 | ✅ |
| 12→13 | 链式衔接 | inter_a | inter_b | 0.885 | ✅ |
| 13→14 | 硬切 | inter_b | c2_moon | 0.417 | ✅ |
| 14→15 | 硬切 | c2_moon | c2_thanks | 0.451 | ✅ |
| 15→16 | 转场 | c2_thanks | out_replay | 0.512 | ✅ |
| 16→17 | 转场 | out_replay | out_credits | 0.355 | ✅ |

## 7. 结论

- ✅ 全部通过