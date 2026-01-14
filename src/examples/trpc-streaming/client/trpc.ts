import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../server/router';

/* Infer types from router */
type RouterOutput = inferRouterOutputs<AppRouter>;

/* Message type inferred from listMessages output */
export type Message = RouterOutput['listMessages'][number];

export const queryClient = new QueryClient();

const apiPort = import.meta.env.VITE_API_PORT ?? 3000;

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: `http://localhost:${apiPort}`,
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
