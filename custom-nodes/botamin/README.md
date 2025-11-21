# Botamin Kafka Nodes (Trigger + Output)

Кастомные ноды для Kafka-транспорта между core и n8n.

## Ноды
- **Botamin Kafka Trigger** — слушает входной Kafka-топик (`botamin.n8n.input`) и запускает workflow. Фильтр по `workflowId` и `event` опционален.
- **Botamin Kafka Output** — публикует результат workflow в выходной Kafka-топик (`botamin.n8n.output`). Отправляет либо `item.json`, либо кастомный JSON.

## Настройка
- Брокеры из параметра или `KAFKA_BROKERS` (пример: `localhost:29092`).
- Топики по умолчанию:
  - Input: `botamin.n8n.input`
  - Output: `botamin.n8n.output`
- Group ID триггера: `n8n-botassist-trigger` (можно переопределить).

## Сборка и установка в n8n
```bash
cd n8n/custom-nodes/botamin
npm install
npm run build
```

Затем:
- Docker/Server: `N8N_CUSTOM_EXTENSIONS=/path/to/repo/n8n/custom-nodes/botamin`, перезапустить n8n.
- Desktop: скопировать папку с собранным `dist` в `~/.n8n/custom/` или указать путь в `N8N_CUSTOM_EXTENSIONS`.

**Примечание:** При сборке n8n через `pnpm build:n8n` кастомные ноды собираются автоматически.

## Формат сообщений
- **Вход (core → n8n trigger)**:
```json
{
  "workflowId": "123",
  "correlationId": "uuid",
  "payload": { "chat": {}, "message": {} },
  "meta": { "provider": "telegram" },
  "domain": "chat",
  "domainEntityId": "42",
  "companyId": 1,
  "botId": 7
}
```
Нода кладёт содержимое в `items[0].json`.

- **Выход (n8n → core через Output node)**:
  Отправьте `item.json` с полями `executionId`, `workflowId`, `correlationId`, `domain`, `domainEntityId`, `companyId`, `botId`, `event`, `status`, `result`/`error`, `meta`. Обычно `executionId` задаётся выражением `{{$execution.id}}`.
