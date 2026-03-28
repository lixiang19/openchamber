import React from 'react';
import type { PiSessionViewState } from '@/lib/pi/types';
import { projectPiSessionToTurnRecords } from '../lib/turns/projectTurnRecords';
import { stabilizeTurnProjection } from '../lib/turns/stabilizeTurnProjection';
import type { TurnProjectionResult } from '../lib/turns/types';

interface UseTurnRecordsOptions {
    showTextJustificationActivity: boolean;
    piSession?: PiSessionViewState | null;
}

export interface TurnRecordsResult {
    projection: TurnProjectionResult;
    staticTurns: TurnProjectionResult['turns'];
    streamingTurn: TurnProjectionResult['turns'][number] | undefined;
}

export const useTurnRecords = (
    _messages: unknown[],
    options: UseTurnRecordsOptions,
): TurnRecordsResult => {
    const previousProjectionRef = React.useRef<TurnProjectionResult | null>(null);

    React.useEffect(() => {
        previousProjectionRef.current = null;
    }, [options.showTextJustificationActivity]);

    // Pi-native: 直接从 Pi session 构建 turn 记录
    const projection = React.useMemo(() => {
        if (!options.piSession) {
            return {
                turns: [],
                indexes: { turnById: new Map(), messageToTurnId: new Map(), messageMetaById: new Map() },
                lastTurnId: null,
                lastTurnMessageIds: new Set(),
                ungroupedMessageIds: new Set(),
                piMessages: new Map(),
            } as TurnProjectionResult;
        }
        const rawProjection = projectPiSessionToTurnRecords(options.piSession, {
            previousProjection: previousProjectionRef.current,
            showTextJustificationActivity: options.showTextJustificationActivity,
        });
        const stabilizedProjection = stabilizeTurnProjection(rawProjection, previousProjectionRef.current);
        previousProjectionRef.current = stabilizedProjection;
        return stabilizedProjection;
    }, [options.piSession, options.showTextJustificationActivity]);

    const staticTurns = React.useMemo(() => {
        if (projection.turns.length <= 1) {
            return [];
        }
        return projection.turns.slice(0, -1);
    }, [projection.turns]);

    const streamingTurn = React.useMemo(() => {
        if (projection.turns.length === 0) {
            return undefined;
        }
        return projection.turns[projection.turns.length - 1];
    }, [projection.turns]);

    return {
        projection,
        staticTurns,
        streamingTurn,
    };
};
