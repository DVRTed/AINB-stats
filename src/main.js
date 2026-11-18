import { init, use } from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

const ANNOTATIONS_API_URL = "https://en.wikipedia.org/w/api.php";
const ANNOTATIONS_PAGE_TITLE = "User:DVRTed_bot/Annotations";

const ANNOTATIONS_HEADING = /^==\s*Annotations\s*==\s*$/m;
const ANY_HEADING = /^==[^=].*==\s*$/m;
const ANNOTATION_LINE =
  /^\*\s*(?<dateOrRevision>\d{4}-\d{2}-\d{2}|\d+)\s*:\s*(?<text>.+?)\s*$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const FIELDS = {
  c: "#22c55e",
  t: "#facc15",
  u: "#84cc16",
  i: "#a78bfa",
  tg: "#38bdf8",
};
const FIELD_LABELS = {
  c: "Completed",
  t: "To do",
  u: "Unnecessary",
  i: "In progress",
  tg: "Tagged",
};
const INCREASE_IS_POSITIVE = new Set(["c", "u", "tg"]);

// revisions to exclude from the chart
const SKIP_REVISIONS = new Set([
  1380028494, // AI noticeboard overhaul affected case page matching
]);

const ANNOTATIONS = [];

const numberFormat = new Intl.NumberFormat("en-US");
const timestampFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

const chartEl = document.getElementById("chart");
const chart = init(chartEl);
const chartLoading = document.getElementById("chart-loading");

const noteBar = document.createElement("div");
Object.assign(noteBar.style, {
  boxSizing: "border-box",
  height: "52px",
  marginTop: "6px",
  padding: "8px 14px",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  fontSize: "12px",
  lineHeight: "17px",
  color: "#b6bbc6",
  borderRadius: "8px",
  border: "1px solid transparent",
  background: "transparent",
  transition: "background 0.15s, border-color 0.15s",
});
chartEl.after(noteBar);

let notesByRev = new Map();
let numByRev = new Map();
let dateByRev = new Map();
const noteDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function showNote(texts, n, date) {
  const has = texts.length > 0;
  noteBar.innerHTML = has
    ? `<span><strong style="color:#f5f7fb">Note ${n}${date ? ` (${date})` : ""}:</strong> ${texts.join(" · ")}</span>`
    : "";
  noteBar.style.color = "#b6bbc6";
  noteBar.style.background = has ? "rgba(255,255,255,0.05)" : "transparent";
  noteBar.style.borderColor = has ? "rgba(255,255,255,0.08)" : "transparent";
}

function showHint() {
  noteBar.innerHTML =
    "<span>Hover or tap an annotation to read its note</span>";
  noteBar.style.color = "#6b7280";
  noteBar.style.background = "transparent";
  noteBar.style.borderColor = "transparent";
}
showNote([]);

const showFor = (e) => {
  const rev = e.data?.rev;
  showNote(notesByRev.get(rev) ?? [], numByRev.get(rev), dateByRev.get(rev));
};
chart.on("mouseover", { seriesName: "__annotations" }, showFor);
chart.on("click", { seriesName: "__annotations" }, showFor); // touch

