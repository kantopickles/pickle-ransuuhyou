export type ImageTeam = [number, number];

export type ImageSchedulePayload = {
  title?: string;
  names: string[];
  matches: Array<{
    match: number;
    courts: Array<{
      court: number;
      teamA: ImageTeam;
      teamB: ImageTeam;
    }>;
    resting: number[];
  }>;
};

const CANVAS_WIDTH = 1080;
const SIDE_PADDING = 54;
const CONTENT_WIDTH = CANVAS_WIDTH - SIDE_PADDING * 2;
const FONT_FAMILY = 'system-ui, -apple-system, "Hiragino Sans", "Yu Gothic", sans-serif';

function playerName(index: number, names: string[]) {
  return names[index] || `${index + 1}番`;
}

function teamName(team: ImageTeam, names: string[]) {
  return `${playerName(team[0], names)}・${playerName(team[1], names)}`;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text)) {
    const next = current + character;
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function fitFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, maximum: number, minimum: number) {
  for (let size = maximum; size >= minimum; size -= 1) {
    context.font = `700 ${size}px ${FONT_FAMILY}`;
    if (context.measureText(text).width <= maxWidth) return size;
  }
  return minimum;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function safeFileName(value: string) {
  const normalized = value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ");
  return normalized.slice(0, 48) || "ピックルボール乱数表";
}

export function scheduleImageFileName(payload: ImageSchedulePayload) {
  return `${safeFileName(payload.title || "ピックルボール乱数表")}.png`;
}

export async function createScheduleImage(
  payload: ImageSchedulePayload,
  checkedMatches: ReadonlySet<number> = new Set()
) {
  if (document.fonts?.ready) await document.fonts.ready;

  const measuringCanvas = document.createElement("canvas");
  const measuringContext = measuringCanvas.getContext("2d");
  if (!measuringContext) throw new Error("画像を作成できませんでした。");

  measuringContext.font = `500 28px ${FONT_FAMILY}`;
  const matchLayouts = payload.matches.map((match) => {
    const restingText = `休み：${match.resting.length
      ? match.resting.map((player) => playerName(player, payload.names)).join("、")
      : "なし"}`;
    const restingLines = wrapText(measuringContext, restingText, CONTENT_WIDTH - 48);
    const height = 82 + match.courts.length * 70 + restingLines.length * 38 + 28;
    return { height, restingLines };
  });

  measuringContext.font = `800 48px ${FONT_FAMILY}`;
  const titleLines = wrapText(measuringContext, payload.title || "ピックルボール乱数表", CONTENT_WIDTH).slice(0, 2);
  const headerHeight = 150 + titleLines.length * 62;
  const canvasHeight = headerHeight
    + matchLayouts.reduce((sum, layout) => sum + layout.height + 20, 0)
    + 70;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を作成できませんでした。");

  context.fillStyle = "#f4f8f6";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#0f766e";
  context.fillRect(0, 0, canvas.width, 22);
  context.fillStyle = "#0b5f59";
  context.font = `800 29px ${FONT_FAMILY}`;
  context.fillText("PICKLEBALL RANDOM TABLE", SIDE_PADDING, 80);

  context.fillStyle = "#17211d";
  context.font = `800 48px ${FONT_FAMILY}`;
  titleLines.forEach((line, index) => {
    context.fillText(line, SIDE_PADDING, 148 + index * 62);
  });

  context.fillStyle = "#61706a";
  context.font = `600 25px ${FONT_FAMILY}`;
  context.fillText(`${payload.names.length}人 / ${payload.matches.length}試合`, SIDE_PADDING, headerHeight - 30);

  let y = headerHeight;
  payload.matches.forEach((match, matchIndex) => {
    const layout = matchLayouts[matchIndex];
    const done = checkedMatches.has(match.match);

    roundedRect(context, SIDE_PADDING, y, CONTENT_WIDTH, layout.height, 18);
    context.fillStyle = done ? "#eef1ef" : "#ffffff";
    context.fill();
    context.strokeStyle = done ? "#c9d0cd" : "#b7d7ce";
    context.lineWidth = done ? 2 : 3;
    context.stroke();

    context.fillStyle = done ? "#61706a" : "#0b5f59";
    context.font = `800 34px ${FONT_FAMILY}`;
    context.fillText(`第${match.match}試合`, SIDE_PADDING + 24, y + 50);

    if (done) {
      context.font = `700 23px ${FONT_FAMILY}`;
      context.textAlign = "right";
      context.fillText("終了", CANVAS_WIDTH - SIDE_PADDING - 24, y + 47);
      context.textAlign = "left";
    }

    let rowY = y + 76;
    match.courts.forEach((court) => {
      const courtLabel = `コート${court.court}`;
      const teamA = teamName(court.teamA, payload.names);
      const teamB = teamName(court.teamB, payload.names);
      const teamWidth = 330;

      context.fillStyle = done ? "#e1e7e4" : "#e9f6f2";
      roundedRect(context, SIDE_PADDING + 20, rowY, CONTENT_WIDTH - 40, 58, 12);
      context.fill();

      context.fillStyle = done ? "#61706a" : "#0b5f59";
      context.font = `700 23px ${FONT_FAMILY}`;
      context.fillText(courtLabel, SIDE_PADDING + 38, rowY + 37);

      const matchupLeft = SIDE_PADDING + 188;
      context.fillStyle = done ? "#59635f" : "#17211d";
      context.textAlign = "right";
      context.font = `700 ${fitFontSize(context, teamA, teamWidth, 29, 18)}px ${FONT_FAMILY}`;
      context.fillText(teamA, matchupLeft + teamWidth, rowY + 38);

      context.fillStyle = "#708079";
      context.textAlign = "center";
      context.font = `800 22px ${FONT_FAMILY}`;
      context.fillText("VS", matchupLeft + teamWidth + 45, rowY + 37);

      context.fillStyle = done ? "#59635f" : "#17211d";
      context.textAlign = "left";
      context.font = `700 ${fitFontSize(context, teamB, teamWidth, 29, 18)}px ${FONT_FAMILY}`;
      context.fillText(teamB, matchupLeft + teamWidth + 88, rowY + 38);
      context.textAlign = "left";

      rowY += 70;
    });

    context.fillStyle = "#53635d";
    context.font = `500 28px ${FONT_FAMILY}`;
    layout.restingLines.forEach((line, lineIndex) => {
      context.fillText(line, SIDE_PADDING + 24, rowY + 32 + lineIndex * 38);
    });

    y += layout.height + 20;
  });

  context.fillStyle = "#708079";
  context.font = `500 22px ${FONT_FAMILY}`;
  context.textAlign = "center";
  context.fillText("保存した画像は作成時点の対戦表です", CANVAS_WIDTH / 2, canvas.height - 28);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("画像を作成できませんでした。"));
    }, "image/png");
  });
}
