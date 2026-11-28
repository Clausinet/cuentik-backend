const CUOTA_MENSUAL = 30;

const SYSTEM_PROMPT = `Eres un autor profesional de cuentos infantiles pedagogicos y disenador de sonido para una app de lectura en voz alta con efectos sonoros.
Responde UNICAMENTE con un objeto JSON valido, sin markdown, sin comentarios y sin texto adicional, con esta estructura exacta:
{"titulo":"string de maximo 80 caracteres","moraleja":"string con la ensenanza principal","texto":"UN solo parrafo continuo, sin saltos de linea y sin comillas dobles, maximo 2000 caracteres","efectos":[{"palabra":"palabra en minusculas que aparece textualmente en texto","archivo":"nombre del sonido sin extension"}],"temas_debate":["2 o 3 preguntas abiertas para conversar en familia"]}
Reglas obligatorias:
1. El campo "texto" debe ser UN SOLO parrafo continuo sin saltos de linea ni comillas dobles (usa comillas simples si necesitas dialogos).
2. Adapta la longitud al tamano pedido por el usuario: Corto ~600 caracteres, Mediano ~1200, Largo ~2000.
3. Incluye entre 5 y 10 efectos distribuidos a lo largo del cuento.
4. Cada "palabra" de "efectos" debe aparecer textualmente dentro de "texto".
5. Usa SOLO estos nombres exactos en "archivo" (sin extension): "viento_suave","pasos_hojas","magia_varita","campanillas","risas_duendes","burbujas_agua","rugido_amigable","trueno_suave","fuego_hogar","pasos_nieve","reloj_cucu","buho_nocturno".
6. El protagonista debe ser el nino o nina indicado por el usuario, reflejando el tema, el personaje secundario y el lugar indicados.
7. Tono calido, apto para antes de dormir, sin violencia ni sustos fuertes.`;

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
  const userPrompt = (input.userPrompt || "").trim();
  if (!licenseKey || !userPrompt) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Faltan licenseKey o userPrompt" }) };
  }

  // 1) Validar con endpoint público de Polar
  let license;
  try {
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
    license = await r.json();
  } catch (e) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "No se pudo contactar a Polar" }) };
  }

  const status = license.license_key?.status || license.status;
  if (status === "revoked" || status === "disabled") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia revocada o deshabilitada", polar_status: status }) };
  }

  // 2) Cupo mensual con Netlify Blobs
  const { getStore } = await import("@netlify/blobs");
  const store = getStore("cuotas");
  const month = new Date().toISOString().slice(0, 7);
  const rec = JSON.parse((await store.get(licenseKey)) || "{}");
  const used = rec.month === month ? rec.used : 0;
  if (used >= CUOTA_MENSUAL) {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Cupo mensual agotado", remaining: 0 }) };
  }

  // 3) IA con clave server-side
  const aiModel = process.env.AI_MODEL || "google/gemini-2.0-flash-exp:free";
  let raw = "";
  for (let intento = 0; intento < 2 && !raw; intento++) {
    try {
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
      if (!ai.ok) {
        console.error("OpenRouter error:", ai.status, await ai.text());
        continue;
      }
      const data = await ai.json();
      raw = data?.choices?.[0]?.message?.content || "";
    } catch (e) {
      console.error("OpenRouter fetch error:", e);
    }
  }
  if (!raw) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "IA ocupada, intenta de nuevo" }) };
  }

  // 4) Descontar cupo y devolver
  await store.set(licenseKey, JSON.stringify({ month, used: used + 1 }));
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      story_raw: raw,
      remaining: CUOTA_MENSUAL - (used + 1),
      used: used + 1,
      limit: CUOTA_MENSUAL
    })
  };
};
