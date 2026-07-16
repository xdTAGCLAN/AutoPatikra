from __future__ import annotations

import calendar
import datetime as dt
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php"
REQUEST_HEADERS = {
    "User-Agent": "AutoPatikra/1.0 representative vehicle image lookup (local development app)"
}
PURECARS_AUTOCHECK_URL = "https://app.purecars.com/ValueReport/ViewAutoCheckReport.aspx"
TOYOTA_CAR_INFO_URL = "https://gdpr.toyota-ce.com/api/unit/car-basic-info/{vin}"
TOYOTA_LEXUS_BRANDS = {"TOYOTA", "LEXUS"}
US_SPEC_ERROR_TEXT = "We are sorry, but the vehicle history report cannot be displayed for VIN"
VIN_YEAR_CODES = {
    "A": [1980, 2010],
    "B": [1981, 2011],
    "C": [1982, 2012],
    "D": [1983, 2013],
    "E": [1984, 2014],
    "F": [1985, 2015],
    "G": [1986, 2016],
    "H": [1987, 2017],
    "J": [1988, 2018],
    "K": [1989, 2019],
    "L": [1990, 2020],
    "M": [1991, 2021],
    "N": [1992, 2022],
    "P": [1993, 2023],
    "R": [1994, 2024],
    "S": [1995, 2025],
    "T": [1996, 2026],
    "V": [1997, 2027],
    "W": [1998, 2028],
    "X": [1999, 2029],
    "Y": [2000],
    "1": [2001],
    "2": [2002],
    "3": [2003],
    "4": [2004],
    "5": [2005],
    "6": [2006],
    "7": [2007],
    "8": [2008],
    "9": [2009],
}
TRUCK_YEAR_SKIP_BRANDS = {"DAF", "IVECO", "MERCEDES-BENZ", "MERCEDES BENZ", "SCANIA"}
CAR_YEAR_US_SPEC_ONLY_BRANDS = {
    "BMW",
    "MINI",
    "DACIA",
    "DAIHATSU",
    "FERRARI",
    "INFINITI",
    "IVECO",
    "LEXUS",
    "MERCEDES-BENZ",
    "MERCEDES BENZ",
    "SMART",
    "NISSAN",
    "RENAULT",
    "SUZUKI",
    "TOYOTA",
}


def subtract_months(moment: dt.datetime, months: int) -> dt.datetime:
    year = moment.year - months // 12
    month = moment.month - months % 12
    if month <= 0:
        year -= 1
        month += 12

    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def normalize_brand(brand: str) -> str:
    return re.sub(r"\s+", " ", (brand or "").strip().upper())


def is_truck_type(vehicle_type: str) -> bool:
    normalized = (vehicle_type or "").strip().upper()
    return any(term in normalized for term in ["TRUCK", "LORRY", "VAN", "BUS", "TRACTOR"])


def check_us_spec(vin: str) -> bool | None:
    vin = re.sub(r"[^A-Za-z0-9]", "", vin or "").upper()
    if len(vin) != 17:
        return None

    response = requests.get(
        PURECARS_AUTOCHECK_URL,
        params={"vin": vin, "dealerId": "100013407"},
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        },
        timeout=10,
    )
    response.raise_for_status()
    return US_SPEC_ERROR_TEXT not in response.text


def purecars_report_url(vin: str) -> str:
    vin = re.sub(r"[^A-Za-z0-9]", "", vin or "").upper()
    return f"{PURECARS_AUTOCHECK_URL}?vin={vin}&dealerId=100013407"


