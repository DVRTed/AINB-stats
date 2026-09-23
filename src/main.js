import { init, use } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const FIELDS = {
  c: "#facc15",
  t: "#c084fc",
  u: "#f97316",
  i: "#22d3ee",
  tg: "#4ade80",
};
const FIELD_LABELS = {
  c: "Completed",
  t: "To do",
  u: "Unnecessary",
  i: "In progress",
  tg: "Tagged",
};
const INCREASE_IS_POSITIVE = new Set(["c", "u", "tg"]);
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

function renderChart(data) {
  chart.setOption({
    useUTC: true,
    animationDuration: 500,
    color: Object.values(FIELDS),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      backgroundColor: "#171a22",
      borderColor: "#394151",
      textStyle: { color: "#f5f7fb" },
      formatter: (params) => {
        const timestamp = timestampFormat.format(new Date(params[0].axisValue));
        const values = params
          .map((item) => {
            const key = Object.keys(FIELDS).find(
              (field) => FIELD_LABELS[field] === item.seriesName,
            );
            const index = item.dataIndex;
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
    series: Object.entries(FIELDS).map(([key]) => ({
      name: FIELD_LABELS[key],
      type: "line",
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
      data: data.map((p) => [p.d, p[key]]),
    })),
  });
}

fetchData()
  .then((data) => {
    if (!data.length) throw new Error("No valid revisions were found");
    renderChart(data);
  })
  .catch((error) => {
    console.error("Could not load revision history:", error);
  })
  .finally(() => {
    chartLoading.remove();
  });

window.addEventListener("resize", () => chart.resize());
