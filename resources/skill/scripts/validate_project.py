# -*- coding: utf-8 -*-
"""Validate a staged webnovel project dossier."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_FILES = [
    "01_设定拆解/设定拆解.md",
    "02_项目配置/项目配置.md",
    "02_项目配置/文风样本与规则.md",
    "03_世界规则与卖点/世界规则与卖点.md",
    "04_人物记忆库/角色卡.md",
    "04_人物记忆库/人物关系.md",
    "04_人物记忆库/情绪与行为记忆.md",
    "04_人物记忆库/批次人物摘要.md",
    "04_连续性记忆库/时间线.md",
    "04_连续性记忆库/伏笔台账.md",
    "04_连续性记忆库/物品与伤势.md",
    "04_连续性记忆库/规则术语表.md",
    "04_连续性记忆库/知情边界.md",
    "05_长篇大纲/分卷大纲.md",
    "05_长篇大纲/章节总纲.md",
    "09_续写状态/当前进度.md",
    "09_续写状态/改动影响记录.md",
    "阶段索引.md",
]

TASK_FIELDS = [
    "本章标题",
    "目标字数",
    "字数范围",
    "视角",
    "文风依据",
    "当前剧情阶段",
    "上章钩子",
    "章节类型",
    "情节强度",
    "本章核心事件",
    "前300字叙事入口",
    "本章状态变化",
    "本章主要阅读回报",
    "主角主动选择",
    "外部推动",
    "必须出场角色",
    "必须承接记忆",
    "本章首次出现的新名词及白话解释",
    "新增信息",
    "回收伏笔",
    "章末证据或异常的基础意义",
    "仍需保留的悬念",
]

BATCH_FIELDS = [
    "承接",
    "章节类型",
    "情节强度",
    "前300字叙事入口",
    "核心场面",
    "主角动作",
    "外部推动",
    "状态变化",
    "设定揭示预算",
    "主要阅读回报",
    "人物记忆变化",
    "章末牵引",
]

UPDATE_FIELDS = [
    "核心事件",
    "正文实际字数",
    "章节类型与强度",
    "状态变化",
    "主要阅读回报",
    "主角获得",
    "主角失去",
    "对手或外部局势变化",
    "新增冲突",
    "新增伏笔",
    "回收伏笔",
    "必须承接",
    "建议章节类型与强度",
    "已同步角色卡当前字段",
    "已追加情绪与行为记忆",
    "已更新人物关系",
    "已更新批次人物摘要",
    "已更新连续性台账",
    "已更新阶段索引",
    "已更新当前进度",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def numbered_files(folder: Path, suffix: str) -> dict[int, Path]:
    result: dict[int, Path] = {}
    if not folder.exists():
        return result
    pattern = re.compile(rf"^第(\d{{3}})章{re.escape(suffix)}\.md$")
    for path in folder.glob("*.md"):
        match = pattern.match(path.name)
        if match:
            result[int(match.group(1))] = path
    return result


def field_exists(text: str, field: str) -> bool:
    return re.search(rf"^-\s*{re.escape(field)}[：:]", text, re.MULTILINE) is not None


def parse_total_rows(text: str) -> dict[int, tuple[str, int]]:
    rows: dict[int, tuple[str, int]] = {}
    for line in text.splitlines():
        match = re.match(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d)\s*\|", line)
        if match:
            rows[int(match.group(1))] = (match.group(2).strip(), int(match.group(3)))
    return rows


def parse_batch_sections(text: str) -> dict[int, str]:
    matches = list(re.finditer(r"^##\s+第(\d{3})章(?:：[^\n]+)?\s*$", text, re.MULTILINE))
    sections: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[int(match.group(1))] = text[match.end():end]
    return sections


def parse_volume_ranges(text: str) -> list[tuple[int, int, int]]:
    ranges: list[tuple[int, int, int]] = []
    pattern = re.compile(
        r"^\|\s*第[^|]+卷\s*\|[^|]*\|\s*(\d+)\s*[-—]\s*(\d+)\s*\|\s*(\d+)章",
        re.MULTILINE,
    )
    for match in pattern.finditer(text):
        ranges.append(tuple(map(int, match.groups())))
    return ranges


def normalize_type(value: str) -> str:
    return re.sub(r"[\s。.]", "", value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a webnovel project dossier.")
    parser.add_argument("project_dir", help="Path to the project dossier.")
    args = parser.parse_args()

    root = Path(args.project_dir).resolve()
    errors: list[str] = []
    warnings: list[str] = []

    if not root.is_dir():
        print(f"ERROR: 项目目录不存在：{root}")
        return 2

    for relative in REQUIRED_FILES:
        if not (root / relative).is_file():
            errors.append(f"缺少必需文件：{relative}")

    prose = numbered_files(root / "07_正文章节", "")
    latest = max(prose, default=0)
    if latest == 0:
        errors.append("未发现第XXX章.md格式的正文文件")
    elif set(prose) != set(range(1, latest + 1)):
        errors.append(f"正文编号不连续：现有 {sorted(prose)}")

    related = {
        "任务清单": numbered_files(root / "06_章节设计", "任务清单"),
        "单章细纲": numbered_files(root / "06_章节设计", "细纲"),
        "章后更新": numbered_files(root / "08_章后更新", "记忆更新"),
    }
    for label, files in related.items():
        missing = [number for number in range(1, latest + 1) if number not in files]
        if missing:
            errors.append(f"{label}缺少已完成章节：{missing}")

    config_path = root / "02_项目配置/项目配置.md"
    config = read(config_path) if config_path.exists() else ""
    range_match = re.search(r"字数允许范围[：:]\s*(\d+)\s*[-—至]\s*(\d+)", config)
    minimum, maximum = (2300, 2700)
    if range_match:
        minimum, maximum = map(int, range_match.groups())
    else:
        warnings.append("项目配置未识别出字数允许范围，按2300-2700检查")

    for number, path in sorted(prose.items()):
        lines = read(path).splitlines()
        body = "\n".join(lines[1:] if lines and lines[0].startswith("# ") else lines)
        count = len(re.sub(r"\s+", "", body))
        if not minimum <= count <= maximum:
            errors.append(f"第{number:03d}章正文非空白字符数{count}，不在{minimum}-{maximum}")

    for number, path in sorted(related["任务清单"].items()):
        if number > latest:
            continue
        text = read(path)
        missing = [field for field in TASK_FIELDS if not field_exists(text, field)]
        if missing:
            errors.append(f"第{number:03d}章任务清单缺字段：{', '.join(missing)}")

    for number, path in sorted(related["章后更新"].items()):
        if number > latest:
            continue
        text = read(path)
        missing = [field for field in UPDATE_FIELDS if not field_exists(text, field)]
        if missing:
            errors.append(f"第{number:03d}章章后更新缺字段：{', '.join(missing)}")

    if latest:
        batch_start = ((latest - 1) // 30) * 30 + 1
        batch_end = batch_start + 29
        batch_name = f"第{batch_start:03d}-{batch_end:03d}章细纲.md"
        rhythm_name = f"第{batch_start:03d}-{batch_end:03d}章节奏.md"
        batch_path = root / "06_章节设计" / batch_name
        rhythm_path = root / "05_长篇大纲" / rhythm_name
        if not batch_path.exists():
            errors.append(f"缺少当前批次细纲：06_章节设计/{batch_name}")
        if not rhythm_path.exists():
            errors.append(f"缺少当前批次节奏：05_长篇大纲/{rhythm_name}")
        else:
            rhythm_ranges: list[tuple[int, int]] = []
            for line in read(rhythm_path).splitlines():
                match = re.match(r"^\|\s*(\d+)\s*[-—]\s*(\d+)\s*\|", line)
                if match:
                    rhythm_ranges.append(tuple(map(int, match.groups())))
            covered: list[int] = []
            for start, end in rhythm_ranges:
                covered.extend(range(start, end + 1))
            expected_numbers = list(range(batch_start, batch_end + 1))
            if covered != expected_numbers:
                errors.append(
                    f"当前批次节奏范围未连续覆盖{batch_start:03d}-{batch_end:03d}：{rhythm_ranges}"
                )

        total_path = root / "05_长篇大纲/章节总纲.md"
        total_rows = parse_total_rows(read(total_path)) if total_path.exists() else {}
        missing_total = [n for n in range(batch_start, batch_end + 1) if n not in total_rows]
        if missing_total:
            errors.append(f"章节总纲未覆盖当前批次：{missing_total}")

        if batch_path.exists():
            batch_text = read(batch_path)
            for field in ["对应章节总纲范围已扩展", "对应三十章节奏文件"]:
                if not field_exists(batch_text, field):
                    errors.append(f"当前批次细纲缺批次级字段：{field}")
            sections = parse_batch_sections(batch_text)
            expected = set(range(batch_start, batch_end + 1))
            if set(sections) != expected:
                missing = sorted(expected - set(sections))
                extra = sorted(set(sections) - expected)
                errors.append(f"当前批次章节标题不完整，缺少{missing}，多出{extra}")
            for number in sorted(expected & set(sections)):
                section = sections[number]
                missing = [field for field in BATCH_FIELDS if not field_exists(section, field)]
                if missing:
                    errors.append(f"批量细纲第{number:03d}章缺字段：{', '.join(missing)}")
                type_match = re.search(r"^-\s*章节类型[：:]\s*([^\n]+)", section, re.MULTILINE)
                intensity_match = re.search(r"^-\s*情节强度[：:]\s*(\d)", section, re.MULTILINE)
                if number in total_rows and type_match and intensity_match:
                    total_type, total_intensity = total_rows[number]
                    if normalize_type(type_match.group(1)) != normalize_type(total_type):
                        errors.append(
                            f"第{number:03d}章类型不同步：总纲={total_type}，批量细纲={type_match.group(1).strip()}"
                        )
                    if int(intensity_match.group(1)) != total_intensity:
                        errors.append(
                            f"第{number:03d}章强度不同步：总纲={total_intensity}，批量细纲={intensity_match.group(1)}"
                        )

    progress_path = root / "09_续写状态/当前进度.md"
    if progress_path.exists() and latest:
        progress = read(progress_path)
        if f"第{latest:03d}章" not in progress:
            errors.append(f"当前进度未标明最新正文第{latest:03d}章")
        batch_progress = ((latest - 1) % 30) + 1
        if f"{batch_progress}/30" not in progress:
            errors.append(f"当前进度未标明批次进度{batch_progress}/30")

    version_values: list[tuple[str, str]] = []
    for label, path in [("项目配置", config_path), ("当前进度", progress_path)]:
        if path.exists():
            match = re.search(r"工作流版本[：:]\s*([^\s]+)", read(path))
            if match:
                version_values.append((label, match.group(1)))
            else:
                errors.append(f"{label}缺少工作流版本")
    if len({value for _, value in version_values}) > 1:
        errors.append(f"工作流版本不一致：{version_values}")

    volume_path = root / "05_长篇大纲/分卷大纲.md"
    if volume_path.exists():
        volume_ranges = parse_volume_ranges(read(volume_path))
        if not volume_ranges:
            errors.append("分卷大纲未识别出分卷容量表")
        else:
            previous_end = 0
            for start, end, declared in volume_ranges:
                actual = end - start + 1
                if actual != declared:
                    errors.append(
                        f"分卷范围{start:03d}-{end:03d}实际{actual}章，与声明{declared}章不符"
                    )
                if start != previous_end + 1:
                    errors.append(
                        f"分卷范围不连续：上一卷结束{previous_end:03d}，下一卷从{start:03d}开始"
                    )
                previous_end = end
            total_match = re.search(r"预计总章数[：:]\s*约?(\d+)章", config)
            if total_match and previous_end != int(total_match.group(1)):
                errors.append(
                    f"分卷容量截止第{previous_end}章，与项目预计总章数{total_match.group(1)}不符"
                )

    index_path = root / "阶段索引.md"
    if index_path.exists():
        index = read(index_path).replace("\\", "/")
        for path in root.rglob("*.md"):
            relative = path.relative_to(root).as_posix()
            if relative == "阶段索引.md" or relative.startswith("99_旧流程归档/"):
                continue
            if relative not in index:
                errors.append(f"阶段索引缺少：{relative}")

    memory_files = [
        root / "04_人物记忆库/角色卡.md",
        root / "04_人物记忆库/情绪与行为记忆.md",
        root / "04_人物记忆库/批次人物摘要.md",
        root / "04_连续性记忆库/时间线.md",
        root / "04_连续性记忆库/伏笔台账.md",
        root / "04_连续性记忆库/物品与伤势.md",
        root / "04_连续性记忆库/规则术语表.md",
        root / "04_连续性记忆库/知情边界.md",
    ]
    if latest:
        for path in memory_files:
            if path.exists() and f"第{latest:03d}章" not in read(path):
                warnings.append(f"{path.relative_to(root).as_posix()} 未明确标注同步至第{latest:03d}章")

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")

    if errors:
        print(f"校验失败：{len(errors)}个错误，{len(warnings)}个警告")
        return 1
    print(f"校验通过：最新正文第{latest:03d}章，0个错误，{len(warnings)}个警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())
