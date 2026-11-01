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

type Mode = "time" | "words";
type View = "test" | "leaderboard" | "settings";

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

  function newTest() {
    stopTimer();
    const count = mode() === "time" ? 200 : wordCount();
    setWords(pickRandomWords(WORDS, count));
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
    snapshot = { correct: 0, incorrect: 0 };
    lastBucketSecond = -1;
    inputEl?.focus();
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
      // Backend is optional. Results still show locally.
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
    if (e.key === "Escape") {
      e.preventDefault();
      newTest();
      return;
    }
    if (e.key === "Backspace") {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setInput("");
        return;
      }
      if (input() === "" && wordIndex() > 0) {
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
    if (mode() === "words" && wordIndex() + 1 >= words().length) {
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
      if (target) playKeySound(value[pos] === target[pos]);
    }
    startTimerIfNeeded();
    setInput(value);
  }

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
    stopTimer();
  });

  createEffect(() => {
    void mode();
    void timeLimit();
    void wordCount();
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
            </div>
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
            <div class="dt-surface rounded-lg px-4 py-2">
              <button class="dt-muted" title="restart test" onClick={newTest}>
                ↻
              </button>
            </div>
          </section>

          <Show when={!finished()}>
            {/* Timer + live stats, only once the test has started. */}
            <Show when={startedAt() !== null}>
              <section class="mb-6 mt-10 flex flex-wrap items-end gap-8">
                <span class="dt-accent-text text-2xl">
                  <Show when={mode() === "time"}>{timeLeft()}s</Show>
                  <Show when={mode() === "words"}>
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

            <p class="dt-muted mb-6 mt-10 text-center text-sm">english</p>

            {/* Words: plain on the page background. While unfocused the
                words blur and the focus warning sits centred over them. */}
            <section class="relative" onClick={() => inputEl?.focus()}>
              <div class={focused() ? "" : "dt-blurred"}>
                <div class="cursor-pointer text-xl leading-[2] sm:text-2xl md:text-[1.6rem]">
                  <For each={words().slice(0, mode() === "words" ? words().length : 60)}>
                    {(word, i) => {
                      const done = finishedWords()[i()];
                      const isCurrent = i() === wordIndex();
                      return (
                        <span class="mr-3 inline-block">
                          <For each={word.split("")}>
                            {(ch, ci) => {
                              let cls = "text-[var(--dt-muted)]";
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

            <div class="mt-8 text-center">
              <button
                class="dt-muted text-2xl"
                title="restart test"
                onClick={newTest}
              >
                ↻
              </button>
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
                <div class="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
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
                      {stats().correctChars}/
                      {stats().correctChars + stats().incorrectChars}
                    </div>
                    <div class="dt-muted text-sm">correct chars</div>
                  </div>
                </div>
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
            <h3 class="dt-muted mb-2 text-sm">controls</h3>
            <ul class="dt-muted space-y-1 text-sm">
              <li>esc — restart test</li>
              <li>space — next word</li>
              <li>backspace on an empty word — previous word</li>
              <li>ctrl + backspace — clear current word</li>
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