def fetch_toyota_year(vin: str) -> dict | None:
    try:
        response = requests.get(
            TOYOTA_CAR_INFO_URL.format(vin=vin),
            headers=REQUEST_HEADERS,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        return None

    date_str = data.get("productionDate") or data.get("firstRegistrationDate")
    if not date_str or len(date_str) < 4:
        return None

    try:
        year = int(date_str[:4])
    except (TypeError, ValueError):
        return None

    return {"year": year, "bodyTypeName": data.get("bodyTypeName")}


def decode_vin_model_year(vin: str, brand: str, vehicle_type: str) -> dict:
    vin = re.sub(r"[^A-Za-z0-9]", "", vin or "").upper()
    if len(vin) != 17:
        return {"year": None, "usSpec": None, "pureCarsUrl": None, "skipped": True, "reason": "invalid-vin"}

    us_spec = None
    try:
        us_spec = check_us_spec(vin)
    except requests.RequestException:
        us_spec = None

    base_info = {"usSpec": us_spec, "pureCarsUrl": purecars_report_url(vin) if us_spec is True else None}

    normalized_brand = normalize_brand(brand)
    if is_truck_type(vehicle_type) and normalized_brand in TRUCK_YEAR_SKIP_BRANDS:
        return {**base_info, "year": None, "skipped": True, "reason": "unsupported-truck-brand"}

    if normalized_brand in TOYOTA_LEXUS_BRANDS:
        toyota_info = fetch_toyota_year(vin)
        if toyota_info:
            return {
                **base_info,
                "year": toyota_info["year"],
                "years": [toyota_info["year"]],
                "ambiguousYear": False,
                "skipped": False,
                "source": "toyota-api",
                "bodyTypeName": toyota_info.get("bodyTypeName"),
            }
        # Fall through to the standard US-spec-gated VIN decode below if the
        # Toyota/Lexus lookup service didn't return usable data.

    if normalized_brand in CAR_YEAR_US_SPEC_ONLY_BRANDS:
        if us_spec is None:
            return {**base_info, "year": None, "skipped": True, "reason": "us-spec-check-failed"}
        if us_spec is not True:
            return {**base_info, "year": None, "skipped": True, "reason": "not-us-spec"}

    year_code = vin[9]
    years = VIN_YEAR_CODES.get(year_code)
    if not years:
        return {**base_info, "year": None, "years": [], "ambiguousYear": False, "skipped": True, "reason": "unknown-year-code", "code": year_code}

    ambiguous_year = len(years) > 1
    year_display = " or ".join(str(year) for year in years) if ambiguous_year else years[0]

    return {
        **base_info,
        "year": year_display,
        "years": years,
        "ambiguousYear": ambiguous_year,
        "skipped": False,
        "code": year_code,
    }


def check_lt_insurance(plate: str) -> dict:
    plate = re.sub(r"[^A-Za-z0-9]", "", plate or "").upper()
    if not plate:
        return {"status": "0", "message": "Enter a Lithuanian plate number."}

    session = requests.Session()

    get_url = "https://www.cab.lt/en/check-vehicle-insurance/"
    get_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Pragma": "no-cache",
        "Accept": "*/*",
    }

    first_response = session.get(get_url, headers=get_headers, timeout=25)
    first_response.raise_for_status()

    match = re.search(r'action=handle_get_vin","nonce":"(.*?)"', first_response.text)
    if not match:
        return {"status": "0", "message": "Could not prepare the CAB lookup request."}

    post_url = "https://www.cab.lt/wp-admin/admin-ajax.php?action=handle_get_insurance"
    post_headers = {
        "cookie": "wp-wpml_current_language=en",
        "origin": "https://www.cab.lt",
        "referer": get_url,
        "user-agent": get_headers["User-Agent"],
        "x-requested-with": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }

    last_response: dict | None = None
    now = dt.datetime.now()

    for months_back in range(0, 121, 6):
        accident_time = subtract_months(now, months_back).strftime("%Y%m%d%H%M")
        payload = {
            "nonce": match.group(1),
            "registrationcountry": "LT",
            "carplate": plate,
            "accidentcountry": "LT",
            "accidenttime": accident_time,
            "accidentPlateisEEE": "T",
            "accidentCountryisEEE": "T",
        }

        second_response = session.post(post_url, headers=post_headers, data=payload, timeout=25)
        second_response.raise_for_status()

        try:
            result = second_response.json()
        except ValueError:
            return {
                "status": "0",
                "message": "The CAB service returned an unexpected response.",
                "raw": second_response.text,
                "lookup": {"accidenttime": accident_time, "monthsBack": months_back},
            }

        result["lookup"] = {
            "accidenttime": accident_time,
            "monthsBack": months_back,
            "attempts": months_back // 6 + 1,
        }
        last_response = result

        main_result = str(result.get("data", {}).get("main", {}).get("result", "")).upper()
        if result.get("status") == "1" and main_result and main_result != "NR":
            return result

        if result.get("status") != "1" or main_result != "NR":
            return result

    return {
        "status": "0",
        "message": "No valid insurance result was found in the last 10 years.",
        "lastResponse": last_response,
    }


def normalize_search_vehicle_type(vehicle_type: str) -> str:
    normalized = (vehicle_type or "").strip()
    if re.search(r"\blorry\b", normalized, re.IGNORECASE):
        return re.sub(r"\blorry\b", "truck", normalized, flags=re.IGNORECASE)
    return normalized


