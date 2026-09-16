import { CLIENTS, getClient, publicClient, findService, isAllowedSlot } from "./clients.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const API = "https://api.telegram.org/bot";
const DEFAULT_CLIENT = "brodyaga";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}

async function tg(env, method, body, client) {
  if (!client?.telegramToken) return { ok: false, description: "Telegram token is not configured" };
  const chatId = client.telegramChatId || env.TELEGRAM_CHAT_ID;
  const r = await fetch(`${API}${client.telegramToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, chat_id: body.chat_id || chatId })
  });
  return r.json().catch(() => ({}));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mainKeyboard() {
  return { inline_keyboard: [
    [{ text: "📋 Заявки", callback_data: "menu:bookings" }, { text: "⏳ Ожидают", callback_data: "menu:pending" }],
    [{ text: "📅 Расписание", callback_data: "menu:schedule" }, { text: "⚙️ Бот", callback_data: "menu:status" }]
  ]};
}

function backKeyboard() {
  return { inline_keyboard: [[{ text: "← Главное меню", callback_data: "menu:home" }]] };
}

function bookingKeyboard(id) {
  return { inline_keyboard: [
    [{ text: "✅ Принять", callback_data: `booking:accept:${id}` }, { text: "✕ Отклонить", callback_data: `booking:reject:${id}` }],
    [{ text: "← Заявки", callback_data: "menu:bookings" }]
  ]};
}

function bookingLabel(b) {
  return b.bookingType === "restaurant" ? "🍽 Бронирование столика" : `💈 ${b.service || "Услуга"}`;
}

function fmtBooking(b) {
  const lines = [
    `<b>${escapeHtml(bookingLabel(b))}</b>`,
    `📅 ${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")}`
  ];
  if (b.bookingType === "restaurant") lines.push(`👥 Гостей: <b>${escapeHtml(b.guests || "—")}</b>`);
  lines.push(`👤 ${escapeHtml(b.name || "—")}`, `📞 ${escapeHtml(b.contact || "—")}`);
  if (b.comment) lines.push(`💬 ${escapeHtml(b.comment)}`);
  lines.push(`🌐 ${escapeHtml(b.site || "—")}`, `\nСтатус: <b>${escapeHtml(b.status || "pending")}</b>`);
  return lines.join("\n");
}

async function listBookings(env, clientId) {
  if (!env.BOOKINGS) return [];
  const result = await env.BOOKINGS.list({ prefix: `booking:${clientId}:` });
  const out = [];
  for (const key of result.keys || []) {
    const b = await env.BOOKINGS.get(key.name, "json");
    if (b) out.push(b);
  }
  return out.sort((a, b) => `${b.date || ""} ${b.time || ""}`.localeCompare(`${a.date || ""} ${a.time || ""}`));
}

async function showBookings(env, chatId, messageId, client) {
  const all = await listBookings(env, client.id);
  const pending = all.filter(b => (b.status || "pending") === "pending");
  let text = `📋 <b>Заявки — ${escapeHtml(client.name)}</b>\n\n`;
  text += all.length ? `Всего: ${all.length}\nОжидают: ${pending.length}\n\n` + all.slice(0, 8).map((b, i) => `${i + 1}. ${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")} — <b>${escapeHtml(b.name || "—")}</b>\n${escapeHtml(bookingLabel(b))} · ${escapeHtml(b.status || "pending")}`).join("\n\n") : "Заявок пока нет.";
  const keyboard = all.length ? { inline_keyboard: all.slice(0, 8).map(b => [{ text: `👤 ${b.name || "Клиент"} · ${b.time || "—"}`, callback_data: `booking:view:${b.id}` }]).concat([[{ text: "← Главное меню", callback_data: "menu:home" }]]) } : backKeyboard();
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: keyboard }, client);
}

async function showPending(env, chatId, messageId, client) {
  const all = await listBookings(env, client.id);
  const pending = all.filter(b => (b.status || "pending") === "pending");
  const text = pending.length ? `⏳ <b>Ожидают подтверждения</b>\n\n${pending.map((b, i) => `${i + 1}. <b>${escapeHtml(b.name || "Клиент")}</b>\n${escapeHtml(b.date || "—")} · ${escapeHtml(b.time || "—")}\n${escapeHtml(bookingLabel(b))}${b.bookingType === "restaurant" ? ` · ${escapeHtml(b.guests)} гостей` : ""}`).join("\n\n")}` : "⏳ <b>Ожидают подтверждения</b>\n\nНовых заявок нет.";
  const keyboard = pending.length ? { inline_keyboard: pending.map(b => [{ text: `📋 ${b.name || "Клиент"}`, callback_data: `booking:view:${b.id}` }]).concat([[{ text: "← Главное меню", callback_data: "menu:home" }]]) } : backKeyboard();
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: keyboard }, client);
}

