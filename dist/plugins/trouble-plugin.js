/**
 * Factory function for TroubleGameEngine
 * Receives bundle and returns the TroubleGameEngine class
 * Based on the working version from commit f73ff38
 */
function createTroubleGameEngine(bundle) {
    const { 
        MultiPieceGameEngine, 
        TurnPhases, 
        GamePhases, 
        ModalUtil, 
        getVisibleElementById,
        PlayerStates
    } = bundle;

    /**
     * TroubleGameEngine - extends MultiPieceGameEngine for Trouble/Pop-O-Matic gameplay
     */
    class TroubleGameEngine extends MultiPieceGameEngine {
        constructor(dependencies, config = {}) {
            super(dependencies, {
                ...config,
                piecesPerPlayer: 4,
                allowCapture: true,
                safeSpaces: [] // Finish lanes are implicitly safe
            });

            this.TRACK_LENGTH = config.trackLength || 28;
            this.finishLength = config.finishLength || 4;
            this.startOffsets = Array.isArray(config.startOffsets) && config.startOffsets.length
                ? config.startOffsets
                : [0, 7, 14, 21];

            this.currentRoll = null;
            this.availableMoves = new Map(); // pieceId -> move descriptor
            this.awaitingMoveChoice = false;
            this.targetMoves = new Map(); // spaceId -> move descriptor
            this.manualSpaceHandlers = new Map(); // spaceId -> handler

            this.handlePieceClick = this.handlePieceClick.bind(this);
            this.handleSpaceClick = this.handleSpaceClick.bind(this);
            this.winners = new Set();
        }

        async promptStartOrBoardMove() {
            return new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.className = 'modal custom-modal';
                modal.style.display = 'block';

                const content = document.createElement('div');
                content.className = 'modal-content';

                const title = document.createElement('h2');
                title.textContent = 'Choose your action';
                content.appendChild(title);

                const message = document.createElement('p');
                message.textContent = 'Pick whether to move a new piece out of home or move an existing piece on the board.';
                content.appendChild(message);

                const buttons = document.createElement('div');
                buttons.className = 'modal-buttons';
                buttons.style.display = 'flex';
                buttons.style.justifyContent = 'center';
                buttons.style.gap = '12px';

                const startBtn = document.createElement('button');
                startBtn.className = 'button button-primary';
                startBtn.textContent = 'Move piece out of home';
                startBtn.addEventListener('click', () => {
                    document.body.removeChild(modal);
                    resolve(true);
                });

                const boardBtn = document.createElement('button');
                boardBtn.className = 'button button-secondary';
                boardBtn.textContent = 'Move piece on board';
                boardBtn.addEventListener('click', () => {
                    document.body.removeChild(modal);
                    resolve(false);
                });

                buttons.appendChild(startBtn);
                buttons.appendChild(boardBtn);
                content.appendChild(buttons);
                modal.appendChild(content);
                document.body.appendChild(modal);
            });
        }

        /**
         * Get engine type identifier
         * @returns {string} Engine type
         */
        getEngineType() {
            return 'trouble';
        }

        getPieceManagerType() {
            return 'trouble';
        }

        hideTimerUI() {
            // Always hide/remove timer UI regardless of settings
            const timerContainer = document.querySelector('.timer-container');
            if (timerContainer) {
                timerContainer.style.display = 'none';
            }

            // Stop/hide component if present
            const timer = this.uiSystem?.getComponent?.('timer');
            if (timer) {
                timer.stopTimer?.();
                timer.hide?.();
            }

            // Unregister or hide sidebar widget if manager exists
            const sidebarManager = this.uiSystem?.sidebarWidgetManager;
            if (sidebarManager) {
                sidebarManager.unregister?.('timer');
            }

            // Also try component manager hide (legacy)
            if (this.uiSystem?.componentManager) {
                this.uiSystem.componentManager.hide?.('timer');
            }
        }

        /**
         * Get required UI components for this engine
         * Override to exclude timer (Trouble doesn't use turn timers)
         * @returns {UIComponentSpec[]}
         */
        getRequiredUIComponents() {
            // Get base components from MultiPieceGameEngine
            const baseComponents = super.getRequiredUIComponents();
            
            // Filter out the timer component
            return baseComponents.filter(component => component.id !== 'timer');
        }

        /**
         * Initialize the engine
         */
        init() {
            super.init();
            this.hideTimerUI();
            
            this.setupPlayerPieces();
            this.registerEventListeners();
            this.wireRollButtonCallbacks();
            this.setRollButtonActive(this.isClientTurn());
            if (this.gameState?.setTurnPhase) {
                this.gameState.setTurnPhase(TurnPhases.BEGIN_TURN);
            }
            console.log('[TroubleGameEngine] Initialized');
        }

        cleanup() {
            if (this.eventBus?.off) {
                this.eventBus.off('pieceClicked', this.handlePieceClick);
                this.eventBus.off('spaceClicked', this.handleSpaceClick);
            }
            super.cleanup();
            this.availableMoves.clear();
            this.currentRoll = null;
            this.cleanupManualSpaceChoice();
        }

        registerEventListeners() {
            if (!this.eventBus?.on) return;
            this.eventBus.on('pieceClicked', this.handlePieceClick);
            this.eventBus.on('spaceClicked', this.handleSpaceClick);
        }

        setupPlayerPieces() {
            if (!Array.isArray(this.gameState?.players)) return;

            this.gameState.players.forEach((player, index) => {
                if (!Array.isArray(player.pieces) || player.pieces.length === 0) {
                    player.pieces = [];
                    for (let i = 0; i < this.piecesPerPlayer; i++) {
                        player.pieces.push({
                            id: `${player.playerId}-piece-${i + 1}`,
                            playerId: player.playerId,
                            label: String(i + 1),
                            state: 'home',
                            startIndex: this.getStartIndexForPlayer(index),
                            startSpaceId: this.getTrackSpaceId(this.getStartIndexForPlayer(index)),
                            currentSpaceId: this.getHomeSpaceId(index, i),
                            homeIndex: i,
                            stepsFromStart: null,
                            finishIndex: null,
                            isSelectable: false
                        });
                    }
                } else {
                    player.pieces.forEach((piece, i) => {
                        if (piece.startIndex === undefined) {
                            piece.startIndex = this.getStartIndexForPlayer(index);
                            piece.startSpaceId = this.getTrackSpaceId(piece.startIndex);
                        }
                        if (piece.homeIndex === undefined) {
                            piece.homeIndex = i;
                        }
                        if (!piece.currentSpaceId) {
                            piece.currentSpaceId = piece.state === 'home'
                                ? this.getHomeSpaceId(index, piece.homeIndex)
                                : piece.startSpaceId;
                        }
                    });
                }
            });
        }

        handlePieceClick({ pieceId, playerId }) {
            const currentPlayer = this.gameState.getCurrentPlayer();
            if (!currentPlayer || currentPlayer.playerId !== playerId) {
                return;
            }
            this.handlePieceSelection(pieceId);
        }

        handleSpaceClick({ space, spaceId }) {
            if (!this.awaitingMoveChoice || !this.isClientTurn()) return;
            const currentPlayer = this.gameState.getCurrentPlayer();
            if (!currentPlayer) return;

            const targetId = spaceId || space?.id || space?.spaceId || null;
            const move = targetId ? this.findMoveByTarget(targetId) : null;
            if (move) {
                console.log(`[Trouble] Space clicked ${targetId}, resolving move for piece ${move.pieceId}`);
                this.handleMovePiece(currentPlayer.playerId, {
                    pieceId: move.pieceId,
                    targetSpaceId: move.targetSpaceId
                });
            }
        }

        /**
         * Override to support dev manual rolls
         */
        rollDiceForCurrentPlayer() {
            const currentPlayer = this.gameState.getCurrentPlayer();
            const rollResult = currentPlayer.rollDice();

            console.log(`${currentPlayer.nickname} rolled a ${rollResult}`);

            this.emitEvent('playerRoll', {
                gameState: this.gameState,
                result: rollResult
            });

            return rollResult;
        }

        /**
         * Handle after dice roll (Pop-O-Matic logic)
         * @param {number} rollResult
         */
        async handleAfterDiceRoll(rollResult) {
            this.currentRoll = rollResult;
            const currentPlayer = this.gameState.getCurrentPlayer();
            if (!currentPlayer) {
                return;
            }
            if (this.winners.has(currentPlayer.playerId)) {
                console.log('[Trouble] Skipping turn for winner', currentPlayer.nickname);
                this.endTurnForPlayer(currentPlayer);
                return;
            }
            console.log(`[Trouble] Roll result ${rollResult} for ${currentPlayer.nickname}`);
            const validMoves = this.getValidMovesForPlayer(currentPlayer, rollResult);
            console.log('[Trouble] Valid moves', validMoves);

            this.availableMoves = new Map(validMoves.map(move => [move.pieceId, move]));
            this.markSelectablePieces(currentPlayer, validMoves);
            this.awaitingMoveChoice = false;
            this.targetMoves.clear();
            this.setRollButtonActive(false);
            this.startTurnTimer();

            if (validMoves.length === 0) {
                // No legal moves: either roll again on 6 or pass turn
                if (rollResult === 6) {
                    this.emitEvent('extraRollGranted', { playerId: currentPlayer?.playerId });
                    this.currentRoll = null;
                    this.setRollButtonActive(this.isClientTurn());
                } else {
                    this.endTurnForPlayer(currentPlayer);
                }
                this.markSelectablePieces(null, []);
                this.proposeStateChange(this.gameState);
                return;
            }

            const startMoves = validMoves.filter(m => m.targetState === 'track' && m.progress === 0);
            const nonStartMoves = validMoves.filter(m => !(m.targetState === 'track' && m.progress === 0));

            // If both a "bring out" move and other moves exist on a 6, ask the player
            if (rollResult === 6 && startMoves.length > 0 && nonStartMoves.length > 0) {
                const takeStart = await this.promptStartOrBoardMove();
                if (takeStart) {
                    const move = startMoves[0];
                    this.handleMovePiece(currentPlayer.playerId, {
                        pieceId: move.pieceId,
                        targetSpaceId: move.targetSpaceId
                    });
                    return;
                }

                // Player chose to move existing piece: limit choices to non-start moves
                this.availableMoves = new Map(nonStartMoves.map(move => [move.pieceId, move]));
                this.markSelectablePieces(currentPlayer, nonStartMoves);
                await this.awaitMoveSelection(nonStartMoves, currentPlayer);
                return;
            }

            const allPiecesHome = (currentPlayer.pieces || []).every(p => p.state === 'home');
            const autoMove = (rollResult === 6 && allPiecesHome) || validMoves.length === 1;
            if (autoMove) {
                const priorityMove = validMoves.find(m => m.targetState === 'track') || validMoves[0];
                this.handleMovePiece(currentPlayer.playerId, {
                    pieceId: priorityMove.pieceId,
                    targetSpaceId: priorityMove.targetSpaceId
                });
                return;
            }

            await this.awaitMoveSelection(validMoves, currentPlayer);
        }

        /**
         * Handle piece selection (from UI or event bus)
         */
        handlePieceSelection(pieceId) {
            this.selectedPieceId = pieceId;

            const boardInteraction = this.getUIComponent('boardInteraction');
            if (boardInteraction?.highlightValidMoves) {
                const validMoves = this.getValidMovesForPiece(pieceId);
                boardInteraction.highlightValidMoves(validMoves.map(move => move.targetSpaceId));
                if (validMoves.length === 1) {
                    const move = validMoves[0];
                    const player = this.gameState.getCurrentPlayer();
                    if (player) {
                        this.handleMovePiece(player.playerId, {
                            pieceId,
                            targetSpaceId: move.targetSpaceId
                        });
                    }
                }
            }
        }

        /**
         * Handle piece movement with Trouble rules
         */
        async handleMovePiece(playerId, actionData) {
            const roll = this.currentRoll;
            if (!roll) {
                return { success: false, error: 'Roll the die first' };
            }

            const player = this.gameState.getPlayerByPlayerId?.(playerId) ||
                this.gameState.players.find(p => p.playerId === playerId);
            if (!player) {
                return { success: false, error: 'Invalid player' };
            }

            const piece = player.pieces?.find(p => p.id === (this.selectedPieceId || actionData.pieceId));
            if (!piece) {
                return { success: false, error: 'No piece selected' };
            }

            if (!actionData?.targetSpaceId) {
                return { success: false, error: 'Target space required' };
            }

            const validMoves = this.getValidMovesForPiece(piece.id, roll);
            const move = validMoves.find(m => m.targetSpaceId === actionData.targetSpaceId);
            if (!move) {
                return { success: false, error: 'Invalid move for this roll' };
            }

            this.applyMove(player, piece, move);
            this.selectedPieceId = null;
            this.availableMoves.clear();
            this.awaitingMoveChoice = false;
            this.targetMoves.clear();
            this.cleanupManualSpaceChoice();

            const winner = this.checkForWinner(player);
            let extraTurn = roll === 6;
            this.currentRoll = null;

            if (winner) {
                this.handleWinner(player);
                extraTurn = false;
            }

            if (!winner && !extraTurn) {
                this.endTurnForPlayer(player);
            } else if (extraTurn) {
                this.emitEvent('extraRollGranted', { playerId: player.playerId });
                this.markSelectablePieces(null, []);
                this.setRollButtonActive(this.isClientTurn());
                this.proposeStateChange(this.gameState);
            }

            return {
                success: true,
                data: {
                    pieceId: piece.id,
                    toSpaceId: move.targetSpaceId,
                    state: piece.state
                }
            };
        }

        endTurnForPlayer(player) {
            if (this.gameState?.nextPlayerTurn) {
                this.gameState.nextPlayerTurn();
            }
            this.selectedPieceId = null;
            this.availableMoves.clear();
            this.awaitingMoveChoice = false;
            this.targetMoves.clear();
            this.cleanupManualSpaceChoice();
            this.currentRoll = null;
            this.markSelectablePieces(null, []);
            this.emitEvent('turnEnded', { playerId: player?.playerId });
            this.getUIComponent('boardInteraction')?.clearHighlights?.();
            this.setRollButtonActive(this.isClientTurn());
            this.stopTurnTimer();
            this.proposeStateChange(this.gameState);
        }

        /**
         * Check if a piece can move to a space using the latest computed moves
         */
        canPieceMoveToSpace(piece, targetSpaceId) {
            if (!piece) return false;
            const move = this.availableMoves.get(piece.id);
            return Boolean(move && move.targetSpaceId === targetSpaceId);
        }

        /**
         * Get valid moves for a piece based on current roll
         * @param {string} pieceId
         */
        getValidMovesForPiece(pieceId, roll = this.currentRoll) {
            if (!pieceId || !roll) return [];
            if (this.availableMoves.has(pieceId)) {
                return [this.availableMoves.get(pieceId)];
            }

            const player = this.gameState.players.find(p => p.pieces?.some(pc => pc.id === pieceId));
            if (!player) return [];
            return this.getValidMovesForPlayer(player, roll).filter(move => move.pieceId === pieceId);
        }

        /**
         * Compute all valid moves for a player given a roll
         */
        getValidMovesForPlayer(player, roll = this.currentRoll) {
            if (!player || !Array.isArray(player.pieces) || !roll) return [];
            if (this.winners.has(player.playerId)) return [];
            const playerIndex = this.getPlayerIndex(player.playerId);
            if (playerIndex === -1) return [];

            const moves = [];
            player.pieces.forEach(piece => {
                const move = this.calculateMoveForPiece(piece, playerIndex, roll);
                if (move) {
                    moves.push(move);
                }
            });
            return moves;
        }

        calculateMoveForPiece(piece, playerIndex, roll) {
            if (!piece || piece.state === 'done') return null;

            if (piece.state === 'home') {
                if (roll !== 6) return null;
                const startSpaceId = this.getTrackSpaceId(this.getStartIndexForPlayer(playerIndex));
                if (this.isSpaceBlockedByOwn(playerIndex, startSpaceId)) return null;

                return {
                    pieceId: piece.id,
                    targetSpaceId: startSpaceId,
                    targetState: 'track',
                    progress: 0,
                    finishIndex: null
                };
            }

            const currentProgress = piece.stepsFromStart ?? 0;

            if (piece.state === 'track') {
                const nextProgress = currentProgress + roll;
                if (nextProgress < this.TRACK_LENGTH) {
                    const trackIndex = (this.getStartIndexForPlayer(playerIndex) + nextProgress) % this.TRACK_LENGTH;
                    const targetSpaceId = this.getTrackSpaceId(trackIndex);
                    if (this.isSpaceBlockedByOwn(playerIndex, targetSpaceId)) return null;
                    return {
                        pieceId: piece.id,
                        targetSpaceId,
                        targetState: 'track',
                        progress: nextProgress,
                        finishIndex: null
                    };
                }

                const finishIndex = nextProgress - this.TRACK_LENGTH;
                if (finishIndex >= this.finishLength) {
                    return null; // Must roll exact to enter or advance in finish lane
                }
                const targetSpaceId = this.getFinishSpaceId(playerIndex, finishIndex);
                if (this.isSpaceBlockedByOwn(playerIndex, targetSpaceId)) return null;
                return {
                    pieceId: piece.id,
                    targetSpaceId,
                    targetState: finishIndex === this.finishLength - 1 ? 'done' : 'finish',
                    progress: nextProgress,
                    finishIndex
                };
            }

            if (piece.state === 'finish') {
                const currentFinishIndex = Number.isInteger(piece.finishIndex)
                    ? piece.finishIndex
                    : Math.max(0, (piece.stepsFromStart ?? this.TRACK_LENGTH) - this.TRACK_LENGTH);
                const targetIndex = currentFinishIndex + roll;
                if (targetIndex >= this.finishLength) {
                    return null;
                }
                const targetSpaceId = this.getFinishSpaceId(playerIndex, targetIndex);
                if (this.isSpaceBlockedByOwn(playerIndex, targetSpaceId)) return null;
                return {
                    pieceId: piece.id,
                    targetSpaceId,
                    targetState: targetIndex === this.finishLength - 1 ? 'done' : 'finish',
                    progress: this.TRACK_LENGTH + targetIndex,
                    finishIndex: targetIndex
                };
            }

            return null;
        }

        applyMove(player, piece, move) {
            const playerIndex = this.getPlayerIndex(player.playerId);
            if (move.targetState === 'track') {
                const occupying = this.findPieceOnSpace(move.targetSpaceId, piece.id);
                if (occupying && occupying.playerIndex !== playerIndex) {
                    this.sendPieceHome(occupying.piece, occupying.playerIndex);
                } else if (occupying && occupying.playerIndex === playerIndex) {
                    // Cannot land on your own piece
                    return;
                }
            }

            piece.state = move.targetState;
            piece.stepsFromStart = move.progress;
            piece.finishIndex = move.finishIndex ?? (move.targetState === 'finish' || move.targetState === 'done'
                ? Math.max(0, move.progress - this.TRACK_LENGTH)
                : null);
            piece.currentSpaceId = move.targetSpaceId;
            piece.isSelectable = false;

            this.emitEvent('pieceMoved', {
                playerId: player.playerId,
                pieceId: piece.id,
                toSpaceId: move.targetSpaceId,
                state: piece.state
            });

            this.proposeStateChange(this.gameState);
            const boardInteraction = this.getUIComponent('boardInteraction');
            boardInteraction?.clearHighlights?.();
        }

        sendPieceHome(piece, playerIndex) {
            if (!piece) return;
            piece.state = 'home';
            piece.stepsFromStart = null;
            piece.finishIndex = null;
            piece.currentSpaceId = this.getHomeSpaceId(playerIndex, piece.homeIndex ?? 0);
            piece.isSelectable = false;

            this.emitEvent('pieceCaptured', {
                capturedPieceId: piece.id,
                playerIndex
            });
        }

        markSelectablePieces(currentPlayer, validMoves) {
            const selectable = new Set(validMoves.map(move => move.pieceId));
            this.gameState.players.forEach(player => {
                (player.pieces || []).forEach(piece => {
                    piece.isSelectable = Boolean(currentPlayer && player.playerId === currentPlayer.playerId && selectable.has(piece.id));
                });
            });
        }

        highlightAllValidMoves(validMoves) {
            const boardInteraction = this.getBoardComponent();
            const uniqueTargets = Array.from(new Set(validMoves.map(m => m.targetSpaceId)));
            console.log('[Trouble] Highlighting targets', uniqueTargets);
            if (boardInteraction?.highlightValidMoves) {
                boardInteraction.highlightValidMoves(uniqueTargets);
            } else {
                this.setupManualSpaceSelection(uniqueTargets);
            }
        }

        /**
         * Override timer methods - Trouble doesn't use turn timers
         * These are no-ops to prevent timer-related errors
         */
        startTurnTimer() {
            // Trouble doesn't use timers - do nothing
            this.hideTimerUI();
        }

        stopTurnTimer() {
            // Trouble doesn't use timers - do nothing
            this.hideTimerUI();
        }

        findMoveByTarget(spaceId) {
            return this.targetMoves.get(spaceId) || null;
        }

        async awaitMoveSelection(validMoves, currentPlayer) {
            if (!Array.isArray(validMoves) || validMoves.length === 0) {
                this.endTurnForPlayer(currentPlayer);
                return;
            }

            if (validMoves.length === 1) {
                const move = validMoves[0];
                this.handleMovePiece(currentPlayer.playerId, {
                    pieceId: move.pieceId,
                    targetSpaceId: move.targetSpaceId
                });
                return;
            }

            // Waiting for player choice: highlight all possible targets and allow piece/space clicks
            this.awaitingMoveChoice = true;
            this.targetMoves.clear();
            validMoves.forEach(move => this.targetMoves.set(move.targetSpaceId, move));
            this.highlightAllValidMoves(validMoves);
            this.setRollButtonActive(false);
            // Wait for user click on highlighted space (or piece)
        }

        getBoardComponent() {
            return this.getUIComponent('boardInteraction') ||
                this.getUIComponent('boardCanvas') ||
                this.uiSystem?.getComponent?.('boardCanvas') ||
                null;
        }

        setupManualSpaceSelection(spaceIds = []) {
            this.cleanupManualSpaceChoice();
            spaceIds.forEach(id => {
                const el = getVisibleElementById(`space-${id}`);
                if (!el) {
                    console.warn(`[Trouble] No visible element found for space ${id}`);
                    return;
                }
                el.classList.add('highlight');
                const handler = () => {
                    const currentPlayer = this.gameState.getCurrentPlayer();
                    const move = this.findMoveByTarget(id);
                    if (currentPlayer && move) {
                        this.handleMovePiece(currentPlayer.playerId, {
                            pieceId: move.pieceId,
                            targetSpaceId: move.targetSpaceId
                        });
                    }
                };
                el.addEventListener('click', handler);
                this.manualSpaceHandlers.set(id, { element: el, handler });
            });
        }

        cleanupManualSpaceChoice() {
            this.manualSpaceHandlers.forEach(({ element, handler }) => {
                if (element && handler) {
                    element.classList.remove('highlight');
                    element.removeEventListener('click', handler);
                }
            });
            this.manualSpaceHandlers.clear();
        }

        handleWinner(player) {
            if (!player) return;
            this.winners.add(player.playerId);
            try {
                player.setState?.(PlayerStates.WON || PlayerStates.WAITING);
            } catch (e) {
                player.state = 'won';
            }

            this.emitEvent('gameWon', { winner: player });
            ModalUtil.alert?.(`${player.nickname} has won the game! Players may continue moving remaining pieces.`, 'Game Won');
        }

        isSpaceBlockedByOwn(playerIndex, spaceId) {
            const occupying = this.findPieceOnSpace(spaceId);
            return occupying && occupying.playerIndex === playerIndex;
        }

        findPieceOnSpace(spaceId, ignorePieceId = null) {
            for (let pIndex = 0; pIndex < this.gameState.players.length; pIndex++) {
                const player = this.gameState.players[pIndex];
                for (const piece of player.pieces || []) {
                    if (piece.id !== ignorePieceId && piece.currentSpaceId === spaceId && piece.state !== 'home') {
                        return { piece, playerIndex: pIndex };
                    }
                }
            }
            return null;
        }

        getPlayerIndex(playerId) {
            return this.gameState.players.findIndex(p => p.playerId === playerId);
        }

        getStartIndexForPlayer(playerIndex) {
            return this.startOffsets[playerIndex % this.startOffsets.length];
        }

        getTrackSpaceId(index) {
            const normalized = ((index % this.TRACK_LENGTH) + this.TRACK_LENGTH) % this.TRACK_LENGTH;
            return `t${normalized}`;
        }

        getFinishSpaceId(playerIndex, finishIndex) {
            return `p${playerIndex}-f${finishIndex}`;
        }

        getHomeSpaceId(playerIndex, homeIndex) {
            return `p${playerIndex}-home-${homeIndex}`;
        }

        checkForWinner(player) {
            const finished = (player.pieces || []).every(piece => piece.state === 'done');
            if (finished) {
                this.emitEvent('playerWon', { playerId: player.playerId });
            }
            return finished;
        }

        getRollButtonComponent() {
            return this.getUIComponent('rollButton') || this.uiSystem?.getComponent?.('rollButton') || null;
        }

        wireRollButtonCallbacks() {
            const rollButton = this.getRollButtonComponent();
            if (!rollButton) return;
            const callbacks = {
                onRollDice: () => this.rollDiceForCurrentPlayer(),
                onRollComplete: (result) => this.handleAfterDiceRoll(result)
            };
            if (rollButton.registerCallbacks) {
                rollButton.registerCallbacks(callbacks);
            } else if (rollButton.init) {
                rollButton.init(callbacks);
            }
        }

        /**
         * Keep roll button synced to whose turn it is
         */
        setRollButtonActive(active) {
            const rollButton = this.getRollButtonComponent();
            if (!rollButton) return;
            if (this.awaitingMoveChoice && active) {
                // Do not re-activate while waiting for a move selection
                active = false;
            }
            if (active && rollButton.activate) {
                rollButton.activate();
            } else if (!active && rollButton.deactivate) {
                rollButton.deactivate();
            }
        }

        updateGameState(gameState) {
            this.gameState = gameState;
            const canAct = gameState?.gamePhase !== GamePhases.GAME_ENDED;
            this.setRollButtonActive(this.isClientTurn() && canAct && !this.awaitingMoveChoice);
        }
    }

    return TroubleGameEngine;
}

