import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from './trpc';
import { Chat } from './Chat';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Chat />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
