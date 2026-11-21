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

function formatDateRu(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value || "—");
}

function statusLabel(status) {
  return ({ pending: "⏳ Ожидает", confirmed: "✅ Подтверждена", rejected: "✕ Отклонена" })[status || "pending"] || status;
}

function mainKeyboard() {
  return { inline_keyboard: [
    [{ text: "📥 Новые заявки", callback_data: "menu:pending" }],
    [{ text: "📋 Все активные", callback_data: "menu:bookings" }, { text: "🗑 Архив", callback_data: "menu:rejected" }],
    [{ text: "📅 Сегодня", callback_data: "schedule:today" }, { text: "📅 Завтра", callback_data: "schedule:tomorrow" }],
    [{ text: "✅ Подтверждённые", callback_data: "menu:confirmed" }],
    [{ text: "🗓 Выбрать дату", callback_data: "menu:datehelp" }, { text: "⚙️ Настройки", callback_data: "menu:status" }]
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
    "<b>👤 КЛИЕНТ</b>\n" + escapeHtml(b.name || "—"),
    "<b>📅 ДАТА И ВРЕМЯ</b>\n" + formatDateRu(b.date) + " · " + escapeHtml(b.time || "—"),
    "<b>🧾 УСЛУГА</b>\n" + escapeHtml(bookingLabel(b))
  ];
  if (b.bookingType === "restaurant") lines.push("<b>👥 ГОСТИ</b>\n" + escapeHtml(b.guests || "—"));
  lines.push("<b>📞 КОНТАКТ</b>\n" + escapeHtml(b.contact || "—"));
  if (b.comment) lines.push("<b>💬 КОММЕНТАРИЙ</b>\n" + escapeHtml(b.comment));
  lines.push("<b>🌐 САЙТ</b>\n" + escapeHtml(b.site || "—"));
  lines.push("<b>СТАТУС</b>\n" + statusLabel(b.status));
  return lines.join("\n\n");
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
  const all = (await listBookings(env, client.id)).filter(b => (b.status || "pending") !== "rejected");
  const pending = all.filter(b => (b.status || "pending") === "pending");
  const confirmed = all.filter(b => b.status === "confirmed");
  const cards = all.slice(0, 8).map((b, i) => {
    const status = b.status === "confirmed" ? "✅ ПОДТВЕРЖДЕНА" : "⏳ ОЖИДАЕТ";
    return "<blockquote><b>ЗАПИСЬ №" + (i + 1) + " · " + escapeHtml(b.name || "Клиент") + "</b>\n" +
      "📅 <b>Дата:</b> " + formatDateRu(b.date) + "\n" +
      "🕒 <b>Время:</b> " + escapeHtml(b.time || "—") + "\n" +
      "💈 <b>Услуга:</b> " + escapeHtml(bookingLabel(b)) + "\n" +
      "<b>" + status + "</b></blockquote>";
  });
  const text = "<b>📋 АКТИВНЫЕ ЗАПИСИ · " + escapeHtml(client.name).toUpperCase() + "</b>\n\n" +
    "Всего: <b>" + all.length + "</b>   ⏳ <b>" + pending.length + "</b>   ✅ <b>" + confirmed.length + "</b>\n\n" +
    (cards.length ? cards.join("\n\n") : "Активных записей пока нет.");
  const rows = all.slice(0, 8).map(b => [{
    text: (b.status === "confirmed" ? "✅ " : "⏳ ") + (b.name || "Клиент") + " · " + (b.time || "—"),
    callback_data: "booking:view:" + b.id
  }]);
  rows.push([{ text: "🗑 Архив отклонённых", callback_data: "menu:rejected" }]);
  rows.push([{ text: "⌂ Главное меню", callback_data: "menu:home" }]);
  return tg(env, messageId ? "editMessageText" : "sendMessage", {
    chat_id: chatId, ...(messageId ? { message_id: messageId } : {}),
    text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows }
  }, client);
}
async function showRejected(env, chatId, messageId, client) {
  const rejected = (await listBookings(env, client.id)).filter(b => b.status === "rejected");
  const cards = rejected.slice(0, 20).map((b, i) =>
    "<blockquote><b>ОТКЛОНЁННАЯ ЗАПИСЬ №" + (i + 1) + " · " + escapeHtml(b.name || "Клиент") + "</b>\n" +
    "📅 <b>Дата:</b> " + formatDateRu(b.date) + "\n" +
    "🕒 <b>Время:</b> " + escapeHtml(b.time || "—") + "\n" +
    "💈 <b>Услуга:</b> " + escapeHtml(bookingLabel(b)) + "\n" +
    "✕ <b>ОТКЛОНЕНА</b></blockquote>"
  );
  const text = "<b>🗑 АРХИВ · " + escapeHtml(client.name).toUpperCase() + "</b>\n\n" +
    "Отклонённых заявок: <b>" + rejected.length + "</b>\n\n" +
    (cards.length ? cards.join("\n\n") : "Архив пока пуст.");
  const keyboard = { inline_keyboard: [
    [{ text: "📋 Активные записи", callback_data: "menu:bookings" }],
    [{ text: "⌂ Главное меню", callback_data: "menu:home" }]
  ]};
  return tg(env, messageId ? "editMessageText" : "sendMessage", {
    chat_id: chatId, ...(messageId ? { message_id: messageId } : {}),
    text, parse_mode: "HTML", reply_markup: keyboard
  }, client);
}
async function showPending(env, chatId, messageId, client) {
  const all = await listBookings(env, client.id);
  const pending = all.filter(b => (b.status || "pending") === "pending");
  const cards = pending.slice(0, 20).map((b, i) =>
    "<blockquote><b>НОВАЯ ЗАЯВКА №" + (i + 1) + " · " + escapeHtml(b.name || "Клиент") + "</b>\n" +
    "📅 <b>Дата:</b> " + formatDateRu(b.date) + "\n" +
    "🕒 <b>Время:</b> " + escapeHtml(b.time || "—") + "\n" +
    "💈 <b>Услуга:</b> " + escapeHtml(bookingLabel(b)) +
    (b.bookingType === "restaurant" ? "\n👥 <b>Гостей:</b> " + escapeHtml(b.guests) : "") +
    "\n⏳ <b>ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ</b></blockquote>"
  );
  const text = "<b>⏳ НОВЫЕ ЗАЯВКИ</b>\n\n" +
    "Нужно обработать: <b>" + pending.length + "</b>\n\n" +
    (cards.length ? cards.join("\n\n") : "Новых заявок нет. Всё обработано.");
  const rows = pending.slice(0, 20).map(b => [{
    text: "Открыть · " + (b.name || "Клиент") + " · " + (b.time || "—"),
    callback_data: "booking:view:" + b.id
  }]);
  rows.push([{ text: "⌂ Главное меню", callback_data: "menu:home" }]);
  return tg(env, messageId ? "editMessageText" : "sendMessage", {
    chat_id: chatId, ...(messageId ? { message_id: messageId } : {}),
    text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows }
  }, client);
}
function addDaysToDate(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function showScheduleForDate(env, chatId, messageId, client, date) {
  const all = await listBookings(env, client.id);
  const day = all.filter(b => b.date === date && b.status !== "rejected")
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const confirmed = day.filter(b => b.status === "confirmed").length;
  const pending = day.filter(b => (b.status || "pending") === "pending").length;
  const cards = day.map((b, i) =>
    "<blockquote><b>ЗАПИСЬ №" + (i + 1) + " · " + escapeHtml(b.time || "—") + " · " + escapeHtml(b.name || "Клиент") + "</b>\n" +
    "💈 <b>Услуга:</b> " + escapeHtml(bookingLabel(b)) +
    (b.bookingType === "restaurant" ? "\n👥 <b>Гостей:</b> " + escapeHtml(b.guests) : "") +
    "\n" + statusLabel(b.status) + "</blockquote>"
  );
  const text = "<b>📅 РАСПИСАНИЕ · " + formatDateRu(date) + "</b>\n\n" +
    "Всего: <b>" + day.length + "</b>   ✅ <b>" + confirmed + "</b>   ⏳ <b>" + pending + "</b>\n\n" +
    (cards.length ? cards.join("\n\n") : "На эту дату записей пока нет.");
  const keyboard = { inline_keyboard: [
    [{ text: "← Сегодня", callback_data: "schedule:today" }, { text: "Завтра →", callback_data: "schedule:tomorrow" }],
    [{ text: "✅ Все подтверждённые", callback_data: "menu:confirmed" }],
    [{ text: "⌂ Главное меню", callback_data: "menu:home" }]
  ]};
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: keyboard }, client);
}
async function showSchedule(env, chatId, messageId, client, offset = 0) {
  const today = localDateString(client.timezone || "Europe/Riga");
  return showScheduleForDate(env, chatId, messageId, client, addDaysToDate(today, offset));
}

