import type { EditPermissionMode } from "../types/sessionTypes";

const EDIT_PERMISSION_TOOL_NAMES = new Set([
    'edit',
    'multiedit',
    'str_replace',
    'str_replace_based_edit_tool',
    'write',
]);

export const isEditPermissionType = (type?: string | null): boolean => {
    if (!type) {
        return false;
    }
    return EDIT_PERMISSION_TOOL_NAMES.has(type.toLowerCase());
};

type PermissionAction = 'allow' | 'deny' | 'ask';

type PermissionRuleValue = PermissionAction | Record<string, PermissionAction>;

type ConfigStoreAgent = {
    name: string;
    permission?: Record<string, PermissionRuleValue>;
};

type ConfigStoreState = {
    agents?: ConfigStoreAgent[];
};

type ConfigStoreRef = { getState?: () => ConfigStoreState };

const resolveConfigStore = (): ConfigStoreRef | undefined => {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return (window as { __zustand_config_store__?: ConfigStoreRef }).__zustand_config_store__;
};

const getAgentDefinition = (agentName?: string): ConfigStoreAgent | undefined => {
    if (!agentName) {
        return undefined;
    }

    try {
        const configStore = resolveConfigStore();
        if (configStore?.getState) {
            const state = configStore.getState();
            return state.agents?.find?.((agent) => agent.name === agentName);
        }
    } catch {
        /* ignored */
    }

    return undefined;
};

const resolvePermissionAction = (
    config: Record<string, PermissionRuleValue> | undefined,
    permission: string,
): PermissionAction => {
    if (!config || typeof config !== 'object') {
        return 'ask';
    }

    const direct = config[permission];
    if (typeof direct === 'string') {
        return direct;
    }

    if (direct && typeof direct === 'object') {
        const fallback = direct['*'];
        if (fallback === 'allow' || fallback === 'deny' || fallback === 'ask') {
            if (fallback === 'deny') {
                return Object.values(direct).some((value) => value === 'allow') ? 'allow' : 'deny';
            }
            return fallback;
        }

        return Object.values(direct).some((value) => value === 'allow') ? 'allow' : 'ask';
    }

    const global = config['*'];
    if (typeof global === 'string') {
        return global;
    }

    return 'ask';
};

export const getAgentDefaultEditPermission = (agentName?: string): EditPermissionMode => {
    const agent = getAgentDefinition(agentName);
    if (!agent) {
        return 'ask';
    }

    const action = resolvePermissionAction(agent.permission, 'edit');
    return action;
};