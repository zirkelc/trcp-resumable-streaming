type MessageRole = 'user' | 'assistant';
type MessageStatus = 'streaming' | 'done' | 'error';

type MessageBubbleProps = {
  content: string;
  role: MessageRole;
  status: MessageStatus;
};

export function MessageBubble({ content, role, status }: MessageBubbleProps) {
  const prefix = role === `user` ? `You: ` : `Assistant: `;

  return (
    <div>
      <strong>{prefix}</strong>
      {content}
      {status === `streaming` ? ` ...` : null}
      {status === `error` ? ` [Error]` : null}
    </div>
  );
}
