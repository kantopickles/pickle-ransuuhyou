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
  tennisBear: "https://www.tennisbear.net/user/303162/organized-event"
} as const;

// 共有画面に掲載する大会情報です。上から最大10件まで表示されます。
export const COMMUNITY_TOURNAMENT_EVENTS: CommunityEvent[] = [
  {
    date: "10/3",
    day: "土",
    title: "OASIS PICKLE CUP vol.1",
    location: "THE PICKLE BANG THEORY（千葉県市川市）",
    status: "募集中",
    url: "https://pikura.app/events/regional-oasis-pickle-cup-vol1-2026"
  },
  {
    date: "10/10",
    day: "土",
    title: "第2回 T.S.C団体戦 ごちゃ混ぜ",
    location: "TKCいちごアリーナ（栃木県鹿沼市）",
    status: "募集中",
    url: "https://pikura.app/events/regional-tsc-team-tournament-2026"
  },
  {
    date: "10/11",
    day: "日",
    title: "第2回 PJL BURGER KING CUP",
    location: "有明テニスの森（東京都江東区）",
    status: "募集中",
    url: "https://pikura.app/events/official-pjl-burger-king-cup-2026"
  },
  {
    date: "11/1",
    day: "日",
    title: "PB1 CUP 決勝大会",
    location: "Sansanピックルボールコート池袋（東京都豊島区）",
    status: "募集中",
    url: "https://pikura.app/events/manual-pb1cup-final-2026"
  },
  {
    date: "11/21",
    day: "土",
    title: "PJ TOP TOUR 2026 T8 OARAI",
    location: "茨城県大洗町",
    status: "開催予定",
    url: "https://pikura.app/events"
  },
  {
    date: "12/7",
    day: "月",
    title: "第3回 ピックルボールチャンピオンシップス in Japan",
    location: "有明テニスの森（東京都江東区）",
    status: "募集中",
    url: "https://pikura.app/events"
  }
].slice(0, 10);
