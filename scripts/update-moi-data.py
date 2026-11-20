#!/usr/bin/env python3
"""從內政部實價登錄開放資料，更新中和區住宅成交快照。

- data/zhonghe-resale.json：中古屋與成屋（不動產買賣，新北市 A 表）
- data/zhonghe-presale.json：預售屋（預售屋買賣，新北市 B 表，含建案名稱）

下載最近 17 季（約四年）的季報，加上「本期」資料，以編號去重。可傳入 --offline <資料夾>，
改讀已下載的 zip 檔（測試用）。
"""

import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESALE_DEST = ROOT / "data" / "zhonghe-resale.json"
PRESALE_DEST = ROOT / "data" / "zhonghe-presale.json"
SEASON_URL = "https://plvr.land.moi.gov.tw/DownloadSeason?season={season}&type=zip&fileName=lvr_landcsv.zip"
CURRENT_URL = "https://plvr.land.moi.gov.tw/Download?type=zip&fileName=lvr_landcsv.zip"
SOURCE = "https://plvr.land.moi.gov.tw/DownloadOpenData"
DISTRICT = "中和區"
SQM_PER_PING = 3.305785
SEASONS = 17
WINDOW_YEARS = 4
# 特殊交易會讓價格偏離行情，整筆排除。
SPECIAL_NOTES = ("特殊關係", "親友", "急買急賣", "瑕疵", "債權債務", "拍賣", "法拍", "政府機關", "頂樓加蓋", "增建", "未登記建物", "含租約", "畸零地", "公共設施保留地", "受託")
# 早期資料匯出時部分非 Big5 字會變成「?」；依名稱與地址查證後修正。
NAME_FIXES = {"?捷橙品": "双捷橙品", "偉鉅中山?匯": "偉鉅中山双匯", "寶亞南山公?": "寶亞南山公館"}
TYPES = {"住宅大樓": "住宅大樓", "華廈": "華廈", "公寓": "公寓"}
DIGITS = "零一二三四五六七八九"


def roc_date(raw):
    raw = str(raw or "").strip()
    if not raw.isdigit() or len(raw) < 6:
        return None
    try:
        year = int(raw[:-4]) + 1911
        month = int(raw[-4:-2])
        day = int(raw[-2:]) or 1
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def roc_year(raw):
    raw = str(raw or "").strip()
    if not raw.isdigit() or len(raw) < 5:
        return None
    year = int(raw[:-4]) + 1911
    return year if 1950 <= year <= date.today().year + 1 else None


def chinese_floor(text):
    value = str(text or "").split("，")[0].strip().replace("層", "")
    if value.isdigit():
        return int(value) or None
    if not value or any(ch not in "一二三四五六七八九十" for ch in value):
        return None
    if "十" not in value:
        return DIGITS.index(value) if len(value) == 1 else None
    tens, ones = value.split("十")
    if len(tens) > 1 or len(ones) > 1:
        return None
    return (DIGITS.index(tens) if tens else 1) * 10 + (DIGITS.index(ones) if ones else 0)


def normalize(text):
    table = str.maketrans("０１２３４５６７８９", "0123456789")
    return str(text or "").translate(table).replace("臺", "台").strip()


def street_of(address):
    text = normalize(address).replace("新北市", "").replace(DISTRICT, "")
    match = re.search(r"[^\d\s,，號巷弄之~]+?(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?", text)
    return match.group(0) if match else ""


def building_of(address):
    """門牌去掉樓層，作為同一棟的近似識別。"""
    text = normalize(address).replace("新北市", "").replace(DISTRICT, "")
    match = re.match(r"(.+?號)", text)
    return match.group(1) if match else text


def seasons_back(count, today=None):
    today = today or date.today()
    year, quarter = today.year - 1911, (today.month - 1) // 3 + 1
    result = []
    for _ in range(count):
        result.append(f"{year}S{quarter}")
        quarter -= 1
        if quarter == 0:
            year, quarter = year - 1, 4
    return result


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "life-lab-home-data/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        return response.read()


def read_table(archive, name):
    try:
        raw = archive.read(name)
    except KeyError:
        return []
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    if len(rows) < 3:
        return []
    header = rows[0]
    return [dict(zip(header, row)) for row in rows[2:] if row and row[0] == DISTRICT]


