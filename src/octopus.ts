import type { BoxRect } from "./box";

type Vec = { x: number; y: number };

const TAU = Math.PI * 2;
const DESIGN = 160;
const RENDER = 96;
const PIXEL_SCALE = 1.5;
const SCREEN_SCALE = (RENDER / DESIGN) * PIXEL_SCALE;
const HEAD_ART_Y = 52;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const MAX_REACH = 560;
const REACH_OUT_TIME = 0.45;
const REACH_RETRACT_TIME = 0.35;
const HOOK_OUT_TIME = 0.22;
const HOOK_IN_TIME = 0.16;

const SPEAK_SECONDS = 9;
const BUBBLE_MAX_W = 320;
const BUBBLE_LINE = 18;
const BUBBLE_LINES = 4;

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

type ReachState = {
  armIndex: number;
  target: Vec;
  reachable: boolean;
  amount: number;
  hook: number;
  phase: "out" | "hold" | "in";
};

type Tentacle = {
  rootX: number;
  rootY: number;
  baseAngle: number;
  len: number;
  width: number;
  curl: number;
  phase: number;
};

type Shape = {
  pts: Vec[];
  widths: number[];
  curl: number;
};

const COLORS = {
  outline: "#33204a",
  body: "#a97bb6",
  bodyLight: "#c7a0d4",
  bodyLight2: "#ddbfe7",
  bodyDark: "#7d5a92",
  tentacle: "#9d71ad",
  sucker: "#e6b8d1",
  suckerDark: "#cf96b6",
  eye: "#21172b",
  glint: "#fff8ff",
  mouth: "#3d274f",
  rope: "#cbaedd",
  hook: "#eae0f4",
};

export class Octopus {
  private sprite: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private time = 0;
  private head = { x: 0, y: 0 };
  private placed = false;
  private blink = 0;
  private nextBlink = 2.4;
  private cursor: Vec = { x: 0, y: 0 };
  private tentacles: Tentacle[] = [];
  private reach: ReachState | null = null;
  private reachAmount = 0;
  private pull: { side: number; index: number; t: number } | null = null;
  private occlusion = 0;
  private box: BoxRect = { x: 0, y: 0, w: 0, h: 0 };
  private speech = "";
  private speechUntil = 0;
  private speechStart = 0;
  private thinking = false;
  private armCanvas: HTMLCanvasElement | null = null;
  private actx: CanvasRenderingContext2D | null = null;

