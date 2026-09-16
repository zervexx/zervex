const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const API = "https://api.telegram.org/bot";
const SITE_NAME = "БРОДЯГА";
const SITE_URL = "https://zervexx.github.io/zervex";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}

async function tg(env, method, body) {
  const r = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📋 Заявки", callback_data: "menu:bookings" }, { text: "⏳ Ожидают", callback_data: "menu:pending" }],
      [{ text: "📅 Расписание", callback_data: "menu:schedule" }, { text: "⚙️ Бот", callback_data: "menu:status" }]
    ]
  };
}

function backKeyboard() {
  return { inline_keyboard: [[{ text: "← Главное меню", callback_data: "menu:home" }]] };
}

function bookingKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: "✅ Принять", callback_data: `booking:accept:${id}` }, { text: "✕ Отклонить", callback_data: `booking:reject:${id}` }],
      [{ text: "← Заявки", callback_data: "menu:bookings" }]
    ]
  };
}

function fmtBooking(b) {
  return [
    `💈 <b>${escapeHtml(b.service || "Услуга")}</b>`,
    `📅 ${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")}`,
    `👤 ${escapeHtml(b.name || "—")}`,
    `📞 ${escapeHtml(b.contact || "—")}`,
    `🌐 ${escapeHtml(b.site || SITE_NAME)}`,
    `\nСтатус: <b>${escapeHtml(b.status || "pending")}</b>`
  ].join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function listBookings(env) {
  if (!env.BOOKINGS) return [];
  const result = await env.BOOKINGS.list({ prefix: "booking:" });
  const out = [];
  for (const key of result.keys || []) {
    const b = await env.BOOKINGS.get(key.name, "json");
    if (b) out.push(b);
  }
  return out.sort((a, b) => `${b.date || ""} ${b.time || ""}`.localeCompare(`${a.date || ""} ${a.time || ""}`));
}

async function showBookings(env, chatId, messageId) {
  const all = await listBookings(env);
  const pending = all.filter(b => (b.status || "pending") === "pending");
  let text = `📋 <b>Заявки — ${SITE_NAME}</b>\n\n`;
  if (!all.length) text += "Заявок пока нет.";
  else text += `Всего: ${all.length}\nОжидают: ${pending.length}\n\n` + all.slice(0, 8).map((b, i) => `${i + 1}. ${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")} — <b>${escapeHtml(b.name || "—")}</b>\n${escapeHtml(b.service || "—")} · ${escapeHtml(b.status || "pending")}`).join("\n\n");
  const keyboard = all.length ? { inline_keyboard: all.slice(0, 8).map(b => [{ text: `👤 ${b.name || "Клиент"} · ${b.time || "—"}`, callback_data: `booking:view:${b.id}` }]).concat([[{ text: "← Главное меню", callback_data: "menu:home" }]]) } : backKeyboard();
  if (messageId) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard });
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard });
}

async function showPending(env, chatId, messageId) {
  const all = await listBookings(env);
  const pending = all.filter(b => (b.status || "pending") === "pending");
  const text = pending.length ? `⏳ <b>Ожидают подтверждения</b>\n\n${pending.map((b, i) => `${i + 1}. <b>${escapeHtml(b.name || "Клиент")}</b>\n${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")}\n${escapeHtml(b.service || "—")}`).join("\n\n")}` : "⏳ <b>Ожидают подтверждения</b>\n\nНовых заявок нет.";
  const keyboard = pending.length ? { inline_keyboard: pending.map(b => [{ text: `📋 ${b.name || "Клиент"}`, callback_data: `booking:view:${b.id}` }]).concat([[{ text: "← Главное меню", callback_data: "menu:home" }]]) } : backKeyboard();
  if (messageId) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: keyboard });
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard });
}

async function showSchedule(env, chatId, messageId) {
  const all = await listBookings(env);
  const today = new Date().toISOString().slice(0, 10);
  const day = all.filter(b => b.date === today && b.status !== "rejected").sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const text = day.length ? `📅 <b>Расписание на сегодня</b>\n\n${day.map(b => `${escapeHtml(b.time)} — <b>${escapeHtml(b.name)}</b>\n${escapeHtml(b.service)} · ${escapeHtml(b.status || "pending")}`).join("\n\n")}` : `📅 <b>Расписание на сегодня</b>\n\nЗаписей на сегодня нет.`;
  if (messageId) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: backKeyboard() });
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: backKeyboard() });
}

async function showStatus(env, chatId, messageId) {
  const text = `⚙️ <b>Бот подключен</b>\n\nСайт: <b>${SITE_NAME}</b>\nAPI: <b>online</b>\nХранилище: <b>${env.BOOKINGS ? "KV" : "не настроено"}</b>\n\nЗаявки с сайта приходят сюда автоматически.`;
  if (messageId) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: backKeyboard() });
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: backKeyboard() });
}

