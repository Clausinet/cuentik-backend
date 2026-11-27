const POLAR = "https://api.polar.sh/v1";
const CUOTA_MENSUAL = 30;

const SYSTEM_PROMPT = `Eres un autor profesional de cuentos infantiles pedagogicos y disenador de sonido. Responde UNICAMENTE con JSON valido, sin markdown, sin texto adicional, con esta estructura exacta:
{"titulo":"string max 80 caracteres","moraleja":"string","texto":"UN solo parrafo sin saltos de linea ni comillas dobles, max 2000 caracteres","efectos":[{"palabra":"minusculas","archivo":"sin extension"}],"temas_debate":["string","string"]}
Reglas obligatorias:
1. El campo texto debe ser UN SOLO string sin saltos de linea.
2. Todas las palabras en efectos deben aparecer textualmente en texto.
3. Los archivos de sonido NO deben tener extension.
4. Inclui entre 5 y 10 efectos distribuidos a lo largo del cuento.
5. Efectos de sonido permitidos para el campo "archivo" (usa SOLO estos nombres exactos): "viento_suave","pasos_hojas","magia_varita","campanillas","risas_duendes","burbujas_agua","rugido_amigable","trueno_suave","fuego_hogar","pasos_nieve","reloj_cucu","buho_nocturno".`;

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
  
  const { licenseKey, userPrompt } = input;
  if (!licenseKey || !userPrompt) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Faltan datos" }) };
  }

  // 1) Validar licencia en Polar
  const r = await fetch(`${POLAR}/license-keys/validate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.POLAR_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ key: licenseKey })
  });
  if (!r.ok) return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia invalida o expirada" }) };
  const license = await r.json();
  if (license.status !== "active") return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Suscripcion inactiva" }) };

  // 2) Chequear cuota mensual (Netlify Blobs gratis)
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("cuotas");
  const month = new Date().toISOString().slice(0, 7);
  const rec = JSON.parse((await store.get(licenseKey)) || "{}");
  const used = rec.month === month ? rec.used : 0;
  if (used >= CUOTA_MENSUAL) {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Cupo mensual agotado", remaining: 0 }) };
  }

  // 3) Llamar a OpenRouter con clave SERVER-SIDE
  const aiModel = process.env.AI_MODEL || "google/gemini-2.0-flash-exp:free";
  const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AI_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cuentik.netlify.app",
      "X-Title": "Cuentik Backend"
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!ai.ok) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "IA ocupada, intenta de nuevo" }) };
  const data = await ai.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  if (!raw) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Respuesta vacia de la IA" }) };

  // 4) Descontar 1 de la cuota y devolver
  await store.set(licenseKey, JSON.stringify({ month, used: used + 1 }));
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      story_raw: raw,
      remaining: CUOTA_MENSUAL - (used + 1)
    })
  };
};
