import type { ChatMessage } from '../state/chat-state';
import UserMessage from './user-message';
import AssistantMessage from './assistant-message';

interface MessageListProps {
    messages: ChatMessage[];
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
    // Find the last assistant message index
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
            lastAssistantIdx = i;
            break;
        }
    }

    return (
        <div className="message-list">
            {messages.map((msg, i) =>
                msg.role === 'user' ? (
                    <UserMessage key={msg.id} message={msg} />
                ) : (
                    <AssistantMessage key={msg.id} message={msg} isLatest={i === lastAssistantIdx} />
                ),
            )}
        </div>
    );
};

export default MessageList;
