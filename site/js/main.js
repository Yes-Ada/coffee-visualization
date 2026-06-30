const DATA_PATHS = {
  samples: "./data/coffee_samples_final.json",
  countries: "./data/country_summary_final.json",
  regions: "./data/region_summary_final.json",
  distribution: "./data/focus_country_score_distribution.json",
  cupping: "./data/cupping_score_profile.json",
  flavor: "./data/high_score_flavor_lift.json",
  originFlavor: "./data/focus_country_flavor_matrix.json",
  price: "./data/price_rating_samples.json",
};

const COLORS = {
  ink: "#24211d",
  muted: "#6f675f",
  line: "#ded2c1",
  coffee: "#5a3726",
  copper: "#b76e3b",
  leaf: "#466d56",
  berry: "#9b3d57",
  blue: "#2f6f8e",
  gold: "#d8a24a",
  pale: "#f1e4d2",
};

const selected = {
  country: "Panama",
  sortMetric: "avg_rating",
};

const tooltip = document.querySelector("#tooltip");

function fmtNumber(value, digits = 2) {
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtPercent(value) {
  return `${fmtNumber(Number(value) * 100, 1)}%`;
}

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  if (tooltip.hidden) return;
  const pad = 18;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + pad;
  let top = event.clientY + pad;
  if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - pad;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function clearSvg(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function setSvgViewBox(svg) {
  const width = Math.max(320, Math.round(svg.clientWidth || svg.parentElement.clientWidth || 800));
  const height = Math.max(320, Math.round(svg.clientHeight || 420));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height };
}

function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16));
}

function mixColor(lightHex, darkHex, amount) {
  const t = Math.max(0, Math.min(1, amount));
  const light = hexToRgb(lightHex);
  const dark = hexToRgb(darkHex);
  const rgb = light.map((channel, index) => Math.round(channel + (dark[index] - channel) * t));
  return `rgb(${rgb.join(",")})`;
}

function quantile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.min(lower + 1, sorted.length - 1);
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function metricLabel(metric) {
  return {
    avg_rating: "平均评分",
    share_94plus: "94+ 占比",
    sample_size: "样本量",
    median_price_100g_usd: "价格中位数",
  }[metric];
}

function metricValue(row, metric) {
  if (metric === "share_94plus") return fmtPercent(row[metric]);
  if (metric === "median_price_100g_usd") return `$${fmtNumber(row[metric], 2)}`;
  if (metric === "sample_size") return `${row[metric]} 条`;
  return fmtNumber(row[metric], 2);
}

function countryColor(country) {
  const palette = {
    Panama: COLORS.copper,
    Kenya: COLORS.berry,
    Ethiopia: COLORS.leaf,
    Colombia: COLORS.blue,
    Guatemala: COLORS.gold,
    Yemen: "#8c6f3f",
    "United States": "#7f5a44",
    Nicaragua: "#6f8a64",
    "Costa Rica": "#2f7f78",
    Indonesia: "#9a5c86",
    "Democratic Republic Of The Congo": "#7d6f9b",
    "El Salvador": "#b9833f",
    Burundi: "#6e6f4a",
    Peru: "#a85f4d",
    Rwanda: "#4f7890",
    Brazil: "#8d7a3f",
    Mexico: "#9b4e58",
    China: "#7b6aa4",
  };
  return palette[country] || COLORS.coffee;
}

function rankingColor(value, min, max) {
  const t = (value - min) / (max - min || 1);
  return mixColor("#e7d3bf", "#7b3f28", 0.28 + t * 0.72);
}

function flavorColor(tag, ratio) {
  const palette = {
    花香: ["#efe4d8", "#8a5a78"],
    柑橘: ["#f3e5c9", "#c87b28"],
    浆果: ["#f0d6dc", "#96364f"],
    热带水果: ["#f2e0b8", "#c39524"],
    巧克力可可: ["#e5d4c9", "#6d442f"],
    坚果: ["#e8ddc9", "#8d7441"],
  };
  const [light, dark] = palette[tag] || ["#f1e4d2", "#5a3726"];
  return mixColor(light, dark, 0.12 + ratio * 0.88);
}

function splitFlavorLabel(label) {
  return {
    热带水果: ["热带", "水果"],
    巧克力可可: ["巧克力", "可可"],
  }[label] || [label];
}

function initStats(data) {
  const high = data.samples.filter((row) => row.high_score_94plus).length;
  const prices = data.samples.map((row) => row.price_100g_usd).sort((a, b) => a - b);
  const medianPrice = prices[Math.floor(prices.length / 2)];
  document.querySelector("#statSamples").textContent = data.samples.length.toLocaleString("zh-CN");
  document.querySelector("#statCountries").textContent = data.countries.length;
  document.querySelector("#statHigh").textContent = high.toLocaleString("zh-CN");
  document.querySelector("#statPrice").textContent = `$${fmtNumber(medianPrice, 2)}`;
}

