import pkg from './package.json' assert { type: 'json' };

export const TROUBLE_PLUGIN_VERSION = pkg.version;

export const TROUBLE_PLUGIN_CDN = (version = TROUBLE_PLUGIN_VERSION) =>
    `https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v${version}/dist/plugins/trouble-plugin.js`;

export const TROUBLE_PLUGIN_REQUIREMENT = (version = TROUBLE_PLUGIN_VERSION) => `^${version}`;
