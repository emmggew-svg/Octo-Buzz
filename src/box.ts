export type BoxRect = { x: number; y: number; w: number; h: number };

export const PET_BOX_WIDTH = 480;
export const PET_BOX_HEIGHT = 208;
export const PET_BOX_TOP = 36;
export const PET_BOX_RADIUS = 26;

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

export function layoutBox(vw: number, shift = 0): BoxRect {
  const w = Math.min(PET_BOX_WIDTH, Math.max(260, vw - 80));
  return {
    x: Math.round((vw - w) / 2 + shift),
    y: PET_BOX_TOP,
    w,
    h: PET_BOX_HEIGHT,
  };
}

export function drawBox(
  ctx: CanvasRenderingContext2D,
  box: BoxRect,
  time = 0,
  rippleAt = Number.NEGATIVE_INFINITY,
) {
  const { x, y, w, h } = box;
  const r = PET_BOX_RADIUS;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, "rgba(142,166,208,0.22)");
  fill.addColorStop(0.5, "rgba(58,72,104,0.26)");
  fill.addColorStop(1, "rgba(14,18,30,0.42)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();

  for (let i = 0; i < 3; i++) {
    const phase = time * (0.18 + i * 0.05) + i * 2.1;
    const cx = x + w * (0.5 + 0.62 * Math.sin(phase));
    const cy = y + h * (0.45 + 0.5 * Math.cos(phase * 0.8));
    const radius = 150 + 60 * i;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, `rgba(196,214,253,${0.08 - i * 0.02})`);
    glow.addColorStop(1, "rgba(196,214,253,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    for (let px = x + 10; px <= x + w - 10; px += 8) {
      const t = (px - x) / w;
      const py =
        y + h * (0.34 + i * 0.2) + Math.sin(t * 9 + time * (0.9 + i * 0.25)) * (3 + i * 1.5);
      if (px === x + 10) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  const sweep = ((time * 0.07) % 1.7) - 0.35;
  const sheen = ctx.createLinearGradient(x + (sweep - 0.35) * w, 0, x + (sweep + 0.35) * w, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.26)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = sheen;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y + 1.5);
  ctx.lineTo(x + w, y + 1.5);
  ctx.stroke();

  const dy = y + h - 52;
  ctx.setLineDash([4, 7]);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 20, dy + 0.5);
  ctx.lineTo(x + w - 20, dy + 0.5);
  ctx.stroke();
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.roundRect(x + 6.5, y + 6.5, w - 13, h - 13, r - 6);
  ctx.stroke();

  const age = time - rippleAt;
  if (age >= 0 && age < 0.9) {
    const k = age / 0.9;
    ctx.strokeStyle = `rgba(214,231,255,${0.34 * (1 - k)})`;
    ctx.lineWidth = 2 - k * 1.4;
    ctx.beginPath();
    ctx.roundRect(
      x - 10 - 26 * k,
      y - 10 - 26 * k,
      w + 20 + 52 * k,
      h + 20 + 52 * k,
      r + 12 + 26 * k,
    );
    ctx.stroke();
  }
}

export function drawSettings(ctx: CanvasRenderingContext2D, box: BoxRect, hover = false) {
  const { x, y, size } = settingsIconRect(box);

  ctx.fillStyle = hover ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.roundRect(x - 7, y - 7, size + 14, size + 14, 9);
  ctx.fill();
  ctx.strokeStyle = hover ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.16)";
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