def common(row):
    """共同欄位與排除條件；不合格回傳 None。"""
    when = roc_date(row.get("交易年月日"))
    if not when:
        return None
    if "房地" not in (row.get("交易標的") or ""):
        return None
    if "住家" not in (row.get("主要用途") or ""):
        return None
    note = row.get("備註") or ""
    if any(word in note for word in SPECIAL_NOTES):
        return None
    kind = next((value for key, value in TYPES.items() if key in (row.get("建物型態") or "")), None)
    if not kind:
        return None
    try:
        area = float(row.get("建物移轉總面積平方公尺") or 0)
        parking_area = float(row.get("車位移轉總面積平方公尺") or 0)
        total = float(row.get("總價元") or 0)
        parking_price = float(row.get("車位總價元") or 0)
    except ValueError:
        return None
    if parking_area > 0 and parking_price <= 0:
        return None  # 車位價格未分開登錄時，單價會失真
    home_area = (area - parking_area) / SQM_PER_PING
    if not 8 <= home_area <= 150 or total <= 0:
        return None
    unit = (total - parking_price) / 10000 / home_area
    if not 10 <= unit <= 300:
        return None
    return {
        "id": (row.get("編號") or "").strip(),
        "address": normalize(row.get("土地位置建物門牌")),
        "street": street_of(row.get("土地位置建物門牌")),
        "date": when,
        "area": round(area / SQM_PER_PING, 2),
        "homeArea": round(home_area, 2),
        "unitPrice": round(unit, 2),
        "totalPrice": round(total / 10000, 1),
        "parkingPrice": round(parking_price / 10000, 1),
        "type": kind,
        "floor": (row.get("移轉層次") or "").split("，")[0].strip(),
        "totalFloors": chinese_floor(row.get("總樓層數")),
    }


def resale_record(row):
    item = common(row)
    if not item:
        return None
    built = roc_year(row.get("建築完成年月"))
    if not built:
        return None
    # 網頁只需要「哪一棟、幾樓」，完整門牌與含車位面積不輸出，控制檔案大小。
    item.pop("address", None)
    item.pop("area", None)
    item.update({
        "building": building_of(row.get("土地位置建物門牌")),
        "built": built,
        "rooms": int(row.get("建物現況格局-房") or 0) if str(row.get("建物現況格局-房") or "").isdigit() else None,
        "elevator": (row.get("電梯") or "") == "有",
    })
    return item


def presale_record(row):
    if (row.get("解約情形") or "").strip():
        return None
    item = common(row)
    if not item or item["type"] == "公寓":
        return None
    name = (row.get("建案名稱") or "").strip()
    if not name:
        return None
    item["name"] = NAME_FIXES.get(name, name)
    return item


def collect(archives):
    resale, presale = {}, {}
    for archive in archives:
        for row in read_table(archive, "f_lvr_land_a.csv"):
            item = resale_record(row)
            if item and item["id"]:
                resale[item["id"]] = item
        for row in read_table(archive, "f_lvr_land_b.csv"):
            item = presale_record(row)
            if item and item["id"]:
                presale[item["id"]] = item
    return resale, presale


def within_window(items):
    today = date.today()
    cutoff = date(today.year - WINDOW_YEARS, today.month, 1).isoformat()
    rows = [item for item in items if item["date"] >= cutoff]
    return sorted(rows, key=lambda item: (item["date"], item["id"]), reverse=True)


def write(dest, rows, label, extra=None):
    snapshot = {
        "source": SOURCE,
        "generatedAt": date.today().isoformat(),
        "latestTransaction": max((item["date"] for item in rows), default=None),
        "area": f"新北市{DISTRICT}",
        "kind": label,
        **(extra or {}),
        "transactions": rows,
    }
    dest.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{label}: {len(rows)} 筆，最新成交 {snapshot['latestTransaction']} → {dest.relative_to(ROOT)}")


def main(argv):
    archives = []
    if len(argv) == 3 and argv[1] == "--offline":
        for path in sorted(Path(argv[2]).glob("*.zip")):
            archives.append(zipfile.ZipFile(path))
    else:
        for season in seasons_back(SEASONS):
            try:
                archives.append(zipfile.ZipFile(io.BytesIO(fetch(SEASON_URL.format(season=season)))))
                print(f"已下載 {season}")
            except Exception as error:  # 尚未發布的季別會失敗，略過即可
                print(f"略過 {season}：{error}")
        try:
            archives.append(zipfile.ZipFile(io.BytesIO(fetch(CURRENT_URL))))
            print("已下載本期資料")
        except Exception as error:
            print(f"略過本期資料：{error}")
    if not archives:
        raise SystemExit("沒有可用的資料，保留原本的快照。")
    resale, presale = collect(archives)
    resale_rows = within_window(resale.values())
    presale_rows = within_window(presale.values())
    # 任何一份結果明顯異常（例如來源格式改變）就不覆寫，避免把網站資料清空。
    if len(resale_rows) < 500 or len(presale_rows) < 100:
        raise SystemExit(f"筆數異常（中古屋 {len(resale_rows)}、預售屋 {len(presale_rows)}），保留原本的快照。")
    write(RESALE_DEST, resale_rows, "中古屋與成屋")
    write(PRESALE_DEST, presale_rows, "預售屋")


if __name__ == "__main__":
    main(sys.argv)