  constructor() {
    this.sprite = document.createElement("canvas");
    this.sprite.width = RENDER;
    this.sprite.height = RENDER;
    this.sctx = this.sprite.getContext("2d")!;
    this.sctx.setTransform(RENDER / DESIGN, 0, 0, RENDER / DESIGN, 0, 0);

    const count = 8;
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1);
      const outer = Math.abs(f - 0.5) * 2;
      this.tentacles.push({
        rootX: 80 + (f - 0.5) * 58,
        rootY: 76 + Math.sin(Math.PI * f) * 5,
        baseAngle: Math.PI / 2 - (f - 0.5) * 1.15,
        len: 52 + Math.sin(Math.PI * f) * 18 + (i % 2) * 4,
        width: 7.2 + Math.sin(Math.PI * f) * 2.4,
        curl: (i % 2 === 0 ? 1 : -1) * (0.85 + outer * 0.75),
        phase: i * 0.9 + f * 2,
      });
    }
  }

  triggerReach(cursor: Vec) {
    this.pull = null;

    if (this.reach && this.reach.phase !== "in") {
      this.reach.target.x = cursor.x;
      this.reach.target.y = cursor.y;
      this.reach.phase = "hold";
      this.reach.reachable =
        Math.hypot(cursor.x - this.head.x, cursor.y - (this.head.y + 26)) <= MAX_REACH;
      return;
    }

    const ox = this.head.x - (DESIGN / 2) * SCREEN_SCALE;
    const oy = this.head.y - HEAD_ART_Y * SCREEN_SCALE;
    let best = 0;
    let bestDist = Infinity;
    this.tentacles.forEach((ten, i) => {
      const rx = ox + ten.rootX * SCREEN_SCALE;
      const ry = oy + ten.rootY * SCREEN_SCALE;
      const d = Math.hypot(cursor.x - rx, cursor.y - ry);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });

    const dist = Math.hypot(cursor.x - this.head.x, cursor.y - (this.head.y + 26));
    this.reach = {
      armIndex: best,
      target: { x: cursor.x, y: cursor.y },
      reachable: dist <= MAX_REACH,
      amount: 0,
      hook: 0,
      phase: "out",
    };
    this.reachAmount = 0;
  }

  endReach() {
    if (this.reach && this.reach.phase !== "in") {
      this.reach.phase = "in";
    }
  }

  isReaching() {
    return !!this.reach;
  }

  setOcclusion(score: number) {
    this.occlusion = clamp(score, 0, 1);
  }

  /** Hook a random tentacle on `side` (-1 left, 1 right) onto the panel rim and drag. */
  startPull(side: number) {
    const pick = side < 0 ? Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 4);
    this.pull = { side, index: pick, t: 0 };
  }

  /** Show a speech bubble under the panel; empty text hides it. */
  say(text: string) {
    const fresh = text !== this.speech;
    this.speech = text;
    this.thinking = false;
    const seconds = Math.min(20, SPEAK_SECONDS + text.length * 0.06);
    this.speechUntil = text ? this.time + seconds : 0;
    if (fresh && text) this.speechStart = this.time;
  }

  setThinking(on: boolean) {
    if (on && !this.thinking) this.speechStart = this.time;
    this.thinking = on;
    if (on) this.speech = "";
  }

  private pullTarget(): Vec {
    const box = this.box;
    const edgeX = box.x + box.w / 2 + (this.pull?.side ?? 1) * (box.w / 2 - 52);
    const edgeY = box.y + box.h - 18;
    return {
      x: DESIGN / 2 + (edgeX - this.head.x) / SCREEN_SCALE,
      y: HEAD_ART_Y + (edgeY - this.head.y) / SCREEN_SCALE,
    };
  }

  private buildPullTentacle(ten: Tentacle, t: number, target: Vec): Shape {
    const dx = target.x - ten.rootX;
    const dy = target.y - ten.rootY;
    const dist = Math.hypot(dx, dy) || 1;
    const aim = Math.atan2(dy, dx);
    const steps = Math.max(16, Math.round(dist * 0.5));

    let a = ten.baseAngle;
    let x = ten.rootX;
    let y = ten.rootY;
    const pts: Vec[] = [{ x, y }];

    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      a += wrapAngle(aim - a) * Math.min(0.4, 0.08 + frac * 0.4) + Math.sin(t * 2.4 + frac * 4) * 0.015;
      x += Math.cos(a) * (dist / steps);
      y += Math.sin(a) * (dist / steps);
      pts.push({ x, y });
    }

    const widths = pts.map((_, i) =>
      Math.max(2.6, 9.5 * (1 - 0.7 * (i / (pts.length - 1)))),
    );

    return { pts, widths, curl: -Math.sign(dx || 1) };
  }

  update(dt: number, cursor: Vec, box: BoxRect, vw: number) {
    this.time += dt;
    if (this.speech && this.time > this.speechUntil) this.speech = "";
    this.cursor = cursor;
    this.box = box;
    const t = this.time;

    if (this.pull) {
      this.pull.t += dt;
      if (this.pull.t > 1.9) this.pull = null;
    }

    const half = (DESIGN / 2) * SCREEN_SCALE;
    const pad = 26;
    const left = box.x + pad + half;
    const right = box.x + box.w - pad - half;
    const nx = clamp(vw > 0 ? cursor.x / vw : 0.5, 0, 1);
    const targetX = left + (right - left) * nx;
    const targetY = box.y + 8 + HEAD_ART_Y * SCREEN_SCALE + Math.sin(t * 1.1) * 2;

    if (!this.placed) {
      this.head.x = targetX;
      this.head.y = targetY;
      this.placed = true;
    }
    if (!this.reach) {
      this.head.x += (targetX - this.head.x) * Math.min(1, dt * 6);
    }
    this.head.y += (targetY - this.head.y) * Math.min(1, dt * 5);

    if (this.reach) {
      const r = this.reach;
      r.target.x = cursor.x;
      r.target.y = cursor.y;
      r.reachable =
        Math.hypot(cursor.x - this.head.x, cursor.y - (this.head.y + 26)) <= MAX_REACH;

      if (r.phase === "out") {
        r.amount = Math.min(1, r.amount + dt / REACH_OUT_TIME);
        if (r.amount >= 1) {
          r.phase = "hold";
        }
      } else if (r.phase === "in") {
        r.amount = Math.max(0, r.amount - dt / REACH_RETRACT_TIME);
        if (r.amount <= 0) {
          this.reach = null;
        }
      }
      const wantHook = r.phase !== "in" && !r.reachable && r.amount > 0.85;
      r.hook = wantHook
        ? Math.min(1, r.hook + dt / HOOK_OUT_TIME)
        : Math.max(0, r.hook - dt / HOOK_IN_TIME);
      this.reachAmount = this.reach ? this.reach.amount : 0;
    }

    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 3 + Math.random() * 3.2;
    }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 6);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.sctx;
    s.clearRect(0, 0, DESIGN, DESIGN);

    this.drawTentacles(s);
    this.drawHead(s);

    const bob = Math.round(Math.sin(this.time * 1.7) * 1.4);
    const sway = Math.round(Math.sin(this.time * 0.9) * 0.7);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.sprite,
      Math.round(this.head.x - (DESIGN / 2) * SCREEN_SCALE + sway * SCREEN_SCALE),
      Math.round(this.head.y - HEAD_ART_Y * SCREEN_SCALE + bob * SCREEN_SCALE),
      DESIGN * SCREEN_SCALE,
      DESIGN * SCREEN_SCALE,
    );
  }

  drawBubble(ctx: CanvasRenderingContext2D, vw: number, vh: number, limit = vw) {
    if (!this.speech && !this.thinking) return;

    const thinking = this.thinking && !this.speech;
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const lines = thinking ? [""] : this.wrap(ctx, this.speech);
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    const width = thinking ? 62 : Math.max(96, Math.min(BUBBLE_MAX_W, widest + 26));
    const height = lines.length * BUBBLE_LINE + 16;

    const right = Math.max(12, Math.min(vw, limit) - width - 12);
    const x = clamp(this.head.x - width / 2, 12, right);
    const y = Math.min(this.box.y + this.box.h + 16, vh - height - 12);
    const tail = clamp(this.head.x, x + 24, x + width - 24);

    const pop = easeOutCubic(clamp((this.time - this.speechStart) / 0.18, 0, 1));
    ctx.save();
    ctx.translate(tail, y);
    ctx.scale(0.86 + 0.14 * pop, 0.86 + 0.14 * pop);
    ctx.translate(-tail, -y);
    ctx.globalAlpha = pop;

    ctx.beginPath();
    ctx.moveTo(x + 12, y);
    ctx.lineTo(tail - 9, y);
    ctx.lineTo(tail, y - 13);
    ctx.lineTo(tail + 9, y);
    ctx.lineTo(x + width - 12, y);
    ctx.arcTo(x + width, y, x + width, y + 12, 12);
    ctx.lineTo(x + width, y + height - 12);
    ctx.arcTo(x + width, y + height, x + width - 12, y + height, 12);
    ctx.lineTo(x + 12, y + height);
    ctx.arcTo(x, y + height, x, y + height - 12, 12);
    ctx.lineTo(x, y + 12);
    ctx.arcTo(x, y, x + 12, y, 12);
    ctx.closePath();
    ctx.fillStyle = "#f4ebf8";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#33204a";
    ctx.stroke();

    ctx.fillStyle = "#2a1b3d";
    if (thinking) {
      for (let i = 0; i < 3; i++) {
        const phase = Math.sin(this.time * 5 - i * 0.9);
        ctx.beginPath();
        ctx.arc(x + width / 2 + (i - 1) * 13, y + height / 2 + phase * 2.5, 3.2, 0, TAU);
        ctx.fill();
      }
    } else {
      lines.forEach((line, i) => {
        ctx.fillText(line, x + 13, y + 8 + BUBBLE_LINE * (i + 0.5));
      });
    }
    ctx.restore();
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string): string[] {
    const limit = BUBBLE_MAX_W - 26;
    const lines: string[] = [];
    let line = "";

    for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > limit) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    if (lines.length <= BUBBLE_LINES) return lines;
    const kept = lines.slice(0, BUBBLE_LINES);
    kept[BUBBLE_LINES - 1] = `${kept[BUBBLE_LINES - 1].slice(0, 42)}…`;
    return kept;
  }

  drawReach(ctx: CanvasRenderingContext2D, vw: number, vh: number) {
    const reach = this.reach;
    if (!reach || this.reachAmount < 0.02) return;

    const ox = this.head.x - (DESIGN / 2) * SCREEN_SCALE;
    const oy = this.head.y - HEAD_ART_Y * SCREEN_SCALE;
    const ten = this.tentacles[reach.armIndex];
    const root = { x: ox + ten.rootX * SCREEN_SCALE, y: oy + ten.rootY * SCREEN_SCALE };

    const dx = reach.target.x - root.x;
    const dy = reach.target.y - root.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;
    const len = Math.max(0, Math.min(dist - 8, MAX_REACH) * this.reachAmount);
    if (len < 8) return;

    const tip = { x: root.x + dirX * len, y: root.y + dirY * len };
    const outX = Math.cos(ten.baseAngle);
    const outY = Math.sin(ten.baseAngle);
    const cross = outX * dirY - outY * dirX;
    const side = cross >= 0 ? 1 : -1;
    const nx = -dirY * side;
    const ny = dirX * side;
    const bow = Math.min(90, len * 0.26);

    const p0 = root;
    const p1 = { x: root.x + outX * len * 0.32, y: root.y + outY * len * 0.32 };
    const p2 = {
      x: tip.x - dirX * len * 0.2 + nx * bow,
      y: tip.y - dirY * len * 0.2 + ny * bow,
    };
    const p3 = tip;

    const steps = 46;
    const pts: Vec[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const mu = 1 - u;
      pts.push({
        x:
          mu * mu * mu * p0.x +
          3 * mu * mu * u * p1.x +
          3 * mu * u * u * p2.x +
          u * u * u * p3.x,
        y:
          mu * mu * mu * p0.y +
          3 * mu * mu * u * p1.y +
          3 * mu * u * u * p2.y +
          u * u * u * p3.y,
      });
    }
    const widths = pts.map((_, i) => 15 * (1 - 0.68 * (i / steps)));

    const scale = 1.5;
    const cw = Math.ceil(vw / scale);
    const ch = Math.ceil(vh / scale);
    if (!this.armCanvas) {
      this.armCanvas = document.createElement("canvas");
      this.actx = this.armCanvas.getContext("2d")!;
    }
    if (this.armCanvas.width !== cw || this.armCanvas.height !== ch) {
      this.armCanvas.width = cw;
      this.armCanvas.height = ch;
    }
    const a = this.actx!;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.clearRect(0, 0, cw, ch);
    a.setTransform(1 / scale, 0, 0, 1 / scale, 0, 0);
    a.lineCap = "round";
    a.lineJoin = "round";

    a.strokeStyle = COLORS.outline;
    for (let i = 1; i < pts.length; i++) {
      a.beginPath();
      a.moveTo(pts[i - 1].x, pts[i - 1].y);
      a.lineTo(pts[i].x, pts[i].y);
      a.lineWidth = widths[i] + 2.4;
      a.stroke();
    }
    a.strokeStyle = COLORS.tentacle;
    for (let i = 1; i < pts.length; i++) {
      a.beginPath();
      a.moveTo(pts[i - 1].x, pts[i - 1].y);
      a.lineTo(pts[i].x, pts[i].y);
      a.lineWidth = widths[i];
      a.stroke();
    }

    for (let i = 9; i < pts.length - 2; i += 4) {
      const ang =
        Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) +
        (Math.PI / 2) * side;
      a.beginPath();
      a.arc(
        pts[i].x + Math.cos(ang) * widths[i] * 0.5,
        pts[i].y + Math.sin(ang) * widths[i] * 0.5,
        Math.max(2.2, widths[i] * 0.24),
        0,
        TAU,
      );
      a.fillStyle = COLORS.sucker;
      a.fill();
    }

    if (reach.hook > 0.01) {
      const ease = easeOutCubic(reach.hook);
      const hx = p3.x + (reach.target.x - p3.x) * ease;
      const hy = p3.y + (reach.target.y - p3.y) * ease;
      const rdx = hx - p3.x;
      const rdy = hy - p3.y;
      const rlen = Math.hypot(rdx, rdy);

      if (rlen > 3) {
        const rnx = -rdy / rlen;
        const rny = rdx / rlen;
        const sag = Math.min(26, rlen * 0.07) + Math.sin(this.time * 6) * 2;
        const cx = (p3.x + hx) / 2 + rnx * sag;
        const cy = (p3.y + hy) / 2 + rny * sag;

        const rope: Vec[] = [];
        for (let i = 0; i <= 24; i++) {
          const u = i / 24;
          const mu = 1 - u;
          rope.push({
            x: mu * mu * p3.x + 2 * mu * u * cx + u * u * hx,
            y: mu * mu * p3.y + 2 * mu * u * cy + u * u * hy,
          });
        }

        a.strokeStyle = COLORS.outline;
        for (let i = 1; i < rope.length; i++) {
          a.beginPath();
          a.moveTo(rope[i - 1].x, rope[i - 1].y);
          a.lineTo(rope[i].x, rope[i].y);
          a.lineWidth = 5 - (i / rope.length) * 2.2;
          a.stroke();
        }
        a.strokeStyle = COLORS.rope;
        for (let i = 1; i < rope.length; i++) {
          a.beginPath();
          a.moveTo(rope[i - 1].x, rope[i - 1].y);
          a.lineTo(rope[i].x, rope[i].y);
          a.lineWidth = 3.2 - (i / rope.length) * 1.3;
          a.stroke();
        }

        const hAng = Math.atan2(hy - cy, hx - cx);
        const hs = 1.25 + reach.hook * 0.35;
        a.save();
        a.translate(hx, hy);
        a.rotate(hAng);
        a.scale(hs, hs);

        const hook = new Path2D();
        hook.moveTo(-12, 0);
        hook.lineTo(-2, 0);
        hook.moveTo(0, 0);
        hook.bezierCurveTo(3, 5, 7, 7, 10, 4);
        hook.moveTo(0, 0);
        hook.bezierCurveTo(3, -5, 7, -7, 10, -4);
        hook.moveTo(0, 0);
        hook.lineTo(8, 0);

        a.strokeStyle = COLORS.outline;
        a.lineWidth = 3.6;
        a.stroke(hook);
        a.strokeStyle = COLORS.hook;
        a.lineWidth = 2;
        a.stroke(hook);

        a.beginPath();
        a.arc(-10.5, 0, 2.5, 0, TAU);
        a.fillStyle = COLORS.outline;
        a.fill();
        a.beginPath();
        a.arc(-10.5, 0, 1.2, 0, TAU);
        a.fillStyle = COLORS.hook;
        a.fill();

        if (reach.hook > 0.9) {
          const tw = 0.5 + 0.5 * Math.sin(this.time * 9);
          a.fillStyle = `rgba(255,250,255,${0.45 + tw * 0.5})`;
          a.fillRect(7, -1.5, 2, 2);
          a.fillRect(9, 1, 1.6, 1.6);
        }
        a.restore();
      }
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.armCanvas, 0, 0, vw, vh);
  }

  private buildTentacle(ten: Tentacle, t: number, lean: number): Shape {
    let a = ten.baseAngle + lean + Math.sin(t * 1.4 + ten.phase) * 0.07;
    let x = ten.rootX;
    let y = ten.rootY;

    const steps = Math.round(ten.len);
    const pts: Vec[] = [{ x, y }];

    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const curl =
        ten.curl * (0.004 + 0.135 * frac * frac) * (1 + Math.sin(t * 1.2 + ten.phase) * 0.16);
      a += curl + Math.sin(t * 1.9 + ten.phase + frac * 4.5) * 0.008;
      x += Math.cos(a);
      y += Math.sin(a);
      pts.push({ x, y });
    }

    const widths = pts.map((_, i) =>
      Math.max(2.4, ten.width * (1 - 0.7 * (i / (pts.length - 1)))),
    );

    return { pts, widths, curl: ten.curl };
  }

  private drawTentacles(s: CanvasRenderingContext2D) {
    const t = this.time;
    const lean = clamp((this.cursor.x - this.head.x) * 0.0005, -0.28, 0.28);
    const hidden = this.reach && this.reachAmount > 0.02 ? this.reach.armIndex : -1;
    const pulling =
      this.pull && this.pull.t < 1.7 && this.pull.index !== hidden ? this.pull : null;
    const target = pulling ? this.pullTarget() : null;
    const shapes: Shape[] = [];
    this.tentacles.forEach((ten, i) => {
      if (i === hidden) return;
      if (pulling && target && i === pulling.index) {
        shapes.push(this.buildPullTentacle(ten, t, target));
      } else {
        shapes.push(this.buildTentacle(ten, t, lean));
      }
    });

    s.lineCap = "round";
    s.lineJoin = "round";

    s.strokeStyle = COLORS.outline;
    for (const sh of shapes) this.strokeShape(s, sh, 1.9);

    s.strokeStyle = COLORS.tentacle;
    for (const sh of shapes) this.strokeShape(s, sh, 0);

    for (const sh of shapes) {
      const { pts, widths } = sh;
      for (let i = 4; i < pts.length - 3; i += 5) {
        const frac = i / (pts.length - 1);
        const w = widths[i];
        const nrm =
          Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) +
          (Math.PI / 2) * Math.sign(sh.curl);
        s.beginPath();
        s.arc(
          pts[i].x + Math.cos(nrm) * w * 0.55,
          pts[i].y + Math.sin(nrm) * w * 0.55,
          Math.max(1.8, w * 0.3),
          0,
          TAU,
        );
        s.fillStyle = frac > 0.4 ? COLORS.sucker : COLORS.suckerDark;
        s.fill();
      }
    }
  }

  private strokeShape(s: CanvasRenderingContext2D, sh: Shape, extra: number) {
    const { pts, widths } = sh;
    for (let i = 1; i < pts.length; i++) {
      s.beginPath();
      s.moveTo(pts[i - 1].x, pts[i - 1].y);
      s.lineTo(pts[i].x, pts[i].y);
      s.lineWidth = widths[i] + extra;
      s.stroke();
    }
  }

  private drawHead(s: CanvasRenderingContext2D) {
    const t = this.time;

    const head = new Path2D();
    head.moveTo(42, 56);
    head.bezierCurveTo(40, 32, 50, 17, 68, 17);
    head.lineTo(92, 17);
    head.bezierCurveTo(110, 17, 120, 32, 118, 56);
    head.bezierCurveTo(120, 74, 102, 84, 80, 84);
    head.bezierCurveTo(58, 84, 40, 74, 42, 56);
    head.closePath();

    s.fillStyle = COLORS.body;
    s.fill(head);
    s.strokeStyle = COLORS.outline;
    s.lineWidth = 2.6;
    s.stroke(head);

    s.save();
    s.clip(head);
    s.fillStyle = COLORS.bodyLight;
    s.beginPath();
    s.ellipse(70, 42, 17, 11, -0.35, 0, TAU);
    s.fill();
    s.fillStyle = COLORS.bodyLight2;
    s.beginPath();
    s.ellipse(65, 35, 9, 5.5, -0.35, 0, TAU);
    s.fill();
    s.globalAlpha = 0.45;
    s.fillStyle = COLORS.bodyDark;
    s.beginPath();
    s.ellipse(97, 66, 25, 17, 0, 0, TAU);
    s.fill();
    s.globalAlpha = 1;
    s.restore();

    const dx = this.cursor.x - this.head.x;
    const dy = this.cursor.y - this.head.y;
    const gx = clamp(dx / 300, -1, 1);
    const gy = clamp(dy / 380, -1, 1);
    const open = Math.hypot(dx, dy) < 240;

    const eyes = [59, 101];
    const eyeRy = 9.8 - this.occlusion * 1.9;
    for (const ex of eyes) {
      if (this.blink > 0) {
        s.strokeStyle = COLORS.eye;
        s.lineWidth = 2;
        s.lineCap = "round";
        s.beginPath();
        s.moveTo(ex - 5, 56);
        s.lineTo(ex + 5, 56);
        s.stroke();
        continue;
      }

      s.beginPath();
      s.ellipse(ex, 53, 7.6, eyeRy, 0, 0, TAU);
      s.fillStyle = COLORS.eye;
      s.fill();

      s.beginPath();
      s.arc(ex + gx * 1.8 - 2.2, 50 + gy * 1.5, 2.2, 0, TAU);
      s.fillStyle = COLORS.glint;
      s.fill();
      s.beginPath();
      s.arc(ex + gx * 2.2 + 2.2, 56 + gy * 1.8, 1, 0, TAU);
      s.fillStyle = "rgba(255,248,255,0.55)";
      s.fill();
    }

    if (open) {
      s.beginPath();
      s.ellipse(80 + gx * 1.2, 69, 2.8, 3.4, 0, 0, TAU);
      s.fillStyle = COLORS.mouth;
      s.fill();
      s.beginPath();
      s.ellipse(80 + gx * 1.2, 70.4, 1.5, 1.3, 0, 0, TAU);
      s.fillStyle = "#d98fb6";
      s.fill();
    } else {
      s.strokeStyle = COLORS.mouth;
      s.lineWidth = 1.6;
      s.lineCap = "round";
      s.beginPath();
      s.moveTo(76.5, 68);
      s.quadraticCurveTo(80, 71, 83.5, 68);
      s.stroke();
    }

    const sway = Math.sin(t * 1.3) * 0.8;
    s.strokeStyle = "rgba(255,255,255,0.16)";
    s.lineWidth = 1.2;
    s.beginPath();
    s.arc(64 + sway, 34, 12, Math.PI * 1.1, Math.PI * 1.75);
    s.stroke();
  }
}
