import csv
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
INPUT_CSV = BASE_DIR / "simplified_coffee_cleaned.csv"
MAP_SOURCE_CSV = BASE_DIR / "flourish_projection_map_n10_world_cn_banded.csv"
CUPPING_SOURCE_ZIP = BASE_DIR / "原始数据" / "coffee_df_with_type_and_region.csv.zip"
OUTPUT_DIR = BASE_DIR / "site" / "data"

RANKING_MIN_SAMPLE_SIZE = 10
PRICE_OUTLIER_THRESHOLD = 50.0

FOCUS_COUNTRIES = [
    ("Panama", "巴拿马"),
    ("Kenya", "肯尼亚"),
    ("Ethiopia", "埃塞俄比亚"),
    ("Colombia", "哥伦比亚"),
    ("Guatemala", "危地马拉"),
]
FOCUS_COUNTRY_ORDER = {country: idx for idx, (country, _cn) in enumerate(FOCUS_COUNTRIES)}

CUPPING_COMPONENTS = [
    ("aroma", "香气"),
    ("acid", "酸度"),
    ("body", "醇厚度"),
    ("flavor", "风味"),
    ("aftertaste", "余韵"),
]

SCORE_BANDS = [
    ("92及以下", 0),
    ("93", 1),
    ("94", 2),
    ("95+", 3),
]

COUNTRY_CN = {
    "Australia": "澳大利亚",
    "Bolivia": "玻利维亚",
    "Brazil": "巴西",
    "Burundi": "布隆迪",
    "Canada": "加拿大",
    "China": "中国",
    "Colombia": "哥伦比亚",
    "Costa Rica": "哥斯达黎加",
    "Democratic Republic Of The Congo": "刚果（金）",
    "Dominican Republic": "多米尼加",
    "Ecuador": "厄瓜多尔",
    "El Salvador": "萨尔瓦多",
    "England": "英格兰",
    "Ethiopia": "埃塞俄比亚",
    "Guatemala": "危地马拉",
    "Honduras": "洪都拉斯",
    "Hong Kong": "中国香港",
    "Indonesia": "印度尼西亚",
    "Japan": "日本",
    "Kenya": "肯尼亚",
    "Mexico": "墨西哥",
    "Nepal": "尼泊尔",
    "Nicaragua": "尼加拉瓜",
    "Panama": "巴拿马",
    "Peru": "秘鲁",
    "Philippines": "菲律宾",
    "Rwanda": "卢旺达",
    "Taiwan": "中国台湾",
    "Tanzania": "坦桑尼亚",
    "Thailand": "泰国",
    "Uganda": "乌干达",
    "United Kingdom": "英国",
    "United States": "美国",
    "Yemen": "也门",
}

REGION_CN = {
    "Hawaii": "夏威夷",
    "Hong Kong": "香港",
    "Taiwan": "台湾",
    "England": "英格兰",
}

COUNTRY_FIXES = {
    "Hawai'I": "Hawaii",
    "Hawai'i": "Hawaii",
    "New Taiwan": "Taiwan",
}

GEO_RULES = {
    "Hawaii": {
        "country": "United States",
        "region": "Hawaii",
        "display_cn": "美国夏威夷",
    },
    "Taiwan": {
        "country": "China",
        "region": "Taiwan",
        "display_cn": "中国台湾",
    },
    "Hong Kong": {
        "country": "China",
        "region": "Hong Kong",
        "display_cn": "中国香港",
    },
    "England": {
        "country": "United Kingdom",
        "region": "England",
        "display_cn": "英国英格兰",
    },
}

FLAVOR_GROUPS = [
    (
        "花香",
        [
            "jasmine",
            "flowers",
            "floral",
            "lavender",
            "honeysuckle",
            "lilac",
            "magnolia",
            "narcissus",
            "freesia",
            "hibiscus",
            "rose",
            "gardenia",
            "violet",
            "musk",
        ],
    ),
    (
        "柑橘",
        [
            "lemon",
            "orange",
            "bergamot",
            "tangerine",
            "grapefruit",
            "citrus",
            "mandarin",
            "pomelo",
            "zest",
            "kumquat",
        ],
    ),
    (
        "浆果",
        [
            "currant",
            "raspberry",
            "cherry",
            "blueberry",
            "blackberry",
            "strawberry",
            "cranberry",
            "berry",
        ],
    ),
    (
        "热带水果",
        [
            "mango",
            "pineapple",
            "guava",
            "papaya",
            "passion",
            "melon",
            "apricot",
            "peach",
            "pear",
            "lychee",
            "date",
        ],
    ),
    ("巧克力可可", ["chocolate", "cocoa", "chocolaty", "cacao"]),
    ("坚果", ["almond", "hazelnut", "pistachio", "walnut", "cashew", "pecan", "nut"]),
]


