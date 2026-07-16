const WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php";
const PURECARS_AUTOCHECK_URL = "https://app.purecars.com/ValueReport/ViewAutoCheckReport.aspx";
const TOYOTA_CAR_INFO_URL = "https://gdpr.toyota-ce.com/api/unit/car-basic-info/";
const REQUEST_HEADERS = {
  "User-Agent": "AutoPatikra/1.0 representative vehicle image lookup (Netlify function)",
};
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const US_SPEC_ERROR_TEXT = "We are sorry, but the vehicle history report cannot be displayed for VIN";
const VIN_YEAR_CODES = {
  A: [1980, 2010],
  B: [1981, 2011],
  C: [1982, 2012],
  D: [1983, 2013],
  E: [1984, 2014],
  F: [1985, 2015],
  G: [1986, 2016],
  H: [1987, 2017],
  J: [1988, 2018],
  K: [1989, 2019],
  L: [1990, 2020],
  M: [1991, 2021],
  N: [1992, 2022],
  P: [1993, 2023],
  R: [1994, 2024],
  S: [1995, 2025],
  T: [1996, 2026],
  V: [1997, 2027],
  W: [1998, 2028],
  X: [1999, 2029],
  Y: [2000],
  1: [2001],
  2: [2002],
  3: [2003],
  4: [2004],
  5: [2005],
  6: [2006],
  7: [2007],
  8: [2008],
  9: [2009],
};
const TOYOTA_LEXUS_BRANDS = new Set(["TOYOTA", "LEXUS"]);
const TRUCK_YEAR_SKIP_BRANDS = new Set(["DAF", "IVECO", "MERCEDES-BENZ", "MERCEDES BENZ", "SCANIA"]);
const CAR_YEAR_US_SPEC_ONLY_BRANDS = new Set([
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
]);

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};

  try {
    const payload = await findVehicleImage(
      params.brand || "",
      params.model || "",
      params.type || "",
      params.vin || "",
    );
    return json(payload);
  } catch (error) {
    return json({
      status: "0",
      source: "fallback",
      message: "Could not reach Wikimedia Commons for a representative image.",
      detail: error.message,
      notice: "Representative image, not the inspected vehicle.",
    });
  }
};

async function findVehicleImage(brand, model, vehicleType, vin = "") {
  const searchVehicleType = normalizeSearchVehicleType(vehicleType);
  let query = [brand, model].map((part) => part.trim()).filter(Boolean).join(" ");
  if (!query) {
    query = (searchVehicleType || "vehicle").trim();
  }

  const yearInfo = vin ? await decodeVinModelYear(vin, brand, vehicleType) : { year: null, years: [], skipped: true };
  const yearsList = yearInfo.years || [];
  const searchYear = yearsList.length === 1 ? yearsList[0] : null;
  const bodyType = String(yearInfo.bodyTypeName || "").trim();
  const typeWord = searchVehicleType.trim() || "vehicle";
  const searchTerms = [
    [searchYear ? String(searchYear) : "", query, bodyType, typeWord].filter(Boolean).join(" ").trim(),
    bodyType ? [query, bodyType, typeWord].filter(Boolean).join(" ").trim() : "",
    `${query} ${typeWord}`.trim(),
    query,
    `${brand} ${searchVehicleType}`.trim(),
  ];

  const seenTerms = new Set();
  for (const term of searchTerms) {
    if (!term || seenTerms.has(term.toLowerCase())) {
      continue;
    }
    seenTerms.add(term.toLowerCase());

    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: term,
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      iiurlwidth: "980",
    });
    const response = await fetchWithTimeout(`${WIKIMEDIA_API}?${params}`, { headers: REQUEST_HEADERS }, 15000);
    if (!response.ok) {
      throw new Error(`Wikimedia returned HTTP ${response.status}`);
    }
    const pages = (await response.json())?.query?.pages || {};

    for (const page of Object.values(pages)) {
      const imageInfo = (page.imageinfo || [{}])[0];
      const mime = imageInfo.mime || "";
      const imageUrl = imageInfo.thumburl || imageInfo.url;
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || !imageUrl) {
        continue;
      }

      const metadata = imageInfo.extmetadata || {};
      const artist = metadata.Artist?.value || "";
      const licenseName = metadata.LicenseShortName?.value || "";
      const credit = [artist, licenseName].filter(Boolean).join(" - ").replace(/<[^>]+>/g, "").slice(0, 240);

      return {
        status: "1",
        source: "wikimedia",
        query: term,
        title: String(page.title || "Representative vehicle image").replace("File:", ""),
        imageUrl,
        pageUrl: `https://commons.wikimedia.org/wiki/${String(page.title || "").replaceAll(" ", "_")}`,
        credit,
        vehicleYear: yearInfo.year,
        searchedYear: searchYear,
        yearInfo,
        notice: "Representative image, not the inspected vehicle.",
      };
    }
  }

  return {
    status: "0",
    source: "fallback",
    query,
    vehicleYear: yearInfo.year,
    searchedYear: searchYear,
    yearInfo,
    notice: "Representative image, not the inspected vehicle.",
  };
}

