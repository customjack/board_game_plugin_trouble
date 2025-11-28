# Setting Up Trouble Plugin as Git Submodule

This plugin is designed to be used as a git submodule in the main Drinking Board Game repository.

## Initial Setup

1. **Create a GitHub repository** for this plugin (e.g., `drinking-board-game-trouble-plugin`)

2. **Add the remote to this repository:**
   ```bash
   cd plugins/trouble
   git remote add origin https://github.com/YOUR_USERNAME/drinking-board-game-trouble-plugin.git
   git push -u origin master
   ```

3. **Add as submodule in the main repository:**
   ```bash
   cd /path/to/drinking_board_game
   git submodule add https://github.com/YOUR_USERNAME/drinking-board-game-trouble-plugin.git plugins/trouble
   ```

## Building and Updating

The built plugin file (`dist/plugins/trouble-plugin.js`) is included in this repository so it can be served directly from GitHub Pages or any static file server.

To rebuild after making changes:

1. **In the main repository:**
   ```bash
   npm run build:plugins
   ```

2. **Copy the built file to the plugin repository:**
   ```bash
   cp dist/plugins/trouble-plugin.js plugins/trouble/dist/plugins/
   ```

3. **Commit and push the built file:**
   ```bash
   cd plugins/trouble
   git add dist/plugins/trouble-plugin.js
   git commit -m "Update built plugin"
   git push
   ```

## CDN Usage

Once pushed to GitHub, the plugin can be loaded from:
- GitHub raw: `https://raw.githubusercontent.com/YOUR_USERNAME/drinking-board-game-trouble-plugin/master/dist/plugins/trouble-plugin.js`
- GitHub Pages (if enabled): `https://YOUR_USERNAME.github.io/drinking-board-game-trouble-plugin/dist/plugins/trouble-plugin.js`

