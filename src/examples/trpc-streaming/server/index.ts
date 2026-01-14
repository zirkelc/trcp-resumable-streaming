import cors from 'cors';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router';

const server = createHTTPServer({
  router: appRouter,
  createContext: () => ({}),
  middleware: cors(),
});

const port = process.env.PORT ?? 3000;
server.listen(port);
console.log(`tRPC server listening on http://localhost:${port}`);
