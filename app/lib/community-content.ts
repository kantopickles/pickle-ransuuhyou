export type CommunityEvent = {
  date: string;
  day: string;
  title: string;
  location: string;
  status: string;
  url: string;
};

export type PracticeLevel = "beginner" | "intermediate";

export function getPracticeLevels(title: string): PracticeLevel[] {
  const beginner = /(初級|初中級|初心者|はじめて|🔰)/.test(title);
  // 「初中級」は初級側として扱い、単独の「中級」と区別する。
  const titleWithoutIntroIntermediate = title.replaceAll("初中級", "");
  const intermediate = /(中級|中上級|上級)/.test(titleWithoutIntroIntermediate);

  if (!beginner && !intermediate) return ["beginner", "intermediate"];
  return [
    ...(beginner ? ["beginner" as const] : []),
    ...(intermediate ? ["intermediate" as const] : [])
  ];
}

export const COMMUNITY_LINKS = {
  instagram: "https://www.instagram.com/kantopickles_ricchan/",
  line: "https://line.me/R/ti/p/@222chbus",
  practiceTennisBear: "https://www.tennisbear.net/user/303162/organized-event",
  tournamentTennisBear: "https://www.tennisbear.net/user/36614/organized-event"
} as const;
