import * as echarts from "echarts";

const FIELDS = {
  c: "#facc15",
  t: "#c084fc",
  u: "#f97316",
  i: "#22d3ee",
};
const FIELD_LABELS = {
  c: "Completed",
  t: "To do",
  u: "Unnecessary",
  i: "In progress",
};
const INCREASE_IS_POSITIVE = new Set(["c", "u"]);
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

const pageUrl = new URL(window.location.href);
if (!pageUrl.pathname.endsWith("/")) pageUrl.pathname += "/";

fetch(new URL("data.json", pageUrl))
  .then((r) =>
    r.ok ? r.json() : Promise.reject(new Error(`load failed (${r.status})`)),
  )
  .then((data) => {
    const chart = echarts.init(document.getElementById("chart"));
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
          const timestamp = timestampFormat.format(
            new Date(params[0].axisValue),
          );
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
          hideOverlap: false,
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

    window.addEventListener("resize", () => chart.resize());
  })
  .catch((e) => (document.getElementById("status").textContent = e.message));
