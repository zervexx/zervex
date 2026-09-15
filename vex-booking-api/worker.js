const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: true, service: "VEX Booking API" });
    }

    try {
      const body = await request.json();
      const service = String(body.service || "").trim();
      const date = String(body.date || "").trim();
      const time = String(body.time || "").trim();
      const name = String(body.name || "").trim();
      const contact = String(body.contact || "").trim();

      if (!service || !date || !time || !name || !contact) {
        return json({ ok: false, error: "Заполните все поля" }, 400);
      }

      const text = [
        "✂️ НОВАЯ ЗАПИСЬ — БРОДЯГА",
        "",
        `Услуга: ${service}`,
        `Дата: ${date}`,
        `Время: ${time}`,
        `Имя: ${name}`,
        `Контакт: ${contact}`,
        "",
        "Источник: сайт ZERVEX / БРОДЯГА"
      ].join("\n");

      const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const tg = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          disable_web_page_preview: true
        })
      });

      if (!tg.ok) {
        return json({ ok: false, error: "Не удалось отправить заявку" }, 502);
      }

      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: "Некорректный запрос" }, 400);
    }
  }
};