async function showSchedule(env, chatId, messageId, client) {
  const all = await listBookings(env, client.id);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: client.timezone || "Europe/Riga" });
  const day = all.filter(b => b.date === today && b.status !== "rejected").sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const text = day.length ? `📅 <b>Расписание на сегодня</b>\n\n${day.map(b => `${escapeHtml(b.time)} — <b>${escapeHtml(b.name)}</b>\n${escapeHtml(bookingLabel(b))}${b.bookingType === "restaurant" ? ` · ${escapeHtml(b.guests)} гостей` : ""} · ${escapeHtml(b.status || "pending")}`).join("\n\n")}` : `📅 <b>Расписание на сегодня</b>\n\nЗаписей на сегодня нет.`;
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: backKeyboard() }, client);
}

async function showStatus(env, chatId, messageId, client) {
  const type = client.booking?.type === "restaurant" ? "ресторан" : "услуги";
  const text = `⚙️ <b>Бот подключен</b>\n\nКлиент: <b>${escapeHtml(client.name)}</b>\nID: <code>${escapeHtml(client.id)}</code>\nТип: <b>${type}</b>\nAPI: <b>online</b>\nХранилище: <b>${env.BOOKINGS ? "KV" : "не настроено"}</b>\nЧасовой пояс: <b>${escapeHtml(client.timezone || "Europe/Riga")}</b>`;
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: backKeyboard() }, client);
}

function resolveTelegramClient(env, chatId) {
  // Keep the original Brodyaga bot working even if its chat ID is only
  // available through the legacy TELEGRAM_CHAT_ID secret.
  const brodyaga = getClient(env, DEFAULT_CLIENT);
  const legacyChatId = env.TELEGRAM_CHAT_ID || brodyaga?.telegramChatId;
  if (brodyaga && legacyChatId && String(chatId) === String(legacyChatId)) return brodyaga;

  for (const id of Object.keys(CLIENTS)) {
    if (id === DEFAULT_CLIENT) continue;
    const client = getClient(env, id);
    if (client && client.telegramChatId && String(chatId) === String(client.telegramChatId)) return client;
  }

  // The Brodyaga webhook historically served only one bot. If Telegram
  // delivers an update with a missing/mismatched legacy chat ID, keep
  // that webhook functional instead of silently dropping the update.
  return brodyaga || null;
}

async function handleTelegram(env, update) {
  const message = update.message;
  const callback = update.callback_query;
  const chatId = message?.chat?.id || callback?.message?.chat?.id;
  if (!chatId) return;
  const client = resolveTelegramClient(env, chatId);
  if (!client) return;

  if (callback) {
    const data = callback.data || "";
    await tg(env, "answerCallbackQuery", { callback_query_id: callback.id }, client);
    const messageId = callback.message.message_id;
    if (data === "menu:home") return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: `💼 <b>${escapeHtml(client.name)}</b>\n\nПанель управления бронированиями\n\nВыберите раздел:`, parse_mode: "HTML", reply_markup: mainKeyboard() }, client);
    if (data === "menu:bookings") return showBookings(env, chatId, messageId, client);
    if (data === "menu:pending") return showPending(env, chatId, messageId, client);
    if (data === "menu:schedule") return showSchedule(env, chatId, messageId, client);
    if (data === "menu:status") return showStatus(env, chatId, messageId, client);
    if (data.startsWith("booking:view:")) {
      const id = data.slice("booking:view:".length);
      const b = await env.BOOKINGS?.get(`booking:${client.id}:${id}`, "json");
      if (!b) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "Заявка не найдена.", reply_markup: backKeyboard() }, client);
      return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: `📋 <b>Заявка #${escapeHtml(id)}</b>\n\n${fmtBooking(b)}`, parse_mode: "HTML", reply_markup: bookingKeyboard(id) }, client);
    }
    if (data.startsWith("booking:accept:") || data.startsWith("booking:reject:")) {
      const [_, action, id] = data.split(":");
      const key = `booking:${client.id}:${id}`;
      const b = await env.BOOKINGS?.get(key, "json");
      if (!b) return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: "Заявка уже недоступна.", reply_markup: backKeyboard() }, client);
      b.status = action === "accept" ? "confirmed" : "rejected";
      await env.BOOKINGS.put(key, JSON.stringify(b));
      if (action === "reject" && b.date && b.time) await env.BOOKINGS.delete(`slot:${client.id}:${b.date}:${b.time}`);
      const resultText = action === "accept" ? `✅ <b>Бронирование подтверждено</b>\n\n${fmtBooking(b)}` : `✕ <b>Бронирование отклонено</b>\n\n${fmtBooking(b)}`;
      return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: resultText, parse_mode: "HTML", reply_markup: backKeyboard() }, client);
    }
    return;
  }

  const text = message?.text || "";
  if (["/start", "/help", "/menu"].includes(text.split(" ")[0])) return tg(env, "sendMessage", { chat_id: chatId, text: `💼 <b>${escapeHtml(client.name)}</b>\n\nПанель управления бронированиями\n\nВыберите раздел:`, parse_mode: "HTML", reply_markup: mainKeyboard() }, client);
  if (text === "/bookings") return showBookings(env, chatId, null, client);
  if (text === "/pending") return showPending(env, chatId, null, client);
  if (text === "/today") return showSchedule(env, chatId, null, client);
  if (text === "/status") return showStatus(env, chatId, null, client);
}