def find_vehicle_image(brand: str, model: str, vehicle_type: str, vin: str = "") -> dict:
    search_vehicle_type = normalize_search_vehicle_type(vehicle_type)
    query = " ".join(part.strip() for part in [brand, model] if part and part.strip())
    if not query:
        query = (search_vehicle_type or "vehicle").strip()

    year_info = decode_vin_model_year(vin, brand, vehicle_type) if vin else {"year": None, "years": [], "skipped": True}
    years_list = year_info.get("years") or []
    search_year = years_list[0] if len(years_list) == 1 else None
    body_type = (year_info.get("bodyTypeName") or "").strip()
    type_word = search_vehicle_type.strip() or "vehicle"
    search_terms = [
        " ".join(p for p in [str(search_year) if search_year else "", query, body_type, type_word] if p).strip(),
        " ".join(p for p in [query, body_type, type_word] if p).strip() if body_type else "",
        f"{query} {type_word}".strip(),
        query,
        f"{brand} {search_vehicle_type}".strip(),
    ]

    seen_terms = set()
    for term in search_terms:
        if not term or term.lower() in seen_terms:
            continue
        seen_terms.add(term.lower())

        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrsearch": term,
            "gsrlimit": "8",
            "prop": "imageinfo",
            "iiprop": "url|mime|extmetadata",
            "iiurlwidth": "980",
        }
        response = requests.get(WIKIMEDIA_API, params=params, headers=REQUEST_HEADERS, timeout=15)
        response.raise_for_status()
        pages = response.json().get("query", {}).get("pages", {})

        for page in pages.values():
            image_info = (page.get("imageinfo") or [{}])[0]
            mime = image_info.get("mime", "")
            image_url = image_info.get("thumburl") or image_info.get("url")
            if mime not in {"image/jpeg", "image/png", "image/webp"} or not image_url:
                continue

            metadata = image_info.get("extmetadata") or {}
            artist = (metadata.get("Artist") or {}).get("value", "")
            license_name = (metadata.get("LicenseShortName") or {}).get("value", "")
            credit = " - ".join(part for part in [artist, license_name] if part)

            return {
                "status": "1",
                "source": "wikimedia",
                "query": term,
                "title": page.get("title", "Representative vehicle image").replace("File:", ""),
                "imageUrl": image_url,
                "pageUrl": f"https://commons.wikimedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
                "credit": re.sub(r"<[^>]+>", "", credit)[:240],
                "vehicleYear": year_info.get("year"),
                "searchedYear": search_year,
                "yearInfo": year_info,
                "notice": "Representative image, not the inspected vehicle.",
            }

    return {
        "status": "0",
        "source": "fallback",
        "query": query,
        "vehicleYear": year_info.get("year"),
        "searchedYear": search_year,
        "yearInfo": year_info,
        "notice": "Representative image, not the inspected vehicle.",
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/health":
            self.send_json({"ok": True})
            return

        if path.startswith("/api/check"):
            plate = query.get("plate", [""])[0]
            self.handle_lookup(plate)
            return

        if path == "/api/vehicle-image":
            self.handle_vehicle_image(
                brand=query.get("brand", [""])[0],
                model=query.get("model", [""])[0],
                vehicle_type=query.get("type", [""])[0],
                vin=query.get("vin", [""])[0],
            )
            return

        file_path = PUBLIC / ("index.html" if path in {"", "/"} else path.lstrip("/"))
        self.serve_file(file_path)

    def do_POST(self) -> None:
        if self.path != "/api/check":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        try:
            plate = json.loads(body or "{}").get("plate", "")
        except json.JSONDecodeError:
            plate = parse_qs(body).get("plate", [""])[0]

        self.handle_lookup(plate)

    def handle_lookup(self, plate: str) -> None:
        try:
            self.send_json(check_lt_insurance(plate))
        except requests.RequestException as exc:
            self.send_json(
                {
                    "status": "0",
                    "message": "The Lithuanian insurance register could not be reached.",
                    "detail": str(exc),
                },
                status=502,
            )

    def handle_vehicle_image(self, brand: str, model: str, vehicle_type: str, vin: str) -> None:
        try:
            self.send_json(find_vehicle_image(brand, model, vehicle_type, vin))
        except requests.RequestException as exc:
            self.send_json(
                {
                    "status": "0",
                    "source": "fallback",
                    "message": "Could not reach Wikimedia Commons for a representative image.",
                    "detail": str(exc),
                    "notice": "Representative image, not the inspected vehicle.",
                }
            )

    def serve_file(self, file_path: Path) -> None:
        if not file_path.resolve().is_relative_to(PUBLIC.resolve()) or not file_path.exists():
            self.send_error(404)
            return

        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
        }.get(file_path.suffix, "application/octet-stream")

        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("Lithuania vehicle check running at http://127.0.0.1:8787")
    server.serve_forever()
