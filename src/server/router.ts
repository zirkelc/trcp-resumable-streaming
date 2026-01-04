import { z } from 'zod';
import { generateId } from '../shared/utils';
import { publicProcedure, router } from './trpc';

/** Zod schema for message input */
const messageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.enum([`user`, `assistant`]),
  createdAt: z.number(),
  status: z.enum([`streaming`, `done`, `error`]),
});

/** Message type inferred from Zod schema */
type Message = z.infer<typeof messageSchema>;

/** Structured chunk yielded during streaming */
type StreamChunk = {
  messageId: string;
  status: Message['status'];
  text: string;
};

/** In-memory message storage */
const messages: Array<Message> = [];

/** Predefined bot responses */
const responses = [
  `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`,
];

/** Simulated LLM API that returns a ReadableStream of words */
function completion(): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      console.log(`[completion] Starting`);

      /* Simulate AI thinking */
      await new Promise((resolve) => setTimeout(resolve, 500));

      /* Pick a random response */
      const response = responses[Math.floor(Math.random() * responses.length)]!;
      const words = response.split(` `);

      /* Stream words one by one */
      for (const word of words) {
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 300));
        console.log(`[completion] Enqueuing word: "${word}"`);
        controller.enqueue(word);
      }

      console.log(`[completion] Complete`);
      controller.close();
    },
  });
}

/** Consumes a ReadableStream and updates the message in the background */
function consumeStream(
  stream: ReadableStream<string>,
  message: Message,
): void {
  /* Fire and forget - runs to completion independently of HTTP connection */
  (async () => {
    console.log(`[consumeStream] Starting for message ${message.id}`);
    try {
      const reader = stream.getReader();
      while (true) {
        const { done, value: word } = await reader.read();
        if (done) break;

        message.content += (message.content ? ` ` : ``) + word;
        console.log(`[consumeStream] Word: "${word}", total: "${message.content}"`);
      }
      message.status = `done`;
      console.log(`[consumeStream] Complete for message ${message.id}`);
    } catch (error) {
      message.status = `error`;
      console.error(`[consumeStream] Error for message ${message.id}:`, error);
    }
  })();
}

/** Converts a ReadableStream to an AsyncGenerator of StreamChunks */
async function* convertReadableStreamToAsyncIterable(
  stream: ReadableStream<string>,
  messageId: string,
): AsyncGenerator<StreamChunk> {
  console.log(`[convertReadableStreamToAsyncIterable] Starting for message ${messageId}`);

  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value: word } = await reader.read();
      if (done) break;

      console.log(`[convertReadableStreamToAsyncIterable] Yielding word: "${word}"`);
      yield {
        messageId,
        status: `streaming`,
        text: word,
      };
    }

    console.log(`[convertReadableStreamToAsyncIterable] Done`);
    yield { messageId, status: `done`, text: `` };
  } finally {
    reader.releaseLock();
  }
}

/** Polls a message and yields chunks as they become available */
async function* pollMessage(
  message: Message,
  startWordCount: number,
): AsyncGenerator<StreamChunk> {
  console.log(`[pollMessage] Starting for message ${message.id}, startWordCount=${startWordCount}`);

  let lastWordCount = startWordCount;

  while (true) {
    const words = message.content.split(` `).filter(Boolean);

    /* Yield any new words since last check */
    for (let i = lastWordCount; i < words.length; i++) {
      console.log(`[pollMessage] Yielding word: "${words[i]}"`);
      yield {
        messageId: message.id,
        status: `streaming`,
        text: words[i]!,
      };
    }
    lastWordCount = words.length;

    /* Check if done */
    if (message.status === `done`) {
      console.log(`[pollMessage] Message is done, exiting`);
      yield { messageId: message.id, status: `done`, text: `` };
      break;
    }

    /* Check if error */
    if (message.status === `error`) {
      console.log(`[pollMessage] Message has error, exiting`);
      yield { messageId: message.id, status: `error`, text: `` };
      break;
    }

    /* Poll interval */
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const appRouter = router({
  /** Query to list all messages */
  listMessages: publicProcedure.query(() => {
    return messages;
  }),

  /** Mutation to clear all messages */
  clearMessages: publicProcedure.mutation(() => {
    messages.length = 0;
  }),

  /** Mutation to send a message and get streaming response */
  sendMessage: publicProcedure
    .input(messageSchema)
    .mutation(async function* ({ input }): AsyncGenerator<StreamChunk> {
      console.log(`[sendMessage] Called with user message id=${input.id}, content: "${input.content}"`);

      /* Store user message (passed from client) */
      messages.push(input);

      /* Create assistant message placeholder */
      const assistantMessage: Message = {
        id: generateId(`assistant`),
        content: ``,
        role: `assistant`,
        createdAt: Date.now(),
        status: `streaming`,
      };
      messages.push(assistantMessage);

      console.log(`[sendMessage] Created assistant message ${assistantMessage.id}`);

      /* Get completion stream and tee it */
      const stream = completion();
      const [stream1, stream2] = stream.tee();

      /* Start background consumer - updates message for resumeMessage */
      consumeStream(stream1, assistantMessage);

      /* Yield chunks directly to client */
      yield* convertReadableStreamToAsyncIterable(stream2, assistantMessage.id);
    }),

  /** Mutation to resume a streaming message */
  resumeMessage: publicProcedure
    .input(messageSchema)
    .mutation(async function* ({ input }): AsyncGenerator<StreamChunk> {
      console.log(`[resumeMessage] Called with id=${input.id}, content="${input.content}"`);

      const message = messages.find((m) => m.id === input.id);

      if (!message) {
        console.log(`[resumeMessage] Message not found!`);
        throw new Error(`Message not found`);
      }

      console.log(`[resumeMessage] Server message status: ${message.status}, content: "${message.content}"`);

      const startWordCount = input.content.split(` `).filter(Boolean).length;
      console.log(`[resumeMessage] Client has ${startWordCount} words`);

      /* Poll and yield chunks */
      yield* pollMessage(message, startWordCount);
    }),
});

/** Export type router type signature, NOT the router itself */
export type AppRouter = typeof appRouter;