var id = "trouble-classic";
var boardManifest = {
	id: id};

var name = "Trouble Classic";
var author = "Jack Carlton";
var version$1 = "1.0.4";
var description = "Four-player race to your finish lane.";
var tags = [
	"trouble",
	"race",
	"multi-piece",
	"capture"
];
var created = "2025-11-22T00:00:00.000Z";
var modified = "2025-11-22T08:00:37Z";
var metadataJson = {
	name: name,
	author: author,
	version: version$1,
	description: description,
	tags: tags,
	created: created,
	modified: modified
};

var type = "trouble";
var config = {
	piecesPerPlayer: 4,
	allowCapture: true,
	trackLength: 28,
	startOffsets: [
		0,
		7,
		14,
		21
	],
	finishLength: 4
};
var engineJson = {
	type: type,
	config: config
};

var turnOrder = "sequential";
var startingPositions = {
	mode: "custom",
	startZones: {
		player1: [
			"p0-home-0",
			"p0-home-1",
			"p0-home-2",
			"p0-home-3"
		],
		player2: [
			"p1-home-0",
			"p1-home-1",
			"p1-home-2",
			"p1-home-3"
		],
		player3: [
			"p2-home-0",
			"p2-home-1",
			"p2-home-2",
			"p2-home-3"
		],
		player4: [
			"p3-home-0",
			"p3-home-1",
			"p3-home-2",
			"p3-home-3"
		]
	}
};
var recommendedPlayers = {
};
var diceRolling = {
	enabled: true,
	diceCount: 1,
	diceSides: 6,
	rollAgainOn: [
		6
	]
};
var winCondition = {
	type: "all-pieces-home",
	config: {
		homeZones: {
			player1: [
				"p0-f0",
				"p0-f1",
				"p0-f2",
				"p0-f3"
			],
			player2: [
				"p1-f0",
				"p1-f1",
				"p1-f2",
				"p1-f3"
			],
			player3: [
				"p2-f0",
				"p2-f1",
				"p2-f2",
				"p2-f3"
			],
			player4: [
				"p3-f0",
				"p3-f1",
				"p3-f2",
				"p3-f3"
			]
		}
	}
};
var rulesJson = {
	turnOrder: turnOrder,
	startingPositions: startingPositions,
	recommendedPlayers: recommendedPlayers,
	diceRolling: diceRolling,
	winCondition: winCondition
};

