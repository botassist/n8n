# n8n Production Deployment

## Queue Mode Configuration

Для работы n8n в режиме очередей с воркерами необходимо настроить следующие переменные окружения в файле `.env.vars`:

### Обязательные переменные для Queue Mode:

```bash
# Queue Mode
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=valkey.infra
QUEUE_BULL_REDIS_PORT=6379
QUEUE_BULL_REDIS_DB=0
OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true

# Database (PostgreSQL)
# n8n не поддерживает DATABASE_URL напрямую, нужно использовать отдельные переменные
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=ailab-pg-rw.infra
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=app
DB_POSTGRESDB_PASSWORD=
DB_POSTGRESDB_SCHEMA=public

# n8n Basic Configuration
N8N_HOST=n8n.bot-assist.online
N8N_PORT=5678
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.bot-assist.online/

# Encryption (обязательно для production)
N8N_ENCRYPTION_KEY=<your-encryption-key>

# Task Runners (для выполнения Python/JavaScript кода)
N8N_RUNNERS_ENABLED=true
N8N_RUNNERS_MODE=external
N8N_RUNNERS_BROKER_LISTEN_ADDRESS=0.0.0.0
N8N_RUNNERS_AUTH_TOKEN=<generate-secure-token>
N8N_NATIVE_PYTHON_RUNNER=true

# Optional: License (если используется Enterprise)
# N8N_LICENSE_ACTIVATION_KEY=<license-key>
# N8N_LICENSE_CERT=<license-cert>
```

### Описание переменных:

- **EXECUTIONS_MODE=queue** - Включает режим очередей
- **QUEUE_BULL_REDIS_HOST** - Хост Redis (используется valkey.infra в инфраструктуре)
- **QUEUE_BULL_REDIS_PORT** - Порт Redis (6379)
- **QUEUE_BULL_REDIS_DB** - Номер базы данных Redis (можно использовать отдельную БД для n8n)
- **OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS** - Передавать ручные запуски воркфлоу воркерам

### Архитектура:

- **Main процесс** (`deployment-main.yaml`): Принимает запросы, управляет UI, ставит задачи в очередь Redis (не обрабатывает задачи, поэтому достаточно 1 реплики)
- **Worker процессы** (`deployment-worker.yaml`): Обрабатывают воркфлоу из очереди Redis

### Масштабирование:

- **Main процесс**: 1 реплика (достаточно для приема запросов и постановки задач в очередь)
- **Worker процессы**: По умолчанию 2 реплики, можно увеличить для большей производительности обработки воркфлоу

## Python Code Execution

n8n поддерживает выполнение Python кода через **Task Runners**. Для production рекомендуется использовать **Native Python Runner** (внешний runner), а не Pyodide (в браузере).

### Настройка Python Task Runners:

1. **Включить Task Runners:**
   - `N8N_RUNNERS_ENABLED=true` - включает task runners
   - `N8N_RUNNERS_MODE=external` - использует внешние runners (sidecar контейнеры)
   - `N8N_NATIVE_PYTHON_RUNNER=true` - включает Native Python runner (вместо Pyodide)

2. **Task Broker:**
   - `N8N_RUNNERS_BROKER_LISTEN_ADDRESS=0.0.0.0` - адрес для прослушивания Task Broker
   - `N8N_RUNNERS_AUTH_TOKEN` - токен для аутентификации между n8n и runners (сгенерируйте безопасный токен)

3. **Использование в Code Node:**
   - В узле "Code" выберите язык "Python Native" (не "Python")
   - Python код будет выполняться во внешнем runner контейнере, что намного быстрее чем Pyodide

### Примечания:

- Task Runners работают на воркерах, которые обрабатывают воркфлоу
- Для работы Python runners нужен sidecar контейнер `n8nio/runners` (можно добавить как initContainer или отдельный deployment)
- Native Python runner поддерживает стандартные библиотеки Python и внешние пакеты (если установлены в runner образе)

