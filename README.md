# tRPC + TanStack Query Streaming Chat

A demo application showcasing **resumable streaming** with tRPC v11, TanStack Query v5, and React 19.

## Features

- **Streaming mutations** - Server yields chunks via async generators, client updates UI in real-time
- **Resumable streams** - If client disconnects mid-stream, it can resume from where it left off
- **Interrupt & Resume** - User can manually interrupt a stream and resume later
- **Background persistence** - Server continues processing even when client disconnects

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          SERVER                                  │
│                                                                  │
│  sendMessage()                                                   │
│    │                                                             │
│    ├─► Create user + bot messages                                │
│    ├─► completion() → ReadableStream                             │
│    ├─► tee() splits stream into two branches                     │
│    │     ├─► consumeStream() - background task, updates message  │
│    │     └─► yield chunks directly to client                     │
│    │                                                             │
│  resumeMessage()                                                 │
│    └─► pollMessage() - yields delta chunks from in-memory state  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

When `sendMessage` is called:
1. A `ReadableStream` is created (simulating an LLM API)
2. The stream is `tee()`'d into two branches
3. One branch feeds `consumeStream()` - a fire-and-forget background task that updates the message in memory (simulating DB persistence)
4. The other branch yields chunks directly to the client 

If the client disconnects, the background task continues. When `resumeMessage` is called:
1. Client sends its current content
2. Server calculates the delta (words client is missing)
3. Server polls the message and yields remaining chunks

## Project Structure

```
├── src/
│   ├── shared/
│   │   └── utils.ts      # Shared utilities (generateId)
│   ├── server/
│   │   ├── index.ts      # HTTP server with CORS
│   │   ├── router.ts     # tRPC router with procedures
│   │   └── trpc.ts       # tRPC initialization
│   └── client/
│       ├── App.tsx       # QueryClientProvider + DevTools
│       ├── Chat.tsx      # Main chat component
│       ├── Message.tsx   # Message display component
│       ├── trpc.ts       # tRPC client setup + inferred types
│       └── main.tsx      # React entry point
└── package.json
```

## API Reference

### Queries

#### `listMessages`
Returns all messages from in-memory storage.

- **Returns**: `Message[]`

### Mutations

#### `sendMessage`
Sends a user message and streams back an assistant response.

- **Input**: `Message` (full user message object)
- **Yields**: `AsyncGenerator<StreamChunk>`
- **Behavior**: 
  - Stores user message (passed from client)
  - Creates assistant message (status: `streaming`)
  - Starts background task to update message
  - Yields chunks to client
  - Sets status to `done` when complete

#### `resumeMessage`
Resumes a streaming message from the client's current position.

- **Input**: `Message`
- **Yields**: `AsyncGenerator<StreamChunk>`
- **Behavior**:
  - Finds message by ID
  - Calculates delta (words client doesn't have)
  - Polls message and yields new chunks
  - Continues until status is `done`

#### `clearMessages`
Clears all messages from storage.

- **Returns**: `void`

## Running the Project

### Install Dependencies

```bash
pnpm install
```

### Start Development Servers

You need two terminals:

```bash
# Terminal 1 - Start the tRPC server (port 3000)
pnpm dev:server

# Terminal 2 - Start the Vite dev server (port 5173)
pnpm dev:client
```

Open http://localhost:5173 in your browser.

## Testing the Features

### Basic Streaming
1. Type a message and click **Send**
2. Watch the bot response stream in word by word

### Interrupt & Resume
1. Send a message
2. Click **Interrupt** while streaming
3. Click **Resume** to continue from where you left off

### Page Reload Resume
1. Send a message
2. Reload the page mid-stream (or open a new tab)
3. The stream automatically resumes

## Key Implementation Details

### Why Background Tasks?

tRPC's `createHTTPServer` creates an `AbortController` that triggers when the client disconnects. This causes server-side async generators to stop. To work around this, we use a fire-and-forget background task (`consumeStream`) that runs independently of the HTTP connection.

### Stream Tee Pattern

```ts
const stream = completion();
const [stream1, stream2] = stream.tee();

consumeStream(stream1, assistantMessage);  // Background - updates message
yield* convertReadableStreamToAsyncIterable(stream2, assistantMessage.id);  // Client
```

### Polling for Resume

`resumeMessage` uses polling because the original stream connection is gone. It reads the message object (which is being updated by `consumeStream`) every 50ms and yields new words as they appear.

## License

MIT