async function decodeVinModelYear(vin, brand, vehicleType) {
  const cleanVin = String(vin || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (cleanVin.length !== 17) {
    return { year: null, usSpec: null, pureCarsUrl: null, skipped: true, reason: "invalid-vin" };
  }

  let usSpec = null;
  try {
    usSpec = await checkUsSpec(cleanVin);
  } catch {
    usSpec = null;
  }

  const baseInfo = {
    usSpec,
    pureCarsUrl: usSpec === true ? pureCarsReportUrl(cleanVin) : null,
  };
  const normalizedBrand = normalizeBrand(brand);

  if (isTruckType(vehicleType) && TRUCK_YEAR_SKIP_BRANDS.has(normalizedBrand)) {
    return { ...baseInfo, year: null, skipped: true, reason: "unsupported-truck-brand" };
  }

  if (TOYOTA_LEXUS_BRANDS.has(normalizedBrand)) {
    const toyotaInfo = await fetchToyotaYear(cleanVin);
    if (toyotaInfo) {
      return {
        ...baseInfo,
        year: toyotaInfo.year,
        years: [toyotaInfo.year],
        ambiguousYear: false,
        skipped: false,
        source: "toyota-api",
        bodyTypeName: toyotaInfo.bodyTypeName,
      };
    }
  }

  if (CAR_YEAR_US_SPEC_ONLY_BRANDS.has(normalizedBrand)) {
    if (usSpec === null) {
      return { ...baseInfo, year: null, skipped: true, reason: "us-spec-check-failed" };
    }
    if (usSpec !== true) {
      return { ...baseInfo, year: null, skipped: true, reason: "not-us-spec" };
    }
  }

  const yearCode = cleanVin[9];
  const years = VIN_YEAR_CODES[yearCode];
  if (!years) {
    return {
      ...baseInfo,
      year: null,
      years: [],
      ambiguousYear: false,
      skipped: true,
      reason: "unknown-year-code",
      code: yearCode,
    };
  }

  const ambiguousYear = years.length > 1;
  return {
    ...baseInfo,
    year: ambiguousYear ? years.join(" or ") : years[0],
    years,
    ambiguousYear,
    skipped: false,
    code: yearCode,
  };
}

async function checkUsSpec(vin) {
  const params = new URLSearchParams({ vin, dealerId: "100013407" });
  const response = await fetchWithTimeout(`${PURECARS_AUTOCHECK_URL}?${params}`, {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`PureCars returned HTTP ${response.status}`);
  }
  return !(await response.text()).includes(US_SPEC_ERROR_TEXT);
}

function pureCarsReportUrl(vin) {
  return `${PURECARS_AUTOCHECK_URL}?vin=${vin}&dealerId=100013407`;
}

async function fetchToyotaYear(vin) {
  try {
    const response = await fetchWithTimeout(`${TOYOTA_CAR_INFO_URL}${vin}`, { headers: REQUEST_HEADERS });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const dateStr = data.productionDate || data.firstRegistrationDate;
    if (!dateStr || String(dateStr).length < 4) {
      return null;
    }
    const year = Number.parseInt(String(dateStr).slice(0, 4), 10);
    return Number.isFinite(year) ? { year, bodyTypeName: data.bodyTypeName } : null;
  } catch {
    return null;
  }
}

function normalizeBrand(brand) {
  return String(brand || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function isTruckType(vehicleType) {
  const normalized = String(vehicleType || "").trim().toUpperCase();
  return ["TRUCK", "LORRY", "VAN", "BUS", "TRACTOR"].some((term) => normalized.includes(term));
}

function normalizeSearchVehicleType(vehicleType) {
  return String(vehicleType || "").trim().replace(/\blorry\b/gi, "truck");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function json(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  };
}