function renderOverview(data) {
  const svg = document.querySelector("#overviewChart");
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const compact = width < 720;
  const margin = {
    top: 58,
    right: compact ? 30 : 150,
    bottom: compact ? 104 : 76,
    left: 78,
  };
  const rows = data.countries.filter(
    (row) =>
      row.keep_for_ranking &&
      Number.isFinite(row.avg_rating) &&
      Number.isFinite(row.share_94plus) &&
      Number.isFinite(row.sample_size) &&
      Number.isFinite(row.median_price_100g_usd),
  );
  if (!rows.length) return;

  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;
  const xValues = rows.map((row) => row.avg_rating);
  const yValues = rows.map((row) => row.share_94plus);
  const sampleValues = rows.map((row) => row.sample_size);
  const priceValues = rows.map((row) => row.median_price_100g_usd);
  const xMin = Math.floor((Math.min(...xValues) - 0.15) * 10) / 10;
  const xMax = Math.ceil((Math.max(...xValues) + 0.15) * 10) / 10;
  const yMax = Math.min(1, Math.max(0.8, Math.ceil((Math.max(...yValues) + 0.08) * 10) / 10));
  const maxSample = Math.max(...sampleValues);
  const priceLow = quantile(priceValues, 0.05);
  const priceHigh = quantile(priceValues, 0.95);
  const avgScore = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const avgHighShare = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  const x = scaleLinear(xMin, xMax, plotLeft, plotRight);
  const y = scaleLinear(0, yMax, plotBottom, plotTop);
  const radius = (value) => 6 + Math.sqrt(value / maxSample) * 24;
  const priceColor = (value) => {
    const capped = Math.max(priceLow, Math.min(priceHigh, value));
    const t = (capped - priceLow) / (priceHigh - priceLow || 1);
    return mixColor("#ead9c9", "#60402e", 0.16 + t * 0.84);
  };

  svg.appendChild(
    svgEl("rect", {
      x: plotLeft,
      y: plotTop,
      width: plotRight - plotLeft,
      height: plotBottom - plotTop,
      fill: "rgba(255, 250, 242, 0.56)",
      stroke: COLORS.line,
    }),
  );

  const xStep = compact ? 1 : 0.5;
  for (let tick = Math.ceil(xMin / xStep) * xStep; tick <= xMax + 0.001; tick += xStep) {
    const gx = x(tick);
    svg.appendChild(svgEl("line", { x1: gx, x2: gx, y1: plotTop, y2: plotBottom, class: "grid-line" }));
    const label = svgEl("text", {
      x: gx,
      y: plotBottom + 24,
      "text-anchor": "middle",
      class: "axis-text",
    });
    label.textContent = Number.isInteger(tick) ? tick : tick.toFixed(1);
    svg.appendChild(label);
  }

  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    if (tick > yMax + 0.001) return;
    const gy = y(tick);
    svg.appendChild(svgEl("line", { x1: plotLeft, x2: plotRight, y1: gy, y2: gy, class: "grid-line" }));
    const label = svgEl("text", {
      x: plotLeft - 12,
      y: gy + 4,
      "text-anchor": "end",
      class: "axis-text",
    });
    label.textContent = `${Math.round(tick * 100)}%`;
    svg.appendChild(label);
  });

  svg.appendChild(
    svgEl("line", {
      x1: x(avgScore),
      x2: x(avgScore),
      y1: plotTop,
      y2: plotBottom,
      stroke: COLORS.line,
      "stroke-width": 1.4,
      "stroke-dasharray": "5 6",
    }),
  );
  svg.appendChild(
    svgEl("line", {
      x1: plotLeft,
      x2: plotRight,
      y1: y(avgHighShare),
      y2: y(avgHighShare),
      stroke: COLORS.line,
      "stroke-width": 1.4,
      "stroke-dasharray": "5 6",
    }),
  );

  const cue = svgEl("text", { x: plotLeft, y: 24, class: "legend-text" });
  cue.textContent = compact ? "右上角表示评分与高分密度同时较高。" : "读图重点：越靠右且越靠上，说明平均分与高分密度同时更突出。";
  svg.appendChild(cue);

  rows
    .slice()
    .sort((a, b) => b.sample_size - a.sample_size)
    .forEach((row) => {
      const isSelected = row.origin_country_norm === selected.country;
      const dot = svgEl("circle", {
        cx: x(row.avg_rating),
        cy: y(row.share_94plus),
        r: radius(row.sample_size),
        fill: priceColor(row.median_price_100g_usd),
        "fill-opacity": isSelected ? 0.92 : 0.74,
        stroke: isSelected ? COLORS.ink : "#fffaf2",
        "stroke-width": isSelected ? 3 : 1.4,
        class: "overview-dot",
      });
      dot.addEventListener("mouseenter", (event) => {
        showTooltip(
          event,
          `<strong>${row.origin_country_cn}</strong><br>平均分：${fmtNumber(row.avg_rating, 2)}<br>94+ 占比：${fmtPercent(
            row.share_94plus,
          )}<br>样本量：${row.sample_size} 条<br>价格中位数：$${fmtNumber(row.median_price_100g_usd, 2)}`,
        );
      });
      dot.addEventListener("mousemove", moveTooltip);
      dot.addEventListener("mouseleave", hideTooltip);
      dot.addEventListener("click", () => {
        selected.country = row.origin_country_norm;
        renderAll(data);
      });
      svg.appendChild(dot);
    });

  const labelCountries = new Set(["Panama", "Kenya", "Ethiopia", "Colombia", "Guatemala", selected.country]);
  rows
    .filter((row) => labelCountries.has(row.origin_country_norm))
    .forEach((row) => {
      const px = x(row.avg_rating);
      const py = y(row.share_94plus);
      const r = radius(row.sample_size);
      const isNearRight = px > plotRight - 118;
      const label = svgEl("text", {
        x: isNearRight ? px - r - 8 : px + r + 8,
        y: Math.max(plotTop + 14, py - r * 0.3),
        "text-anchor": isNearRight ? "end" : "start",
        fill: COLORS.ink,
        stroke: "#fffaf2",
        "stroke-width": 4,
        "paint-order": "stroke",
        "font-size": compact ? 11 : 12,
        "font-weight": 700,
      });
      label.textContent = row.origin_country_cn;
      svg.appendChild(label);
    });

  const xAxis = svgEl("text", {
    x: (plotLeft + plotRight) / 2,
    y: height - (compact ? 64 : 28),
    "text-anchor": "middle",
    class: "axis-text",
  });
  xAxis.textContent = "平均分（越靠右越高）";
  svg.appendChild(xAxis);

  const yAxis = svgEl("text", {
    x: 18,
    y: (plotTop + plotBottom) / 2,
    transform: `rotate(-90 18 ${(plotTop + plotBottom) / 2})`,
    "text-anchor": "middle",
    class: "axis-text",
  });
  yAxis.textContent = "94+ 占比（越靠上越高）";
  svg.appendChild(yAxis);

  const avgLabel = svgEl("text", { x: x(avgScore) + 8, y: plotTop + 16, class: "legend-text" });
  avgLabel.textContent = "主排名均值";
  svg.appendChild(avgLabel);

  const legendX = compact ? plotLeft : plotRight + 26;
  const legendY = compact ? height - 48 : plotTop + 8;
  const legendTitle = svgEl("text", { x: legendX, y: legendY, class: "chart-title" });
  legendTitle.textContent = compact ? "图例：大小=样本量，深浅=价格" : "图例";
  svg.appendChild(legendTitle);

  if (compact) {
    [
      [8, "样本少"],
      [17, "样本多"],
    ].forEach(([r, label], index) => {
      const cx = legendX + 18 + index * 86;
      svg.appendChild(svgEl("circle", { cx, cy: legendY + 28, r, fill: "#8d614b", "fill-opacity": 0.62 }));
      const text = svgEl("text", { x: cx + r + 8, y: legendY + 32, class: "legend-text" });
      text.textContent = label;
      svg.appendChild(text);
    });
  } else {
    const sizeTitle = svgEl("text", { x: legendX, y: legendY + 30, class: "legend-text" });
    sizeTitle.textContent = "气泡越大：样本量越多";
    svg.appendChild(sizeTitle);
    [
      [8, "少"],
      [18, "多"],
    ].forEach(([r, label], index) => {
      const cy = legendY + 56 + index * 46;
      svg.appendChild(svgEl("circle", { cx: legendX + 18, cy, r, fill: "#8d614b", "fill-opacity": 0.62 }));
      const text = svgEl("text", { x: legendX + 48, y: cy + 4, class: "legend-text" });
      text.textContent = label;
      svg.appendChild(text);
    });

    const colorTitle = svgEl("text", { x: legendX, y: legendY + 156, class: "legend-text" });
    colorTitle.textContent = "颜色越深：价格中位数越高";
    svg.appendChild(colorTitle);
    ["#ead9c9", "#a9785d", "#60402e"].forEach((color, index) => {
      svg.appendChild(
        svgEl("rect", {
          x: legendX + index * 28,
          y: legendY + 170,
          width: 24,
          height: 14,
          fill: color,
          stroke: "#fffaf2",
        }),
      );
    });
    const low = svgEl("text", { x: legendX, y: legendY + 202, class: "legend-text" });
    low.textContent = "低";
    svg.appendChild(low);
    const high = svgEl("text", { x: legendX + 58, y: legendY + 202, class: "legend-text" });
    high.textContent = "高";
    svg.appendChild(high);
  }
}

