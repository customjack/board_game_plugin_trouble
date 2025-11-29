/**
 * Trouble Plugin - Entry point for CDN loading
 * 
 * This plugin registers the Trouble game engine.
 * Based on the working version from commit f73ff38.
 */

// Import factory functions for trouble-specific classes
import { createTroubleGameEngine } from './engine/TroubleGameEngine.js';
// Import bundled map data
import { troubleClassicMap } from './maps/trouble-classic.js';
import { TROUBLE_PLUGIN_VERSION } from './version.js';

/**
 * Factory function that receives dependencies and returns the plugin class
 * @param {Object} bundle - Dependency injection bundle
 * @returns {Class} TroublePlugin class
 */
export default function createTroublePlugin(bundle) {
    // Extract dependencies from bundle
    const { Plugin, GameEngineFactory, MultiPieceManager } = bundle;

    // Create trouble-specific engine using factory
    const TroubleGameEngine = createTroubleGameEngine(bundle);

    /**
     * TroublePlugin - Registers the Trouble engine
     */
    class TroublePlugin extends Plugin {
        initialize(eventBus, registryManager, factoryManager) {
            this.eventBus = eventBus;
            this.registryManager = registryManager;
            this.factoryManager = factoryManager;

            // Register Trouble game engine
            if (!GameEngineFactory.isRegistered('trouble')) {
                GameEngineFactory.register('trouble', TroubleGameEngine);
                console.log('[TroublePlugin] Registered TroubleGameEngine');
            }

            // Register multi-piece manager for rendering multiple pawns
            const pieceRegistry = registryManager.getPieceManagerRegistry?.();
            if (pieceRegistry) {
                if (!pieceRegistry.get('multi-piece')) {
                    pieceRegistry.register('multi-piece', MultiPieceManager);
                }
                if (!pieceRegistry.get('trouble')) {
                    pieceRegistry.register('trouble', MultiPieceManager);
                }
            }

            // Register bundled maps using PluginMapProvider
            this.registerBundledMaps();
        }

        registerBundledMaps() {
            try {
                // Get plugin metadata for the plugin ID
                const metadata = this.constructor.getPluginMetadata();
                const pluginId = metadata.id;

                // Create a map provider for this plugin using the bundle's convenience method
                if (bundle.createMapProvider) {
                    const mapProvider = bundle.createMapProvider(pluginId);
                    
                    // Register the bundled map
                    mapProvider.registerMap(troubleClassicMap, {
                        id: 'trouble-classic',
                        name: 'Trouble Classic',
                        author: 'Jack Carlton',
                        description: 'Four-player race to your finish lane.'
                    });

                    // Store the map provider for cleanup
                    this.mapProvider = mapProvider;
                    
                    console.log('[TroublePlugin] Registered bundled map: Trouble Classic');
                } else {
                    console.warn('[TroublePlugin] createMapProvider not available in bundle');
                }
            } catch (error) {
                console.error('[TroublePlugin] Failed to register bundled maps:', error);
            }
        }

        cleanup() {
            // Unregister all maps when plugin is removed
            if (this.mapProvider) {
                this.mapProvider.unregisterAllMaps();
                this.mapProvider = null;
            }
            console.log('[TroublePlugin] Cleanup complete');
        }

        static getPluginMetadata() {
            return {
                id: 'trouble-plugin',
                name: 'Trouble Game Engine',
                version: TROUBLE_PLUGIN_VERSION,
                description: 'Adds support for the classic Trouble ruleset.',
                author: 'Jack Carlton',
                tags: ['trouble', 'engine'],
                isDefault: false,
                dependencies: [],
                provides: {
                    actions: [],
                    triggers: [],
                    effects: [],
                    components: []
                }
            };
        }
    }

    return TroublePlugin;
}
