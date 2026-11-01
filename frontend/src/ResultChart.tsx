/**
 * dustype's own results chart: a plain <canvas> line chart, no charting
 * library. It is a pure function of the per-second speed + error arrays:
 * the speed line is drawn on its own scale, and error markers are drawn
 * on a separate error scale so a burst of errors cannot squash the
 * speed line. No animation; the canvas is cleared/redrawn when the data
 * or theme changes, and nothing is left running on unmount.
 */
import { createEffect, onCleanup, Show } from "solid-js";

interface ResultChartProps {
  speed: number[];
  errors: number[];
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export default function ResultChart(props: ResultChartProps) {
  let canvas: HTMLCanvasElement | undefined;

  function draw() {
    const el = canvas;
    if (!el) return;
    const speed = props.speed;
    const errors = props.errors;
    const dpr = window.devicePixelRatio || 1;
    const width = 640;
    const height = 180;
    el.width = width * dpr;
    el.height = height * dpr;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const accent = cssVar("--dt-accent", "#6ee7b7");
    const errorColour = cssVar("--dt-error", "#fb7185");
    const muted = cssVar("--dt-muted", "#9399ad");
    const border = cssVar("--dt-border", "#33374a");

    const padLeft = 36;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 22;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxSpeed = Math.max(10, ...speed);
    const maxErrors = Math.max(1, ...errors);
    const x = (i: number) =>
      padLeft + (speed.length <= 1 ? plotW / 2 : (i / (speed.length - 1)) * plotW);
    const ySpeed = (v: number) => padTop + plotH - (v / maxSpeed) * plotH;
    const yError = (v: number) => padTop + plotH - (v / maxErrors) * plotH;

    // Grid + speed axis labels.
    ctx.strokeStyle = border;
    ctx.fillStyle = muted;
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.lineWidth = 1;
    for (const frac of [0, 0.5, 1]) {
      const y = padTop + plotH - frac * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round(maxSpeed * frac)), padLeft - 6, y + 4);
    }
    ctx.textAlign = "center";
    ctx.fillText("0s", padLeft, height - 6);
    if (speed.length > 1) {
      ctx.fillText(`${speed.length - 1}s`, width - padRight, height - 6);
    }

    // Speed line.
    if (speed.length > 0) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      speed.forEach((v, i) => {
        if (i === 0) ctx.moveTo(x(i), ySpeed(v));
        else ctx.lineTo(x(i), ySpeed(v));
      });
      ctx.stroke();
    }

    // Error markers: one dot per second that had errors, on the
    // error scale (so they never distort the speed line).
    ctx.fillStyle = errorColour;
    errors.forEach((count, i) => {
      if (count <= 0) return;
      ctx.beginPath();
      ctx.arc(x(i), yError(count), 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  createEffect(() => {
    // Track the arrays so a theme change or new history redraws.
    void props.speed;
    void props.errors;
    draw();
  });

  onCleanup(() => {
    const el = canvas;
    if (el) {
      const ctx = el.getContext("2d");
      ctx?.clearRect(0, 0, el.width, el.height);
    }
  });

  return (
    <div class="mt-6">
      <Show
        when={props.speed.length > 0}
        fallback={<p class="text-sm dt-muted">No per-second data recorded for this test.</p>}
      >
        <canvas
          ref={canvas}
          class="h-auto w-full"
          role="img"
          aria-label="Per-second typing speed line with error markers"
        />
        <p class="dt-muted mt-1 text-xs">
          Line: words per minute per second. Dots: errors in that second (own scale).
        </p>
      </Show>
    </div>
  );
}
