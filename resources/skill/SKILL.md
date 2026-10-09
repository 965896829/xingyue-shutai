---
name: webnovel-seed-to-chapter
description: "Turn Chinese webnovel high-concept seeds into a staged longform plan, character memory system, first chapter, and continuation workflow. Use when the user provides any 神级设定, 脑洞设定, 番茄爽文 premise, longform webnovel idea, or asks for 大纲, 主要角色, 人物记忆, 第一章, 后续章节续写, or chapter memory updates."
---

# Webnovel Seed To Chapter

- 工作流版本：2.0
- 规则修订：2026-10-08-r2（命名系统升级全题材 v2.0；保留阶段、目录与模板字段）

## Core Rule

Use this skill to turn any high-concept webnovel seed into a reusable longform project package, not just one chat answer. Work in visible stages, tell the user the current stage, and create Chinese folders plus Markdown files for every stage so the user can inspect the result outside the conversation.

Before producing content, load the relevant references:

- Read `references/workflow.md` for the full stage checklist.
- Read `references/memory-system.md` before creating or continuing any character-driven project.
- Read `references/style-system.md` when the user supplies a writing sample, requests a custom voice, or asks to rewrite chapters in their own style.
- Read the shared constraints and relevant genre/tag modules in `references/naming-system.md` (全题材 v2.0) before creating or renaming characters, factions, institutions, ranks, artifacts, techniques, or places. Combine modules by the actual object's world, era and culture; do not load every genre example as a candidate pool. Preserve accepted names unless their revision is authorized.
- Read `references/templates.md` when writing project files, chapter plans, quality checks, or memory updates.

## Rule Scope And Examples

- Follow the author's explicit requirements and confirmed project settings before skill defaults. Examples illustrate a method; they are not facts about the current book or instructions to add those characters, institutions, artifacts, or scenes.
- Treat examples marked `反例` or `原句（待改）` as material to avoid or revise. Only `正向结构参考` and `改写示例` demonstrate an allowed approach; do not copy their names, plots, or sentences into the book. Keep counterexamples separate from recommended examples.
- Apply naming rules from the first premise breakdown. Apply prose voice and narration rules to prose and prose revision; planning files should explain concrete goals, actions, costs, and consequences clearly. Do not turn a planning file into novel prose to satisfy a voice rule.
- A custom voice profile applies only when marked `已启用`; an existing but `未启用` file does not cancel confirmed style preferences in the project configuration. A list of scene types describes coverage when those scenes occur, not a requirement to add every scene type.
- Keep all required template fields, but do not invent events to fill them. Record no change, unknown, or not applicable with a concrete reason when supported; ask about missing decisions that would change the story direction. Clearly separate author-confirmed facts, proposed creative choices, and unresolved questions.
- Working within a stage does not authorize the next stage. When the author or host requires confirmation, wait for that confirmation before stage generation, prose generation, and acceptance; a recommended cross-stage sequence does not override these boundaries.

## File Output Is Mandatory

When filesystem access is available, create a project dossier in the user's current workspace before or during Stage 1. Prefer the bundled script:

```bash
python <skill目录>/scripts/create_stage_project.py --title "<作品名或临时标题>" --output "<用户工作目录>"
```

The script creates a Chinese project folder such as `作品名创作档案/` with stage folders and Markdown files. Fill or update the appropriate Markdown file after each stage. Do not leave the user's work only in chat.

If filesystem access is unavailable, show the same folder tree and provide the Markdown contents in the response.

## Default Parameters

