import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage } from '../state/chat-state';
import ThinkingBlock from './thinking-block';
import ToolUseBlock from './tool-use-block';
import ResultSummary from './result-summary';

interface AssistantMessageProps {
    message: ChatMessage;
    isLatest: boolean;
}

const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, isLatest }) => {
    const bubbleClass = 'assistant-bubble' + (isLatest ? ' assistant-bubble-latest' : '');

    return (
        <div className="assistant-message">
            <div className={bubbleClass}>
                {message.thinking && <ThinkingBlock text={message.thinking} />}

                {message.toolUses.map((tool) => (
                    <ToolUseBlock key={tool.toolUseId} tool={tool} />
                ))}

                {message.text && (
                    <div className="assistant-text">
                        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
                            {message.text}
                        </Markdown>
                    </div>
                )}

                {message.usage && <ResultSummary usage={message.usage} durationMs={message.durationMs} />}
            </div>
        </div>
    );
};

export default AssistantMessage;
