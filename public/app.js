const form = document.querySelector("#plate-form");
const plateInput = document.querySelector("#plate");
const statusDot = document.querySelector("#status-dot");
const statusTitle = document.querySelector("#status-title");
const statusDetail = document.querySelector("#status-detail");
const submitButton = form.querySelector("button");

const fields = {
  vehicleResult: document.querySelector("#vehicle-result"),
  vehiclePlate: document.querySelector("#vehicle-plate"),
  vehicleBrand: document.querySelector("#vehicle-brand"),
  vehicleModel: document.querySelector("#vehicle-model"),
  vehicleType: document.querySelector("#vehicle-type"),
  vehicleVin: document.querySelector("#vehicle-vin"),
  vehicleYear: document.querySelector("#vehicle-year"),
  vehicleUsSpec: document.querySelector("#vehicle-us-spec"),
  vehicleVisual: document.querySelector("#vehicle-visual"),
  vehicleImageLink: document.querySelector("#vehicle-image-link"),
  vehicleImage: document.querySelector("#vehicle-image"),
  vehicleImageTitle: document.querySelector("#vehicle-image-title"),
  vehicleImageNote: document.querySelector("#vehicle-image-note"),
  policyState: document.querySelector("#policy-state"),
  policyNo: document.querySelector("#policy-no"),
  contractNo: document.querySelector("#contract-no"),
  insurerId: document.querySelector("#insurer-id"),
  insurerLogo: document.querySelector("#insurer-logo"),
  insurerName: document.querySelector("#insurer-name"),
  insurerContact: document.querySelector("#insurer-contact"),
  subjectList: document.querySelector("#subject-list"),
};

const subjectTemplate = document.querySelector("#subject-template");