async function fetchData() {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "revisions",
    titles: "User:DVRTed_bot/AINB-stats.json",
    rvdir: "newer",
    rvlimit: "max",
    rvprop: "ids|timestamp|content",
    rvslots: "main",
  });
  const data = [];
  let continuation;

  do {
    const query = new URLSearchParams(params);
    if (continuation) {
      for (const [key, value] of Object.entries(continuation))
        query.set(key, value);
    }

    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?${query.toString()}`,
    );
    if (!response.ok)
      throw new Error(`Wikipedia API returned ${response.status}`);

    const result = await response.json();
    const pages = Object.values(result.query?.pages ?? {});
    for (const revision of pages[0]?.revisions ?? []) {
      if (SKIP_REVISIONS.has(revision.revid)) continue;
      let json;
      try {
        json = JSON.parse(revision.slots.main["*"]);
      } catch {
        continue;
      }
      if (
        [
          "total_completed",
          "total_todo",
          "total_unnecessary",
          "total_in_progress",
        ].some((field) => typeof json[field] !== "number")
      )
        continue;

      data.push({
        d: revision.timestamp,
        r: revision.revid,
        c: json.total_completed,
        t: json.total_todo,
        u: json.total_unnecessary,
        i: json.total_in_progress,
        tg: typeof json.total_tagged === "number" ? json.total_tagged : 0,
      });
    }
    continuation = result.continue;
  } while (continuation);

  data.sort((a, b) => new Date(a.d) - new Date(b.d));
  return data;
}

const WIKILINK = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]*))?\]\]/g;

const escapeHtml = (str) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderAnnotationText(text) {
  let out = "";
  let last = 0;

  for (const m of text.matchAll(WIKILINK)) {
    const [page, ...rest] = m[1].trim().split("#");
    const pageName = page.trim();
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;

    if (!pageName) {
      out += escapeHtml(m[0]);
      continue;
    }

    const path = encodeURIComponent(pageName.replace(/ /g, "_"))
      .replace(/%3A/gi, ":")
      .replace(/%2F/gi, "/");
    const fragment = rest.join("#").trim();
    const hash = fragment
      ? "#" + encodeURIComponent(fragment.replace(/ /g, "_"))
      : "";
    const label = (m[2] ?? "").trim() || m[1].trim();

    out +=
      `<a href="https://en.wikipedia.org/wiki/${path}${hash}" target="_blank" rel="noopener noreferrer"` +
      ` style="color:#e5e7eb;text-decoration:underline;text-underline-offset:2px">${escapeHtml(label)}</a>`;
  }

  return out + escapeHtml(text.slice(last));
}

function parseAnnotations(wikitext) {
  const afterHeading = wikitext.split(ANNOTATIONS_HEADING)[1];
  if (!afterHeading) return [];

  const sectionText = afterHeading.split(ANY_HEADING)[0];
  const annotations = [];

  for (const line of sectionText.split("\n")) {
    const match = line.match(ANNOTATION_LINE);
    if (!match) continue;

    const { dateOrRevision, text } = match.groups;
    const safeText = renderAnnotationText(text);

    if (DATE_FORMAT.test(dateOrRevision)) {
      annotations.push({ date: dateOrRevision, text: safeText });
    } else {
      annotations.push({ rev: Number(dateOrRevision), text: safeText });
    }
  }
  return annotations;
}

async function fetchAnnotations() {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "revisions",
      titles: ANNOTATIONS_PAGE_TITLE,
      rvprop: "content",
      rvslots: "main",
    });

    const response = await fetch(`${ANNOTATIONS_API_URL}?${params}`);
    if (!response.ok)
      throw new Error(`Wikipedia API returned ${response.status}`);

    const result = await response.json();
    const page = Object.values(result.query?.pages ?? {})[0];
    const wikitext = page?.revisions?.[0]?.slots?.main?.["*"] ?? "";

    return parseAnnotations(wikitext);
  } catch (error) {
    console.error("Could not load annotations:", error);
    return [];
  }
}

function resolveAnnotations(data) {
  const first = new Date(data[0].d).getTime();
  const last = new Date(data[data.length - 1].d).getTime();
  const resolved = [];

  for (const a of ANNOTATIONS) {
    let point;
    if (a.rev !== undefined) {
      point = data.find((p) => p.r === a.rev);
    } else if (a.date) {
      const target = new Date(a.date).getTime();
      if (target < first || target > last) point = undefined;
      else {
        point = data.reduce((best, p) =>
          Math.abs(new Date(p.d) - target) < Math.abs(new Date(best.d) - target)
            ? p
            : best,
        );
      }
    }
    if (!point) {
      console.warn("Annotation skipped, no matching data point:", a);
      continue;
    }
    resolved.push({ ...a, point });
  }
  return resolved;
}

function buildAnnotationSeries(annotations) {
  const points = [
    ...new Map(annotations.map((a) => [a.point.r, a.point])).values(),
  ];
  return {
    name: "__annotations",
    type: "scatter",
    yAxisIndex: 1, // hidden 0..1 axis: y=1 is the top edge of the plot
    z: 10,
    clip: false,
    symbol: "circle",
    symbolSize: 18,
    itemStyle: { color: "#e5e7eb", borderColor: "#171a22", borderWidth: 2 },
    label: {
      show: true,
      position: "inside",
      color: "#171a22",
      fontSize: 10,
      fontWeight: "bold",
      formatter: (p) => p.data.n,
    },
    emphasis: {
      scale: 1.25,
      itemStyle: { color: "#ffffff" },
      label: { show: true },
    },
    tooltip: { show: false },
    data: points.map((p) => ({
      value: [p.d, 1],
      rev: p.r,
      n: numByRev.get(p.r),
    })),
    markLine: {
      silent: true,
      symbol: "none",
      animation: false,
      label: { show: false },
      lineStyle: { color: "#8b8f99", opacity: 0.25, type: "solid", width: 1 },
      data: points.map((p) => ({ xAxis: p.d })),
    },
  };
}

function renderChart(data) {
  const latest = data[data.length - 1];
  const sortedKeys = Object.keys(FIELDS).sort((a, b) => latest[b] - latest[a]);

  const annotations = resolveAnnotations(data);
  notesByRev = new Map();
  for (const a of annotations) {
    if (!notesByRev.has(a.point.r)) notesByRev.set(a.point.r, []);
    notesByRev.get(a.point.r).push(a.text);
  }
  numByRev = new Map();
  dateByRev = new Map();
  [...new Map(annotations.map((a) => [a.point.r, a.point])).values()]
    .sort((x, y) => new Date(x.d) - new Date(y.d))
    .forEach((p, i) => {
      numByRev.set(p.r, i + 1);
      dateByRev.set(p.r, noteDateFormat.format(new Date(p.d)));
    });
  if (numByRev.size) showHint();

  chart.setOption({
    useUTC: true,
    animationDuration: 500,
    color: sortedKeys.map((key) => FIELDS[key]),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      backgroundColor: "#171a22",
      borderColor: "#394151",
      textStyle: { color: "#f5f7fb" },
      formatter: (params) => {
        const lineParams = params.filter((item) =>
          Object.values(FIELD_LABELS).includes(item.seriesName),
        );
        if (!lineParams.length) return "";
        const timestamp = timestampFormat.format(
          new Date(lineParams[0].axisValue),
        );
        const index = lineParams[0].dataIndex;
        const values = lineParams
          .map((item) => {
            const key = Object.keys(FIELDS).find(
              (field) => FIELD_LABELS[field] === item.seriesName,
            );
            const change =
              index > 0 ? data[index][key] - data[index - 1][key] : null;
            const changeClass =
              change === null || change === 0
                ? "neutral"
                : change > 0 === INCREASE_IS_POSITIVE.has(key)
                  ? "positive"
                  : "negative";
            const changeText =
              change === null
                ? ""
                : ` <span class="tooltip-change ${changeClass}">(${change > 0 ? "+" : ""}${numberFormat.format(change)})</span>`;
            return `${item.marker}${item.seriesName}: <strong>${numberFormat.format(item.value[1])}</strong>${changeText}`;
          })
          .join("<br>");
        return `<strong>${timestamp} UTC</strong><br>${values}`;
      },
    },
    legend: {
      type: "scroll",
      selectedMode: "multiple",
      top: 0,
      left: 0,
      right: 0,
      itemWidth: 16,
      itemHeight: 4,
      itemGap: 14,
      inactiveColor: "#4c5361",
      textStyle: { color: "#b6bbc6", fontSize: 11 },
      data: sortedKeys.map((key) => FIELD_LABELS[key]),
      selected: Object.fromEntries(
        Object.keys(FIELDS).map((key) => [FIELD_LABELS[key], true]),
      ),
    },
    grid: { top: 48, right: 18, bottom: 28, left: 44 },
    xAxis: {
      type: "time",
      minInterval: 24 * 60 * 60 * 1000,
      maxInterval: 24 * 60 * 60 * 1000,
      axisLine: { lineStyle: { color: "#394151" } },
      axisLabel: {
        color: "#8b8f99",
        fontSize: 11,
        hideOverlap: true,
        formatter: (value) =>
          new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }).format(value),
      },
      splitLine: { lineStyle: { color: "#1e222a" } },
    },
    yAxis: [
      {
        type: "value",
        min: 0,
        axisLabel: { color: "#8b8f99", fontSize: 11 },
        splitLine: { lineStyle: { color: "#1e222a" } },
      },
      { type: "value", min: 0, max: 1, show: false },
    ],
    series: [
      ...sortedKeys.map((key) => ({
        name: FIELD_LABELS[key],
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        emphasis: { focus: "series" },
        data: data.map((p) => [p.d, p[key]]),
      })),
      buildAnnotationSeries(annotations),
    ],
  });
}

fetchData()
  .then(async (data) => {
    if (!data.length) throw new Error("No valid revisions were found");
    ANNOTATIONS.push(...(await fetchAnnotations()));
    renderChart(data);
  })
  .catch((error) => {
    console.error("Could not load revision history:", error);
  })
  .finally(() => {
    chartLoading.remove();
  });

window.addEventListener("resize", () => chart.resize());
