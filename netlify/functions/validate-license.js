const POLAR = "https://api.polar.sh/v1";
const ORGANIZATION_ID = "c0c3490d-f023-4258-bf72-0122e24b323e";

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

  const r = await fetch(`${POLAR}/license-keys/validate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.POLAR_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      key: licenseKey,
      organization_id: ORGANIZATION_ID
    })
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error("Polar validate error:", r.status, detail);
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia invalida o expirada", polar_status: r.status, polar_detail: detail.slice(0, 300) }) };
  }

  const license = await r.json();
  
  if (license.status === "revoked" || license.status === "disabled") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia revocada o deshabilitada", polar_status: license.status }) };
  }

  // Polar devuelve el uso nativo si el benefit tiene "Limit Usage"
  const remaining = license.usage?.remaining ?? 30;
  const used = license.usage?.used ?? 0;
  const limit = license.usage?.limit ?? 30;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: "active",
      remaining: remaining,
      used: used,
      limit: limit
    })
  };
};
