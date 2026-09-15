# VEX Booking → Telegram

Мини-бэкенд для статического сайта на GitHub Pages. Сайт отправляет заявку сюда, а Worker отправляет её в Telegram.

## 1. Создать Telegram-бота

В Telegram открой `@BotFather`, создай бота через `/newbot` и получи токен.

**Токен не отправляй в код сайта и не присылай его в чат.**

## 2. Узнать chat_id

Напиши своему боту любое сообщение, затем открой:

`https://api.telegram.org/bot<TOKEN>/getUpdates`

В ответе найди `message.chat.id`.

## 3. Создать Cloudflare Worker

В Cloudflare открой Workers & Pages → Create → Worker.

Вставь содержимое `worker.js`.

Добавь два Worker Secrets:

- `TELEGRAM_BOT_TOKEN` — токен от BotFather
- `TELEGRAM_CHAT_ID` — твой chat_id

После публикации получится URL вида:

`https://vex-booking-xxxx.workers.dev`

## 4. Подключить к сайту

В booking-коде БРОДЯГИ URL Worker используется как `BOOKING_API_URL`.

После подключения каждая подтверждённая запись отправляется в Telegram.

## Безопасность

Telegram token хранится только в Cloudflare Secret. Никогда не помещай его в `index.html`, `brodyaga.html` или другой публичный файл GitHub.