function renderRanking(data) {
  const svg = document.querySelector("#rankingChart");
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const margin = { top: 24, right: 92, bottom: 36, left: 142 };
  const rows = data.countries
    .filter((row) => row.keep_for_ranking)
    .slice()
    .sort((a, b) => b[selected.sortMetric] - a[selected.sortMetric])
    .slice(0, 12);

  const values = rows.map((row) => row[selected.sortMetric]);
  const domainMin = Math.min(...values);
  const domainMax = Math.max(...values);
  const min = selected.sortMetric === "avg_rating" ? domainMin - 0.2 : 0;
  const max = domainMax * 1.04;
  const x = scaleLinear(min, max, margin.left, width - margin.right);
  const rowH = (height - margin.top - margin.bottom) / rows.length;

  rows.forEach((row, index) => {
    const y = margin.top + index * rowH + 6;
    const barX = x(Math.max(min, 0));
    const barW = Math.max(2, x(row[selected.sortMetric]) - barX);
    const color = rankingColor(row[selected.sortMetric], domainMin, domainMax);

    const label = svgEl("text", { x: margin.left - 12, y: y + rowH * 0.52, "text-anchor": "end", class: "axis-text" });
    label.textContent = row.origin_country_cn;
    svg.appendChild(label);

    const bar = svgEl("rect", {
      x: barX,
      y,
      width: barW,
      height: Math.max(14, rowH - 10),
      fill: color,
      stroke: selected.country === row.origin_country_norm ? COLORS.ink : "none",
      "stroke-width": selected.country === row.origin_country_norm ? 2 : 0,
      class: "bar",
    });
    bar.addEventListener("mouseenter", (event) => {
      showTooltip(
        event,
        `<strong>${row.origin_country_cn}</strong><br>${metricLabel(selected.sortMetric)}：${metricValue(
          row,
          selected.sortMetric,
        )}<br>样本量：${row.sample_size} 条<br>94+ 占比：${fmtPercent(row.share_94plus)}`,
      );
    });
    bar.addEventListener("mousemove", moveTooltip);
    bar.addEventListener("mouseleave", hideTooltip);
    bar.addEventListener("click", () => {
      selected.country = row.origin_country_norm;
      renderAll(data);
    });
    svg.appendChild(bar);

    const value = svgEl("text", { x: barX + barW + 8, y: y + rowH * 0.52, class: "axis-text" });
    value.textContent = metricValue(row, selected.sortMetric);
    svg.appendChild(value);
  });

  const title = svgEl("text", { x: margin.left, y: height - 8, class: "axis-text" });
  title.textContent = `同一色系中颜色越深，当前指标越高。当前排序：${metricLabel(selected.sortMetric)}。`;
  svg.appendChild(title);
}

