import { init, use } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  LineChart,
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

const chart = init(document.getElementById("chart"));
const chartLoading = document.getElementById("chart-loading");

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

function parseAnnotations(wikitext) {
  const afterHeading = wikitext.split(ANNOTATIONS_HEADING)[1];
  if (!afterHeading) return [];

  const sectionText = afterHeading.split(ANY_HEADING)[0];
  const annotations = [];

  for (const line of sectionText.split("\n")) {
    const match = line.match(ANNOTATION_LINE);
    if (!match) continue;

    const { dateOrRevision, text } = match.groups;
    const safeText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

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
  return {
    name: "__annotations",
    type: "line",
    data: [],
    markLine: {
      silent: true,
      symbol: "none",
      animation: false,
      lineStyle: { color: "#fa6e16", type: "dashed", width: 1 },
      label: { show: false },
      data: annotations.map((a) => ({ xAxis: a.point.d })),
    },
  };
}

function renderChart(data) {
  const latest = data[data.length - 1];
  const sortedKeys = Object.keys(FIELDS).sort((a, b) => latest[b] - latest[a]);

  const annotations = resolveAnnotations(data);
  const notesByRev = new Map();
  for (const a of annotations) {
    if (!notesByRev.has(a.point.r)) notesByRev.set(a.point.r, []);
    notesByRev.get(a.point.r).push(a.text);
  }

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
        const notes = (notesByRev.get(data[index].r) ?? [])
          .map((text) => `<div class="tooltip-note">Note: ${text}</div>`)
          .join("");
        return `${notes}<strong>${timestamp} UTC</strong><br>${values}`;
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
    grid: { top: 42, right: 18, bottom: 28, left: 44 },
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
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: "#8b8f99", fontSize: 11 },
      splitLine: { lineStyle: { color: "#1e222a" } },
    },
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