function setStatus(kind, title, detail) {
  statusDot.className = `status-dot ${kind || ""}`.trim();
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function value(text, fallback = "-") {
  return text === undefined || text === null || text === "" ? fallback : text;
}

function setFallbackVehicleImage(title = "Representative image", note = "No matching model image found yet.") {
  fields.vehicleImage.removeAttribute("src");
  fields.vehicleImage.alt = "";
  fields.vehicleImageLink.removeAttribute("href");
  fields.vehicleVisual.classList.remove("has-image");
  fields.vehicleVisual.classList.add("fallback");
  fields.vehicleImageTitle.textContent = title;
  fields.vehicleImageNote.textContent = note;
}

function resetReport(plate) {
  fields.vehicleResult.textContent = "Awaiting lookup";
  fields.vehiclePlate.textContent = plate || "-";
  fields.vehicleBrand.textContent = "-";
  fields.vehicleModel.textContent = "-";
  fields.vehicleType.textContent = "-";
  fields.vehicleVin.textContent = "-";
  fields.vehicleYear.textContent = "-";
  fields.vehicleUsSpec.textContent = "-";
  setFallbackVehicleImage("Representative image", "A matching model image will appear after lookup.");

  fields.policyState.textContent = "Not checked";
  fields.policyNo.textContent = "-";
  fields.contractNo.textContent = "-";

  fields.insurerId.textContent = "-";
  fields.insurerName.textContent = "No insurer loaded";
  fields.insurerContact.textContent = "Run a lookup to see insurer contact details.";
  fields.insurerLogo.removeAttribute("src");
  fields.insurerLogo.style.display = "none";

  fields.subjectList.replaceChildren();
  const row = document.createElement("article");
  row.className = "subject-row muted-row";
  row.innerHTML = "<strong>No subject data yet</strong><span>Results from the register will appear here.</span>";
  fields.subjectList.append(row);
}

function applyVehicleYearInfo(payload) {
  const yearInfo = payload.yearInfo || {};

  fields.vehicleYear.textContent = payload.vehicleYear ? String(payload.vehicleYear) : "-";

  if (yearInfo.usSpec === true) {
    if (yearInfo.pureCarsUrl) {
      fields.vehicleUsSpec.innerHTML = "";
      const link = document.createElement("a");
      link.href = yearInfo.pureCarsUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Yes - PureCars report";
      fields.vehicleUsSpec.append(link);
    } else {
      fields.vehicleUsSpec.textContent = "Yes";
    }
  } else if (yearInfo.usSpec === false) {
    fields.vehicleUsSpec.textContent = "No";
  } else {
    fields.vehicleUsSpec.textContent = "Unknown";
  }
}

async function loadVehicleImage(main) {
  const title = `${value(main.vehicleBrand, "Vehicle")} ${value(main.vehicleModel, "")}`.trim();
  const params = new URLSearchParams({
    brand: main.vehicleBrand || "",
    model: main.vehicleModel || "",
    type: main.vehicleType || "",
    vin: main.vehicleVIN || "",
  });

  fields.vehicleImageTitle.textContent = "Finding image";
  fields.vehicleImageNote.textContent = "Searching Wikimedia Commons and decoding the VIN...";
  fields.vehicleYear.textContent = "Checking...";
  fields.vehicleUsSpec.textContent = "Checking...";

  try {
    const response = await fetch(`/api/vehicle-image?${params.toString()}`);
    const payload = await response.json();

    applyVehicleYearInfo(payload);

    if (payload.status !== "1" || !payload.imageUrl) {
      setFallbackVehicleImage(title, payload.notice || "Representative image, not the inspected vehicle.");
      return;
    }

    fields.vehicleImage.src = payload.imageUrl;
    fields.vehicleImage.alt = payload.title || "Representative vehicle image";
    fields.vehicleImageLink.href = payload.pageUrl || payload.imageUrl;
    fields.vehicleVisual.classList.remove("fallback");
    fields.vehicleVisual.classList.add("has-image");
    fields.vehicleImageTitle.textContent = payload.title || "Representative image";
    fields.vehicleImageNote.textContent = payload.query
      ? `${payload.notice || "Representative image, not the inspected vehicle."} Search: "${payload.query}".`
      : payload.notice || "Representative image, not the inspected vehicle.";
  } catch (error) {
    setFallbackVehicleImage(title, "Representative image, not the inspected vehicle.");
    fields.vehicleYear.textContent = "Unknown";
    fields.vehicleUsSpec.textContent = "Unknown";
  }
}

function applyReport(payload) {
  const data = payload.data || {};
  const main = data.main || {};
  const subjects = Array.isArray(data.subject) ? data.subject : [];

  fields.vehicleResult.textContent = value(main.result, payload.status === "1" ? "Found" : "No result");
  fields.vehiclePlate.textContent = value(main.vehiclePlateNo, plateInput.value.toUpperCase());
  fields.vehicleBrand.textContent = value(main.vehicleBrand);
  fields.vehicleModel.textContent = value(main.vehicleModel);
  fields.vehicleType.textContent = value(main.vehicleType);
  fields.vehicleVin.textContent = value(main.vehicleVIN);
  fields.policyState.textContent = payload.status === "1" ? "Active response" : "No policy loaded";
  fields.policyNo.textContent = value(main.policyNo);
  fields.contractNo.textContent = value(main.contractNo);
  fields.insurerId.textContent = value(main.insurer);
  fields.insurerName.textContent = value(main.insurerName, "No insurer loaded");

  if (main.logo) {
    fields.insurerLogo.src = main.logo;
    fields.insurerLogo.style.display = "block";
  } else {
    fields.insurerLogo.removeAttribute("src");
    fields.insurerLogo.style.display = "none";
  }

  const insurer = subjects.find((item) => item.id === main.insurer) || subjects[0];
  fields.insurerContact.textContent = insurer
    ? [insurer.phone, insurer.email, insurer.www].filter(Boolean).join(" - ")
    : "Run a lookup to see insurer contact details.";

  fields.subjectList.replaceChildren();
  if (!subjects.length) {
    const row = document.createElement("article");
    row.className = "subject-row muted-row";
    row.innerHTML = "<strong>No subject data returned</strong><span>The register response did not include parties.</span>";
    fields.subjectList.append(row);
    return;
  }

  subjects.forEach((subject) => {
    const row = subjectTemplate.content.cloneNode(true);
    row.querySelector("[data-name]").textContent = value(subject.name);
    row.querySelector("[data-address]").textContent = [subject.address1, subject.address2, subject.country]
      .filter(Boolean)
      .join(", ");
    row.querySelector("[data-phone]").textContent = value(subject.phone);
    row.querySelector("[data-email]").textContent = value(subject.email);
    row.querySelector("[data-www]").textContent = value(subject.www);
    fields.subjectList.append(row);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const plate = plateInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  plateInput.value = plate;

  if (!plate) {
    setStatus("error", "Plate missing", "Enter a Lithuanian plate number first.");
    return;
  }

  submitButton.disabled = true;
  resetReport(plate);
  setStatus("", "Checking register", "Contacting the Lithuanian insurance register...");

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate }),
    });
    const payload = await response.json();

    if (!response.ok || payload.status !== "1") {
      applyReport(payload);
      setFallbackVehicleImage("Representative image", "A matching model image will appear after lookup.");
      fields.vehicleYear.textContent = "-";
      fields.vehicleUsSpec.textContent = "-";
      setStatus("error", "No confirmed policy", payload.message || "The register did not return a confirmed insurance record.");
      return;
    }

    applyReport(payload);
    await loadVehicleImage(payload.data?.main || {});
    setStatus("ok", "Report ready", `${value(payload.data?.main?.vehicleBrand, "Vehicle")} ${value(payload.data?.main?.vehicleModel, "")}`.trim());
  } catch (error) {
    setStatus("error", "Lookup failed", "The local app could not complete the request.");
  } finally {
    submitButton.disabled = false;
  }
});