import React from 'react';
import type { PiSessionViewState } from '@/lib/pi/types';
import { projectPiSessionToTurnRecords } from '../lib/turns/projectTurnRecords';
import { stabilizeTurnProjection } from '../lib/turns/stabilizeTurnProjection';
import type { TurnProjectionResult } from '../lib/turns/types';

export interface UsePiNativeTurnsResult {
    projection: TurnProjectionResult | null;
    isLoading: boolean;
}

/**
 * Pi-native hook：直接从 Pi session 构建 turn 记录
 * 完全跳过 ChatMessageEntry 投影，直接消费 Pi-native 数据
 */
export const usePiNativeTurns = (
    session: PiSessionViewState | null,
): UsePiNativeTurnsResult => {
    const previousProjectionRef = React.useRef<TurnProjectionResult | null>(null);
    const previousSessionIdRef = React.useRef<string | null>(null);

    // 当 session 切换时重置缓存
    React.useEffect(() => {
        if (session?.id !== previousSessionIdRef.current) {
            previousProjectionRef.current = null;
            previousSessionIdRef.current = session?.id ?? null;
        }
    }, [session?.id]);

    const projection = React.useMemo(() => {
        if (!session) {
            return null;
        }

        const rawProjection = projectPiSessionToTurnRecords(session, {
            previousProjection: previousProjectionRef.current,
        });

        const stabilizedProjection = stabilizeTurnProjection(rawProjection, previousProjectionRef.current);
        previousProjectionRef.current = stabilizedProjection;
        return stabilizedProjection;
    }, [session]);

    return {
        projection,
        isLoading: false,
    };
};