async function showConfirmed(env, chatId, messageId, client) {
  const confirmed = (await listBookings(env, client.id)).filter(b => b.status === "confirmed");
  const text = [
    "✅ <b>ПОДТВЕРЖДЁННЫЕ ЗАПИСИ</b>",
    `Всего: <b>${confirmed.length}</b>`,
    "",
    ...(confirmed.length ? confirmed.slice(0, 30).map(b => [
      `<b>${formatDateRu(b.date)} · ${escapeHtml(b.time || "—")}</b>`,
      `${escapeHtml(b.name || "Клиент")} · ${escapeHtml(bookingLabel(b))}`
    ].join("\n")) : ["Подтверждённых записей пока нет."])
  ].join("\n\n");
  const keyboard = { inline_keyboard: [[{ text: "📅 Сегодня", callback_data: "schedule:today" }, { text: "📅 Завтра", callback_data: "schedule:tomorrow" }], [{ text: "⌂ Главное меню", callback_data: "menu:home" }]] };
  return tg(env, messageId ? "editMessageText" : "sendMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}), text, parse_mode: "HTML", reply_markup: keyboard }, client);
}

async function showDateHelp(env, chatId, messageId, client) {
  const text = "🗓 <b>РАСПИСАНИЕ НА ДАТУ</b>\n\nОтправь дату отдельным сообщением в формате:\n<code>/date 2026-11-23</code>";
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
    if (data === "menu:rejected") return showRejected(env, chatId, messageId, client);
    if (data === "menu:confirmed") return showConfirmed(env, chatId, messageId, client);
    if (data === "menu:datehelp") return showDateHelp(env, chatId, messageId, client);
    if (data === "menu:pending") return showPending(env, chatId, messageId, client);
    if (data === "menu:schedule" || data === "schedule:today") return showSchedule(env, chatId, messageId, client, 0);
    if (data === "schedule:tomorrow") return showSchedule(env, chatId, messageId, client, 1);
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
      const resultText = action === "accept" ? `✅ <b>Бронирование подтверждено</b>\n\n${fmtBooking(b)}` : `✕ <b>Бронирование отклонено и перемещено в архив</b>\n\n${fmtBooking(b)}`;
      const resultKeyboard = action === "reject"
        ? { inline_keyboard: [[{ text: "📋 Активные заявки", callback_data: "menu:bookings" }], [{ text: "🗑 Архив отклонённых", callback_data: "menu:rejected" }]] }
        : backKeyboard();
      return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text: resultText, parse_mode: "HTML", reply_markup: resultKeyboard }, client);
    }
    return;
  }

  const text = message?.text || "";
  if (["/start", "/help", "/menu"].includes(text.split(" ")[0])) return tg(env, "sendMessage", { chat_id: chatId, text: `💼 <b>${escapeHtml(client.name)}</b>\n\nПанель управления бронированиями\n\nВыберите раздел:`, parse_mode: "HTML", reply_markup: mainKeyboard() }, client);
  if (text === "/bookings") return showBookings(env, chatId, null, client);
  if (text === "/pending") return showPending(env, chatId, null, client);
  if (text === "/today") return showSchedule(env, chatId, null, client, 0);
  if (text === "/tomorrow") return showSchedule(env, chatId, null, client, 1);
  if (text === "/confirmed") return showConfirmed(env, chatId, null, client);
  if (text.startsWith("/date ")) {
    const date = text.slice(6).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      return tg(env, "sendMessage", { chat_id: chatId, text: "Неверная дата. Используй формат /date 2026-11-23", reply_markup: backKeyboard() }, client);
    }
    return showScheduleForDate(env, chatId, null, client, date);
  }
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
    statusToken: Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join(""),
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
    await env.BOOKINGS.put(`status:${client.id}:${booking.statusToken}`, id);
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
      const busy = new Set();
      if (env.BOOKINGS && date) {
        // Booking records are the source of truth. The slot index is only
        // an optimization and may be missing or temporarily stale.
        let cursor;
        do {
          const page = await env.BOOKINGS.list({
            prefix: `booking:${client.id}:`,
            ...(cursor ? { cursor } : {})
          });
          for (const key of page.keys || []) {
            const booking = await env.BOOKINGS.get(key.name, "json");
            if (booking && booking.date === date && booking.status !== "rejected" && booking.time) {
              busy.add(String(booking.time).trim());
            }
          }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      }
      return json({ ok: true, client: client.id, date, busy: [...busy].sort() });
    }

    if (request.method === "GET" && url.pathname === "/booking-status") {
      const client = getClient(env, url.searchParams.get("client") || DEFAULT_CLIENT);
      if (!client) return json({ ok: false, error: "Клиент не найден" }, 404);
      const token = String(url.searchParams.get("token") || "");
      if (!/^[a-f0-9]{48}$/.test(token)) return json({ ok: false, error: "Ссылка недействительна" }, 404);
      if (!env.BOOKINGS) return json({ ok: false, error: "Хранилище временно недоступно" }, 503);
      const bookingId = await env.BOOKINGS.get(`status:${client.id}:${token}`);
      if (!bookingId) return json({ ok: false, error: "Запись не найдена" }, 404);
      const booking = await env.BOOKINGS.get(`booking:${client.id}:${bookingId}`, "json");
      if (!booking || booking.statusToken !== token) return json({ ok: false, error: "Запись не найдена" }, 404);
      return json({
        ok: true,
        status: booking.status || "pending",
        date: booking.date,
        time: booking.time,
        service: booking.service,
        name: booking.name
      });
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
        await env.BOOKINGS.delete(`status:${client.id}:${b.statusToken}`);
        await env.BOOKINGS.delete(`slot:${client.id}:${b.date}:${b.time}`);
        return json({ ok: false, error: `Не удалось отправить заявку: ${tgResult.description || tgResult.error_code || "Telegram API error"}` }, 502);
      }
      const statusUrl = `https://zervexx.github.io/zervex/booking-status.html?client=${encodeURIComponent(client.id)}&token=${b.statusToken}`;
      return json({ ok: true, id: b.id, client: client.id, bookingType: b.bookingType, guests: b.guests || null, statusUrl });
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: "Некорректный запрос" }, 400);
    }
  }
};