function renderDistribution(data) {
  const svg = document.querySelector("#distributionChart");
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const margin = { top: 34, right: 34, bottom: 38, left: 108 };
  const countries = ["Panama", "Kenya", "Ethiopia", "Colombia", "Guatemala"];
  const countryNames = {
    Panama: "巴拿马",
    Kenya: "肯尼亚",
    Ethiopia: "埃塞俄比亚",
    Colombia: "哥伦比亚",
    Guatemala: "危地马拉",
  };
  const x = scaleLinear(84, 98, margin.left, width - margin.right);
  const rowH = (height - margin.top - margin.bottom) / countries.length;

  [86, 88, 90, 92, 94, 96].forEach((tick) => {
    const gx = x(tick);
    svg.appendChild(svgEl("line", { x1: gx, x2: gx, y1: margin.top, y2: height - margin.bottom, class: "grid-line" }));
    const label = svgEl("text", { x: gx, y: height - 12, "text-anchor": "middle", class: "axis-text" });
    label.textContent = tick;
    svg.appendChild(label);
  });

  countries.forEach((country, idx) => {
    const cy = margin.top + idx * rowH + rowH / 2;
    const ratings = data.distribution
      .filter((row) => row.origin_country_norm === country)
      .map((row) => row.rating);
    const q1 = quantile(ratings, 0.25);
    const median = quantile(ratings, 0.5);
    const q3 = quantile(ratings, 0.75);

    svg.appendChild(
      svgEl("rect", {
        x: x(q1),
        y: cy - 12,
        width: Math.max(2, x(q3) - x(q1)),
        height: 24,
        fill: countryColor(country),
        "fill-opacity": 0.2,
        stroke: countryColor(country),
        "stroke-opacity": 0.52,
      }),
    );
    svg.appendChild(
      svgEl("line", {
        x1: x(median),
        x2: x(median),
        y1: cy - 17,
        y2: cy + 17,
        stroke: COLORS.ink,
        "stroke-width": 2,
      }),
    );
    svg.appendChild(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: cy, y2: cy, class: "axis" }));
    const label = svgEl("text", { x: margin.left - 14, y: cy + 4, "text-anchor": "end", class: "axis-text" });
    label.textContent = countryNames[country];
    svg.appendChild(label);
  });

  data.distribution.forEach((row, index) => {
    const countryIndex = countries.indexOf(row.origin_country_norm);
    if (countryIndex === -1) return;
    const jitter = ((index * 37) % 23) - 11;
    const cy = margin.top + countryIndex * rowH + rowH / 2 + jitter;
    const dot = svgEl("circle", {
      cx: x(row.rating),
      cy,
      r: selected.country === row.origin_country_norm ? 4.4 : 3,
      fill: countryColor(row.origin_country_norm),
      "fill-opacity": selected.country === row.origin_country_norm ? 0.82 : 0.42,
      class: "dot",
    });
    dot.addEventListener("mouseenter", (event) => {
      showTooltip(event, `<strong>${row.name}</strong><br>${row.roaster}<br>${row.origin_country_cn} · ${row.rating} 分`);
    });
    dot.addEventListener("mousemove", moveTooltip);
    dot.addEventListener("mouseleave", hideTooltip);
    dot.addEventListener("click", () => {
      selected.country = row.origin_country_norm;
      renderAll(data);
    });
    svg.appendChild(dot);
  });

  const legend = svgEl("text", { x: margin.left, y: 18, class: "legend-text" });
  legend.textContent = "浅色带表示 25%-75% 区间，深色竖线表示中位数，圆点表示单条测评。";
  svg.appendChild(legend);
}

function heatColor(value) {
  const t = Math.max(0, Math.min(1, value));
  const low = [241, 228, 210];
  const high = [90, 55, 38];
  const rgb = low.map((channel, i) => Math.round(channel + (high[i] - channel) * t));
  return `rgb(${rgb.join(",")})`;
}

function cuppingHeatColor(value, min, max) {
  const t = (value - min) / (max - min || 1);
  if (t < 0.5) {
    return mixColor("#edf0df", "#d8a24a", Math.max(0, t) * 2);
  }
  return mixColor("#d8a24a", "#7f4e35", Math.min(1, (t - 0.5) * 2));
}

