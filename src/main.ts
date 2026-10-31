import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";
import { drawBox, drawSettings, layoutBox, settingsIconRect } from "./box";
import { Octopus } from "./octopus";

type Zone = { x: number; y: number; w: number; h: number };

const SIDEBAR_MARGIN = 16;

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
      document.documentElement.style.setProperty("--taskbar-inset", `${Math.max(0, insets.bottom)}px`);
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
  box = layoutBox(innerWidth);
  reportZones();
  syncTaskbarInset();
}

const octopus = new Octopus();

function triggerReach() {
  octopus.triggerReach({ x: target.x, y: target.y });
}

if (isTauri) {
  listen("reach-start", triggerReach);
  listen("reach-end", () => octopus.endReach());
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

  const ease = Math.min(1, dt * 14);
  cursor.x += (target.x - cursor.x) * ease;
  cursor.y += (target.y - cursor.y) * ease;

  const hover = inZone(gearZone(), target.x, target.y);
  if (hover !== gearHover) {
    gearHover = hover;
    canvas.style.cursor = hover ? "pointer" : "default";
  }

  octopus.update(dt, cursor, box, innerWidth);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  drawBox(ctx, box);
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
