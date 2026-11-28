const POLAR = "https://api.polar.sh/v1";

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

  // Validar con Polar (SIN incrementar uso, solo consulta)
  const r = await fetch(`${POLAR}/license-keys/validate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.POLAR_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ key: licenseKey })
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error("Polar validate error:", r.status, detail);
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia invalida o expirada", polar_status: r.status, polar_detail: detail.slice(0, 200) }) };
  }

  const license = await r.json();
  
  // Estados reales de Polar: granted (valida), disabled, revoked
  if (license.status === "revoked" || license.status === "disabled") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia revocada o deshabilitada", polar_status: license.status }) };
  }

  // Polar devuelve el uso restante si el benefit tiene "Limit Usage" activado
  const remaining = license.usage?.remaining ?? 30;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: "active",
      remaining: remaining,
      used: license.usage?.used ?? 0,
      limit: license.usage?.limit ?? 30
    })
  };
};
