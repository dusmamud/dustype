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

interface FinishedWord {
  target: string;
  typed: string;
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
  // Phase 2 live stats: WPM refreshed once per second on a timer tick
  // anchored to the start timestamp; accuracy is derived per keystroke
  // from the running counters (see liveCounters() below, read in JSX).
  const [liveWpmValue, setLiveWpmValue] = createSignal(0);
  const [liveElapsed, setLiveElapsed] = createSignal(0);
  const [history, setHistory] = createSignal<PerSecondHistory>(emptyHistory());
  const [finishedHistory, setFinishedHistory] =
    createSignal<PerSecondHistory>(emptyHistory());
  const [themeId, setThemeId] = createSignal(initialThemeId());
  const [soundOn, setSoundOn] = createSignal(true);
  const [focused, setFocused] = createSignal(false);

  // Apply the persisted (or default) theme before first paint of this
  // component, and re-apply whenever the user picks another theme.
  applyTheme(themeId());
  createEffect(() => {
    applyTheme(themeId());
  });

  let inputEl: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let liveTimer: ReturnType<typeof setInterval> | undefined;
  // Snapshot for per-second deltas, plus the last bucket already written.
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

  /** Running counters, recomputed from state (per-keystroke accuracy). */
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
    // The in-progress partial second is not bucketed; trailing idle
    // buckets are trimmed so the chart ends at the last active second.
    // The end-of-test recomputation in results() stays authoritative.
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
      // Backend is optional in Phase 1. Results still show locally.
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
    // Live-stats tick: once per second, anchored to the start timestamp.
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
    // Spaces between submitted words count as typed characters.
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
    // Escape restarts, like the reference app's quick-restart behaviour.
    if (e.key === "Escape") {
      e.preventDefault();
      newTest();
      return;
    }
    // Backspace on an empty current word goes back to the previous word
    // so it can be corrected; Ctrl+Backspace clears the current word.
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
    // Play a key sound only for a newly typed character, not for a
    // deletion: compare against the previous signal value first.
    if (value.length > input().length) {
      const target = words()[wordIndex()];
      const pos = value.length - 1;
      if (target) playKeySound(value[pos] === target[pos]);
    }
    startTimerIfNeeded();
    setInput(value);
  }

  // Autofocus: pressing a printable key anywhere on the page focuses
  // the typing input, matching the reference app's focus behaviour.
  function autofocusHandler(e: KeyboardEvent) {
    if (finished()) return;
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
    // Regenerate when mode or limits change.
    void mode();
    void timeLimit();
    void wordCount();
    if (words().length === 0) newTest();
  });

  onCleanup(stopTimer);

  // Initial test.
  if (words().length === 0) {
    setWords(pickRandomWords(WORDS, 200));
    setTimeLeft(timeLimit());
  }

  return (
    <main class="mx-auto max-w-3xl px-4 py-8">
      <header class="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <h1 class="dt-accent-text text-3xl font-bold">dustype</h1>
        <p class="dt-muted text-sm">a minimal typing test</p>
      </header>

      <section class="mb-6 flex flex-wrap items-center gap-2" aria-label="Theme">
        <span class="dt-muted mr-1 text-sm">theme</span>
        <For each={THEMES}>
          {(theme) => (
            <button
              class={`rounded px-3 py-1 ${
                themeId() === theme.id ? "dt-accent-bg font-bold" : "dt-surface"
              }`}
              onClick={() => setThemeId(theme.id)}
            >
              {theme.name}
            </button>
          )}
        </For>
        <button
          class="dt-surface ml-2 rounded px-3 py-1"
          onClick={() => {
            const next = !soundOn();
            setSoundOn(next);
            setSoundEnabled(next);
          }}
        >
          sound: {soundOn() ? "on" : "off"}
        </button>
      </section>

      <section class="mb-6 flex flex-wrap gap-2">
        <button
          class={`rounded px-3 py-1 ${mode() === "time" ? "dt-accent-bg font-bold" : "dt-surface"}`}
          onClick={() => {
            setMode("time");
            newTest();
          }}
        >
          time
        </button>
        <button
          class={`rounded px-3 py-1 ${mode() === "words" ? "dt-accent-bg font-bold" : "dt-surface"}`}
          onClick={() => {
            setMode("words");
            newTest();
          }}
        >
          words
        </button>
        <Show when={mode() === "time"}>
          <For each={[15, 30, 60, 120]}>
            {(n) => (
              <button
                class={`rounded px-3 py-1 ${timeLimit() === n ? "dt-accent-bg font-bold" : "dt-surface"}`}
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
                class={`rounded px-3 py-1 ${wordCount() === n ? "dt-accent-bg font-bold" : "dt-surface"}`}
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
      </section>

      <Show when={!finished()}>
        <section class="dt-accent-text mb-4 text-xl">
          <Show when={mode() === "time"}>{timeLeft()}s</Show>
          <Show when={mode() === "words"}>
            {wordIndex() + 1} / {words().length}
          </Show>
        </section>

        {/* Live stats: WPM once per second (timer tick), accuracy per
            keystroke (derived from the running counters on every render). */}
        <section class="dt-surface mb-4 flex gap-8 rounded px-4 py-2">
          <div>
            <span class="dt-accent-text text-2xl">{liveWpmValue()}</span>
            <span class="dt-muted ml-2 text-sm">live wpm</span>
          </div>
          <div>
            <span class="text-2xl">
              {liveAccuracy(currentCounters().correct, currentCounters().incorrect)}%
            </span>
            <span class="dt-muted ml-2 text-sm">live accuracy</span>
          </div>
          <div>
            <span class="text-2xl">{liveElapsed()}s</span>
            <span class="dt-muted ml-2 text-sm">elapsed</span>
          </div>
        </section>

        <section
          class="dt-surface mb-4 rounded p-6 text-lg leading-relaxed sm:text-xl md:text-2xl"
          onClick={() => inputEl?.focus()}
        >
          <Show when={!focused()}>
            <p
              class="dt-error-text mb-4 cursor-pointer text-base"
              onClick={() => inputEl?.focus()}
            >
              Click here or press any key to focus
            </p>
          </Show>
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
                          <Show when={isCurrent && !done && ci() === input().length}>
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
        </section>

        <input
          ref={inputEl}
          class="dt-input w-full rounded border px-4 py-3 text-lg outline-none sm:text-xl"
          value={input()}
          placeholder="Type here, press space after each word…"
          onInput={(e) => onInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <p class="dt-muted mt-2 text-sm">
          Tip: click the words or press any key to focus. Space moves to the
          next word, Backspace on an empty word goes back, Esc restarts.
        </p>
      </Show>

      <Show when={finished() && results()}>
        {(stats) => (
          <section class="dt-surface dt-fade-in rounded p-6">
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
                  {stats().correctChars}/{stats().correctChars + stats().incorrectChars}
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
    </main>
  );
}
