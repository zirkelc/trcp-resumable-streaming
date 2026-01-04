import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageBubble } from './Message';
import { trpc, trpcClient, type Message } from './trpc';
import { generateId } from '../shared/utils';

export function Chat() {
  const [input, setInput] = useState(``);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClientHook = useQueryClient();

  /* Query to list all messages from server */
  const messagesQuery = useQuery(trpc.listMessages.queryOptions());

  /* Mutation to send a message with streaming response */
  const sendMessageMutation = useMutation({
    mutationKey: trpc.sendMessage.mutationKey(),
    mutationFn: async (content: string) => {
      console.log(`[sendMessage] Starting mutation`);

      /* Set up abort controller for this mutation */
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      /* Create user message */
      const userMessage: Message = {
        id: generateId(`user`),
        content,
        role: `user`,
        createdAt: Date.now(),
        status: `done`,
      };

      /* Add user message to cache immediately */
      queryClientHook.setQueryData<Array<Message>>(
        trpc.listMessages.queryKey(),
        (old = []) => [...old, userMessage]
      );

      /* Send user message to server */
      const stream = await trpcClient.sendMessage.mutate(userMessage, { signal });

      /* Assistant message to be built from chunks */
      const assistantMessage: Message = {
        id: ``,
        content: ``,
        role: `assistant`,
        createdAt: Date.now(),
        status: `streaming`,
      };

      try {
        for await (const chunk of stream) {
          /* Check if interrupted */
          if (signal.aborted) {
            console.log(`[sendMessage] Signal aborted, breaking loop. Current content: "${assistantMessage.content}"`);
            break;
          }

          const { messageId, status, text } = chunk;

          /* Update assistant message */
          assistantMessage.id = messageId;
          assistantMessage.status = status;
          if (text) {
            assistantMessage.content += (assistantMessage.content ? ` ` : ``) + text;
          }

          console.log(`[sendMessage] Received chunk: "${text}", total content: "${assistantMessage.content}"`);

          /* Update assistant message in cache */
          queryClientHook.setQueryData<Array<Message>>(
            trpc.listMessages.queryKey(),
            (old = []) => {
              const updated = [...old];
              const existingIndex = updated.findIndex((m) => m.id === messageId);

              if (existingIndex >= 0) {
                updated.splice(existingIndex, 1, { ...assistantMessage });
              } else {
                updated.push({ ...assistantMessage });
              }

              return updated;
            }
          );
        }
      } catch (error) {
        console.log(`[sendMessage] Error:`, error);
        /* Ignore abort errors */
        if ((error as Error).name === `AbortError`) {
          console.log(`[sendMessage] AbortError caught, returning partial message`);
          return assistantMessage;
        }
        /* Mark message as error in cache */
        if (assistantMessage.id) {
          assistantMessage.status = `error`;
          queryClientHook.setQueryData<Array<Message>>(
            trpc.listMessages.queryKey(),
            (old = []) =>
              old.map((m) =>
                m.id === assistantMessage.id ? { ...assistantMessage } : m
              )
          );
        }
        throw error;
      } finally {
        console.log(`[sendMessage] Finally block, clearing abortControllerRef`);
        abortControllerRef.current = null;
      }

      console.log(`[sendMessage] Mutation complete, returning assistantMessage with content: "${assistantMessage.content}"`);
      return assistantMessage;
    },
    onSuccess: (data) => {
      console.log(`[sendMessage] onSuccess called, message content: "${data.content}"`);
      /* Invalidate messages query to refetch from server */
      queryClientHook.invalidateQueries({ queryKey: trpc.listMessages.queryKey() });
    },
  });

  /* Mutation to clear all messages */
  const clearMessagesMutation = useMutation({
    mutationKey: trpc.clearMessages.mutationKey(),
    mutationFn: () => trpcClient.clearMessages.mutate(),
    onSuccess: () => {
      queryClientHook.setQueryData<Array<Message>>(
        trpc.listMessages.queryKey(),
        []
      );
    },
  });

  /* Mutation to resume a streaming message */
  const resumeMessageMutation = useMutation({
    mutationKey: trpc.resumeMessage.mutationKey(),
    mutationFn: async (message: Message) => {
      console.log(`[resumeMessage] Starting mutation for message id=${message.id}, content="${message.content}"`);

      /* Set up abort controller for this mutation */
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setIsInterrupted(false);

      const stream = await trpcClient.resumeMessage.mutate(
        message,
        { signal }
      );

      /* Build message from current state */
      const resumedMessage: Message = { ...message };

      try {
        for await (const chunk of stream) {
          /* Check if interrupted */
          if (signal.aborted) {
            console.log(`[resumeMessage] Signal aborted, breaking loop`);
            break;
          }

          const { messageId, status, text } = chunk;

          /* Update resumed message */
          resumedMessage.id = messageId;
          resumedMessage.status = status;
          if (text) {
            resumedMessage.content += (resumedMessage.content ? ` ` : ``) + text;
          }

          console.log(`[resumeMessage] Received chunk: "${text}", status: ${status}, total content: "${resumedMessage.content}"`);

          /* Update message in cache */
          queryClientHook.setQueryData<Array<Message>>(
            trpc.listMessages.queryKey(),
            (old = []) => {
              const updated = [...old];
              const existingIndex = updated.findIndex((m) => m.id === messageId);

              if (existingIndex >= 0) {
                updated.splice(existingIndex, 1, { ...resumedMessage });
              }

              return updated;
            }
          );

          if (status === `done`) {
            console.log(`[resumeMessage] Status is done, breaking loop`);
            break;
          }
        }
      } catch (error) {
        console.log(`[resumeMessage] Error:`, error);
        /* Ignore abort errors */
        if ((error as Error).name === `AbortError`) {
          console.log(`[resumeMessage] AbortError caught, returning partial message`);
          return resumedMessage;
        }
        throw error;
      } finally {
        console.log(`[resumeMessage] Finally block, clearing abortControllerRef`);
        abortControllerRef.current = null;
      }

      console.log(`[resumeMessage] Mutation complete, returning message with content: "${resumedMessage.content}"`);
      return resumedMessage;
    },
    onSuccess: (data) => {
      console.log(`[resumeMessage] onSuccess called, message content: "${data.content}"`);
      /* Invalidate messages query to refetch from server */
      queryClientHook.invalidateQueries({ queryKey: trpc.listMessages.queryKey() });
    },
  });

  /* Interrupt the current stream */
  const interruptStream = () => {
    console.log(`[interruptStream] Called, abortControllerRef.current:`, !!abortControllerRef.current);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsInterrupted(true);
      console.log(`[interruptStream] Aborted and set isInterrupted=true`);
    }
  };

  /* Check for streaming message on initial load and auto-resume */
  useEffect(() => {
    const streamingMessage = messagesQuery.data?.find((m) => m.status === `streaming`);

    if (streamingMessage && !resumeMessageMutation.isPending && !isInterrupted && !sendMessageMutation.isPending) {
      resumeMessageMutation.mutate(streamingMessage);
    }
  }, [messagesQuery.data, resumeMessageMutation.isPending, isInterrupted, sendMessageMutation.isPending]);

  const submitMessage = () => {
    if (!input.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(input, { });
    setInput(``);
  };

  const clearMessages = () => {
    clearMessagesMutation.mutate();
  };

  const messages = messagesQuery.data ?? [];
  const streamingMessage = messages.find((m) => m.status === `streaming`);
  const isStreaming = sendMessageMutation.isPending || resumeMessageMutation.isPending;

  return (
    <div>
      <h1>tRPC + TanStack Query Streaming Chat</h1>

      <div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === `Enter`) submitMessage();
          }}
          placeholder="Type your message..."
          disabled={isStreaming}
        />
        <button
          onClick={submitMessage}
          disabled={!input.trim() || isStreaming}
        >
          {sendMessageMutation.isPending ? `Sending...` : `Send`}
        </button>
        <button
          onClick={clearMessages}
          disabled={messages.length === 0 || isStreaming}
        >
          Clear
        </button>
        {isStreaming && (
          <button onClick={interruptStream}>
            Interrupt
          </button>
        )}
        {isInterrupted && streamingMessage && (
          <button onClick={() => resumeMessageMutation.mutate(streamingMessage)}>
            Resume
          </button>
        )}
        {resumeMessageMutation.isPending && (
          <span style={{ marginLeft: `8px`, color: `#666` }}>Resuming...</span>
        )}
      </div>

      <div>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            content={msg.content}
            role={msg.role}
            status={msg.status}
          />
        ))}
      </div>
    </div>
  );
}
