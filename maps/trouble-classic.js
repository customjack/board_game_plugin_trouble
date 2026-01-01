import boardManifest from './trouble-classic/board.json';
import metadataJson from './trouble-classic/metadata.json';
import engineJson from './trouble-classic/engine.json';
import rulesJson from './trouble-classic/rules.json';
import uiJson from './trouble-classic/ui.json';
import topologyJson from './trouble-classic/topology.json';
import dependenciesJson from './trouble-classic/dependencies.json';
import settingsJson from './trouble-classic/settings.json';
import previewImage from './trouble-classic/preview.png';
import { TROUBLE_PLUGIN_VERSION, TROUBLE_PLUGIN_CDN, TROUBLE_PLUGIN_REQUIREMENT } from '../version.js';

// @rollup/plugin-url emits assets into dist/plugins/assets with prefix trouble-
// The import is rewritten to an absolute URL using import.meta.url in the bundle.
const resolvedPreviewImage = new URL(previewImage, import.meta.url).href;

// Rebuild the monolithic map definition from the modular bundle assets
const pluginRequirement = {
    id: 'trouble-plugin',
    version: TROUBLE_PLUGIN_REQUIREMENT(),
    source: 'remote',
    cdn: TROUBLE_PLUGIN_CDN(),
    name: 'Trouble Plugin',
    description: 'Trouble game engine mechanics'
};

const dependencies = {
    ...dependenciesJson,
    plugins: (dependenciesJson.plugins || []).map((dep) =>
        dep.id === pluginRequirement.id ? { ...dep, ...pluginRequirement } : dep
    )
};

const metadata = {
    ...metadataJson,
    id: metadataJson.id || boardManifest.id,
    version: TROUBLE_PLUGIN_VERSION,
    thumbnail: metadataJson.thumbnail || resolvedPreviewImage
};

export const troubleClassicMap = {
    $schema: 'https://boardgame.example.com/schemas/game-v3.json',
    version: metadata.version,
    type: 'game',
    metadata,
    requirements: {
        plugins: dependencies.plugins || [],
        minPlayers: dependencies.minPlayers,
        maxPlayers: dependencies.maxPlayers
    },
    engine: {
        type: engineJson.type,
        config: engineJson.config || {}
    },
    ui: {
        layout: uiJson.layout || 'multi-piece-board',
        theme: uiJson.theme || {},
        components: uiJson.components || []
    },
    rules: {
        ...rulesJson,
        minPlayers: rulesJson.minPlayers ?? dependencies.minPlayers,
        maxPlayers: rulesJson.maxPlayers ?? dependencies.maxPlayers
    },
    board: {
        topology: {
            spaces: topologyJson.spaces || [],
            connections: topologyJson.connections || []
        },
        rendering: (settingsJson && (settingsJson.renderConfig || settingsJson.rendering)) || {}
    }
};