- Longform target: 300万字 unless the user sets another target.
- Chapter target: 2500 Chinese characters unless the user sets another target.
- For a 2500-character chapter, acceptable range is 2300-2700, inclusive. Revise any draft outside that range before finalizing; 2701-2800 is not an extra allowance. Use the author's confirmed lower and upper bounds when changed.
- Default style: Chinese fast-paced brainhole爽文 with Tomato-style clarity, an immediately legible narrative task, wave-shaped intensity, and visible reader reward.
- Default opening rule: the book opening, volume openings, and selected climax chapters should enter danger, conflict, trial, judgment, pursuit, humiliation, or a strong anomaly within the first 300 characters. Other chapters must enter effective narrative within 300 characters through a goal, consequence, discovery, relationship change, preparation, settlement, or meaningful transition.
- Default chapter flow: give every chapter a clear function, at least one state change, one reader reward, and suitable end traction. Do not force every chapter into the same pressure-counterattack-face-slap structure.
- Respect explicit user constraints as hard constraints: POV, word count, genre, protagonist type, taboo elements, tone, and whether to output only chapter text.
- Treat a user-provided writing sample as a project-level voice constraint. Preserve the project's pacing, plot, and reveal budget while applying that voice to every scene type, including combat.

## Required Stages

Use the 11 stages in `references/workflow.md` for a new premise. The 15 numbered items below list required file outputs, not 15 separate stages. Each stage must update its matching Chinese Markdown files.

1. `01_设定拆解/设定拆解.md`: identify genre, core 神级点, protagonist predicament, world unfairness, breaking method, and longform engine.
2. `02_项目配置/项目配置.md`: lock word count, chapter length, POV, style, audience, pacing, and hard constraints. When the user provides a writing sample or custom voice, also create `02_项目配置/文风样本与规则.md`.
3. `03_世界规则与卖点/世界规则与卖点.md`: expand world rules, golden finger, power system, costs, limits, and anti-stale mechanisms.
4. `04_人物记忆库/角色卡.md`: create main characters with names, functions, emotions, goals, secrets, and behavior style.
5. `04_人物记忆库/人物关系.md`: create relationship graph, factions, relationship labels, polarity, trust, conflict, and hooks.
6. `04_人物记忆库/情绪与行为记忆.md` and `批次人物摘要.md`: keep the active 30-chapter behavior log plus compact cross-batch summaries; archive completed batch logs under `历史归档/`.
7. `04_连续性记忆库/*.md`: initialize timeline, foreshadow, item/injury, rule-term, and knowledge-boundary ledgers.
8. `05_长篇大纲/分卷大纲.md`: create longform mainline, antagonist ladder, volume arcs, and escalation path.
9. `05_长篇大纲/章节总纲.md`: create a chapter-by-chapter roadmap. Each chapter needs type, intensity, narrative entry, state change, information reveal, character-memory change, reader reward, and end traction.
10. `05_长篇大纲/第001-030章节奏.md`: outline the active 30-chapter batch as 3-5 chapter pulses with rising action, release, aftermath, and varied intensity. Later batches use matching names such as `第031-060章节奏.md`.
11. `06_章节设计/第001-030章细纲.md`: create the first 30 chapter fine outlines as one batch before writing longform prose.
12. `06_章节设计/第001章任务清单.md` and `06_章节设计/第001章细纲.md`: derive the active chapter's task list and scene beats from the 30-chapter fine-outline batch.
13. `07_正文章节/第001章.md`: write Chapter 1 within the locked word range and POV.
14. `08_章后更新/第001章记忆更新.md`: update character states, emotions, relationships, behavior logs, continuity ledgers, power changes, and foreshadowing.
15. `09_续写状态/当前进度.md` and `改动影响记录.md`: record current arc, active batch, next handoff, unresolved questions, continuity requirements, and revision cascades.

## Conversational Stage Updates

At each stage, tell the user:

- 当前阶段
- 本阶段要解决什么
- 已生成或将更新哪个 Markdown 文件
- 是否需要用户确认； if enough information exists, proceed within the authorized stage with a reasonable default and record it in `02_项目配置/项目配置.md`. Do not replace required author confirmation with a default; ask before filling a gap that would materially change the story direction.

Keep stage updates short. Do not over-explain basic writing theory.

## Quality Rules Learned From Prior Issues