def normalize_place_name(value: str) -> str:
    value = " ".join((value or "").strip().split())
    return COUNTRY_FIXES.get(value, value)


def normalize_geo(value: str) -> dict:
    normalized = normalize_place_name(value)
    rule = GEO_RULES.get(normalized)
    if rule:
        country = rule["country"]
        region = rule["region"]
        return {
            "country": country,
            "country_cn": COUNTRY_CN.get(country, country),
            "region": region,
            "region_cn": REGION_CN.get(region, region),
            "display_cn": rule["display_cn"],
        }

    return {
        "country": normalized,
        "country_cn": COUNTRY_CN.get(normalized, normalized),
        "region": "",
        "region_cn": "",
        "display_cn": COUNTRY_CN.get(normalized, normalized),
    }


def parse_number(value: str) -> float:
    return float((value or "").strip())


def parse_optional_number(value: str) -> float | None:
    text = (value or "").strip()
    if not text or text.upper() == "NA":
        return None
    return float(text)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    ordered = sorted(values)
    pos = (len(ordered) - 1) * p
    lower = int(pos)
    upper = min(lower + 1, len(ordered) - 1)
    weight = pos - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def round2(value: float) -> float:
    return round(float(value), 2)


def round4(value: float) -> float:
    return round(float(value), 4)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def read_zip_csv(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as archive:
        csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not csv_names:
            return []
        with archive.open(csv_names[0]) as raw_file:
            rows = (line.decode("utf-8-sig", errors="replace") for line in raw_file)
            return list(csv.DictReader(rows))


def write_json(path: Path, data: list[dict] | dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stats_for_rows(rows: list[dict]) -> dict:
    ratings = [row["rating"] for row in rows]
    prices = [row["price_100g_usd"] for row in rows]
    count_94plus = sum(1 for row in rows if row["rating"] >= 94)
    count_95plus = sum(1 for row in rows if row["rating"] >= 95)
    sample_size = len(rows)
    return {
        "sample_size": sample_size,
        "min_rating": round2(min(ratings)),
        "q1_rating": round2(percentile(ratings, 0.25)),
        "median_rating": round2(percentile(ratings, 0.50)),
        "q3_rating": round2(percentile(ratings, 0.75)),
        "max_rating": round2(max(ratings)),
        "avg_rating": round2(sum(ratings) / sample_size),
        "median_price_100g_usd": round2(percentile(prices, 0.50)),
        "avg_price_100g_usd": round2(sum(prices) / sample_size),
        "q1_price_100g_usd": round2(percentile(prices, 0.25)),
        "q3_price_100g_usd": round2(percentile(prices, 0.75)),
        "count_94plus": count_94plus,
        "count_95plus": count_95plus,
        "share_94plus": round4(count_94plus / sample_size),
        "share_95plus": round4(count_95plus / sample_size),
    }


def enrich_rows(raw_rows: list[dict]) -> list[dict]:
    output = []
    for idx, row in enumerate(raw_rows, start=1):
        origin_geo = normalize_geo(row["origin_raw"])
        loc_geo = normalize_geo(row["loc_country"])
        rating = parse_number(row["rating"])
        price = parse_number(row["100g_USD"])
        output.append(
            {
                "id": idx,
                "name": row["name"],
                "roaster": row["roaster"],
                "roast": row["roast"],
                "loc_country": row["loc_country"],
                "loc_country_norm": loc_geo["country"],
                "loc_country_cn": loc_geo["country_cn"],
                "loc_region": loc_geo["region"],
                "loc_region_cn": loc_geo["region_cn"],
                "loc_display_cn": loc_geo["display_cn"],
                "origin_raw": row["origin_raw"],
                "origin_country_original": row["origin_country"],
                "origin_country_norm": origin_geo["country"],
                "origin_country_cn": origin_geo["country_cn"],
                "origin_region": origin_geo["region"],
                "origin_region_cn": origin_geo["region_cn"],
                "origin_display_cn": origin_geo["display_cn"],
                "price_100g_usd": round2(price),
                "rating": int(rating),
                "review_date": row["review_date"],
                "high_score_94plus": rating >= 94,
                "high_score_95plus": rating >= 95,
                "is_price_outlier": price > PRICE_OUTLIER_THRESHOLD,
                "review": row["review"],
            }
        )
    return output


def build_country_summary(rows: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["origin_country_norm"]].append(row)

    output = []
    for country, items in grouped.items():
        stats = stats_for_rows(items)
        output.append(
            {
                "origin_country_norm": country,
                "origin_country_cn": COUNTRY_CN.get(country, country),
                **stats,
                "keep_for_ranking": stats["sample_size"] >= RANKING_MIN_SAMPLE_SIZE,
            }
        )

    output.sort(
        key=lambda row: (
            row["keep_for_ranking"],
            row["avg_rating"],
            row["sample_size"],
            row["share_94plus"],
        ),
        reverse=True,
    )
    return output


def build_region_summary(rows: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in rows:
        if row["origin_region"]:
            key = (row["origin_country_norm"], row["origin_region"], row["origin_display_cn"])
            grouped[key].append(row)

    output = []
    for (country, region, display_cn), items in grouped.items():
        output.append(
            {
                "origin_country_norm": country,
                "origin_country_cn": COUNTRY_CN.get(country, country),
                "origin_region": region,
                "origin_region_cn": REGION_CN.get(region, region),
                "origin_display_cn": display_cn,
                **stats_for_rows(items),
            }
        )
    output.sort(key=lambda row: (row["origin_country_cn"], row["origin_region_cn"]))
    return output


def load_map_coordinates(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    rows = read_csv(path)
    return {
        row["origin_country"]: {
            "lat": parse_number(row["lat"]),
            "lon": parse_number(row["lon"]),
            "map_note": row.get("map_note", ""),
            "label_priority": int(row.get("label_priority", "0") or 0),
        }
        for row in rows
    }


def rating_band(avg_rating: float) -> tuple[str, int]:
    if avg_rating >= 93.5:
        return "93.50-94.50", 4
    if avg_rating >= 93.0:
        return "93.00-93.49", 3
    if avg_rating >= 92.5:
        return "92.50-92.99", 2
    if avg_rating >= 92.0:
        return "92.00-92.49", 1
    return "低于92.00", 0


def display_for_country_point(rows: list[dict], country_cn: str) -> str:
    displays = sorted({row["origin_display_cn"] for row in rows})
    regions = sorted({row["origin_region"] for row in rows if row["origin_region"]})
    return displays[0] if len(displays) == 1 and len(regions) == 1 else country_cn


def build_map_points(rows: list[dict], country_summary: list[dict]) -> list[dict]:
    coordinates = load_map_coordinates(MAP_SOURCE_CSV)
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["origin_country_norm"]].append(row)

    output = []
    for summary in country_summary:
        country = summary["origin_country_norm"]
        if not summary["keep_for_ranking"] or country not in coordinates:
            continue
        band, band_order = rating_band(summary["avg_rating"])
        coord = coordinates[country]
        output.append(
            {
                "origin_country_norm": country,
                "origin_country_cn": summary["origin_country_cn"],
                "origin_display_cn": display_for_country_point(grouped[country], summary["origin_country_cn"]),
                "lat": coord["lat"],
                "lon": coord["lon"],
                "sample_size": summary["sample_size"],
                "avg_rating": summary["avg_rating"],
                "median_rating": summary["median_rating"],
                "median_price_100g_usd": summary["median_price_100g_usd"],
                "count_94plus": summary["count_94plus"],
                "share_94plus": summary["share_94plus"],
                "count_95plus": summary["count_95plus"],
                "share_95plus": summary["share_95plus"],
                "rating_band": band,
                "rating_band_order": band_order,
                "map_note": coord["map_note"],
                "label_priority": coord["label_priority"],
            }
        )
    output.sort(key=lambda row: (row["rating_band_order"], row["avg_rating"]), reverse=True)
    return output


def build_focus_score_distribution(rows: list[dict]) -> list[dict]:
    output = []
    for row in rows:
        country = row["origin_country_norm"]
        if country not in FOCUS_COUNTRY_ORDER:
            continue
        output.append(
            {
                "origin_country_norm": country,
                "origin_country_cn": COUNTRY_CN.get(country, country),
                "country_order": FOCUS_COUNTRY_ORDER[country],
                "rating": row["rating"],
                "name": row["name"],
                "roaster": row["roaster"],
                "review_date": row["review_date"],
            }
        )
    output.sort(key=lambda row: (row["country_order"], row["rating"], row["name"]))
    return output


def review_has_keyword(review: str, keyword: str) -> bool:
    # Keep phrase matching readable while avoiding regex surprises in flavor terms.
    return re.search(rf"(?<![A-Za-z]){re.escape(keyword)}(?![A-Za-z])", review) is not None


def build_focus_flavor_matrix(rows: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in rows:
        country = row["origin_country_norm"]
        if country in FOCUS_COUNTRY_ORDER:
            grouped[country].append(row["review"].lower())

    output = []
    for country, country_cn in FOCUS_COUNTRIES:
        reviews = grouped[country]
        total = len(reviews)
        for flavor_order, (flavor_tag, keywords) in enumerate(FLAVOR_GROUPS):
            hits = sum(
                1
                for review in reviews
                if any(review_has_keyword(review, keyword) for keyword in keywords)
            )
            output.append(
                {
                    "origin_country_norm": country,
                    "origin_country_cn": country_cn,
                    "country_order": FOCUS_COUNTRY_ORDER[country],
                    "flavor_tag": flavor_tag,
                    "flavor_order": flavor_order,
                    "sample_hits": hits,
                    "sample_total": total,
                    "flavor_ratio": round4(hits / total if total else 0),
                    "flavor_percent": round2(hits / total * 100 if total else 0),
                }
            )
    return output


def matching_keywords(review: str, keywords: list[str]) -> list[str]:
    review_text = review.lower()
    return [keyword for keyword in keywords if review_has_keyword(review_text, keyword)]


def build_high_score_flavor_lift(rows: list[dict]) -> list[dict]:
    high_rows = [row for row in rows if row["high_score_94plus"]]
    non_high_rows = [row for row in rows if not row["high_score_94plus"]]
    output = []

    for flavor_order, (flavor_tag, keywords) in enumerate(FLAVOR_GROUPS):
        high_hits = []
        non_high_hits = []

        for row in high_rows:
            hits = matching_keywords(row["review"], keywords)
            if hits:
                high_hits.append((row, hits))

        for row in non_high_rows:
            if matching_keywords(row["review"], keywords):
                non_high_hits.append(row)

        high_ratio = len(high_hits) / len(high_rows) if high_rows else 0
        non_high_ratio = len(non_high_hits) / len(non_high_rows) if non_high_rows else 0
        examples = []
        for row, hits in sorted(high_hits, key=lambda item: (-item[0]["rating"], item[0]["name"]))[:4]:
            examples.append(
                {
                    "name": row["name"],
                    "rating": row["rating"],
                    "origin_display_cn": row["origin_display_cn"],
                    "origin_country_cn": row["origin_country_cn"],
                    "matched_keywords": hits[:3],
                }
            )

        output.append(
            {
                "flavor_tag": flavor_tag,
                "flavor_order": flavor_order,
                "high_sample_total": len(high_rows),
                "non_high_sample_total": len(non_high_rows),
                "high_hits": len(high_hits),
                "non_high_hits": len(non_high_hits),
                "high_ratio": round4(high_ratio),
                "non_high_ratio": round4(non_high_ratio),
                "difference": round4(high_ratio - non_high_ratio),
                "lift": round2(high_ratio / non_high_ratio) if non_high_ratio else None,
                "examples": examples,
            }
        )

    output.sort(key=lambda row: (row["difference"], row["high_ratio"]), reverse=True)
    return output


def build_price_rating_samples(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "roaster": row["roaster"],
            "origin_country_norm": row["origin_country_norm"],
            "origin_country_cn": row["origin_country_cn"],
            "origin_region": row["origin_region"],
            "origin_region_cn": row["origin_region_cn"],
            "origin_display_cn": row["origin_display_cn"],
            "rating": row["rating"],
            "price_100g_usd": row["price_100g_usd"],
            "is_price_outlier": row["is_price_outlier"],
            "review_date": row["review_date"],
        }
        for row in rows
    ]


def match_key(name: str, roaster: str, rating: int | float | str) -> tuple[str, str, str]:
    return (
        " ".join((name or "").strip().lower().split()),
        " ".join((roaster or "").strip().lower().split()),
        str(int(float(rating))),
    )


def score_band_for_rating(rating: float) -> tuple[str, int]:
    if rating >= 95:
        return "95+", 3
    if rating >= 94:
        return "94", 2
    if rating >= 93:
        return "93", 1
    return "92及以下", 0


def average_optional(values: list[float | None]) -> float | None:
    clean_values = [value for value in values if value is not None]
    if not clean_values:
        return None
    return round2(sum(clean_values) / len(clean_values))


def build_cupping_matches(rows: list[dict], source_rows: list[dict]) -> list[dict]:
    indexed = defaultdict(list)
    for source in source_rows:
        if not source.get("rating"):
            continue
        indexed[match_key(source.get("name", ""), source.get("roaster", ""), source["rating"])].append(source)

    matches = []
    for row in rows:
        key = match_key(row["name"], row["roaster"], row["rating"])
        candidates = indexed.get(key)
        if not candidates:
            continue
        source = candidates.pop(0)
        components = {
            component: parse_optional_number(source.get(component, ""))
            for component, _component_cn in CUPPING_COMPONENTS
        }
        if not any(value is not None for value in components.values()):
            continue
        matches.append(
            {
                "id": row["id"],
                "name": row["name"],
                "roaster": row["roaster"],
                "rating": row["rating"],
                "price_100g_usd": row["price_100g_usd"],
                "roast": source.get("roast", row["roast"]) or row["roast"],
                **components,
            }
        )
    return matches


def build_cupping_score_profile(matches: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in matches:
        band, band_order = score_band_for_rating(row["rating"])
        grouped[(band, band_order)].append(row)

    output = []
    low_band = grouped.get(("92及以下", 0), [])
    low_averages = {
        component: average_optional([row[component] for row in low_band])
        for component, _component_cn in CUPPING_COMPONENTS
    }

    for band, band_order in SCORE_BANDS:
        items = grouped.get((band, band_order), [])
        if not items:
            continue
        component_rows = []
        for component, component_cn in CUPPING_COMPONENTS:
            avg_score = average_optional([row[component] for row in items])
            base_score = low_averages.get(component)
            component_rows.append(
                {
                    "component": component,
                    "component_cn": component_cn,
                    "avg_score": avg_score,
                    "delta_from_low_band": round2(avg_score - base_score)
                    if avg_score is not None and base_score is not None
                    else None,
                }
            )

        output.append(
            {
                "score_band": band,
                "band_order": band_order,
                "sample_size": len(items),
                "avg_rating": round2(sum(row["rating"] for row in items) / len(items)),
                "components": component_rows,
            }
        )

    output.sort(key=lambda row: row["band_order"])
    return output


def build_roast_summary(matches: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in matches:
        roast = (row.get("roast") or "").strip()
        if not roast or roast.upper() == "NA":
            continue
        grouped[roast].append(row)

    output = []
    for roast, items in grouped.items():
        if len(items) < 10:
            continue
        ratings = [row["rating"] for row in items]
        output.append(
            {
                "roast": roast,
                "sample_size": len(items),
                "avg_rating": round2(sum(ratings) / len(ratings)),
                "count_94plus": sum(1 for rating in ratings if rating >= 94),
                "share_94plus": round4(sum(1 for rating in ratings if rating >= 94) / len(ratings)),
            }
        )
    output.sort(key=lambda row: (row["sample_size"], row["avg_rating"]), reverse=True)
    return output


def write_notes() -> None:
    notes = """# 数据说明

本目录为咖啡可视化网站的发布版数据，由 `simplified_coffee_cleaned.csv` 生成。

## 地理字段规范

- 原始字段 `origin_raw`、`loc_country` 保留，用于追溯数据原始写法。
- `Taiwan` 规范为国家 `China`、地区 `Taiwan`，网页展示为“中国台湾”。
- `Hawaii`、`Hawai'I`、`Hawai'i` 规范为国家 `United States`、地区 `Hawaii`，网页展示为“美国夏威夷”。
- 烘焙商所在地字段同样规范化；`Hong Kong` 展示为“中国香港”，`England` 展示为“英国英格兰”。

## 排名与样本量

国家级汇总使用 `origin_country_norm` 聚合。主要排名只使用 `sample_size >= 10` 的国家/地区来源，以避免小样本造成误读。样本量不足的产地保留在数据中，但不作为主排名结论。

## 价格字段

价格以每 100g 美元计。由于价格存在明显长尾，网站应优先展示中位数和分位数；`price_100g_usd > 50` 的样本标记为 `is_price_outlier = true`。

## 高分风味关键词

风味关键词来自英文评论文本匹配，表示“评论文本中的关键词出现率”，不是人工完整杯测标签。网站将 `rating >= 94` 的样本作为高分组，并与非高分组比较关键词出现率；该比较只说明关键词在高分评论中更常见，不代表因果关系。

## 高分定义

本项目将 `94 分及以上` 定义为高分样本。评分来自 Coffee Review 原始测评页面，课程使用的清洗数据来自 Kaggle Coffee Scrap CoffeeReview 数据集。在当前 1245 条样本中，`93+` 覆盖 946 条，占 75.98%，范围偏宽；`95+` 有 231 条，占 18.55%，样本偏少；`94+` 有 587 条，占 47.15%，更适合作为高分比较阈值。

## 杯测分项

杯测分项来自 `原始数据/coffee_df_with_type_and_region.csv.zip`。发布版数据使用 `name + roaster + rating` 与当前网站样本匹配，只保留匹配成功的样本；未匹配样本不进入杯测分项图表。`aroma`、`acid`、`body`、`flavor`、`aftertaste` 转为数值，`NA` 和空值转为 `null`。

## 叙事边界

本数据适合讨论咖啡产地、评分、风味关键词与价格之间的关系；不支持健康、销量或大众受欢迎程度等结论。
"""
    (OUTPUT_DIR / "data_notes.md").write_text(notes, encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    raw_rows = read_csv(INPUT_CSV)
    cupping_source_rows = read_zip_csv(CUPPING_SOURCE_ZIP)
    coffee_samples = enrich_rows(raw_rows)
    cupping_matches = build_cupping_matches(coffee_samples, cupping_source_rows)
    country_summary = build_country_summary(coffee_samples)
    region_summary = build_region_summary(coffee_samples)

    write_json(OUTPUT_DIR / "coffee_samples_final.json", coffee_samples)
    write_json(OUTPUT_DIR / "country_summary_final.json", country_summary)
    write_json(OUTPUT_DIR / "region_summary_final.json", region_summary)
    write_json(OUTPUT_DIR / "map_country_points.json", build_map_points(coffee_samples, country_summary))
    write_json(
        OUTPUT_DIR / "focus_country_score_distribution.json",
        build_focus_score_distribution(coffee_samples),
    )
    write_json(OUTPUT_DIR / "focus_country_flavor_matrix.json", build_focus_flavor_matrix(coffee_samples))
    write_json(OUTPUT_DIR / "high_score_flavor_lift.json", build_high_score_flavor_lift(coffee_samples))
    write_json(OUTPUT_DIR / "price_rating_samples.json", build_price_rating_samples(coffee_samples))
    write_json(OUTPUT_DIR / "cupping_score_profile.json", build_cupping_score_profile(cupping_matches))
    write_json(OUTPUT_DIR / "roast_summary.json", build_roast_summary(cupping_matches))
    write_notes()

    print(f"coffee_samples={len(coffee_samples)}")
    print(f"countries={len(country_summary)}")
    print(f"regions={len(region_summary)}")
    print(f"ranking_countries={sum(1 for row in country_summary if row['keep_for_ranking'])}")
    print(f"price_outliers={sum(1 for row in coffee_samples if row['is_price_outlier'])}")
    print(f"cupping_matches={len(cupping_matches)}")
    print(f"output_dir={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
