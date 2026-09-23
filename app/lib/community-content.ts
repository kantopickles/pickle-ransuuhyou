export type CommunityEvent = {
  date: string;
  day: string;
  title: string;
  location: string;
  status: string;
  url: string;
};

export const COMMUNITY_LINKS = {
  instagram: "https://www.instagram.com/kantopickles_ricchan/",
  line: "https://line.me/R/ti/p/@222chbus",
  practiceTennisBear: "https://www.tennisbear.net/user/303162/organized-event",
  tournamentTennisBear: "https://www.tennisbear.net/user/36614/organized-event"
} as const;