function renderCuppingProfile(data) {
  const svg = document.querySelector("#cuppingChart");
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const rows = (data.cupping || []).slice().sort((a, b) => a.band_order - b.band_order);
  if (!rows.length) return;

  const compact = width < 650;
  const margin = {
    top: compact ? 76 : 82,
    right: compact ? 16 : 34,
    bottom: compact ? 82 : 76,
    left: compact ? 84 : 126,
  };
  const components = rows[0].components.map((component) => ({
    key: component.component,
    label: component.component_cn,
  }));
  const cells = rows.flatMap((row) =>
    row.components.map((component) => ({
      ...component,
      score_band: row.score_band,
      sample_size: row.sample_size,
      avg_rating: row.avg_rating,
    })),
  );
  const values = cells.map((cell) => cell.avg_score).filter((value) => value !== null);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const plotLeft = margin.left;
  const plotTop = margin.top;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colW = plotWidth / components.length;
  const rowH = plotHeight / rows.length;

  const intro = svgEl("text", { x: plotLeft, y: 24, class: "legend-text" });
  intro.textContent = compact
    ? "颜色越深，分项均值越高。"
    : "每个格子表示该评分段内某一杯测分项的均值；颜色越深，均值越高。";
  svg.appendChild(intro);

  components.forEach((component, index) => {
    const label = svgEl("text", {
      x: plotLeft + index * colW + colW / 2,
      y: margin.top - 24,
      "text-anchor": "middle",
      class: "axis-text",
    });
    label.textContent = component.label;
    svg.appendChild(label);
  });

  rows.forEach((row, rowIndex) => {
    const y = plotTop + rowIndex * rowH;
    const band = svgEl("text", {
      x: plotLeft - 14,
      y: y + rowH / 2 - 3,
      "text-anchor": "end",
      class: "axis-text",
      "font-weight": 700,
    });
    band.textContent = row.score_band;
    svg.appendChild(band);

    const count = svgEl("text", {
      x: plotLeft - 14,
      y: y + rowH / 2 + 15,
      "text-anchor": "end",
      class: "legend-text",
    });
    count.textContent = `n=${row.sample_size}`;
    svg.appendChild(count);

    row.components.forEach((cell, colIndex) => {
      const x = plotLeft + colIndex * colW;
      const value = cell.avg_score;
      const rect = svgEl("rect", {
        x: x + 4,
        y: y + 4,
        width: Math.max(16, colW - 8),
        height: Math.max(16, rowH - 8),
        fill: value === null ? COLORS.pale : cuppingHeatColor(value, minValue, maxValue),
        stroke: "#fffaf2",
        "stroke-width": 1,
        class: "cupping-cell",
      });
      rect.addEventListener("mouseenter", (event) => {
        showTooltip(
          event,
          `<strong>${row.score_band} · ${cell.component_cn}</strong><br>样本量：${row.sample_size} 条<br>平均总评分：${fmtNumber(
            row.avg_rating,
            2,
          )}<br>分项均值：${value === null ? "无数据" : fmtNumber(value, 2)}<br>较低分段：${
            cell.delta_from_low_band === null ? "无数据" : `+${fmtNumber(cell.delta_from_low_band, 2)}`
          }`,
        );
      });
      rect.addEventListener("mousemove", moveTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(rect);

      const text = svgEl("text", {
        x: x + colW / 2,
        y: y + rowH / 2 + 5,
        "text-anchor": "middle",
        fill: value !== null && value > 8.85 ? "#fff8ec" : COLORS.ink,
        "font-size": compact ? 11 : 13,
        "font-weight": 800,
        "pointer-events": "none",
      });
      text.textContent = value === null ? "--" : fmtNumber(value, 2);
      svg.appendChild(text);
    });
  });

  const legendX = plotLeft;
  const legendY = height - 36;
  const legend = svgEl("text", { x: legendX, y: legendY, class: "legend-text" });
  legend.textContent = "样本按总评分分段，分项均值来自匹配到的 Coffee Review 原始杯测字段。";
  svg.appendChild(legend);

  const swatchX = width - margin.right - 118;
  ["#edf0df", "#d8a24a", "#7f4e35"].forEach((color, index) => {
    svg.appendChild(
      svgEl("rect", {
        x: swatchX + index * 30,
        y: legendY - 12,
        width: 26,
        height: 12,
        fill: color,
        stroke: "#fffaf2",
      }),
    );
  });
}

function renderFlavor(data) {
  const svg = document.querySelector("#flavorChart");
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const compact = width < 680;
  const margin = { top: 54, right: compact ? 34 : 124, bottom: 48, left: compact ? 86 : 128 };
  const rows = (data.flavor || []).slice().sort((a, b) => b.difference - a.difference);
  if (!rows.length) return;

  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const plotTop = margin.top;
  const plotHeight = height - margin.top - margin.bottom;
  const rowH = plotHeight / rows.length;
  const x = scaleLinear(0, 0.9, plotLeft, plotRight);

  [0, 0.25, 0.5, 0.75].forEach((tick) => {
    const gx = x(tick);
    svg.appendChild(svgEl("line", { x1: gx, x2: gx, y1: margin.top - 10, y2: height - margin.bottom, class: "grid-line" }));
    const label = svgEl("text", { x: gx, y: height - 14, "text-anchor": "middle", class: "axis-text" });
    label.textContent = `${Math.round(tick * 100)}%`;
    svg.appendChild(label);
  });

  const intro = svgEl("text", { x: plotLeft, y: 22, class: "legend-text" });
  intro.textContent = "同一风味中，上方深色条为 94+ 样本，下方浅色条为非 94+ 样本。";
  svg.appendChild(intro);

  rows.forEach((row, index) => {
    const y = plotTop + index * rowH;
    const label = svgEl("text", {
      x: plotLeft - 14,
      y: y + rowH / 2 + 4,
      "text-anchor": "end",
      class: "axis-text",
      "font-weight": 700,
    });
    label.textContent = row.flavor_tag;
    svg.appendChild(label);

    const highY = y + rowH * 0.24;
    const nonHighY = y + rowH * 0.54;
    const barH = Math.max(8, rowH * 0.2);
    [
      {
        y: highY,
        ratio: row.high_ratio,
        hits: row.high_hits,
        total: row.high_sample_total,
        label: "94+ 样本",
        fill: mixColor("#f0d6dc", "#96364f", 0.78),
      },
      {
        y: nonHighY,
        ratio: row.non_high_ratio,
        hits: row.non_high_hits,
        total: row.non_high_sample_total,
        label: "非 94+ 样本",
        fill: "#d9c7b6",
      },
    ].forEach((bar) => {
      const rect = svgEl("rect", {
        x: plotLeft,
        y: bar.y,
        width: Math.max(2, x(bar.ratio) - plotLeft),
        height: barH,
        fill: bar.fill,
        class: "flavor-bar",
      });
      rect.addEventListener("mouseenter", (event) => {
        showTooltip(
          event,
          `<strong>${row.flavor_tag} · ${bar.label}</strong><br>出现率：${fmtPercent(bar.ratio)}<br>命中样本：${bar.hits}/${bar.total}<br>高分差值：${fmtPercent(row.difference)}`,
        );
      });
      rect.addEventListener("mousemove", moveTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(rect);

      const value = svgEl("text", {
        x: x(bar.ratio) + 8,
        y: bar.y + barH - 1,
        class: "axis-text",
      });
      value.textContent = fmtPercent(bar.ratio);
      svg.appendChild(value);
    });

    const diff = svgEl("text", {
      x: compact ? plotLeft : plotRight + 18,
      y: compact ? y + 12 : y + rowH / 2 + 4,
      class: "legend-text",
    });
    diff.textContent = `${row.difference >= 0 ? "+" : ""}${fmtPercent(row.difference)}`;
    svg.appendChild(diff);
  });

  const legend = svgEl("text", { x: plotLeft, y: height - 2, class: "legend-text" });
  legend.textContent = "差值为 94+ 样本出现率减去非 94+ 样本出现率，只表示评论关键词更常见。";
  svg.appendChild(legend);

  renderFlavorExamples(rows);
}

function renderFlavorExamples(rows) {
  const container = document.querySelector("#flavorExamples");
  const selectedRows = rows.filter((row) => row.difference > 0).slice(0, 3);
  container.innerHTML = selectedRows
    .map((row) => {
      const examples = row.examples
        .slice(0, 3)
        .map(
          (example) =>
            `<span>${example.name}，${example.rating} 分，${example.origin_country_cn}；关键词：${example.matched_keywords.join(" / ")}</span>`,
        )
        .join("");
      return `
        <article class="flavor-example-card">
          <strong>${row.flavor_tag}：高分组高出 ${fmtPercent(row.difference)}</strong>
          ${examples}
          <em>94+ 出现率 ${fmtPercent(row.high_ratio)}</em>
        </article>
      `;
    })
    .join("");
}

function renderOriginFlavorMatrix(data) {
  const svg = document.querySelector("#originFlavorChart");
  if (!svg) return;
  clearSvg(svg);
  const { width, height } = setSvgViewBox(svg);
  const rowsData = data.originFlavor || [];
  if (!rowsData.length) return;

  const compact = width < 700;
  const countries = Array.from(
    new Map(
      rowsData
        .slice()
        .sort((a, b) => a.country_order - b.country_order)
        .map((row) => [row.origin_country_norm, row]),
    ).values(),
  );
  const flavors = Array.from(
    new Map(
      rowsData
        .slice()
        .sort((a, b) => a.flavor_order - b.flavor_order)
        .map((row) => [row.flavor_tag, row]),
    ).values(),
  );
  const byKey = new Map(rowsData.map((row) => [`${row.origin_country_norm}|${row.flavor_tag}`, row]));
  const margin = {
    top: compact ? 92 : 98,
    right: compact ? 18 : 42,
    bottom: compact ? 86 : 74,
    left: compact ? 86 : 126,
  };
  const plotLeft = margin.left;
  const plotTop = margin.top;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colW = plotWidth / flavors.length;
  const rowH = plotHeight / countries.length;

  const intro = svgEl("text", { x: plotLeft, y: 24, class: "legend-text" });
  intro.textContent = compact
    ? "颜色越深，关键词出现率越高。"
    : "横向比较风味关键词，纵向比较重点产地；颜色越深，说明该类关键词在评论中出现得越多。";
  svg.appendChild(intro);

  flavors.forEach((flavor, index) => {
    const labelLines = splitFlavorLabel(flavor.flavor_tag);
    labelLines.forEach((line, lineIndex) => {
      const label = svgEl("text", {
        x: plotLeft + index * colW + colW / 2,
        y: margin.top - 38 + lineIndex * 16,
        "text-anchor": "middle",
        class: "axis-text",
        "font-weight": 700,
      });
      label.textContent = line;
      svg.appendChild(label);
    });
  });

  countries.forEach((country, rowIndex) => {
    const y = plotTop + rowIndex * rowH;
    const name = svgEl("text", {
      x: plotLeft - 14,
      y: y + rowH / 2 - 3,
      "text-anchor": "end",
      class: "axis-text",
      "font-weight": 800,
    });
    name.textContent = country.origin_country_cn;
    svg.appendChild(name);

    const count = svgEl("text", {
      x: plotLeft - 14,
      y: y + rowH / 2 + 15,
      "text-anchor": "end",
      class: "legend-text",
    });
    count.textContent = `n=${country.sample_total}`;
    svg.appendChild(count);

    flavors.forEach((flavor, colIndex) => {
      const x = plotLeft + colIndex * colW;
      const cell = byKey.get(`${country.origin_country_norm}|${flavor.flavor_tag}`);
      const ratio = cell ? cell.flavor_ratio : 0;
      const rect = svgEl("rect", {
        x: x + 5,
        y: y + 5,
        width: Math.max(18, colW - 10),
        height: Math.max(18, rowH - 10),
        fill: flavorColor(flavor.flavor_tag, ratio),
        stroke: "#fffaf2",
        "stroke-width": 1,
        class: "origin-flavor-cell",
      });
      rect.addEventListener("mouseenter", (event) => {
        showTooltip(
          event,
          `<strong>${country.origin_country_cn} · ${flavor.flavor_tag}</strong><br>出现率：${fmtPercent(
            ratio,
          )}<br>命中样本：${cell ? cell.sample_hits : 0}/${cell ? cell.sample_total : country.sample_total}`,
        );
      });
      rect.addEventListener("mousemove", moveTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(rect);

      const value = svgEl("text", {
        x: x + colW / 2,
        y: y + rowH / 2 + 5,
        "text-anchor": "middle",
        fill: ratio > 0.58 ? "#fff8ec" : COLORS.ink,
        "font-size": compact ? 10 : 12,
        "font-weight": 800,
        "pointer-events": "none",
      });
      value.textContent = `${Math.round(ratio * 100)}%`;
      svg.appendChild(value);
    });
  });

  const legendY = height - 34;
  const legend = svgEl("text", { x: plotLeft, y: legendY, class: "legend-text" });
  legend.textContent = "每个颜色只在同一风味内表达强弱，用来观察不同产地的风味侧重点。";
  svg.appendChild(legend);

  const swatchX = width - margin.right - 122;
  ["#f3e5c9", "#d8a24a", "#7f4e35"].forEach((color, index) => {
    svg.appendChild(
      svgEl("rect", {
        x: swatchX + index * 30,
        y: legendY - 13,
        width: 26,
        height: 12,
        fill: color,
        stroke: "#fffaf2",
      }),
    );
  });
  const low = svgEl("text", { x: swatchX, y: legendY + 18, class: "legend-text" });
  low.textContent = "低";
  svg.appendChild(low);
  const high = svgEl("text", { x: swatchX + 72, y: legendY + 18, class: "legend-text" });
  high.textContent = "高";
  svg.appendChild(high);
}

function renderPrice(data) {
  const canvas = document.querySelector("#priceChart");
  const panel = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, panel.clientWidth - 44);
  const height = Math.max(360, panel.clientHeight - 44);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const showOutliers = document.querySelector("#showOutliers").checked;
  const bins = [
    { label: "$0-5", min: 0, max: 5 },
    { label: "$5-10", min: 5, max: 10 },
    { label: "$10-15", min: 10, max: 15 },
    { label: "$15-20", min: 15, max: 20 },
    { label: "$20-30", min: 20, max: 30 },
    { label: "$30-50", min: 30, max: 50 },
  ];
  if (showOutliers) bins.push({ label: "$50+", min: 50, max: Infinity });

  const binStats = bins
    .map((bin) => {
      const rows = data.price.filter((row) => row.price_100g_usd >= bin.min && row.price_100g_usd < bin.max);
      const ratings = rows.map((row) => row.rating);
      const highCount = rows.filter((row) => row.rating >= 94).length;
      const sampleSize = rows.length;
      return {
        ...bin,
        rows,
        sampleSize,
        highCount,
        highShare: sampleSize ? highCount / sampleSize : 0,
        medianRating: sampleSize ? quantile(ratings, 0.5) : 0,
        avgRating: sampleSize ? ratings.reduce((sum, value) => sum + value, 0) / sampleSize : 0,
      };
    })
    .filter((bin) => bin.sampleSize > 0);

  const margin = { top: 44, right: 78, bottom: 76, left: 70 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const stepW = plotW / binStats.length;
  const xCenter = (index) => margin.left + stepW * index + stepW / 2;
  const xLeft = (index) => margin.left + stepW * index;
  const xRight = (index) => margin.left + stepW * (index + 1);
  const yShare = scaleLinear(0, 1, height - margin.bottom, margin.top);
  const yRating = scaleLinear(90, 95, height - margin.bottom, margin.top);

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillStyle = COLORS.muted;
  [0, 0.25, 0.5, 0.75, 1].forEach((tick) => {
    const gy = yShare(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left, gy);
    ctx.lineTo(width - margin.right, gy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(tick * 100)}%`, margin.left - 12, gy + 4);
  });
  [90, 91, 92, 93, 94, 95].forEach((tick) => {
    const gy = yRating(tick);
    ctx.beginPath();
    ctx.moveTo(width - margin.right, gy);
    ctx.lineTo(width - margin.right + 7, gy);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText(`${tick}`, width - margin.right + 12, gy + 4);
  });

  binStats.forEach((bin, index) => {
    const left = xLeft(index);
    ctx.fillStyle = index % 2 === 0 ? "rgba(255, 250, 242, 0.58)" : "rgba(241, 228, 210, 0.34)";
    ctx.fillRect(left, margin.top, stepW, plotH);
    ctx.strokeStyle = COLORS.line;
    ctx.beginPath();
    ctx.moveTo(left, margin.top);
    ctx.lineTo(left, height - margin.bottom);
    ctx.stroke();

    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "center";
    ctx.fillText(bin.label, xCenter(index), height - 44);
    ctx.fillText(`n=${bin.sampleSize}`, xCenter(index), height - 24);
  });

  ctx.strokeStyle = COLORS.copper;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  binStats.forEach((bin, index) => {
    const y = yShare(bin.highShare);
    if (index === 0) ctx.moveTo(xLeft(index), y);
    ctx.lineTo(xRight(index), y);
    if (index < binStats.length - 1) {
      ctx.lineTo(xRight(index), yShare(binStats[index + 1].highShare));
    }
  });
  ctx.stroke();

  ctx.fillStyle = COLORS.copper;
  ctx.textAlign = "center";
  ctx.font = "700 13px Microsoft YaHei, sans-serif";
  binStats.forEach((bin, index) => {
    const y = yShare(bin.highShare);
    ctx.beginPath();
    ctx.arc(xCenter(index), y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`${Math.round(bin.highShare * 100)}%`, xCenter(index), y - 12);
  });

  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  binStats.forEach((bin, index) => {
    const x = xCenter(index);
    const y = yRating(bin.medianRating);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = COLORS.blue;
  binStats.forEach((bin, index) => {
    ctx.beginPath();
    ctx.arc(xCenter(index), yRating(bin.medianRating), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.textAlign = "left";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    showOutliers
      ? "阶梯线表示各价格段的 94+ 占比；蓝线表示中位评分；已加入 $50+ 高价段。"
      : "阶梯线表示各价格段的 94+ 占比；蓝线表示中位评分；默认隐藏 $50+ 高价段。",
    margin.left,
    22,
  );

  ctx.fillStyle = COLORS.copper;
  ctx.fillRect(width - margin.right - 238, 16, 22, 4);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("94+ 占比", width - margin.right - 206, 21);
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(width - margin.right - 128, 16, 22, 4);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText("中位评分", width - margin.right - 96, 21);
  ctx.fillText("左轴：94+ 占比", margin.left, height - 6);
  ctx.fillText("右轴：中位评分", width - margin.right - 88, height - 6);

  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const hovered = binStats.find((bin, index) => mx >= xLeft(index) && mx <= xRight(index));
    if (hovered) {
      showTooltip(
        event,
        `<strong>${hovered.label}</strong><br>样本量：${hovered.sampleSize} 条<br>94+ 占比：${fmtPercent(
          hovered.highShare,
        )}<br>中位评分：${fmtNumber(hovered.medianRating, 1)}<br>平均评分：${fmtNumber(hovered.avgRating, 2)}`,
      );
    } else {
      hideTooltip();
    }
  };
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const hovered = binStats.find((bin, index) => mx >= xLeft(index) && mx <= xRight(index));
    if (!hovered) return;
    const topSamples = hovered.rows
      .slice()
      .sort((a, b) => b.rating - a.rating || b.price_100g_usd - a.price_100g_usd)
      .slice(0, 3)
      .map((row) => `${row.name}（${row.rating}分）`)
      .join("<br>");
    showTooltip(event, `<strong>${hovered.label} 高分样本</strong><br>${topSamples}`);
  };
  canvas.onmouseleave = hideTooltip;
}

function renderRegionNotes(data) {
  const container = document.querySelector("#regionNotes");
  const rankingCount = data.countries.filter((row) => row.keep_for_ranking).length;
  const outlierCount = data.price.filter((row) => row.is_price_outlier).length;
  container.innerHTML = `
    <div class="note-item">
      <strong>产地名称</strong>
      <span>同一来源的不同写法已合并。</span>
      <span>原始字段仍保留，方便回看。</span>
    </div>
    <div class="note-item">
      <strong>进入比较</strong>
      <span>样本量不少于 10 条的来源进入主排名。</span>
      <span>本页共有 ${rankingCount} 个来源参与比较。</span>
    </div>
    <div class="note-item">
      <strong>高价样本</strong>
      <span>超过 $50/100g 的样本单独标记。</span>
      <span>本页共有 ${outlierCount} 条。</span>
    </div>
    <div class="note-item">
      <strong>风味关键词</strong>
      <span>风味部分统计评论文本中的关键词。</span>
      <span>它反映描述倾向，不等同于完整杯测表。</span>
    </div>
  `;
}

function renderAll(data) {
  renderOverview(data);
  renderRanking(data);
  renderDistribution(data);
  renderCuppingProfile(data);
  renderFlavor(data);
  renderOriginFlavorMatrix(data);
  renderPrice(data);
}

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_PATHS).map(async ([key, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Failed to load ${path}`);
      return [key, await response.json()];
    }),
  );
  return Object.fromEntries(entries);
}

function bindControls(data) {
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-sort]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      selected.sortMetric = button.dataset.sort;
      renderRanking(data);
    });
  });

  document.querySelector("#showOutliers").addEventListener("change", () => renderPrice(data));
  window.addEventListener("resize", () => renderAll(data));
}

loadData()
  .then((data) => {
    initStats(data);
    renderRegionNotes(data);
    bindControls(data);
    renderAll(data);
  })
  .catch((error) => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div style="padding:16px;background:#7a2f2f;color:white">数据加载失败：${error.message}</div>`,
    );
  });