- Do not exceed the requested chapter length. A "2500字左右" request means 2300-2700, not 4000.
- Avoid abstract, technical, or document-like terms in reader-facing worldbuilding. Prefer simple, memorable Chinese webnovel terms.
- Character names must be easy to read, mainstream, distinctive, and not overused. Avoid obscure names and generic overfamiliar names.
- Names for institutions, ranks, places, techniques, and artifacts must fit their actual era, culture and established naming community. In Eastern fantasy without a corresponding institution, do not mechanically generate `XX司`, `XX使`, or modern departments. These are not universal banned words: established historical offices, modern institutions and conditional exceptions must follow `references/naming-system.md` v2.0. Keep mixed-world naming contexts and viewpoint knowledge separate; do not invent a world system to justify a name.
- Avoid AI-summary prose in chapters. Do not over-explain emotions, themes, or the cleverness of a rule play after the scene already shows it.
- Do not confuse necessary plain-language explanation with AI-summary prose. The first appearance of a new term, judgment, rank, clue, or institutional mark must tell the reader what it means and what immediate consequence it has.
- A chapter hook may hide who caused something, why it happened, or what happens next. It must not hide the basic meaning of the clue itself; readers should understand the clue before becoming curious about its source.
- Avoid model-like correction frames in narration: "不是A，而是B", "并非A，只是B", "与其说A，不如说B", "所谓X，说白了", "这意味着", and "也就是说". State the action, fact, or consequence directly. Character dialogue may use one when the contrast is genuinely part of that character's intent, but do not repeat the pattern across a chapter.
- Reduce stock transitions such as "此言一出", "与此同时", "下一刻", and "就在这时". Prefer a concrete subject beginning the next sentence or a visible change in the scene.
- Use top commercial webnovel craft as a general benchmark, not a specific author's style: scene first, action and dialogue first, short hooks, clear pressure, and room for the reader to infer.
- In chapter prose, delete or reduce ending lines like "他终于明白", "这就是", "所有人第一次意识到", "不是因为...而是因为..." unless they are the actual chapter hook and cannot be shown through action.
- Let key information surface through objects, reactions, interrupted dialogue, public judgment text, silence, wounds, gestures, and consequences.
- Do not dump the full world background or full golden finger in Chapter 1. Reveal only the minimum needed for the immediate conflict. Subsequent chapters should confirm, test, price, limit, and complicate the golden finger through action.
- Never write a continuation chapter directly from the volume outline alone. Read memory files and current progress, then create that chapter's task list and fine outline before writing prose.
- Fine outlines must be generated in 30-chapter batches. Before Chapter 1, create `第001-030章细纲.md`. After Chapter 30 and its memory update, archive the completed behavior log and write the batch summary; then append Chapters 31-60 to `章节总纲.md`, generate `第031-060章节奏.md`, and finally generate `第031-060章细纲.md`. Repeat in the same order for later batches.
- The next 30-chapter batch must be based on actual written chapters, memory updates, unresolved hooks, and deviations from the previous outline. Do not blindly continue the old plan if the story changed.
- `章节总纲` is the authority for chapter order. Each batch rhythm file must summarize or cluster the matching chapter range; if they conflict, revise the rhythm file before writing batch fine outlines.
- The protagonist must not stay suppressed for too long. Release a payoff in Chapter 1.
- Do not make the golden finger omnipotent. Add limits, costs, information gaps, and enemy countermeasures.
- Do not write long exposition before the chapter's narrative task. Begin with pressure when the chapter is meant to be intense; otherwise begin with a goal, consequence, discovery, relationship movement, preparation, settlement, or transition that changes story state.
- Classify each chapter as high-conflict, progression, settlement, daily-life, emotional, or transition, and assign intensity 1-5. Judge intensity by fit to chapter function rather than rewarding every chapter for being louder.
- Every chapter must change at least one of plot position, information, relationship, resource, location, risk, or character decision. A quiet chapter may be low intensity, but it cannot be inert.
- Treat payoff as reader reward. It may be a hard爽点, new knowledge, emotional release, relationship movement, resource gain, world expansion, or anticipation. Do not require a rule-based face-slap in every chapter.
- Use hard cliffhangers selectively. Settlement, daily-life, emotional, and transition chapters may end with a decision, destination, promise, altered relationship, or unresolved detail as soft traction.
- In each 3-5 chapter pulse, vary pressure, progression, release, and aftermath. Avoid three consecutive chapters with the same opening mechanism or the same pressure-counterattack-payoff skeleton unless the sequence is an intentional climax.
- For continuation, never rely on memory alone. Read the project dossier files before writing the next chapter.
- After writing a chapter, reopen the saved chapter file and count the actual non-whitespace characters in the prose body, excluding the Markdown H1 title line, before marking the word count as compliant.
- After every chapter, update changed characters in `角色卡.md`, `人物关系.md`, and the active-batch `情绪与行为记忆.md`; update all affected continuity ledgers and `阶段索引.md`.
- At each 30-chapter boundary, summarize the batch in `批次人物摘要.md`, archive the detailed behavior log as `历史归档/第XXX-XXX章情绪与行为.md`, and reset the active log with only next-batch carryover. Do not read every historical behavior entry for every chapter.
- When `02_项目配置/文风样本与规则.md` contains an active profile, read it before every chapter task list, fine outline, prose draft, and prose revision.
- Before finalizing prose, search for repeated correction frames and stock transitions. Rewrite clusters instead of swapping one trigger phrase for a synonym.

