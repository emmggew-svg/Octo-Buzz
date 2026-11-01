import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";
import { drawBox, drawSettings, layoutBox, settingsIconRect } from "./box";
import { Octopus } from "./octopus";

type Zone = { x: number; y: number; w: number; h: number };

const SIDEBAR_MARGIN = 16;
const OCCLUDE_ON = 9;
const OCCLUDE_OFF = 3;
const PULL_COOLDOWN = 9;
const RETURN_DELAY = 3.2;

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const ctx = canvas.getContext("2d")!;
const sidebarEl = document.querySelector<HTMLElement>("#settings")!;
const closeEl = document.querySelector<HTMLButtonElement>("#settings-close")!;
const navEl = document.querySelector<HTMLElement>("#settings-nav")!;
const bodyEl = document.querySelector<HTMLElement>("#settings-body")!;

const isTauri = "__TAURI_INTERNALS__" in window;

const cursor = { x: innerWidth / 2, y: innerHeight * 0.9 };
const target = { x: cursor.x, y: cursor.y };

let box = layoutBox(innerWidth);
let sidebarOpen = false;
let gearHover = false;

let clock = 0;
let occ = { under: 0, left: 0, right: 0 };
let shift = 0;
let shiftTarget = 0;
let avoidSide = 0;
let cooldown = 0;
let highStreak = 0;
let lowStreak = 0;
let rippleAt = -10;
let zoneTimer = 0;

const octopus = new Octopus();

function gearZone(): Zone {
  const rect = settingsIconRect(box);
  const pad = 8;
  return { x: rect.x - pad, y: rect.y - pad, w: rect.size + pad * 2, h: rect.size + pad * 2 };
}

function sidebarZone(): Zone {
  const w = sidebarEl.offsetWidth;
  const h = sidebarEl.offsetHeight;
  return { x: SIDEBAR_MARGIN, y: SIDEBAR_MARGIN, w, h };
}

function inZone(zone: Zone, x: number, y: number) {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

// The overlay stays click-through except over these zones, so the desktop is never blocked.
function reportZones() {
  if (!isTauri) return;
  invoke("set_hot_zones", {
    gear: gearZone(),
    sidebar: sidebarOpen ? sidebarZone() : null,
    panel: { x: box.x, y: box.y, w: box.w, h: box.h },
  }).catch(() => {});
}

function setSidebar(open: boolean) {
  if (sidebarOpen === open) return;
  sidebarOpen = open;
  sidebarEl.classList.toggle("open", open);
  sidebarEl.setAttribute("aria-hidden", String(!open));
  reportZones();
}

function syncTaskbarInset() {
  if (!isTauri) return;
  invoke<{ bottom: number }>("screen_insets")
    .then((insets) => {
      document.documentElement.style.setProperty(
        "--taskbar-inset",
        `${Math.max(0, insets.bottom)}px`,
      );
      reportZones();
    })
    .catch(() => {});
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  box = layoutBox(innerWidth, shift);
  reportZones();
  syncTaskbarInset();
}

/** Busy content under the panel? Grab the rim with a tentacle and drag the box aside. */
function updateAvoidance(dt: number) {
  cooldown = Math.max(0, cooldown - dt);

  if (occ.under > OCCLUDE_ON) highStreak++;
  else highStreak = 0;
  if (occ.under < OCCLUDE_OFF) lowStreak++;
  else lowStreak = 0;

  const busy = !sidebarOpen && !octopus.isReaching() && cooldown === 0;

  if (busy && avoidSide === 0 && highStreak >= 3) {
    avoidSide = occ.left <= occ.right ? -1 : 1;
    const room = Math.max(120, (innerWidth - box.w) / 2 - 24);
    shiftTarget = avoidSide * Math.min(260, room);
    octopus.startPull(avoidSide);
    rippleAt = clock;
    cooldown = PULL_COOLDOWN;
    highStreak = 0;
  } else if (avoidSide !== 0 && lowStreak * 0.4 > RETURN_DELAY) {
    avoidSide = 0;
    shiftTarget = 0;
    cooldown = PULL_COOLDOWN;
    lowStreak = 0;
  }

  shift += (shiftTarget - shift) * Math.min(1, dt * 3.6);
  box = layoutBox(innerWidth, shift);

  const moving = Math.abs(shiftTarget - shift) > 1.5;
  if (moving) {
    zoneTimer -= dt;
    if (zoneTimer <= 0) {
      reportZones();
      zoneTimer = 0.15;
    }
  } else if (zoneTimer >= 0) {
    reportZones();
    zoneTimer = -1;
  }
}

function triggerReach() {
  octopus.triggerReach({ x: target.x, y: target.y });
}

if (isTauri) {
  listen("reach-start", triggerReach);
  listen("reach-end", () => octopus.endReach());
  listen<{ under: number; left: number; right: number }>("occlusion", (event) => {
    occ = { under: event.payload.under, left: event.payload.left, right: event.payload.right };
    octopus.setOcclusion(Math.max(0, Math.min(1, (occ.under - 4) / 18)));
  });
} else {
  addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "q") {
      event.preventDefault();
      if (!event.repeat) triggerReach();
    }
  });
  addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "q") octopus.endReach();
  });
}

addEventListener("click", (event) => {
  if (inZone(gearZone(), event.clientX, event.clientY)) setSidebar(!sidebarOpen);
});

closeEl.addEventListener("click", () => setSidebar(false));

navEl.addEventListener("click", (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>(".nav-item");
  if (!item) return;
  navEl.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => {
    el.classList.toggle("active", el === item);
  });
  bodyEl.dataset.section = item.dataset.section ?? "";
});

document.querySelector<HTMLButtonElement>("#link-github")!.addEventListener("click", () => {
  if (isTauri) {
    invoke("open_repo").catch(() => {});
  } else {
    window.open("https://github.com/emmggew-svg/Octo-Buzz", "_blank");
  }
});

resize();
addEventListener("resize", resize);

let last = performance.now();

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  clock += dt;

  const ease = Math.min(1, dt * 14);
  cursor.x += (target.x - cursor.x) * ease;
  cursor.y += (target.y - cursor.y) * ease;

  updateAvoidance(dt);

  const hover = inZone(gearZone(), target.x, target.y);
  if (hover !== gearHover) {
    gearHover = hover;
    canvas.style.cursor = hover ? "pointer" : "default";
  }

  octopus.update(dt, cursor, box, innerWidth);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  drawBox(ctx, box, clock, rippleAt);
  drawSettings(ctx, box, gearHover);
  octopus.drawReach(ctx, innerWidth, innerHeight);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 26);
  ctx.clip();
  octopus.draw(ctx);
  ctx.restore();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