function localDateString(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dateToUtcNumber(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function minutesFromTime(time, allow24 = false) {
  const m = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > (allow24 ? 24 : 23) || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

function validateCommon(client, date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Некорректная дата" };
  const dateNumber = dateToUtcNumber(date);
  const parsed = new Date(dateNumber);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { ok: false, error: "Некорректная дата" };
  const weekday = parsed.getUTCDay() || 7;
  if (!client.booking?.workingDays?.includes(weekday)) return { ok: false, error: "В этот день бронирования нет" };

  const slotMinutes = minutesFromTime(time);
  const startMinutes = minutesFromTime(client.booking?.workingHours?.start);
  let endMinutes = minutesFromTime(client.booking?.workingHours?.end, true);
  if (slotMinutes === null || startMinutes === null || endMinutes === null) return { ok: false, error: "Некорректное время" };
  if (endMinutes === 0) endMinutes = 1440;
  if (endMinutes <= startMinutes) endMinutes += 1440;
  if (!isAllowedSlot(client, time) || slotMinutes < startMinutes || slotMinutes >= endMinutes) return { ok: false, error: "Это время недоступно для бронирования" };

  const interval = Number(client.booking?.slotIntervalMinutes || 30);
  if (slotMinutes % interval !== 0) return { ok: false, error: "Некорректный интервал времени" };

  const today = localDateString(client.timezone || "Europe/Riga");
  const diffDays = Math.round((dateNumber - dateToUtcNumber(today)) / 86400000);
  if (diffDays < 0) return { ok: false, error: "Нельзя выбрать прошедшую дату" };
  if (diffDays > Number(client.booking?.maxDaysAhead ?? 30)) return { ok: false, error: "Слишком далеко вперёд для бронирования" };

  const now = new Date();
  const currentLocal = new Intl.DateTimeFormat("en-GB", { timeZone: client.timezone || "Europe/Riga", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const parts = Object.fromEntries(currentLocal.map(p => [p.type, p.value]));
  const currentLocalDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (date === currentLocalDate) {
    const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (slotMinutes < currentMinutes + Number(client.booking?.minNoticeMinutes || 0)) return { ok: false, error: "Это время уже слишком близко" };
  }
  return { ok: true, dateNumber, slotMinutes, endMinutes };
}

function validateBooking(client, body) {
  const date = String(body.date || "").trim();
  const time = String(body.time || "").trim();
  const common = validateCommon(client, date, time);
  if (!common.ok) return common;

  if (client.booking?.type === "restaurant") {
    const guests = Number(body.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > Number(client.booking?.maxGuests || 12)) return { ok: false, error: `Количество гостей: от 1 до ${client.booking?.maxGuests || 12}` };
    return { ...common, bookingType: "restaurant", guests };
  }

  const serviceName = String(body.service || "").trim();
  const service = findService(client, serviceName);
  if (!service) return { ok: false, error: "Выбранная услуга недоступна" };
  if (common.slotMinutes + Number(service.duration || 0) > common.endMinutes) return { ok: false, error: "Услуга не помещается в рабочее время" };
  return { ...common, bookingType: "service", service };
}

async function saveBooking(env, body, client, validation) {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const restaurant = validation.bookingType === "restaurant";
  const booking = {
    id,
    clientId: client.id,
    bookingType: validation.bookingType,
    service: restaurant ? "Бронирование столика" : validation.service.name,
    serviceId: restaurant ? "table" : validation.service.id,
    price: restaurant ? null : validation.service.price,
    duration: restaurant ? null : validation.service.duration,
    guests: restaurant ? validation.guests : null,
    date: String(body.date).trim(),
    time: String(body.time).trim(),
    name: String(body.name).trim(),
    contact: String(body.contact).trim(),
    comment: String(body.comment || "").trim(),
    site: body.site || `${client.name} — ${client.siteUrl}`,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  if (env.BOOKINGS) {
    const slotKey = `slot:${client.id}:${booking.date}:${booking.time}`;
    if (await env.BOOKINGS.get(slotKey)) return { conflict: true };
    await env.BOOKINGS.put(`booking:${client.id}:${id}`, JSON.stringify(booking));
    await env.BOOKINGS.put(slotKey, id);
  }
  return { booking };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/availability") {
      const client = getClient(env, url.searchParams.get("client") || DEFAULT_CLIENT);
      if (!client) return json({ ok: false, error: "Клиент не найден" }, 404);
      const date = url.searchParams.get("date") || "";
      const busy = [];
      if (env.BOOKINGS && date) {
        const result = await env.BOOKINGS.list({ prefix: `slot:${client.id}:${date}:` });
        for (const key of result.keys || []) busy.push(key.name.split(":").pop());
      }
      return json({ ok: true, client: client.id, date, busy });
    }

    if (request.method === "GET" && url.pathname === "/config") {
      const client = getClient(env, url.searchParams.get("client") || DEFAULT_CLIENT);
      if (!client) return json({ ok: false, error: "Клиент не найден" }, 404);
      return json({ ok: true, client: publicClient(client) });
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      try { await handleTelegram(env, await request.json()); return json({ ok: true }); }
      catch (error) { console.error(error); return json({ ok: false }, 500); }
    }

    if (request.method === "GET") return json({ ok: true, service: "VEX Booking", status: "online", storage: env.BOOKINGS ? "kv" : "memory", clients: Object.keys(CLIENTS) });
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    try {
      const body = await request.json();
      const client = getClient(env, body.client || DEFAULT_CLIENT);
      if (!client) return json({ ok: false, error: "Клиент не найден" }, 404);

      const name = String(body.name || "").trim();
      const contact = String(body.contact || body.phone || "").trim();
      if (!name || !contact) return json({ ok: false, error: "Заполните имя и контакт" }, 400);

      const validation = validateBooking(client, body);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
      body.name = name;
      body.contact = contact;

      const result = await saveBooking(env, body, client, validation);
      if (result.conflict) return json({ ok: false, error: "Это время уже занято" }, 409);
      const b = result.booking;
      const textLines = [
        `🔔 <b>НОВАЯ ЗАЯВКА — ${escapeHtml(client.name)}</b>`, "",
        b.bookingType === "restaurant" ? "🍽 <b>Бронирование столика</b>" : `💈 Услуга: ${escapeHtml(b.service)}`,
        b.bookingType === "restaurant" ? `👥 Гостей: ${escapeHtml(b.guests)}` : `💰 Цена: ${escapeHtml(b.price)} ₽`,
        b.bookingType === "restaurant" ? `📍 ${escapeHtml(client.booking?.address || "")}` : `⏱ Длительность: ${escapeHtml(b.duration)} мин`,
        `📅 Дата: ${escapeHtml(b.date)}`,
        `🕐 Время: ${escapeHtml(b.time)}`,
        `👤 Имя: ${escapeHtml(b.name)}`,
        `📞 Контакт: ${escapeHtml(b.contact)}`,
        b.comment ? `💬 Комментарий: ${escapeHtml(b.comment)}` : "",
        "",
        `🌐 Сайт: ${escapeHtml(b.site)}`,
        "",
        `ID: <code>${b.id}</code>`
      ].filter(Boolean);
      const tgResult = await tg(env, "sendMessage", { chat_id: client.telegramChatId, text: textLines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: bookingKeyboard(b.id) }, client);
      if (!tgResult.ok && env.BOOKINGS) {
        await env.BOOKINGS.delete(`booking:${client.id}:${b.id}`);
        await env.BOOKINGS.delete(`slot:${client.id}:${b.date}:${b.time}`);
        return json({ ok: false, error: "Не удалось отправить заявку" }, 502);
      }
      return json({ ok: true, id: b.id, client: client.id, bookingType: b.bookingType, guests: b.guests || null });
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: "Некорректный запрос" }, 400);
    }
  }
};
