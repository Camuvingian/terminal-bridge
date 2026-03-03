import type { ChatMessage } from '../state/chat-state';

interface UserMessageProps {
    message: ChatMessage;
}

const UserMessage: React.FC<UserMessageProps> = ({ message }) => {
    return (
        <div className="user-message">
            <div className="user-bubble">{message.text}</div>
        </div>
    );
};

export default UserMessage;
