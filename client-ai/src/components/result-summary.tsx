import { useMemo } from 'react';
import type { AgentUsage } from '@shared/ai-protocol';

interface ResultSummaryProps {
    usage?: AgentUsage;
    durationMs?: number;
}

const completionKeywords = [
    'Nailed it',
    'Done and dusted',
    'Mission complete',
    'Delivered',
    'Wrapped up',
    'All set',
    'Finished strong',
    'Task conquered',
    'Result forged',
    'Knowledge dispensed',
    'Output crystallized',
    'Response deployed',
    'Wisdom transmitted',
    'Computation complete',
    'Thoughts materialized',
];

const ResultSummary: React.FC<ResultSummaryProps> = ({ usage, durationMs }) => {
    const keyword = useMemo(() => completionKeywords[Math.floor(Math.random() * completionKeywords.length)], []);

    if (!usage && durationMs === undefined) {
        return null;
    }

    const hasTokens = usage && (usage.inputTokens > 0 || usage.outputTokens > 0);

    return (
        <div className="result-summary">
            <span className="result-summary-text">
                {hasTokens && (
                    <>
                        Tokens in: <strong>{formatTokens(usage.inputTokens)}</strong> out:{' '}
                        <strong>{formatTokens(usage.outputTokens)}</strong>
                        {' · '}
                    </>
                )}
                {keyword}
                {durationMs !== undefined && <> in {formatDuration(durationMs)}</>}
            </span>
        </div>
    );
};

function formatTokens(n: number): string {
    return n.toLocaleString('en-US');
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

export default ResultSummary;
