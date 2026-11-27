const POLAR = "https://api.polar.sh/v1";
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
  
  const { licenseKey } = input;
  if (!licenseKey) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Falta licenseKey" }) };

  // Validar con Polar
  const r = await fetch(`${POLAR}/license-keys/validate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.POLAR_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ key: licenseKey })
  });
  
  if (!r.ok) {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia invalida o expirada" }) };
  }
  
  const license = await r.json();
  if (license.status !== "active") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Suscripcion inactiva" }) };
  }

  // Leer cuota mensual de Netlify Blobs
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("cuotas");
  const month = new Date().toISOString().slice(0, 7); // "2026-11"
  const rec = JSON.parse((await store.get(licenseKey)) || "{}");
  const used = rec.month === month ? rec.used : 0;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: "active",
      remaining: Math.max(0, CUOTA_MENSUAL - used),
      month: month
    })
  };
};