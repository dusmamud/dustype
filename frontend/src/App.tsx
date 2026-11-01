import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { calculateStats, countCharResults, pickRandomWords } from "@dustype/util";
import { WORDS } from "./words";
import ResultChart from "./ResultChart";
import {
  emptyHistory,
  liveAccuracy,
  liveCounters,
  liveWpm,
  recordSecond,
  trimTrailingIdle,
  type PerSecondHistory,
} from "./liveStats";
import { applyTheme, initialThemeId, THEMES } from "./themes";
import { playFinishSound, playKeySound, setSoundEnabled } from "./sound";
import { QUOTES } from "./quotes";

type Mode = "time" | "words" | "quote" | "zen" | "custom";
type View = "test" | "leaderboard" | "settings";
type Difficulty = "normal" | "expert" | "master";
type Funbox = "none" | "mirror" | "upside_down";

interface FinishedWord {
  target: string;
  typed: string;
}

interface LeaderboardEntry {
  displayName: string;
  wpm: number;
  accuracy: number;
  mode: string;
}

export default function App() {
  const [mode, setMode] = createSignal<Mode>("time");
  const [timeLimit, setTimeLimit] = createSignal(30);
  const [wordCount, setWordCount] = createSignal(50);
  const [words, setWords] = createSignal<string[]>([]);
  const [wordIndex, setWordIndex] = createSignal(0);
  const [input, setInput] = createSignal("");
  const [finishedWords, setFinishedWords] = createSignal<FinishedWord[]>([]);
  const [startedAt, setStartedAt] = createSignal<number | null>(null);
  const [timeLeft, setTimeLeft] = createSignal(30);
  const [finished, setFinished] = createSignal(false);
  const [elapsed, setElapsed] = createSignal(0);
  const [liveWpmValue, setLiveWpmValue] = createSignal(0);
  const [liveElapsed, setLiveElapsed] = createSignal(0);
  const [history, setHistory] = createSignal<PerSecondHistory>(emptyHistory());
  const [finishedHistory, setFinishedHistory] =
    createSignal<PerSecondHistory>(emptyHistory());
  const [themeId, setThemeId] = createSignal(initialThemeId());
  const [soundOn, setSoundOn] = createSignal(true);
  const [focused, setFocused] = createSignal(false);
  const [view, setView] = createSignal<View>("test");
  const [punctuation, setPunctuation] = createSignal(false);
  const [numbers, setNumbers] = createSignal(false);
  const [difficulty, setDifficulty] = createSignal<Difficulty>("normal");
  const [blind, setBlind] = createSignal(false);
  const [stopOnError, setStopOnError] = createSignal(false);
  const [funbox, setFunbox] = createSignal<Funbox>("none");
  const [capsLock, setCapsLock] = createSignal(false);
  const [windowBlurred, setWindowBlurred] = createSignal(false);
  const [customText, setCustomText] = createSignal("");
  const [customStarted, setCustomStarted] = createSignal(false);
  const [customError, setCustomError] = createSignal<string | null>(null);
  const [resultSaveError, setResultSaveError] = createSignal(false);
  const [leaderboard, setLeaderboard] = createSignal<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = createSignal(false);
  const [leaderboardError, setLeaderboardError] = createSignal<string | null>(
    null,
  );

  applyTheme(themeId());
  createEffect(() => {
    applyTheme(themeId());
  });

  function themeName() {
    return THEMES.find((t) => t.id === themeId())?.name ?? themeId();
  }

  async function loadLeaderboard() {
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const res = await fetch("http://localhost:5005/api/leaderboards?limit=20");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { leaderboard?: LeaderboardEntry[] };
      setLeaderboard(data.leaderboard ?? []);
    } catch {
      setLeaderboard([]);
      setLeaderboardError(
        "Backend nahi chal raha hai, isliye leaderboard khali hai. Local me backend chalu karo, tab results dikhenge.",
      );
    } finally {
      setLeaderboardLoading(false);
    }
  }

  createEffect(() => {
    if (view() === "leaderboard") void loadLeaderboard();
  });

  let inputEl: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let liveTimer: ReturnType<typeof setInterval> | undefined;
  let snapshot = { correct: 0, incorrect: 0 };
  let lastBucketSecond = -1;

  // Word generation for the current mode. Punctuation and numbers
  // only apply to generated-word modes (time / words / zen); quote and
  // custom text are fixed, so those toggles are disabled there.
  function buildWords(): string[] {
    const m = mode();
    if (m === "quote") {
      const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      return quote.split(" ");
    }
    if (m === "custom") {
      return customText().split(/\s+/).filter(Boolean);
    }
    const count = m === "words" ? wordCount() : 200;
    let list = pickRandomWords(WORDS, count);
    if (numbers()) {
      list = list.map((w) =>
        Math.random() < 0.2 ? String(Math.floor(Math.random() * 10000)) : w,
      );
    }
    if (punctuation()) {
      const marks = [".", ",", "?", "!", ":", ";"];
      let capitalizeNext = false;
      list = list.map((w) => {
        let out = capitalizeNext
          ? w.charAt(0).toUpperCase() + w.slice(1)
          : w;
        capitalizeNext = false;
        if (Math.random() < 0.25) {
          const mark = marks[Math.floor(Math.random() * marks.length)];
          out += mark;
          if (mark === "." || mark === "?" || mark === "!") {
            capitalizeNext = true;
          }
        }
        return out;
      });
    }
    return list;
  }

  function newTest() {
    stopTimer();
    if (mode() === "custom" && !customStarted()) {
      // Custom setup view stays; the test starts from its Start button.
      setWords([]);
      setWordIndex(0);
      setInput("");
      setFinishedWords([]);
      setStartedAt(null);
      setFinished(false);
      setResultSaveError(false);
      return;
    }
    setWords(buildWords());
    setWordIndex(0);
    setInput("");
    setFinishedWords([]);
    setStartedAt(null);
    setTimeLeft(timeLimit());
    setFinished(false);
    setElapsed(0);
    setLiveWpmValue(0);
    setLiveElapsed(0);
    setHistory(emptyHistory());
    setFinishedHistory(emptyHistory());
    setResultSaveError(false);
    snapshot = { correct: 0, incorrect: 0 };
    lastBucketSecond = -1;
    inputEl?.focus();
  }

  function startCustomTest() {
    const text = customText().trim();
    if (!text) {
      setCustomError("Custom text khali hai, kuch type karo.");
      return;
    }
    setCustomError(null);
    setCustomStarted(true);
    newTest();
  }

  function consistencyFrom(speed: number[]): number {
    const values = speed.filter((v) => v > 0);
    if (values.length < 2) return 100;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;
    const variance =
      values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    const std = Math.sqrt(variance);
    return Math.max(0, Math.round(100 - (std / mean) * 100));
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = undefined;
    }
  }

  function currentCounters() {
    const idx = wordIndex();
    return liveCounters(
      finishedWords(),
      idx < words().length ? words()[idx] : undefined,
      input(),
    );
  }

  function finishTest() {
    stopTimer();
    const start = startedAt();
    const seconds =
      mode() === "time"
        ? timeLimit()
        : start
          ? Math.max(1, Math.round((Date.now() - start) / 1000))
          : 1;
    setElapsed(seconds);
    setFinishedHistory(trimTrailingIdle(history()));
    setFinished(true);
    playFinishSound();
    void submitResult(seconds);
  }

  async function submitResult(seconds: number) {
    try {
      const stats = results();
      if (!stats) return;
      await fetch("http://localhost:5005/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode(),
          wpm: stats.wpm,
          rawWpm: stats.rawWpm,
          accuracy: stats.accuracy,
          correctChars: stats.correctChars,
          incorrectChars: stats.incorrectChars,
          elapsedSeconds: seconds,
          wordCount: finishedWords().length,
        }),
      });
    } catch {
      // Backend is optional. Results still show locally, with a note.
      setResultSaveError(true);
    }
  }

  function startTimerIfNeeded() {
    if (startedAt() !== null || timer) return;
    const start = Date.now();
    setStartedAt(start);
    timer = setInterval(() => {
      if (mode() !== "time") return;
      const left = timeLimit() - Math.floor((Date.now() - start) / 1000);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) finishTest();
    }, 200);
    liveTimer = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - start) / 1000);
      setLiveElapsed(elapsedSec);
      const counters = currentCounters();
      setLiveWpmValue(liveWpm(counters.correct, elapsedSec));
      const bucket = elapsedSec - 1;
      if (bucket > lastBucketSecond) {
        setHistory((prev) =>
          recordSecond(
            prev,
            bucket,
            counters.correct - snapshot.correct,
            counters.incorrect - snapshot.incorrect,
          ),
        );
        snapshot = { correct: counters.correct, incorrect: counters.incorrect };
        lastBucketSecond = bucket;
      }
    }, 1000);
  }

  function results() {
    if (!finished()) return null;
    let correct = 0;
    let incorrect = 0;
    let typedTotal = 0;
    const all = [...finishedWords()];
    const current = input().trim();
    if (current && wordIndex() < words().length) {
      all.push({ target: words()[wordIndex()], typed: current });
    }
    for (const w of all) {
      const r = countCharResults(w.target, w.typed);
      correct += r.correct;
      incorrect += r.incorrect;
      typedTotal += w.typed.length;
    }
    const spaces = Math.max(0, finishedWords().length);
    correct += spaces;
    typedTotal += spaces;
    return calculateStats({
      correctChars: correct,
      incorrectChars: incorrect,
      elapsedSeconds: elapsed(),
      totalTypedChars: typedTotal,
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (finished()) return;
    setCapsLock(e.getModifierState("CapsLock"));
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode() === "zen" && startedAt() !== null) finishTest();
      else newTest();
      return;
    }
    if (e.key === "Backspace") {
      if (difficulty() === "master") {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setInput("");
        return;
      }
      if (input() === "" && wordIndex() > 0) {
        if (difficulty() === "expert") {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const prev = finishedWords()[finishedWords().length - 1];
        if (!prev) return;
        setFinishedWords(finishedWords().slice(0, -1));
        setWordIndex(wordIndex() - 1);
        setInput(prev.typed);
      }
      return;
    }
    if (e.key !== " ") return;
    e.preventDefault();
    const value = input();
    if (!value) return;
    startTimerIfNeeded();
    const target = words()[wordIndex()];
    const next = [...finishedWords(), { target, typed: value }];
    setFinishedWords(next);
    setInput("");
    if (mode() === "zen" && wordIndex() + 1 >= words().length) {
      setWords([...words(), ...buildWords().slice(0, 100)]);
      setWordIndex(wordIndex() + 1);
      return;
    }
    if (
      (mode() === "words" || mode() === "quote" || mode() === "custom") &&
      wordIndex() + 1 >= words().length
    ) {
      setWordIndex(wordIndex() + 1);
      finishTest();
      return;
    }
    setWordIndex(wordIndex() + 1);
  }

  function onInput(value: string) {
    if (finished()) return;
    if (value.length > input().length) {
      const target = words()[wordIndex()];
      const pos = value.length - 1;
      const correct = target ? value[pos] === target[pos] : true;
      if (target) playKeySound(correct);
      startTimerIfNeeded();
      setInput(value);
      // Stop-on-error: finish on the first incorrect letter.
      if (stopOnError() && !correct) finishTest();
      return;
    }
    startTimerIfNeeded();
    setInput(value);
  }

  function onWindowBlur() {
    setWindowBlurred(true);
  }
  function onWindowFocus() {
    setWindowBlurred(false);
  }
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);

  function autofocusHandler(e: KeyboardEvent) {
    if (finished()) return;
    if (view() !== "test") return;
    if (document.activeElement === inputEl) return;
    if (e.key.length !== 1 && e.key !== " ") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    inputEl?.focus();
  }
  document.addEventListener("keydown", autofocusHandler);
  onCleanup(() => {
    document.removeEventListener("keydown", autofocusHandler);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("focus", onWindowFocus);
    stopTimer();
  });

  createEffect(() => {
    void mode();
    void timeLimit();
    void wordCount();
    // Custom mode has a setup view, not an auto-generated test.
    if (mode() === "custom" && !customStarted()) return;
    if (words().length === 0) newTest();
  });

  onCleanup(stopTimer);

  if (words().length === 0) {
    setWords(pickRandomWords(WORDS, 200));
    setTimeLeft(timeLimit());
  }

  const navClass = (v: View) =>
    `rounded p-2 ${view() === v ? "dt-accent-text" : "dt-muted"}`;

  // Own simple line icons for the nav (keyboard, crown, gear) — drawn
  // here, not copied from any icon font or from the reference app.
  function NavIcon(props: { kind: "keyboard" | "crown" | "gear" }) {
    const kind = props.kind;
    const common = {
      width: 20,
      height: 20,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    } as const;
    if (kind === "keyboard") {
      return (
        <svg {...common}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h2M10 10h2M14 10h2M16 10h2M7 14h10" />
        </svg>
      );
    }
    if (kind === "crown") {
      return (
        <svg {...common}>
          <path d="M3 18h18M4 18l-1-9 5 4 4-6 4 6 5-4-1 9z" />
        </svg>
      );
    }
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2" />
      </svg>
    );
  }

  return (
    <div class="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-4 sm:px-8">
      {/* Header: small icon + wordmark left, icon-only nav right. */}
      <header class="flex items-center justify-between gap-4">
        <button
          class="flex items-center gap-2 text-left"
          onClick={() => {
            setView("test");
            window.setTimeout(() => inputEl?.focus(), 0);
          }}
        >
          <span class="dt-accent-text flex items-center">
            <NavIcon kind="keyboard" />
          </span>
          <span class="text-2xl font-bold">dustype</span>
        </button>
        <nav class="flex gap-1" aria-label="Main">
          <button
            class={navClass("test")}
            title="test"
            onClick={() => setView("test")}
          >
            <NavIcon kind="keyboard" />
          </button>
          <button
            class={navClass("leaderboard")}
            title="leaderboard"
            onClick={() => setView("leaderboard")}
          >
            <NavIcon kind="crown" />
          </button>
          <button
            class={navClass("settings")}
            title="settings"
            onClick={() => setView("settings")}
          >
            <NavIcon kind="gear" />
          </button>
        </nav>
      </header>

      <main class="flex flex-1 flex-col justify-center py-8">
        <Show when={view() === "test"}>
          {/* Config: three small pills, like the reference app —
              mode pill, value pill, restart pill. Only modes dustype
              actually supports are shown. */}
          <section
            class="flex flex-wrap items-center justify-center gap-2 text-sm"
            aria-label="Test config"
          >
            <div class="dt-surface flex gap-4 rounded-lg px-4 py-2">
              <button
                class={mode() === "time" ? "dt-accent-text font-bold" : "dt-muted"}
                onClick={() => {
                  setMode("time");
                  newTest();
                }}
              >
                time
              </button>
              <button
                class={mode() === "words" ? "dt-accent-text font-bold" : "dt-muted"}
                onClick={() => {
                  setMode("words");
                  newTest();
                }}
              >
                words
              </button>
              <button
                class={mode() === "quote" ? "dt-accent-text font-bold" : "dt-muted"}
                onClick={() => {
                  setMode("quote");
                  newTest();
                }}
              >
                quote
              </button>
              <button
                class={mode() === "zen" ? "dt-accent-text font-bold" : "dt-muted"}
                onClick={() => {
                  setMode("zen");
                  newTest();
                }}
              >
                zen
              </button>
              <button
                class={mode() === "custom" ? "dt-accent-text font-bold" : "dt-muted"}
                onClick={() => {
                  setMode("custom");
                  setCustomStarted(false);
                  newTest();
                }}
              >
                custom
              </button>
            </div>
            <div class="dt-surface flex gap-4 rounded-lg px-4 py-2">
              <Show
                when={
                  mode() === "time" || mode() === "words" || mode() === "zen"
                }
              >
                <button
                  class={punctuation() ? "dt-accent-text font-bold" : "dt-muted"}
                  title={
                    mode() === "zen"
                      ? "punctuation is disabled in zen mode"
                      : "punctuation"
                  }
                  disabled={mode() === "zen"}
                  onClick={() => {
                    setPunctuation(!punctuation());
                    newTest();
                  }}
                >
                  @ punctuation
                </button>
                <button
                  class={numbers() ? "dt-accent-text font-bold" : "dt-muted"}
                  title={
                    mode() === "zen"
                      ? "numbers are disabled in zen mode"
                      : "numbers"
                  }
                  disabled={mode() === "zen"}
                  onClick={() => {
                    setNumbers(!numbers());
                    newTest();
                  }}
                >
                  # numbers
                </button>
              </Show>
            </div>
            <Show when={mode() === "time" || mode() === "words"}>
              <div class="dt-surface flex gap-4 rounded-lg px-4 py-2">
                <Show when={mode() === "time"}>
                  <For each={[15, 30, 60, 120]}>
                    {(n) => (
                      <button
                        class={
                          timeLimit() === n ? "dt-accent-text font-bold" : "dt-muted"
                        }
                        onClick={() => {
                          setTimeLimit(n);
                          newTest();
                        }}
                      >
                        {n}
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={mode() === "words"}>
                  <For each={[10, 25, 50, 100]}>
                    {(n) => (
                      <button
                        class={
                          wordCount() === n ? "dt-accent-text font-bold" : "dt-muted"
                        }
                        onClick={() => {
                          setWordCount(n);
                          newTest();
                        }}
                      >
                        {n}
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
            <div class="dt-surface rounded-lg px-4 py-2">
              <button class="dt-muted" title="restart test" onClick={newTest}>
                ↻
              </button>
            </div>
          </section>

          <Show when={mode() === "custom" && !customStarted() && !finished()}>
            <section class="dt-surface mx-auto mt-10 w-full max-w-2xl rounded-xl p-6">
              <h2 class="mb-3 text-lg font-bold">Custom text</h2>
              <p class="dt-muted mb-4 text-sm">
                Apna text yahan paste karo, fir Start dabao. Test usi text
                par chalega.
              </p>
              <textarea
                class="dt-border w-full rounded-lg border bg-transparent p-3 text-base"
                rows={6}
                placeholder="Type or paste your text here..."
                value={customText()}
                onInput={(e) => setCustomText(e.currentTarget.value)}
              />
              <Show when={customError()}>
                <p class="text-[var(--dt-error)] mt-3 text-sm">
                  {customError()}
                </p>
              </Show>
              <button
                class="dt-accent-bg mt-4 rounded-lg px-6 py-2 font-bold"
                onClick={startCustomTest}
              >
                Start custom test
              </button>
            </section>
          </Show>

          <Show
            when={
              !finished() &&
              (mode() !== "custom" || customStarted())
            }
          >
            <Show when={capsLock()}>
              <p class="text-[var(--dt-error)] mt-10 text-center text-sm font-bold">
                Caps Lock on hai
              </p>
            </Show>
            <Show when={windowBlurred()}>
              <p class="dt-muted mt-2 text-center text-sm">
                Window focus me nahi hai — window par click karo, fir type karo.
              </p>
            </Show>
            {/* Timer + live stats, only once the test has started. */}
            <Show when={startedAt() !== null}>
              <section class="mb-6 mt-10 flex flex-wrap items-end gap-8">
                <span class="dt-accent-text text-2xl">
                  <Show when={mode() === "time"}>{timeLeft()}s</Show>
                  <Show when={mode() === "zen"}>{liveElapsed()}s</Show>
                  <Show
                    when={
                      mode() === "words" ||
                      mode() === "quote" ||
                      mode() === "custom"
                    }
                  >
                    {wordIndex() + 1} / {words().length}
                  </Show>
                </span>
                <span class="dt-muted text-sm">
                  <span class="dt-accent-text text-xl">{liveWpmValue()}</span>{" "}
                  wpm
                </span>
                <span class="dt-muted text-sm">
                  <span class="text-xl">
                    {liveAccuracy(
                      currentCounters().correct,
                      currentCounters().incorrect,
                    )}
                    %
                  </span>{" "}
                  acc
                </span>
                <span class="dt-muted text-sm">
                  <span class="text-xl">{liveElapsed()}s</span> elapsed
                </span>
              </section>
            </Show>

            <p class="dt-muted mb-6 mt-10 text-center text-sm">
              <Show when={mode() === "quote" || mode() === "custom"}>
                {mode()}
              </Show>
              <Show when={mode() !== "quote" && mode() !== "custom"}>
                english
              </Show>
              <Show when={punctuation()}> • punctuation</Show>
              <Show when={numbers()}> • numbers</Show>
              <Show when={mode() === "zen"}>
                {" "}
                • zen — finish karne ke liye Esc dabao
              </Show>
            </p>

            {/* Words: plain on the page background. While unfocused the
                words blur and the focus warning sits centred over them. */}
            <section
              class="relative"
              style={
                funbox() === "mirror"
                  ? { transform: "scaleX(-1)" }
                  : funbox() === "upside_down"
                    ? { transform: "rotate(180deg)" }
                    : {}
              }
              onClick={() => inputEl?.focus()}
            >
              <div class={focused() ? "" : "dt-blurred"}>
                <div class="cursor-pointer text-xl leading-[2] sm:text-2xl md:text-[1.6rem]">
                  {/* Time/zen show 60 words at a time, in a window that
                      moves forward as you type, so the page stays the
                      same height as the reference app. Words/quote/
                      custom show their whole text at once. */}
                  <For
                    each={(() => {
                      const w = words();
                      if (
                        mode() === "words" ||
                        mode() === "quote" ||
                        mode() === "custom"
                      ) {
                        return w;
                      }
                      const start = Math.floor(wordIndex() / 60) * 60;
                      return w.slice(start, start + 60);
                    })()}
                  >
                    {(word, i) => {
                      const windowStart =
                        mode() === "words" ||
                        mode() === "quote" ||
                        mode() === "custom"
                          ? 0
                          : Math.floor(wordIndex() / 60) * 60;
                      const globalIndex = windowStart + i();
                      const done = finishedWords()[globalIndex];
                      const isCurrent = globalIndex === wordIndex();
                      return (
                        <span class="mr-3 inline-block">
                          <For each={word.split("")}>
                            {(ch, ci) => {
                              let cls = "text-[var(--dt-muted)]";
                              if (!blind()) {
                                if (done) {
                                  cls =
                                    done.typed[ci()] === ch
                                      ? "text-[var(--dt-text)]"
                                      : "text-[var(--dt-error)]";
                                } else if (isCurrent) {
                                  const typed = input()[ci()];
                                  if (typed !== undefined) {
                                    cls =
                                      typed === ch
                                        ? "text-[var(--dt-text)]"
                                        : "text-[var(--dt-error)]";
                                  }
                                }
                              }
                              return (
                                <>
                                  <Show
                                    when={isCurrent && !done && ci() === input().length}
                                  >
                                    <span class="dt-caret" aria-hidden="true" />
                                  </Show>
                                  <span class={cls}>{ch}</span>
                                </>
                              );
                            }}
                          </For>
                          <Show when={isCurrent && !done && input().length > word.length}>
                            <For each={input().slice(word.length).split("")}>
                              {(extra) => (
                                <span class="text-[var(--dt-error)]">{extra}</span>
                              )}
                            </For>
                          </Show>
                          <Show when={isCurrent && !done && input().length === word.length}>
                            <span class="dt-caret" aria-hidden="true" />
                          </Show>
                          <Show when={done && done.typed !== word}>
                            <span class="text-[var(--dt-error)]"> ✕</span>
                          </Show>
                        </span>
                      );
                    }}
                  </For>
                </div>
              </div>
              <Show when={!focused()}>
                <button
                  class="absolute inset-0 flex items-center justify-center text-lg"
                  onClick={() => inputEl?.focus()}
                >
                  Click here or press any key to focus
                </button>
              </Show>
            </section>

            <div class="mt-8 flex items-center justify-center gap-6 text-center">
              <button
                class="dt-muted text-2xl"
                title="restart test"
                onClick={newTest}
              >
                ↻
              </button>
              <Show when={mode() === "zen" && startedAt() !== null}>
                <button
                  class="dt-accent-bg rounded px-4 py-2 text-sm font-bold"
                  onClick={finishTest}
                >
                  Finish test
                </button>
              </Show>
            </div>

            <input
              ref={inputEl}
              class="pointer-events-none absolute h-0 w-0 opacity-0"
              aria-label="Typing input"
              value={input()}
              onInput={(e) => onInput(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </Show>

          <Show when={finished() && results()}>
            {(stats) => (
              <section class="dt-surface dt-fade-in mt-10 rounded p-6">
                <h2 class="mb-4 text-2xl font-bold">Results</h2>
                <p class="dt-muted mb-4 text-sm">
                  {mode()} •{" "}
                  <Show when={mode() === "time"}>{timeLimit()}s</Show>
                  <Show when={mode() === "words"}>{wordCount()} words</Show>
                  <Show when={mode() === "quote"}>quote</Show>
                  <Show when={mode() === "zen"}>zen</Show>
                  <Show when={mode() === "custom"}>custom</Show>
                  <Show when={punctuation()}> • punctuation</Show>
                  <Show when={numbers()}> • numbers</Show>
                </p>
                <div class="grid grid-cols-2 gap-4 text-center sm:grid-cols-5">
                  <div>
                    <div class="dt-accent-text text-3xl">{stats().wpm}</div>
                    <div class="dt-muted text-sm">wpm</div>
                  </div>
                  <div>
                    <div class="text-3xl">{stats().rawWpm}</div>
                    <div class="dt-muted text-sm">raw</div>
                  </div>
                  <div>
                    <div class="text-3xl">{stats().accuracy}%</div>
                    <div class="dt-muted text-sm">accuracy</div>
                  </div>
                  <div>
                    <div class="text-3xl">
                      {consistencyFrom(finishedHistory().speed)}%
                    </div>
                    <div class="dt-muted text-sm">consistency</div>
                  </div>
                  <div>
                    <div class="text-3xl">
                      {stats().correctChars}/
                      {stats().correctChars + stats().incorrectChars}
                    </div>
                    <div class="dt-muted text-sm">correct chars</div>
                  </div>
                </div>
                <Show when={resultSaveError()}>
                  <p class="text-[var(--dt-error)] mt-4 text-sm">
                    Backend nahi chal raha hai, isliye ye result save nahi
                    hua — sirf local dikh raha hai.
                  </p>
                </Show>
                <ResultChart
                  speed={finishedHistory().speed}
                  errors={finishedHistory().errors}
                />
                <button
                  class="dt-accent-bg mt-6 rounded px-4 py-2 font-bold"
                  onClick={newTest}
                >
                  Next test
                </button>
              </section>
            )}
          </Show>
        </Show>

        <Show when={view() === "leaderboard"}>
          <section>
            <h2 class="mb-2 text-2xl font-bold">Leaderboard</h2>
            <p class="dt-muted mb-6 text-sm">
              Top results by WPM, from the dustype backend. Live site par
              backend nahi chalta, isliye wahan ye khali dikhega.
            </p>
            <Show when={leaderboardLoading()}>
              <p class="dt-muted">Loading…</p>
            </Show>
            <Show when={leaderboardError()}>
              <p class="dt-error-text">{leaderboardError()}</p>
            </Show>
            <Show when={!leaderboardLoading() && !leaderboardError()}>
              <Show
                when={leaderboard().length > 0}
                fallback={<p class="dt-muted">Abhi koi result nahi hai.</p>}
              >
                <ol class="space-y-2">
                  <For each={leaderboard()}>
                    {(entry, i) => (
                      <li class="dt-surface flex items-center justify-between rounded px-4 py-2">
                        <span>
                          <span class="dt-muted mr-3">{i() + 1}.</span>
                          {entry.displayName}
                        </span>
                        <span>
                          <span class="dt-accent-text font-bold">
                            {entry.wpm}
                          </span>{" "}
                          <span class="dt-muted text-sm">
                            wpm • {entry.accuracy}% • {entry.mode}
                          </span>
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </Show>
            <button
              class="dt-surface mt-6 rounded px-4 py-2"
              onClick={() => void loadLeaderboard()}
            >
              Refresh
            </button>
          </section>
        </Show>

        <Show when={view() === "settings"}>
          <section>
            <h2 class="mb-6 text-2xl font-bold">Settings</h2>
            <h3 class="dt-muted mb-2 text-sm">theme</h3>
            <div class="mb-8 flex flex-wrap gap-2">
              <For each={THEMES}>
                {(theme) => (
                  <button
                    class={`rounded px-3 py-1 ${
                      themeId() === theme.id
                        ? "dt-accent-bg font-bold"
                        : "dt-surface"
                    }`}
                    onClick={() => setThemeId(theme.id)}
                  >
                    {theme.name}
                  </button>
                )}
              </For>
            </div>
            <h3 class="dt-muted mb-2 text-sm">sound</h3>
            <button
              class="dt-surface mb-8 rounded px-3 py-1"
              onClick={() => {
                const next = !soundOn();
                setSoundOn(next);
                setSoundEnabled(next);
              }}
            >
              sound: {soundOn() ? "on" : "off"}
            </button>
            <h3 class="dt-muted mb-2 text-sm">difficulty</h3>
            <div class="mb-8 flex flex-wrap gap-2">
              <For each={["normal", "expert", "master"] as Difficulty[]}>
                {(d) => (
                  <button
                    class={`rounded px-3 py-1 ${
                      difficulty() === d ? "dt-accent-bg font-bold" : "dt-surface"
                    }`}
                    onClick={() => setDifficulty(d)}
                  >
                    {d}
                  </button>
                )}
              </For>
            </div>
            <p class="dt-muted mb-8 -mt-6 text-sm">
              normal: backspace se pichle word par ja sakte ho. expert:
              backspace sirf current word me. master: backspace band hai.
            </p>
            <h3 class="dt-muted mb-2 text-sm">typing behaviour</h3>
            <div class="mb-8 flex flex-wrap gap-2">
              <button
                class="dt-surface rounded px-3 py-1"
                onClick={() => setBlind(!blind())}
              >
                blind mode: {blind() ? "on" : "off"}
              </button>
              <button
                class="dt-surface rounded px-3 py-1"
                onClick={() => setStopOnError(!stopOnError())}
              >
                stop on error: {stopOnError() ? "on" : "off"}
              </button>
            </div>
            <p class="dt-muted mb-8 -mt-6 text-sm">
              blind mode me sahi/galat rang nahi dikhta, sirf caret dikhta
              hai. stop on error me pehli galat letter par test khatam ho
              jata hai.
            </p>
            <h3 class="dt-muted mb-2 text-sm">funbox</h3>
            <div class="mb-8 flex flex-wrap gap-2">
              <For each={["none", "mirror", "upside_down"] as Funbox[]}>
                {(f) => (
                  <button
                    class={`rounded px-3 py-1 ${
                      funbox() === f ? "dt-accent-bg font-bold" : "dt-surface"
                    }`}
                    onClick={() => setFunbox(f)}
                  >
                    {f}
                  </button>
                )}
              </For>
            </div>
            <h3 class="dt-muted mb-2 text-sm">controls</h3>
            <ul class="dt-muted space-y-1 text-sm">
              <li>esc — restart test (zen me: finish test)</li>
              <li>space — next word</li>
              <li>backspace on an empty word — previous word</li>
              <li>ctrl + backspace — clear current word</li>
              <li>caps lock on hone par warning dikhta hai</li>
            </ul>
          </section>
        </Show>
      </main>

      {/* Footer: keytips above, links left, theme + version right. */}
      <footer class="mt-8">
        <p class="dt-muted mb-4 text-center text-[11px]">
          <span class="dt-surface rounded px-1">esc</span> restart test
          {" • "}
          <span class="dt-surface rounded px-1">space</span> next word
          {" • "}
          <span class="dt-surface rounded px-1">ctrl + backspace</span>{" "}
          clear word
        </p>
        <div class="dt-muted flex flex-col justify-between gap-4 text-[11px] sm:flex-row">
          <div class="flex flex-wrap gap-4">
            <a
              href="https://github.com/dusmamud/dustype"
              target="_blank"
              rel="noreferrer"
            >
              github
            </a>
            <a
              href="https://dustype.pages.dev"
              target="_blank"
              rel="noreferrer"
            >
              dustype.pages.dev
            </a>
          </div>
          <div class="flex gap-4">
            <span>theme: {themeName()}</span>
            <span>dustype 0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
