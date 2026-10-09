# -*- coding: utf-8 -*-
"""Create Chinese stage folders and Markdown files for a webnovel project."""

from __future__ import annotations

import argparse
import re
from datetime import datetime
from pathlib import Path


STAGE_FILES = {
    "01_设定拆解": ["设定拆解.md"],
    "02_项目配置": ["项目配置.md", "文风样本与规则.md"],
    "03_世界规则与卖点": ["世界规则与卖点.md"],
    "04_人物记忆库": ["角色卡.md", "人物关系.md", "情绪与行为记忆.md", "批次人物摘要.md"],
    "04_连续性记忆库": ["时间线.md", "伏笔台账.md", "物品与伤势.md", "规则术语表.md", "知情边界.md"],
    "05_长篇大纲": ["分卷大纲.md", "章节总纲.md", "第001-030章节奏.md"],
    "06_章节设计": ["第001-030章细纲.md", "第001章任务清单.md", "第001章细纲.md"],
    "07_正文章节": ["第001章.md"],
    "08_章后更新": ["第001章记忆更新.md"],
    "09_续写状态": ["当前进度.md", "改动影响记录.md"],
}

EXTRA_DIRS = ["04_人物记忆库/历史归档"]


def sanitize_title(title: str | None) -> str:
    raw = (title or "").strip()
    if not raw:
        return "网文项目_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", raw).strip()
    cleaned = re.sub(r"\s+", "", cleaned)
    return cleaned or "网文项目_" + datetime.now().strftime("%Y%m%d_%H%M%S")


def heading_from_filename(filename: str) -> str:
    return Path(filename).stem


def skeleton(title: str, stage: str, filename: str) -> str:
    heading = heading_from_filename(filename)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if filename == "文风样本与规则.md":
        return (
            f"# {heading}\n\n"
            f"- 项目：{title}\n"
            f"- 阶段：{stage}\n"
            "- 文风来源：项目默认\n"
            "- 状态：未启用\n"
            "- 适用范围：全部正文章节\n"
            f"- 创建时间：{now}\n\n"
            "## 启用条件\n\n"
            "用户提供写作样本或明确自定义文风后，按 style-system.md 分析并启用。\n"
        )
    return (
        f"# {heading}\n\n"
        f"- 项目：{title}\n"
        f"- 阶段：{stage}\n"
        f"- 状态：待生成\n"
        f"- 创建时间：{now}\n\n"
        "## 内容\n\n"
        "待填写。\n"
    )


def create_project(title: str, output: Path, dry_run: bool) -> Path:
    safe_title = sanitize_title(title)
    project_dir = output / f"{safe_title}创作档案"
    planned_paths: list[Path] = [project_dir / "阶段索引.md"]

    for stage, files in STAGE_FILES.items():
        for filename in files:
            planned_paths.append(project_dir / stage / filename)
    for dirname in EXTRA_DIRS:
        planned_paths.append(project_dir / dirname)

    if dry_run:
        print(f"[DRY RUN] Project folder: {project_dir}")
        for path in planned_paths:
            print(path)
        return project_dir

    project_dir.mkdir(parents=True, exist_ok=True)
    for dirname in EXTRA_DIRS:
        (project_dir / dirname).mkdir(parents=True, exist_ok=True)

    index_lines = [
        "# 阶段索引",
        "",
        f"- 项目：{safe_title}",
        f"- 创建时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 阶段文件",
        "",
    ]

    for stage, files in STAGE_FILES.items():
        stage_dir = project_dir / stage
        stage_dir.mkdir(parents=True, exist_ok=True)
        index_lines.append(f"### {stage}")
        for filename in files:
            path = stage_dir / filename
            if not path.exists():
                path.write_text(skeleton(safe_title, stage, filename), encoding="utf-8")
            index_lines.append(f"- {stage}/{filename}")
        if stage == "04_人物记忆库":
            index_lines.append("- 04_人物记忆库/历史归档/（按30章批次保存详细日志）")
        index_lines.append("")

    index_path = project_dir / "阶段索引.md"
    if not index_path.exists():
        index_path.write_text("\n".join(index_lines), encoding="utf-8")

    print(f"Created project dossier: {project_dir}")
    return project_dir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create Chinese stage folders and Markdown files for a webnovel project."
    )
    parser.add_argument("--title", default="", help="Novel title or temporary project title.")
    parser.add_argument(
        "--output",
        default=".",
        help="Directory where the project dossier should be created.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print planned files without writing.")
    args = parser.parse_args()

    create_project(args.title, Path(args.output).resolve(), args.dry_run)


if __name__ == "__main__":
    main()
