"use client";
import { type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../ui";
import { Feather } from "lucide-react";
export const stages = [
  ["requirements", "创作需求", "01"],
  ["idea", "灵感与构思", "02"],
  ["contract", "本书设定", "03"],
  ["world", "世界观", "04"],
  ["characters", "人物与关系", "05"],
  ["planning", "故事规划", "06"],
  ["chapter-plan", "章节与场景", "07"],
  ["draft", "正文编辑", "08"],
  ["review", "审稿与定稿", "09"],
  ["memory", "记忆与资料", "10"],
  ["transfer", "导入与导出", "11"],
];
export const genreName = (g: string) =>
  ({ URBAN: "都市", XUAN: "玄幻", XIAN: "仙侠", WUX: "武侠", FANT: "奇幻", MYTH: "神话", POWER: "都市异能", MROM: "现代言情", AROM: "古代言情", CAMPUS: "校园青春", FAMILY: "婚恋家庭", ERA: "年代生活", CAREER: "职场", BUSINESS: "商战", SHOWBIZ: "娱乐圈", RURAL: "乡村田园", BUILD: "种田基建", OFFICE: "官场", HISTORY: "历史", WAR: "军事战争", SPY: "谍战", MYSTERY: "悬疑", HORROR: "惊悚恐怖", RULEHOR: "规则怪谈", INFINITE: "无限流", BATTLE: "生存博弈", SCIFI: "科幻", CYBER: "赛博机甲", APOC: "末世", SPACE: "星际", GAME: "游戏网游", ESPORT: "电竞", SPORT: "体育", LIGHT: "轻小说", FANFIC: "同人", NONHUM: "兽世异族", BEAST: "御兽", ADVENTURE: "探险", RESEARCH: "科研工业", PROF: "行业故事", EXAM: "科举", FLEE: "逃荒", MATRI: "女尊", TYCOON: "神豪", APPRAISE: "鉴宝", CEO: "豪门总裁", COURT: "宫斗", HOUSE: "宅斗", MEDFANT: "神医", URBANCULT: "都市修真", RICHRET: "归来逆袭", MYSTROM: "悬疑恋爱", FANTROM: "玄幻言情", FOOD: "美食", FISH: "赶海钓鱼", FOLK: "民俗玄谈" } as Record<string, string>)[g] ||
  g ||
  "未定题材";
export const bookUrl = (id: string, stage = "continue") =>
  `/studio/book/${id}/${stage}`;
export const countWords = (t: string) =>
  Array.from(t.replace(/\s/g, "")).length;
export function useAction() {
  const toast = useToast(),
    cache = useQueryClient();
  return async (fn: () => Promise<unknown>, message?: string) => {
    try {
      const result = await fn();
      await cache.invalidateQueries();
      if (message) toast(message);
      return result;
    } catch (e) {
      toast((e as Error).message, true);
      throw e;
    }
  };
}
export function Heading({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="s-heading">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="s-actions">{children}</div>
    </div>
  );
}
export function Cover({
  title,
  genre,
  small = false,
}: {
  title: string;
  genre?: string;
  small?: boolean;
}) {
  return (
    <div
      className={`s-cover ${small ? "small" : ""}`}
      style={{
        backgroundImage: `url(/studio-assets/${genre === "XUAN" ? "mountains" : "city"}.png)`,
      }}
    >
      <span>{title}</span>
      <small>长篇创作</small>
    </div>
  );
}
export function Blank({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  return (
    <div className="s-blank">
      <Feather size={30} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{sub}</p>
      {children}
    </div>
  );
}
export function DotArt() {
  return (
    <span className="s-dot-art" aria-hidden="true">
      {Array.from({ length: 49 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
export function ReadText({ text }: { text: string }) {
  return (
    <div className="s-read-text">
      {text
        .split("\n")
        .map((line, i) =>
          line.startsWith("# ") ? (
            <h2 key={i}>{line.slice(2)}</h2>
          ) : line.startsWith("## ") ? (
            <h3 key={i}>{line.slice(3)}</h3>
          ) : (
            <p key={i}>{line || "\u00a0"}</p>
          ),
        )}
    </div>
  );
}