## Continuation Workflow

When the user asks to continue:

1. Read `02_项目配置/项目配置.md` and, when present, `02_项目配置/文风样本与规则.md`.
2. Read `09_续写状态/当前进度.md`, `改动影响记录.md`, and the latest chapter.
3. Read current character cards, relationships, the active-batch behavior log, batch summaries, and all five files in `04_连续性记忆库/`. Open a historical behavior archive only when a returning character or old hook requires it.
4. Read `05_长篇大纲/章节总纲.md`, the matching rhythm file, and the active batch file such as `06_章节设计/第001-030章细纲.md`.
5. If the requested chapter is outside the active batch, first close the completed batch by archiving its detailed behavior log, writing its character summary, and consolidating continuity ledgers. Then append the requested range to `章节总纲.md`, generate the matching rhythm file such as `05_长篇大纲/第031-060章节奏.md`, and only then generate `06_章节设计/第031-060章细纲.md`. Base all three on actual prose, memory, continuity ledgers, unresolved hooks, and recorded deviations.
6. Create or update `06_章节设计/第XXX章任务清单.md` from the batch fine outline.
7. Create or update `06_章节设计/第XXX章细纲.md` with scene-by-scene beats for the immediate chapter.
8. Write `07_正文章节/第XXX章.md` from the chapter fine outline and the active style profile.
9. Update `08_章后更新/第XXX章记忆更新.md`.
10. Update changed character cards, relationships, the active behavior log, and every affected continuity ledger.
11. Update `09_续写状态/当前进度.md`, including active batch, completed chapter count, and whether the next batch must be generated.
12. Update `阶段索引.md` so the dossier reflects every new task list, fine outline, chapter, memory update, and ledger.

If the user asks for a revision such as "更爽", "节奏太慢", "人物崩了", or "压到2500字", record the changed facts and affected file range in `改动影响记录.md`, revise the chapter, then cascade-check every later prose chapter, task list, fine outline, memory file, continuity ledger, and current-progress handoff. Update only files whose facts, timing, knowledge, injuries, objects, hooks, or character state are actually affected.

After scaffolding, batch generation, chapter completion, or a cross-file revision, run:

```bash
python <skill目录>/scripts/validate_project.py "<项目创作档案目录>"
```

Fix all errors before declaring the stage complete. Warnings require review and a recorded reason when intentionally retained.
