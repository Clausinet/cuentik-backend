const POLAR = "https://api.polar.sh/v1";
const ORGANIZATION_ID = "c0c3490d-f023-4258-bf72-0122e24b323e";
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

  // 1) Validar licencia Polar
  let license;
  try {
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
    license = await r.json();
  } catch (e) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "No se pudo contactar a Polar" }) };
  }

  if (license.status === "revoked" || license.status === "disabled") {
    return { statusCode: 402, headers: corsHeaders, body: JSON.stringify({ error: "Licencia revocada o deshabilitada", polar_status: license.status }) };
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

  // 3) IA con Google Gemini API directo (100% gratis, sin OpenRouter)
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "API key de Gemini no configurada" }) };
  }

  let raw = "";
  for (let intento = 0; intento < 2 && !raw; intento++) {
    try {
      const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
            { role: "model", parts: [{ text: "Entendido. Generaré el cuento en formato JSON estricto." }] },
            { role: "user", parts: [{ text: userPrompt }] }
          ],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048
          }
        })
      });
      
      if (!ai.ok) {
        const errorText = await ai.text();
        console.error("Gemini error:", ai.status, errorText);
        continue;
      }
      
      const data = await ai.json();
      raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) {
      console.error("Gemini fetch error:", e);
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
