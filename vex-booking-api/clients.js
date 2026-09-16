// VEX Booking client registry.
// Add new clients here instead of duplicating the Worker.
// Secrets stay in Cloudflare and are referenced by env key names.

export const CLIENTS = {
  brodyaga: {
    id: "brodyaga",
    enabled: true,
    name: "БРОДЯГА",
    siteUrl: "https://zervexx.github.io/zervex",
    telegramTokenKey: "TELEGRAM_BOT_TOKEN",
    telegramChatIdKey: "TELEGRAM_CHAT_ID",
    timezone: "Europe/Riga",
    booking: {
      minNoticeMinutes: 0,
      maxDaysAhead: 30,
      slotIntervalMinutes: 30,
      workingDays: [1, 2, 3, 4, 5, 6, 7],
      workingHours: { start: "10:00", end: "21:00" }
    },
    services: [
      { id: "haircut", name: "Мужская стрижка", duration: 60, price: 1800 },
      { id: "haircut-beard", name: "Стрижка + борода", duration: 90, price: 2500 },
      { id: "beard", name: "Оформление бороды", duration: 40, price: 1200 },
      { id: "clipper", name: "Стрижка машинкой", duration: 30, price: 1200 }
    ],
    slotTimes: [
      "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
      "13:00", "14:00", "14:30", "15:00", "16:00", "17:00",
      "18:00", "19:00", "20:00", "21:00"
    ]
  }
};

export function getClient(env, id = "brodyaga") {
  const client = CLIENTS[String(id).toLowerCase()];
  if (!client || client.enabled === false) return null;
  return {
    ...client,
    telegramToken: env[client.telegramTokenKey],
    telegramChatId: env[client.telegramChatIdKey]
  };
}

export function publicClient(client) {
  if (!client) return null;
  return {
    id: client.id,
    name: client.name,
    siteUrl: client.siteUrl,
    timezone: client.timezone,
    booking: client.booking,
    services: client.services,
    slotTimes: client.slotTimes
  };
}

export function findService(client, name) {
  if (!client) return null;
  return client.services.find(service => service.name === String(name || "").trim()) || null;
}

export function isAllowedSlot(client, time) {
  return Boolean(client?.slotTimes?.includes(String(time || "").trim()));
}
