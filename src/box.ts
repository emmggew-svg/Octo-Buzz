export type BoxRect = { x: number; y: number; w: number; h: number };

const GEAR = 11;
const GEAR_BLOCK = 2;
const GEAR_PAD = 18;
const GEAR_TOP = 16;

const gearCells = (() => {
  const c = (GEAR - 1) / 2;
  const cells: boolean[][] = [];
  for (let y = 0; y < GEAR; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < GEAR; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const slice = (Math.atan2(dy, dx) + Math.PI) % (Math.PI / 4);
      const tooth = slice < Math.PI / 8;
      row.push((r <= 3.2 && r >= 1.3) || (r > 3.2 && r <= 4.8 && tooth));
    }
    cells.push(row);
  }
  return cells;
})();

export function settingsIconRect(box: BoxRect) {
  const size = GEAR * GEAR_BLOCK;
  return {
    x: box.x + box.w - GEAR_PAD - size,
    y: box.y + GEAR_TOP,
    size,
  };
}

export function drawSettings(ctx: CanvasRenderingContext2D, box: BoxRect, hover = false) {
  const { x, y, size } = settingsIconRect(box);

  ctx.fillStyle = hover ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.roundRect(x - 7, y - 7, size + 14, size + 14, 9);
  ctx.fill();
  ctx.strokeStyle = hover ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const paint = (ox: number, oy: number, color: string) => {
    ctx.fillStyle = color;
    for (let cy = 0; cy < GEAR; cy++) {
      for (let cx = 0; cx < GEAR; cx++) {
        if (gearCells[cy][cx]) {
          ctx.fillRect(x + cx * GEAR_BLOCK + ox, y + cy * GEAR_BLOCK + oy, GEAR_BLOCK, GEAR_BLOCK);
        }
      }
    }
  };

  paint(-GEAR_BLOCK, 0, "#33204a");
  paint(GEAR_BLOCK, 0, "#33204a");
  paint(0, -GEAR_BLOCK, "#33204a");
  paint(0, GEAR_BLOCK, "#33204a");
  paint(0, GEAR_BLOCK, "rgba(0,0,0,0.35)");
  paint(0, 0, hover ? "#e2c8ee" : "#c7a0d4");
}

export const PET_BOX_WIDTH = 480;
export const PET_BOX_HEIGHT = 208;
export const PET_BOX_TOP = 36;

export function layoutBox(vw: number): BoxRect {
  const w = Math.min(PET_BOX_WIDTH, Math.max(260, vw - 80));
  return {
    x: Math.round((vw - w) / 2),
    y: PET_BOX_TOP,
    w,
    h: PET_BOX_HEIGHT,
  };
}

export function drawBox(ctx: CanvasRenderingContext2D, box: BoxRect) {
  const r = 26;
  const x = box.x;
  const y = box.y;
  const w = box.w;
  const h = box.h;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 12;
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, "rgba(29,27,34,0.93)");
  fill.addColorStop(1, "rgba(17,16,21,0.95)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();

  const sheen = ctx.createLinearGradient(x, 0, x + w, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.16)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = sheen;
  ctx.beginPath();
  ctx.moveTo(x + r, y + 1.5);
  ctx.lineTo(x + w - r, y + 1.5);
  ctx.stroke();

  const dy = y + h - 52;
  ctx.save();
  ctx.setLineDash([4, 7]);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.moveTo(x + 20, dy + 0.5);
  ctx.lineTo(x + w - 20, dy + 0.5);
  ctx.stroke();
  ctx.restore();
}
