import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../state/chat-state';
import MessageList from './message-list';
import ThinkingAnimation from './thinking-animation';

interface ChatAreaProps {
    messages: ChatMessage[];
    isQuerying: boolean;
}

const ChatArea: React.FC<ChatAreaProps> = ({ messages, isQuerying }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new messages or when thinking starts
    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [messages, isQuerying]);

    if (messages.length === 0 && !isQuerying) {
        return (
            <div className="chat-area" ref={scrollRef}>
                <div className="empty-state">Send a message to get started</div>
            </div>
        );
    }

    return (
        <div className="chat-area" ref={scrollRef}>
            <MessageList messages={messages} />
            {isQuerying && (
                <div className="thinking-indicator">
                    <ThinkingAnimation />
                </div>
            )}
        </div>
    );
};

export default ChatArea;
