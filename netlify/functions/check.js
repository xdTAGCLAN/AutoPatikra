const CAB_LOOKUP_PAGE = "https://www.cab.lt/en/check-vehicle-insurance/";
const CAB_AJAX_URL = "https://www.cab.lt/wp-admin/admin-ajax.php?action=handle_get_insurance";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json({ status: "0", message: "Method not allowed." }, 405);
  }

  const plate = getPlate(event);
  if (!plate) {
    return json({ status: "0", message: "Enter a Lithuanian plate number." });
  }

  try {
    const result = await checkLtInsurance(plate);
    return json(result);
  } catch (error) {
    return json(
      {
        status: "0",
        message: "The Lithuanian insurance register could not be reached.",
        detail: error.message,
      },
      502,
    );
  }
};

function getPlate(event) {
  if (event.httpMethod === "GET") {
    return cleanPlate(event.queryStringParameters?.plate || "");
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    return cleanPlate(payload.plate || "");
  } catch {
    const params = new URLSearchParams(event.body || "");
    return cleanPlate(params.get("plate") || "");
  }
}

function cleanPlate(plate) {
  return String(plate || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

async function checkLtInsurance(plate) {
  const firstResponse = await fetchWithTimeout(CAB_LOOKUP_PAGE, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Pragma: "no-cache",
      Accept: "*/*",
    },
  });
  const firstBody = await firstResponse.text();
  if (!firstResponse.ok) {
    throw new Error(`CAB page returned HTTP ${firstResponse.status}`);
  }

  const nonceMatch = firstBody.match(/action=handle_get_vin","nonce":"(.*?)"/);
  if (!nonceMatch) {
    return { status: "0", message: "Could not prepare the CAB lookup request." };
  }

  let lastResponse = null;
  const now = new Date();

  for (let monthsBack = 0; monthsBack <= 120; monthsBack += 6) {
    const accidentTime = formatCabDate(subtractMonths(now, monthsBack));
    const body = new URLSearchParams({
      nonce: nonceMatch[1],
      registrationcountry: "LT",
      carplate: plate,
      accidentcountry: "LT",
      accidenttime: accidentTime,
      accidentPlateisEEE: "T",
      accidentCountryisEEE: "T",
    });

    const response = await fetchWithTimeout(CAB_AJAX_URL, {
      method: "POST",
      headers: {
        Cookie: "wp-wpml_current_language=en",
        Origin: "https://www.cab.lt",
        Referer: CAB_LOOKUP_PAGE,
        "User-Agent": BROWSER_USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`CAB lookup returned HTTP ${response.status}`);
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return {
        status: "0",
        message: "The CAB service returned an unexpected response.",
        raw: text,
        lookup: { accidenttime: accidentTime, monthsBack },
      };
    }

    result.lookup = {
      accidenttime: accidentTime,
      monthsBack,
      attempts: monthsBack / 6 + 1,
    };
    lastResponse = result;

    const mainResult = String(result?.data?.main?.result || "").toUpperCase();
    if (result.status === "1" && mainResult && mainResult !== "NR") {
      return result;
    }

    if (result.status !== "1" || mainResult !== "NR") {
      return result;
    }
  }

  return {
    status: "0",
    message: "No valid insurance result was found in the last 10 years.",
    lastResponse,
  };
}

function subtractMonths(moment, months) {
  const date = new Date(moment.getTime());
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, lastDay));
  return date;
}

function formatCabDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
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
