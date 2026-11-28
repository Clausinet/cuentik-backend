const CUOTA_MENSUAL = 30;

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders };

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "JSON invalido" }) }; }

  const licenseKey = (input.licenseKey || "").trim().toUpperCase();
  if (!licenseKey) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Falta licenseKey" }) };

  // Endpoint público de Polar (no requiere token ni organization_id)
  const r = await fetch("https://api.polar.sh/v1/customer-portal/license-keys/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey })
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error("Polar validate error:", r.status, detail);
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia invalida o expirada", polar_status: r.status, polar_detail: detail.slice(0, 200) }) };
  }

  const license = await r.json();
  
  // El endpoint público devuelve: { license_key: { status: "granted" | "revoked" | "disabled", ... } }
  const status = license.license_key?.status || license.status;
  if (status === "revoked" || status === "disabled") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia revocada o deshabilitada", polar_status: status }) };
  }

  // Contador mensual con Netlify Blobs (reset automático cada mes)
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("cuotas");
  const month = new Date().toISOString().slice(0, 7);
  const rec = JSON.parse((await store.get(licenseKey)) || "{}");
  const used = rec.month === month ? rec.used : 0;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: "active",
      remaining: Math.max(0, CUOTA_MENSUAL - used),
      used: used,
      limit: CUOTA_MENSUAL,
      month: month
    })
  };
};
