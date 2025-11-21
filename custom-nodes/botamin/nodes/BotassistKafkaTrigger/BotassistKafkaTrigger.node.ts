import {
  ITriggerFunctions,
  ITriggerResponse,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { Consumer, Kafka, logLevel } from 'kafkajs';

export class BotassistKafkaTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Botassist Kafka Trigger',
    name: 'botassistKafkaTrigger',
    icon: 'file:kafka.svg',
    group: ['trigger'],
    version: 1,
    description:
      'Начинает выполнение workflow при получении сообщения из Kafka от Botassist',
    defaults: {
      name: 'Botassist Kafka Trigger',
    },
    inputs: [],
    outputs: ['main'],
    credentials: [],
    properties: [
      {
        displayName: 'Kafka Brokers',
        name: 'brokers',
        type: 'string',
        default: '',
        placeholder: 'localhost:29092',
        description:
          'Список брокеров через запятую. Если пусто — возьмется из переменной окружения KAFKA_BROKERS или localhost:29092',
      },
      {
        displayName: 'Topic',
        name: 'topic',
        type: 'string',
        default: 'botassist.n8n.input',
        description: 'Топик, куда core публикует события для n8n',
        required: true,
      },
      {
        displayName: 'Group ID',
        name: 'groupId',
        type: 'string',
        default: 'n8n-botassist-trigger',
        description: 'Идентификатор consumer group для этого workflow',
        required: true,
      },
      {
        displayName: 'Start From Beginning',
        name: 'fromBeginning',
        type: 'boolean',
        default: false,
        description: 'Подписаться с начала топика (по умолчанию только новые сообщения)',
      },
      {
        displayName: 'Workflow Filter',
        name: 'workflowFilter',
        type: 'string',
        default: '',
        description:
          'Если указано, пропускать сообщения, у которых workflowId не совпадает (удобно, если один топик на все workflow)',
      },
      {
        displayName: 'Parse JSON',
        name: 'parseJson',
        type: 'boolean',
        default: true,
        description: 'Парсить value как JSON. Если false — класть строку в поле data',
      },
    ],
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const brokersRaw = (this.getNodeParameter('brokers', 0) as string) || '';
    const topic = this.getNodeParameter('topic', 0) as string;
    const groupId = this.getNodeParameter('groupId', 0) as string;
    const fromBeginning = this.getNodeParameter('fromBeginning', 0) as boolean;
    const workflowFilter = (this.getNodeParameter('workflowFilter', 0) as string) || '';
    const parseJson = this.getNodeParameter('parseJson', 0) as boolean;

    const brokersEnv = process.env.KAFKA_BROKERS || 'localhost:29092';
    const brokers = (brokersRaw || brokersEnv)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    if (!brokers.length) {
      throw new Error('Не указаны Kafka brokers (параметр или KAFKA_BROKERS)');
    }

    const kafka = new Kafka({
      clientId: 'n8n-botassist-trigger',
      brokers,
      logLevel: logLevel.NOTHING,
    });

    const consumer: Consumer = kafka.consumer({
      groupId: groupId || 'n8n-botassist-trigger',
    });

    const emitItem = async (rawPayload: any) => {
      // Фильтрация по workflowId (если нужно)
      if (workflowFilter) {
        const workflowIdFromPayload =
          typeof rawPayload === 'object' && rawPayload
            ? rawPayload.workflowId
            : undefined;
        if (
          workflowIdFromPayload !== undefined &&
          String(workflowIdFromPayload) !== workflowFilter
        ) {
          return;
        }
      }

      const items = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
      const normalized = items.map((item) => {
        if (item !== null && typeof item === 'object') {
          return item as Record<string, any>;
        }
        return { data: item };
      });

      await this.emit([this.helpers.returnJsonArray(normalized)]);
    };

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning });

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic: msgTopic, partition, message }) => {
        if (!message.value) {
          return;
        }

        const rawValue = message.value.toString();
        let payload: any = rawValue;

        if (parseJson) {
          try {
            payload = JSON.parse(rawValue);
          } catch (error) {
            payload = {
              parseError: (error as Error).message,
              raw: rawValue,
            };
          }
        }

        try {
          await emitItem(payload);
          await consumer.commitOffsets([
            {
              topic: msgTopic,
              partition,
              offset: (Number(message.offset) + 1).toString(),
            },
          ]);
        } catch (error) {
          // При ошибке не коммитим offset — сообщение будет переобработано
          // eslint-disable-next-line no-console
          console.error('Kafka trigger error:', (error as Error).message);
        }
      },
    });

    return {
      closeFunction: async () => {
        await consumer.disconnect();
      },
      manualTriggerFunction: async () => {
        // Для ручного запуска ничего дополнительного не делаем — ждем первое сообщение
      },
    };
  }
}