async function handleTelegram(env, update) {
  const message = update.message;
  const callback = update.callback_query;
  const chatId = message?.chat?.id || callback?.message?.chat?.id;
  if (!chatId || String(chatId) !== String(env.TELEGRAM_CHAT_ID)) return;

  if (callback) {
    const data = callback.data || "";
    await tg(env, "answerCallbackQuery", { callback_query_id: callback.id });
    if (data === "menu:home") return tg(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: `💈 <b>${SITE_NAME}</b>\n\nПанель управления записью\n\nВыберите раздел:`, parse_mode: "HTML", reply_markup: mainKeyboard() });
    if (data === "menu:bookings") return showBookings(env, chatId, callback.message.message_id);
    if (data === "menu:pending") return showPending(env, chatId, callback.message.message_id);
    if (data === "menu:schedule") return showSchedule(env, chatId, callback.message.message_id);
    if (data === "menu:status") return showStatus(env, chatId, callback.message.message_id);
    if (data.startsWith("booking:view:")) {
      const id = data.slice("booking:view:".length);
      const b = await env.BOOKINGS?.get(`booking:${id}`, "json");
      if (!b) return tg(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: "Заявка не найдена.", reply_markup: backKeyboard() });
      return tg(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: `📋 <b>Заявка #${escapeHtml(id)}</b>\n\n${fmtBooking(b)}`, parse_mode: "HTML", reply_markup: bookingKeyboard(id) });
    }
    if (data.startsWith("booking:accept:") || data.startsWith("booking:reject:")) {
      const [_, action, id] = data.split(":");
      const key = `booking:${id}`;
      const b = await env.BOOKINGS?.get(key, "json");
      if (!b) return tg(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: "Заявка уже недоступна.", reply_markup: backKeyboard() });
      b.status = action === "accept" ? "confirmed" : "rejected";
      await env.BOOKINGS.put(key, JSON.stringify(b));
      if (action === "reject" && b.date && b.time) await env.BOOKINGS.delete(`slot:${b.date}:${b.time}`);
      const resultText = action === "accept" ? `✅ <b>Запись подтверждена</b>\n\n${fmtBooking(b)}` : `✕ <b>Запись отклонена</b>\n\n${fmtBooking(b)}`;
      return tg(env, "editMessageText", { chat_id: chatId, message_id: callback.message.message_id, text: resultText, parse_mode: "HTML", reply_markup: backKeyboard() });
    }
    return;
  }

  const text = message?.text || "";
  if (["/start", "/help", "/menu"].includes(text.split(" ")[0])) {
    return tg(env, "sendMessage", { chat_id: chatId, text: `💈 <b>${SITE_NAME}</b>\n\nПанель управления записью\n\nВыберите раздел:`, parse_mode: "HTML", reply_markup: mainKeyboard() });
  }
  if (text === "/bookings") return showBookings(env, chatId);
  if (text === "/pending") return showPending(env, chatId);
  if (text === "/today") return showSchedule(env, chatId);
  if (text === "/status") return showStatus(env, chatId);
}

async function saveBooking(env, body) {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const booking = { id, service: body.service, date: body.date, time: body.time, name: body.name, contact: body.contact, site: body.site || `${SITE_NAME} — ${SITE_URL}`, status: "pending", createdAt: new Date().toISOString() };
  if (env.BOOKINGS) {
    const occupied = await env.BOOKINGS.get(`slot:${booking.date}:${booking.time}`);
    if (occupied) return { conflict: true };
    await env.BOOKINGS.put(`booking:${id}`, JSON.stringify(booking));
    await env.BOOKINGS.put(`slot:${booking.date}:${booking.time}`, id);
  }
  return { booking };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/availability") {
      const date = url.searchParams.get("date") || "";
      const busy = [];
      if (env.BOOKINGS && date) {
        const result = await env.BOOKINGS.list({ prefix: `slot:${date}:` });
        for (const key of result.keys || []) busy.push(key.name.split(":").pop());
      }
      return json({ ok: true, date, busy });
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      try { await handleTelegram(env, await request.json()); return json({ ok: true }); }
      catch { return json({ ok: false }, 500); }
    }

    if (request.method === "GET") return json({ ok: true, service: "VEX Booking", status: "online", storage: env.BOOKINGS ? "kv" : "memory" });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    try {
      const body = await request.json();
      const service = String(body.service || "").trim();
      const date = String(body.date || "").trim();
      const time = String(body.time || "").trim();
      const name = String(body.name || "").trim();
      const contact = String(body.contact || "").trim();
      if (!service || !date || !time || !name || !contact) return json({ ok: false, error: "Заполните все поля" }, 400);

      const result = await saveBooking(env, body);
      if (result.conflict) return json({ ok: false, error: "Это время уже занято" }, 409);
      const b = result.booking;
      const text = [`🔔 <b>НОВАЯ ЗАЯВКА — ${SITE_NAME}</b>`, ``, `💈 Услуга: ${escapeHtml(b.service)}`, `📅 Дата: ${escapeHtml(b.date)}`, `🕐 Время: ${escapeHtml(b.time)}`, `👤 Имя: ${escapeHtml(b.name)}`, `📞 Контакт: ${escapeHtml(b.contact)}`, ``, `🌐 Сайт: ${escapeHtml(b.site)}`, ``, `ID: <code>${b.id}</code>`].join("\n");
      const tgResult = await tg(env, "sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: bookingKeyboard(b.id) });
      if (!tgResult.ok && env.BOOKINGS) {
        await env.BOOKINGS.delete(`booking:${b.id}`);
        await env.BOOKINGS.delete(`slot:${b.date}:${b.time}`);
        return json({ ok: false, error: "Не удалось отправить заявку" }, 502);
      }
      return json({ ok: true, id: b.id });
    } catch { return json({ ok: false, error: "Некорректный запрос" }, 400); }
  }
};