var layout = "multi-piece-board";
var components = [
	{
		id: "pieceSelector",
		enabled: true,
		position: {
			left: 20,
			bottom: 20
		},
		config: {
			maxPieces: 4,
			showPieceColors: true,
			highlightMovable: true
		}
	},
	{
		id: "rollButton",
		enabled: true,
		position: {
			bottom: 20,
			centerX: true
		},
		config: {
			label: "Pop",
			hotkey: "space"
		}
	},
	{
		id: "boardInteraction",
		enabled: true,
		position: {
			centerX: true,
			centerY: true
		},
		config: {
			showMultiplePieces: true,
			highlightMovablePieces: true
		}
	},
	{
		id: "gameLog",
		enabled: true,
		position: {
			bottom: 80,
			right: 20
		},
		config: {
			maxEntries: 50
		}
	}
];
var theme = {
	primaryColor: "#e53935",
	secondaryColor: "#1e88e5",
	backgroundColor: "#0f172a",
	textColor: "#e2e8f0",
	boardStyle: "bold"
};
var uiJson = {
	layout: layout,
	components: components,
	theme: theme
};

var spaces = [
	{
		id: "t0",
		name: "Start",
		type: "start",
		position: {
			x: 400,
			y: 140
		},
		visual: {
			size: 44,
			color: "#e53935",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t1",
				draw: true
			},
			{
				targetId: "p0-f0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "t1",
		name: "Track 2",
		type: "track",
		position: {
			x: 458,
			y: 147
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t2",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t2",
		name: "Track 3",
		type: "track",
		position: {
			x: 513,
			y: 166
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t3",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t3",
		name: "Track 4",
		type: "track",
		position: {
			x: 562,
			y: 197
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t4",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t4",
		name: "Track 5",
		type: "track",
		position: {
			x: 603,
			y: 238
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t5",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t5",
		name: "Track 6",
		type: "track",
		position: {
			x: 634,
			y: 287
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t6",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t6",
		name: "Track 7",
		type: "track",
		position: {
			x: 653,
			y: 342
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t7",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t7",
		name: "Start",
		type: "start",
		position: {
			x: 660,
			y: 400
		},
		visual: {
			size: 44,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t8",
				draw: true
			},
			{
				targetId: "p1-f0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "t8",
		name: "Track 9",
		type: "track",
		position: {
			x: 653,
			y: 458
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t9",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t9",
		name: "Track 10",
		type: "track",
		position: {
			x: 634,
			y: 513
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t10",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t10",
		name: "Track 11",
		type: "track",
		position: {
			x: 603,
			y: 562
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t11",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t11",
		name: "Track 12",
		type: "track",
		position: {
			x: 562,
			y: 603
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t12",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t12",
		name: "Track 13",
		type: "track",
		position: {
			x: 513,
			y: 634
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t13",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t13",
		name: "Track 14",
		type: "track",
		position: {
			x: 458,
			y: 653
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t14",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t14",
		name: "Start",
		type: "start",
		position: {
			x: 400,
			y: 660
		},
		visual: {
			size: 44,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t15",
				draw: true
			},
			{
				targetId: "p2-f0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "t15",
		name: "Track 16",
		type: "track",
		position: {
			x: 342,
			y: 653
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t16",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t16",
		name: "Track 17",
		type: "track",
		position: {
			x: 287,
			y: 634
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t17",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t17",
		name: "Track 18",
		type: "track",
		position: {
			x: 238,
			y: 603
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t18",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t18",
		name: "Track 19",
		type: "track",
		position: {
			x: 197,
			y: 562
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t19",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t19",
		name: "Track 20",
		type: "track",
		position: {
			x: 166,
			y: 513
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t20",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t20",
		name: "Track 21",
		type: "track",
		position: {
			x: 147,
			y: 458
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t21",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t21",
		name: "Start",
		type: "start",
		position: {
			x: 140,
			y: 400
		},
		visual: {
			size: 44,
			color: "#43a047",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t22",
				draw: true
			},
			{
				targetId: "p3-f0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "t22",
		name: "Track 23",
		type: "track",
		position: {
			x: 147,
			y: 342
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t23",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t23",
		name: "Track 24",
		type: "track",
		position: {
			x: 166,
			y: 287
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t24",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t24",
		name: "Track 25",
		type: "track",
		position: {
			x: 197,
			y: 238
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t25",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t25",
		name: "Track 26",
		type: "track",
		position: {
			x: 238,
			y: 197
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t26",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t26",
		name: "Track 27",
		type: "track",
		position: {
			x: 287,
			y: 166
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t27",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "t27",
		name: "Track 28",
		type: "track",
		position: {
			x: 342,
			y: 147
		},
		visual: {
			size: 44,
			color: "#eceff1",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "circle"
		},
		connections: [
			{
				targetId: "t0",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-f0",
		name: "Finish 1",
		type: "finish",
		position: {
			x: 400,
			y: 220
		},
		visual: {
			size: 40,
			color: "#e53935",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p0-f1",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-f1",
		name: "Finish 2",
		type: "finish",
		position: {
			x: 400,
			y: 260
		},
		visual: {
			size: 40,
			color: "#e53935",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p0-f2",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-f2",
		name: "Finish 3",
		type: "finish",
		position: {
			x: 400,
			y: 300
		},
		visual: {
			size: 40,
			color: "#e53935",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p0-f3",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-f3",
		name: "Finish 4",
		type: "finish",
		position: {
			x: 400,
			y: 340
		},
		visual: {
			size: 40,
			color: "#e53935",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
		],
		triggers: [
		]
	},
	{
		id: "p1-f0",
		name: "Finish 1",
		type: "finish",
		position: {
			x: 580,
			y: 400
		},
		visual: {
			size: 40,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p1-f1",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-f1",
		name: "Finish 2",
		type: "finish",
		position: {
			x: 540,
			y: 400
		},
		visual: {
			size: 40,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p1-f2",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-f2",
		name: "Finish 3",
		type: "finish",
		position: {
			x: 500,
			y: 400
		},
		visual: {
			size: 40,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p1-f3",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-f3",
		name: "Finish 4",
		type: "finish",
		position: {
			x: 460,
			y: 400
		},
		visual: {
			size: 40,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
		],
		triggers: [
		]
	},
	{
		id: "p2-f0",
		name: "Finish 1",
		type: "finish",
		position: {
			x: 400,
			y: 580
		},
		visual: {
			size: 40,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p2-f1",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-f1",
		name: "Finish 2",
		type: "finish",
		position: {
			x: 400,
			y: 540
		},
		visual: {
			size: 40,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p2-f2",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-f2",
		name: "Finish 3",
		type: "finish",
		position: {
			x: 400,
			y: 500
		},
		visual: {
			size: 40,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p2-f3",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-f3",
		name: "Finish 4",
		type: "finish",
		position: {
			x: 400,
			y: 460
		},
		visual: {
			size: 40,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
		],
		triggers: [
		]
	},
	{
		id: "p3-f0",
		name: "Finish 1",
		type: "finish",
		position: {
			x: 220,
			y: 400
		},
		visual: {
			size: 40,
			color: "#43a047",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p3-f1",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-f1",
		name: "Finish 2",
		type: "finish",
		position: {
			x: 260,
			y: 400
		},
		visual: {
			size: 40,
			color: "#43a047",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p3-f2",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-f2",
		name: "Finish 3",
		type: "finish",
		position: {
			x: 300,
			y: 400
		},
		visual: {
			size: 40,
			color: "#43a047",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
			{
				targetId: "p3-f3",
				draw: true
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-f3",
		name: "Finish 4",
		type: "finish",
		position: {
			x: 340,
			y: 400
		},
		visual: {
			size: 40,
			color: "#43a047",
			textColor: "#0f172a",
			font: "12px Inter",
			shape: "diamond"
		},
		connections: [
		],
		triggers: [
		]
	},
	{
		id: "p0-home-0",
		name: "Home",
		type: "home",
		position: {
			x: 360,
			y: 60
		},
		visual: {
			size: 32,
			color: "#e53935",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-home-1",
		name: "Home",
		type: "home",
		position: {
			x: 400,
			y: 60
		},
		visual: {
			size: 32,
			color: "#e53935",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-home-2",
		name: "Home",
		type: "home",
		position: {
			x: 360,
			y: 100
		},
		visual: {
			size: 32,
			color: "#e53935",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p0-home-3",
		name: "Home",
		type: "home",
		position: {
			x: 400,
			y: 100
		},
		visual: {
			size: 32,
			color: "#e53935",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t0",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-home-0",
		name: "Home",
		type: "home",
		position: {
			x: 700,
			y: 360
		},
		visual: {
			size: 32,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t7",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-home-1",
		name: "Home",
		type: "home",
		position: {
			x: 740,
			y: 360
		},
		visual: {
			size: 32,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t7",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-home-2",
		name: "Home",
		type: "home",
		position: {
			x: 700,
			y: 400
		},
		visual: {
			size: 32,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t7",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p1-home-3",
		name: "Home",
		type: "home",
		position: {
			x: 740,
			y: 400
		},
		visual: {
			size: 32,
			color: "#1e88e5",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t7",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-home-0",
		name: "Home",
		type: "home",
		position: {
			x: 360,
			y: 700
		},
		visual: {
			size: 32,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t14",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-home-1",
		name: "Home",
		type: "home",
		position: {
			x: 400,
			y: 700
		},
		visual: {
			size: 32,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t14",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-home-2",
		name: "Home",
		type: "home",
		position: {
			x: 360,
			y: 740
		},
		visual: {
			size: 32,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t14",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p2-home-3",
		name: "Home",
		type: "home",
		position: {
			x: 400,
			y: 740
		},
		visual: {
			size: 32,
			color: "#fdd835",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t14",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-home-0",
		name: "Home",
		type: "home",
		position: {
			x: 60,
			y: 360
		},
		visual: {
			size: 32,
			color: "#43a047",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t21",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-home-1",
		name: "Home",
		type: "home",
		position: {
			x: 60,
			y: 400
		},
		visual: {
			size: 32,
			color: "#43a047",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t21",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-home-2",
		name: "Home",
		type: "home",
		position: {
			x: 100,
			y: 360
		},
		visual: {
			size: 32,
			color: "#43a047",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t21",
				draw: false
			}
		],
		triggers: [
		]
	},
	{
		id: "p3-home-3",
		name: "Home",
		type: "home",
		position: {
			x: 100,
			y: 400
		},
		visual: {
			size: 32,
			color: "#43a047",
			textColor: "#0f172a",
			font: "11px Inter",
			shape: "square"
		},
		connections: [
			{
				targetId: "t21",
				draw: false
			}
		],
		triggers: [
		]
	}
];
var connections = [
];
var topologyJson = {
	spaces: spaces,
	connections: connections
};

var plugins = [
	{
		id: "core",
		version: "^1.0.0",
		source: "builtin",
		description: "Core game functionality"
	},
	{
		id: "trouble-plugin",
		version: "^1.0.4",
		source: "remote",
		cdn: "https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v1.0.4/dist/plugins/trouble-plugin.js",
		name: "Trouble Plugin",
		description: "Trouble game engine mechanics"
	}
];
var minPlayers = 2;
var maxPlayers = 4;
var dependenciesJson = {
	plugins: plugins,
	minPlayers: minPlayers,
	maxPlayers: maxPlayers
};

var renderConfig = {
	backgroundColor: "#0b1321",
	gridSize: 40,
	showConnections: true,
	spaceBorderWidth: 2,
	spaceBorderColor: "#000000"
};
var settingsJson = {
	renderConfig: renderConfig
};

var previewImage = "assets/trouble-preview.png";

var version = "1.0.6";
var pkg = {
	version: version};

const TROUBLE_PLUGIN_VERSION = pkg.version;

const TROUBLE_PLUGIN_CDN = (version = TROUBLE_PLUGIN_VERSION) =>
    `https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v${version}/dist/plugins/trouble-plugin.js`;

const TROUBLE_PLUGIN_REQUIREMENT = (version = TROUBLE_PLUGIN_VERSION) => `^${version}`;

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

const troubleClassicMap = {
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
        layout: uiJson.layout,
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

/**
 * Trouble Plugin - Entry point for CDN loading
 * 
 * This plugin registers the Trouble game engine.
 * Based on the working version from commit f73ff38.
 */


/**
 * Factory function that receives dependencies and returns the plugin class
 * @param {Object} bundle - Dependency injection bundle
 * @returns {Class} TroublePlugin class
 */
function createTroublePlugin(bundle) {
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

export { createTroublePlugin as default };
//# sourceMappingURL=trouble-plugin.js.map
