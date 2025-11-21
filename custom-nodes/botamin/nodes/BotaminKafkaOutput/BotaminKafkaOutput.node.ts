import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { Kafka, logLevel } from 'kafkajs';

export class BotaminKafkaOutput implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Botamin Kafka Output',
    name: 'botaminKafkaOutput',
    icon: 'file:kafka.svg',
    group: ['output'],
    version: 1,
    description: 'Отправляет результат workflow в Kafka для core. Только входящая нода — данные не передаются дальше.',
    defaults: {
      name: 'Botamin Kafka Output',
    },
    inputs: ['main'],
    outputs: [],
    properties: [
      {
        displayName: 'Kafka Brokers',
        name: 'brokers',
        type: 'string',
        default: '',
        placeholder: 'localhost:29092',
        description:
          'Список брокеров через запятую. Если пусто — берется из переменной окружения KAFKA_BROKERS или localhost:29092',
      },
      {
        displayName: 'Topic',
        name: 'topic',
        type: 'string',
        default: 'botamin.n8n.output',
        description: 'Топик, куда публикуется результат для core',
        required: true,
      },
      {
        displayName: 'Execution ID',
        name: 'executionId',
        type: 'string',
        default: '={{$execution.id}}',
        description: 'ID выполнения workflow в n8n. По умолчанию используется {{$execution.id}}',
        required: true,
      },
      {
        displayName: 'Response Text',
        name: 'responseText',
        type: 'string',
        default: '',
        description:
          'Текст ответа, который будет отправлен пользователю. Можно использовать выражения n8n, например {{$json.text}} или {{$json.message}}',
        required: true,
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        default: 'success',
        description: 'Статус выполнения workflow',
        options: [
          {
            name: 'Success',
            value: 'success',
          },
          {
            name: 'Error',
            value: 'error',
          },
          {
            name: 'Running',
            value: 'running',
          },
          {
            name: 'Waiting',
            value: 'waiting',
          },
          {
            name: 'Canceled',
            value: 'canceled',
          },
        ],
      },
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        default: 'ChatMessageResponse',
        description: 'Тип события',
        required: true,
        options: [
          {
            name: 'Chat Message Response',
            value: 'ChatMessageResponse',
            description: 'Ответ на сообщение в чате (текст, контекст, статус)',
          },
        ],
      },
      {
        displayName: 'Error Message',
        name: 'error',
        type: 'string',
        default: '',
        description:
          'Сообщение об ошибке (если status = error). Можно использовать выражения n8n.',
        displayOptions: {
          show: {
            status: ['error'],
          },
        },
      },
      {
        displayName: 'Chat Context',
        name: 'chatContext',
        type: 'json',
        default: '{}',
        description:
          'Контекст чата для обновления. Будет автоматически объединен с существующим контекстом чата в core. Можно использовать выражения n8n, например: {{ { "variables": $json.slots, "userIntent": $json.intent } }}',
        displayOptions: {
          show: {
            event: ['ChatMessageResponse'],
          },
        },
        required: false,
      },
      {
        displayName: 'Chat Status',
        name: 'chatStatus',
        type: 'options',
        default: '',
        description:
          'Статус чата. Если выбран - обновит статус чата в core. Пустое значение - не изменять статус.',
        displayOptions: {
          show: {
            event: ['ChatMessageResponse'],
          },
        },
        options: [
          {
            name: 'Не изменять',
            value: '',
          },
          {
            name: 'Снять со стопа',
            value: 'activate',
          },
          {
            name: 'Остановить',
            value: 'stop',
          },
          {
            name: 'Пометить как лид',
            value: 'lead',
          },
          {
            name: 'Убрать пометку лида',
            value: 'unlead',
          },
        ],
        required: false,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const brokersRaw = (this.getNodeParameter('brokers', 0) as string) || '';
    const topic = this.getNodeParameter('topic', 0) as string;
    const status = this.getNodeParameter('status', 0) as string;

    const brokersEnv = process.env.KAFKA_BROKERS || 'localhost:29092';
    const brokers = (brokersRaw || brokersEnv)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    if (!brokers.length) {
      throw new Error('Не указаны Kafka brokers (параметр или KAFKA_BROKERS)');
    }

    if (!topic) {
      throw new Error('Topic обязателен');
    }

    const kafka = new Kafka({
      clientId: 'n8n-botamin-output',
      brokers,
      logLevel: logLevel.NOTHING,
    });

    const producer = kafka.producer();
    await producer.connect();

    const messages = items.map((item, index) => {
      // Вычисляем значения выражений для каждого item
      const executionId = this.getNodeParameter('executionId', index) as string;
      const responseText = this.getNodeParameter('responseText', index) as string;
      const event = (this.getNodeParameter('event', index) as string) || 'ChatMessageResponse';
      const error = status === 'error' 
        ? ((this.getNodeParameter('error', index) as string) || undefined)
        : undefined;
      
      // Поля для ChatMessageResponse
      let chatContext: Record<string, any> | undefined = undefined;
      const chatStatus = (this.getNodeParameter('chatStatus', index) as string) || undefined;
      
      if (event === 'ChatMessageResponse') {
        try {
          const contextStr = this.getNodeParameter('chatContext', index) as string;
          if (contextStr && contextStr.trim()) {
            chatContext = typeof contextStr === 'string' ? JSON.parse(contextStr) : contextStr;
          }
        } catch (e) {
          // Игнорируем ошибки парсинга
        }
      }

      // Берем данные из триггера (из item.json)
      const triggerData = item.json || {};
      // Если workflowId нет в триггере, берем из переменной $workflow.id
      let workflowId = triggerData.workflowId;
      if (!workflowId) {
        try {
          const workflowProxy = this.getWorkflowDataProxy(index);
          workflowId = workflowProxy.$workflow?.id as string | undefined;
        } catch (e) {
          // Игнорируем ошибки
        }
      }
      const correlationId = triggerData.correlationId;
      const domain = triggerData.domain || 'chat';
      const domainEntityId = triggerData.domainEntityId;
      const companyId = triggerData.companyId;
      const botId = triggerData.botId;
      const triggerMeta = triggerData.meta && typeof triggerData.meta === 'object' 
        ? triggerData.meta as Record<string, any>
        : {};

      // Формируем payload для отправки в Kafka
      const result: Record<string, any> = {};
      
      if (responseText) {
        result.text = responseText;
      }

      // Добавляем поля для ChatMessageResponse в result
      if (event === 'ChatMessageResponse') {
        if (chatContext && Object.keys(chatContext).length > 0) {
          result.chatContext = chatContext;
        }
        if (chatStatus) {
          result.chatStatus = chatStatus;
        }
      }

      const payload: Record<string, any> = {
        executionId: String(executionId),
        workflowId: workflowId ? String(workflowId) : undefined,
        correlationId,
        status,
        domain,
        domainEntityId,
        companyId,
        botId,
        event,
        result: Object.keys(result).length > 0 ? result : undefined,
        meta: triggerMeta || {},
      };

      if (error) {
        payload.error = error;
      }

      return {
        value: JSON.stringify(payload),
      };
    });

    // Отправляем все сообщения
    if (messages.length > 0) {
      await producer.send({
        topic,
        messages,
      });
    }

    await producer.disconnect();

    // Не возвращаем данные, так как это конечная нода
    return [[]];
  }
}

