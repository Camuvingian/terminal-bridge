import { AgentProvider } from './agent-provider.js';

/**
 * Registry for AI providers (Open/Closed Principle).
 *
 * New providers are registered at startup; the rest of the system only
 * interacts through `getActiveProvider()`.  Swapping the active provider
 * is a single `setActiveProvider(id)` call — no handler changes needed.
 */
export class ProviderRegistry {
    private readonly providers = new Map<string, AgentProvider>();
    private activeProviderId: string | null = null;

    register(provider: AgentProvider): void {
        if (this.providers.has(provider.id)) {
            throw new Error(`Provider "${provider.id}" is already registered.`);
        }
        this.providers.set(provider.id, provider);

        // First registered provider becomes the default.
        if (this.activeProviderId === null) {
            this.activeProviderId = provider.id;
        }
    }

    getProvider(id: string): AgentProvider | undefined {
        return this.providers.get(id);
    }

    getActiveProvider(): AgentProvider {
        if (!this.activeProviderId) {
            throw new Error('No providers registered.');
        }
        const provider = this.providers.get(this.activeProviderId);
        if (!provider) {
            throw new Error(`Active provider "${this.activeProviderId}" not found.`);
        }
        return provider;
    }

    setActiveProvider(id: string): void {
        if (!this.providers.has(id)) {
            throw new Error(`Unknown provider: "${id}".`);
        }
        this.activeProviderId = id;
    }

    listProviders(): { id: string; displayName: string; active: boolean }[] {
        return [...this.providers.values()].map((p) => ({
            id: p.id,
            displayName: p.displayName,
            active: p.id === this.activeProviderId,
        }));
    }

    async disposeAll(): Promise<void> {
        const disposals = [...this.providers.values()].map((p) => p.dispose());
        await Promise.allSettled(disposals);
        this.providers.clear();
        this.activeProviderId = null;
    }
}
