/**
 * InterfaceManager methods: the player info panel, discovery panel, the
 * actors/items sidebar, actor and item info panels (with their line builders and
 * hover info) and the help window.
 */

import { randomElement, resolveTemplate } from '../core/util.js';
import { globalVars } from '../globals.js';
import { InputManager } from '../input.js';
import { InterfaceManager } from './interface-manager.js';

const PLAYER_COUNTER_ATTRIBUTES = ['score', 'wealth'];

export const UIPanels = {
    /**
     * Toggle the player info box (show if hidden, hide if shown)
     * @param {Actor} player - The player actor
     * @returns {boolean} True if box is now visible, false if hidden
     */
    togglePlayerInfo(player) {
        const infoBoxId = 'player_info';

        // If already showing, hide it (resets inventory mode)
        if (this.boxes.has(infoBoxId)) {
            this.hidePlayerInfo();
            return false;
        }

        // Show player info and enable inventory mode
        this.showPlayerInfo(player);
        return true;
    },

    /**
     * Show the player info box
     * @param {Actor} player - The player actor
     */
    showPlayerInfo(player) {
        if (!player) return;

        this.clearTargetingHighlights();

        const infoBoxId = 'player_info';

        // Remove existing if present
        if (this.boxes.has(infoBoxId)) {
            this.removeBox(infoBoxId);
        }

        // Check if HTML actors element exists - if so, skip canvas thermometers
        // since stats are already displayed in the HTML sidebar
        const hasHtmlActorsElement = document.getElementById('actors') !== null;

        // Gather stats, separating thermometer stats from regular stats
        const regularStats = [];
        const thermometerStats = []; // { key, current, max, lineIndex }
        if (player.stats) {
            for (const [key, value] of Object.entries(player.stats)) {
                if (this.isThermometerStat(key) && !hasHtmlActorsElement) {
                    // Get current and max values (handle both object and simple number formats)
                    const max = typeof value === 'object' ? value.max : value;
                    const current = typeof value === 'object' ? value.current : value;
                    // Skip thermometer stats with max <= 1 (1-hit death prototypes)
                    if (max > 1) {
                        thermometerStats.push({ key, current, max });
                    }
                } else if (!this.isThermometerStat(key)) {
                    // Regular stat - display as text
                    const displayValue = typeof value === 'object' ? value.current : value;
                    regularStats.push(`${this.capitalize(key)}: ${this.formatStatValue(displayValue)}`);
                }
                // When hasHtmlActorsElement is true, thermometer stats are skipped entirely
                // (they're shown in the HTML sidebar instead)
            }
        }

        // Integer attributes read as counters (score, wealth) rather than traits, so
        // they belong beside the stats.
        if (player.attributes instanceof Map) {
            // Treasure totals are listed by name ("Gold nugget: 34"). Where a
            // prototype has them, a bare Wealth line would only repeat them.
            const tally = player.attributes.get('treasure_tally');
            const tallyEntries = tally && typeof tally === 'object' ? Object.entries(tally) : [];
            for (const key of PLAYER_COUNTER_ATTRIBUTES) {
                if (key === 'wealth' && tallyEntries.length > 0) continue;
                const value = player.attributes.get(key);
                if (typeof value === 'number' && Number.isInteger(value)) {
                    regularStats.push(`${this.capitalize(key)}: ${this.formatStatValue(value)}`);
                }
            }
            for (const [label, amount] of tallyEntries) {
                regularStats.push(`${this.capitalize(label)}: ${this.formatStatValue(amount)}`);
            }
        }

        // Gather inventory items with letter prefixes
        const inventoryItems = []; // { text, item, statLine }
        if (player.inventory && player.inventory.length > 0) {
            for (let i = 0; i < player.inventory.length; i++) {
                const item = player.inventory[i];
                const letter = String.fromCharCode(97 + i); // 'a', 'b', 'c', etc.
                // Use getDisplayName() for identification-aware display, truncated for UI
                let displayName = item.getDisplayName ? item.getDisplayName() : item.name;
                displayName = this.colorizeItemName(this.truncateText(displayName, 26));
                let itemText = `${letter})   ${displayName}`; // Two spaces: tile (offset 5) + blank gap (offset 6)
                if (item.count > 1) {
                    itemText += ` (×${item.count})`;
                }
                // Mark equipped items
                if (player.isItemEquipped(item)) {
                    itemText += item.hasAttribute('weapon') ? ' (equipped)' : ' (worn)';
                }

                // Check if item has displayable stats
                // Display is opt-in: charge_stat attribute (staffs) OR display_label on a stat (e.g. torches)
                let statLine = null;
                if (item.stats && Object.keys(item.stats).length > 0) {
                    const chargeStat = item.getAttribute('charge_stat');
                    if (chargeStat) {
                        const stat = item.stats[chargeStat];
                        if (stat && typeof stat === 'object' && stat.max !== undefined) {
                            const uses = item.getAttribute('uses') || 1;
                            const readyAt = stat.ready_at || Math.floor(stat.max / uses);
                            const availableCharges = Math.floor(stat.current / readyAt);
                            const isIdentified = item.identified !== false;
                            statLine = {
                                label: `      Charges: `,
                                chargeCount: isIdentified ? `${availableCharges}/${uses}` : `?/?`,
                                noBar: true,
                                current: stat.current,
                                max: stat.max
                            };
                        }
                    } else {
                        // Generic display: first stat with a display_label. Label +
                        // thermometer only, no numeric value (the raw value can be a
                        // float that renders a stray glyph in some decimals).
                        for (const stat of Object.values(item.stats)) {
                            if (stat && typeof stat === 'object' && stat.display_label && stat.max !== undefined) {
                                // A full, idle consumable has nothing to report: three
                                // fresh unlit torches showing three identical 100% bars
                                // is noise, and it's the common case now that they stack.
                                // Show the bar only once the item is being consumed
                                // (per_turn drains it) or has actually been used.
                                const draining = (stat.per_turn ?? 0) < 0;
                                const partial = stat.current < stat.max;
                                if (!draining && !partial) break;
                                statLine = {
                                    label: `      ${stat.display_label}: `,
                                    chargeCount: null,
                                    // Amber while it's actively burning down; gray for a
                                    // part-used item sitting idle, so "lit" reads at a
                                    // glance without checking the item name.
                                    dim: !draining,
                                    current: stat.current,
                                    max: stat.max
                                };
                                break;
                            }
                        }
                    }
                }

                inventoryItems.push({ text: itemText, item, statLine });
            }
        }

        // Build lines for the info box
        const lines = [];
        const thermometerLineIndices = [];
        lines.push(player.name);
        lines.push('');

        const hasStats = thermometerStats.length > 0 || regularStats.length > 0;
        if (hasStats) {
            lines.push('Stats:');
            // Add thermometer stats first
            for (const stat of thermometerStats) {
                const label = `  ${this.capitalize(stat.key)}: `;
                thermometerLineIndices.push({ lineIndex: lines.length, label, stat });
                lines.push(label); // Placeholder - bar will be rendered separately
            }
            // Add regular stats
            for (const stat of regularStats) {
                lines.push('  ' + stat);
            }
        }

        const inventoryLineIndices = [];
        const itemStatLineIndices = [];
        if (inventoryItems.length > 0) {
            if (hasStats) lines.push('');
            lines.push('Inventory:');
            for (const { text, item, statLine } of inventoryItems) {
                inventoryLineIndices.push({ lineIndex: lines.length, item });
                lines.push('  ' + text);

                // Add stat line below item if it has stats
                if (statLine) {
                    // Combine label and charge count for display text
                    const displayLabel = statLine.chargeCount
                        ? `${statLine.label}${statLine.chargeCount} `
                        : statLine.label;
                    itemStatLineIndices.push({
                        lineIndex: lines.length, label: displayLabel,
                        current: statLine.current, max: statLine.max,
                        noBar: !!statLine.noBar, dim: !!statLine.dim
                    });
                    lines.push(displayLabel); // "Charges: 2/3", or "Fuel: " + thermometer
                }
            }
        } else {
            if (hasStats) lines.push('');
            lines.push('Inventory: (empty)');
        }

        // A blank trailing line to pad the '?' button
        lines.push('');

        // Calculate dimensions - account for thermometer bar widths
        const padding = 1;
        let maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 10);
        const thermometerBarWidth = 10;
        for (const { label } of thermometerLineIndices) {
            const totalWidth = label.length + thermometerBarWidth;
            if (totalWidth > maxLineLength) {
                maxLineLength = totalWidth;
            }
        }
        // Also check item stat thermometers
        for (const { label } of itemStatLineIndices) {
            const totalWidth = label.length + thermometerBarWidth;
            if (totalWidth > maxLineLength) {
                maxLineLength = totalWidth;
            }
        }
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Vertically placed in the half the player isn't in
        const { y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);
        const vis = this.getVisibleArea();
        const visMidpoint = vis.originX + vis.width / 2;
        const x = (player.x || 0) >= visMidpoint
            ? vis.originX + 1
            : vis.originX + vis.width - boxWidth - 1;

        // Create the box
        const boxContainer = this.createBox(infoBoxId, x, y, boxWidth, boxHeight);

        if (!boxContainer) return;

        // Store click metadata
        boxContainer._padding = padding;
        boxContainer._inventoryLineIndices = inventoryLineIndices;
        // Absolute tile of the '?' affordance: one tile in from the bottom and right
        // border tiles, which is inside the padding ring rather than the content area —
        // so it's hit-tested directly here instead of through _hitTestBox's content grid.
        boxContainer._helpTileX = x + boxWidth - 2;
        boxContainer._helpTileY = y + boxHeight - 2;

        // Zebra-stripe the inventory rows (an item with a stat sub-line spans 2 rows)
        const stripeRows = inventoryLineIndices.map(({ lineIndex }) => ({
            lineIndex,
            span: itemStatLineIndices.some(s => s.lineIndex === lineIndex + 1) ? 2 : 1,
        }));
        this.drawListStripes(boxContainer, stripeRows, contentWidth, padding);

        // Add text sprites
        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        // Item stat sub-lines (charges, fuel, etc.) render in the amber accent color —
        // except a `dim` line (a part-used but idle consumable), whose label follows its
        // bar to gray so the two don't disagree about whether the item is active.
        const accentLineSet = new Set(itemStatLineIndices.map(s => s.lineIndex));
        const dimLineSet = new Set(itemStatLineIndices.filter(s => s.dim).map(s => s.lineIndex));

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const accent = accentLineSet.has(lineIndex);
            const baseColor = dimLineSet.has(lineIndex) ? this.inactiveTintColor
                : accent ? this.statAccentColor : this.defaultTextTint;
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            // accent lines are wholly amber (baseWhite); markup spans color individual words
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, baseColor, accent);
        }

        // Render thermometer bars for health/nutrition stats
        for (const { lineIndex, label, stat } of thermometerLineIndices) {
            const barX = textStartX + (label.length * globalVars.TILE_WIDTH);
            const barY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderThermometerBar(boxContainer, stat.current, stat.max, barX, barY);
        }

        // Render item tiles in inventory list
        // Format is "  a)  [tile] _ Item Name" - tile at offset 5, blank gap at offset 6, name at offset 7
        for (const { lineIndex, item } of inventoryLineIndices) {
            const tileX = textStartX + (5 * globalVars.TILE_WIDTH); // Position after "  a)  "
            const tileY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderItemTile(boxContainer, item, tileX, tileY);
            this.renderMagicPolarityIcon(boxContainer, item, tileX - globalVars.TILE_WIDTH, tileY);
        }

        // Render thermometer bars for continuous item stats (torch fuel, condition) in
        // the amber accent color. Charge-based items opt out via noBar 
        for (const { lineIndex, label, current, max, noBar, dim } of itemStatLineIndices) {
            if (noBar) continue;
            const barX = textStartX + (label.length * globalVars.TILE_WIDTH);
            const barY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderThermometerBar(boxContainer, current, max, barX, barY,
                dim ? this.inactiveTintColor : this.statAccentColor);
        }

        // The '?' help affordance, one tile in from the bottom-right border tiles.
        // Positioned box-relative, not text-relative: it sits in the padding ring
        // just outside the content area.
        const helpSprite = this.createCharSprite(
            '?',
            (boxWidth - 2) * globalVars.TILE_WIDTH,
            (boxHeight - 2) * globalVars.TILE_HEIGHT
        );
        if (helpSprite) boxContainer.addChild(helpSprite);

        // Enable inventory selection mode
        this.inventoryMode = true;
        this.currentPlayer = player;
        this.selectedItemIndex = null;

        this.updateBoxOverlays();
    },

    /**
     * Hide the player info box if it's showing
     */
    hidePlayerInfo() {
        this.removeBox('player_info');
        this.removeBox('item_action_menu');
        this.inventoryMode = false;
        this.currentPlayer = null;
        this.selectedItemIndex = null;
        this.updateBoxOverlays();
    },

    /**
     * Update the player info box if it's currently visible
     * Call this after stat changes to reflect updates immediately
     */
    updatePlayerInfo() {
        // Update regardless of inventoryMode - stat changes should always reflect
        if (this.currentPlayer && this.boxes.has('player_info')) {
            // Re-render the player info box with updated stats
            this.showPlayerInfo(this.currentPlayer);
        }
    },

    /**
     * Check if the player info box is currently visible
     * @returns {boolean}
     */
    isPlayerInfoVisible() {
        return this.boxes.has('player_info');
    },

    handleDiscoveryKey(key) {
        if (!this.boxes.has('discovery_panel')) return false;
        if (key === 'Escape' || key === 'd' || key === 'D') {
            this.removeBox('discovery_panel');
            return true;
        }
        return true;
    },

    toggleDiscoveryPanel() {
        const boxId = 'discovery_panel';
        if (this.boxes.has(boxId)) {
            this.removeBox(boxId);
            return;
        }

        const prototype = this.engine.currentPrototype;
        if (!prototype || prototype.activeCatalog.size === 0) {
            this.engine.inputManager?.showMessage('No item catalog active.');
            return;
        }

        const lines = ['Item Discovery', ''];
        const barWidth = 16;

        for (const [category, types] of prototype.activeCatalog) {
            const stats = prototype.getCatalogStats(category);
            if (!stats) continue;
            const label = category.charAt(0).toUpperCase() + category.slice(1);
            const filled = Math.round((stats.discovered / stats.total) * barWidth);
            const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
            lines.push(`  ${label.padEnd(10)} ${bar} ${stats.discovered}/${stats.total}`);
        }

        lines.push('');
        lines.push('  Esc/d) Close');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length), 14);
        const boxWidth = maxLineLength + padding * 2 + 2;
        const boxHeight = lines.length + padding * 2 + 2;
        // Centered horizontally; vertically placed away from the player.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(boxId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            // The title line (0) renders white; the rest use the default black.
            const baseColor = lineIndex === 0 ? 0xFFFFFF : this.defaultTextTint;
            const charY = textStartY + lineIndex * globalVars.TILE_HEIGHT;
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY, baseColor);
        }

        this.updateBoxOverlays();
    },

    // ========================================================================
    // ACTORS AND ITEMS DIVS
    // ========================================================================

    /**
     * Is the actor whose eyes we render through hallucinating?
     *
     * The sidebar is drawn once for the whole party, not per entity, so it asks the
     * viewpoint directly rather than going through `Entity.isViewerHallucinating`,
     * which needs a subject to ask on behalf of.
     *
     * @returns {boolean}
     */
    isViewerHallucinating() {
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        return viewer?.hasStateProperty?.('hallucinating') === true;
    },

    /** Is the viewpoint actor blind (a `vision_cap` state)? Sidebar twin of Entity.isViewerBlind. */
    isViewerBlind() {
        const viewer = this.engine?.entityManager?.getPrimaryViewpoint?.();
        return !!viewer?.findStateWithProperty?.('vision_cap');
    },

    /**
     * A made-up condition word — "gibbering", "shimmering" — for a hallucinated actor.
     *
     * Deliberately *not* memoized, unlike the name: the churn is the point, so the
     * ailment shifts every time the panel redraws while the creature it belongs to
     * stays the same imagined thing. Drawn from `adjectives.hallucinated_states`, the
     * list the info panel's template already uses, so the two read as one vocabulary
     * without having to agree on any single word.
     *
     * @returns {string} A single adjective, or '' if the word list is missing
     */
    hallucinatedCondition() {
        const words = this.engine?.globalWordRegistry?.['adjectives.hallucinated_states'];
        if (!Array.isArray(words) || !words.length) return '';
        return randomElement(words);
    },

    /**
     * Update the actors div with visible actors and their stats
     * Controllable actors (like Player) are listed first
     */
    updateActorsDiv() {
        const actorsDiv = document.getElementById('actors');
        if (!actorsDiv) return;

        const entityManager = this.engine.entityManager;
        if (!entityManager) {
            actorsDiv.innerHTML = '';
            return;
        }

        // Get all living actors
        const actors = entityManager.actors.filter(a => !a.isDead);
        if (actors.length === 0) {
            actorsDiv.innerHTML = '';
            return;
        }

        // Filter to visible actors with something to show
        const visibleActors = actors.filter(a =>
            this.engine.isTileVisible(a.x, a.y) &&
            (a.hasAttribute('controlled') || (a.stats && Object.keys(a.stats).length > 0)) &&
            (!a.isUnseen?.() || a.hasAttribute('controlled'))
        );

        // Sort: controlled actors first, then non-controlled by distance to the
        // player (nearest first)  so a crowded level surfaces the closest threats;
        const player = entityManager.player;
        const distTo = (a) => player
            ? Math.max(Math.abs(a.x - player.x), Math.abs(a.y - player.y))
            : 0;
        visibleActors.sort((a, b) => {
            const aControlled = a.hasAttribute('controlled') ? 0 : 1;
            const bControlled = b.hasAttribute('controlled') ? 0 : 1;
            if (aControlled !== bControlled) return aControlled - bControlled;
            const da = distTo(a), db = distTo(b);
            if (da !== db) return da - db;
            return a.name.localeCompare(b.name);
        });

        // Render one actor's entry block.
        const renderActor = (actor) => {
            // Hallucinating, the row reads "something" — the same word
            // `getNameWithArticle` already gives the message log — plus a made-up
            // condition, with the real states and stat bars withheld. Reading a
            // creature's health means having identified it first. The scrambled tile
            // name belongs to the hover and info-panel path, where you're looking at
            // one specific thing; a list of them wants the plain anonymous word.
            //
            // `isAnonymous()` is true for invisible and `visible: false` actors too, so
            // the hallucination check is what keeps those on the normal path — the
            // list already filters out `isUnseen()` actors but not `visible: false`
            // ones. The player is exempt: isAnonymous() returns false for the
            // controlled actor, so you always know yourself.
            const hallucinating = this.isViewerHallucinating();
            const deceived = actor.isAnonymous?.() && (hallucinating || this.isViewerBlind());

            let html = `<div class="actor-entry">`;
            html += `<strong class="actor-name">${deceived ? 'something' : actor.name}`;

            // Show equipping status with dots for progress
            if (!deceived && actor.isEquipping && actor.isEquipping()) {
                const turnsCompleted = actor._equippingTurnsTotal - actor._equippingTurnsLeft;
                const dots = '.'.repeat(turnsCompleted);
                html += ` <span class="equipping-status">(equipping${dots})</span>`;
            }

            html += `</strong>`;

            if (deceived) {
                // No duration: a made-up condition has no honest number to show, and
                // printing one would be the single readable fact in a false entry.
                // Blind, there's nothing to make up: just the bare "something".
                const fake = hallucinating ? this.hallucinatedCondition() : null;
                if (fake) {
                    html += `<div class="actor-conditions">`
                        + `<span class="actor-condition">${fake}</span></div>`;
                }
                html += '</div>';
                return html;
            }

            // Show active conditions (confused, blinded, burning, etc.)
            if (actor.states && Object.keys(actor.states).length > 0) {
                html += '<div class="actor-conditions">';
                for (const [key, state] of Object.entries(actor.states)) {
                    const displayName = state.data && state.data.name ? state.data.name : key;
                    const durationText = state.duration === Infinity ? 'always' : state.duration;
                    const colorStyle = state.data?.tint ? ` style="color: ${state.data.tint}"` : '';
                    html += `<span class="actor-condition"${colorStyle}>${displayName} (${durationText})</span>`;
                }
                html += '</div>';
            }

            // Add stats as thermometer fills with ratio in an unordered list
            if (actor.stats && Object.keys(actor.stats).length > 0) {
                html += '<ul class="actor-stats">';
                for (const [key, value] of Object.entries(actor.stats)) {
                    const current = value.current;
                    const max = value.max;

                    // Skip 1/1 stats (one-hit death games)
                    if (max === 1 && current === 1) continue;

                    const percentage = max > 0 ? Math.round((current / max) * 100) : 0;

                    html += `<li>`;
                    html += `<span class="stat-label">${this.capitalize(key)}</span>`;
                    html += `<figure class="stat-thermometer">`;
                    html += `<div class="stat-fill" style="width: ${percentage}%"></div>`;
                    html += `</figure>`;
                    // Only show ratio numbers for stats with max <= 100
                    if (max <= 100) {
                        html += `<span class="stat-ratio">${this.formatStatValue(current)}/${this.formatStatValue(max)}</span>`;
                    }
                    html += `</li>`;
                }
                html += '</ul>';
            }

            // For controlled actors, show integer attributes as plain numbers
            if (actor.hasAttribute('controlled') && actor.attributes instanceof Map) {
                let attributesHtml = '';
                for (const [key, value] of actor.attributes) {
                    if (typeof value === 'number' && Number.isInteger(value)) {
                        attributesHtml += `<li>`;
                        attributesHtml += `<span class="stat-label">${this.capitalize(key)}</span>`;

                        // Inventory is special - show as current/max ratio
                        if (key === 'inventory') {
                            const currentItems = actor.inventory ? actor.inventory.length : 0;
                            attributesHtml += `<span class="stat-value">${currentItems}/${value}</span>`;
                        } else {
                            // Use effective values for stats with equipment/passive bonuses
                            let displayValue = value;
                            if (key === 'defense' && actor.getEffectiveDefense) {
                                displayValue = actor.getEffectiveDefense();
                            } else if (key === 'strength' && actor.getEffectiveStrength) {
                                displayValue = actor.getEffectiveStrength();
                            } else if (key === 'accuracy' && actor.getEffectiveAccuracy) {
                                displayValue = actor.getEffectiveAccuracy();
                            }
                            attributesHtml += `<span class="stat-value">${displayValue}</span>`;
                        }

                        attributesHtml += `</li>`;
                    }
                }
                if (attributesHtml) {
                    html += `<ul class="actor-attributes">${attributesHtml}</ul>`;
                }
            }

            html += '</div>';
            return html;
        };

        // Cap the list: show the first N (controlled + nearest), and tuck any
        // overflow into a collapsible <details> so a crowded level doesn't flood
        // the sidebar. Short lists render exactly as before (no disclosure).
        const MAX_SHOWN = 5;
        if (visibleActors.length <= MAX_SHOWN) {
            actorsDiv.innerHTML = visibleActors.map(renderActor).join('');
        } else {
            const shown = visibleActors.slice(0, MAX_SHOWN);
            const rest = visibleActors.slice(MAX_SHOWN);
            const shownHtml = shown.map(renderActor).join('');
            const restHtml = rest.map(renderActor).join('');
            actorsDiv.innerHTML =
                shownHtml +
                `<details class="actor-overflow"><summary>${rest.length} more…</summary>${restHtml}</details>`;
        }
    },

    /**
     * Update the items div with visible items
     */
    updateItemsDiv() {
        const itemsDiv = document.getElementById('items');
        if (!itemsDiv) return;

        const entityManager = this.engine.entityManager;
        if (!entityManager) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Get all items on the map (not in inventory)
        const items = entityManager.items;
        if (items.length === 0) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Filter to visible items (or all if darkness is off)
        const visibleItems = items.filter(item => this.engine.isTileVisible(item.x, item.y));

        if (visibleItems.length === 0) {
            itemsDiv.innerHTML = '';
            return;
        }

        // Group items by display name and count duplicates.
        //
        // Hallucinating, a floor item reads as "something" — the same word
        // `getNameWithArticle` gives the message log, so the list and the prose agree.
        // `Item.isAnonymous()` draws the line by inventory membership, and this list
        // holds only floor items, so everything here is on the deceived side while the
        // pack stays honest. They collapse into one "something xN" row, which is the
        // truthful reading: unable to identify any of them, you can't tell them apart
        // either.
        const itemCounts = new Map();
        for (const item of visibleItems) {
            const displayName = item.isAnonymous?.()
                ? 'something'
                : (item.getDisplayName ? item.getDisplayName() : item.name);
            itemCounts.set(displayName, (itemCounts.get(displayName) || 0) + 1);
        }

        const listItems = [];
        for (const [name, count] of itemCounts) {
            listItems.push(count > 1 ? `<li>${name} x${count}</li>` : `<li>${name}</li>`);
        }

        itemsDiv.innerHTML = `<details><summary><strong>Visible Items</strong></summary><ul>${listItems.join('')}</ul></details>`;
    },

    /**
     * Mark the actor/item sidebar dirty and ensure a flush is scheduled.
     * Cheap to call many times per turn (every entity add/remove, every move under
     * darkness) — the actual innerHTML rebuild happens once on the next animation
     * frame instead of once per call, avoiding a per-event DOM-reflow storm.
     */
    updateSidebar() {
        this._sidebarDirty = true;
        if (!this._sidebarFlushScheduled) {
            this._sidebarFlushScheduled = true;
            requestAnimationFrame(this._flushSidebarBound);
        }
    },

    // Rebuild the actor/item panels now if anything marked them dirty. Called from
    // the scheduled animation frame; safe to call directly when an immediate,
    // synchronous refresh is required (e.g. just before reading layout).
    _flushSidebar() {
        this._sidebarFlushScheduled = false;
        if (!this._sidebarDirty) return;
        this._sidebarDirty = false;
        this.updateActorsDiv();
        this.updateItemsDiv();
    },

    // ========================================================================
    // ACTOR INFO
    // ========================================================================

    /**
     * Any key dismisses the actor info panel.
     *
     * Unlike the other handle*Key methods this is NOT modal: the panel is a read, not
     * a prompt, and it is big enough to cover much of the map — so leaving it up while
     * play continues is never what the player wants. Esc is consumed (its whole job
     * was to close), but every other key closes the panel and then falls through to
     * do its normal work, so reading a monster never costs an extra keystroke.
     *
     * Turn-taking actions arriving by other routes (mouse travel, menus) are covered
     * by InputManager.onPlayerAction, which closes the panel too.
     *
     * @returns {boolean} True only if the key was consumed and should not dispatch
     */
    handleActorInfoKey(key) {
        if (!this.actorInfoMode) return false;
        // Modifier presses on their own aren't actions; closing on them would make the
        // panel vanish as the player reaches for a shifted key.
        if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return false;
        this.closeActorInfo();
        return key === 'Escape';
    },

    /**
     * Describe an actor: what it is, what it can do, and — for a tactician — how a
     * fight with it would go.
     *
     * Modelled on Brogue's monsterDetails (Monsters.c), which assembles flavour text,
     * threat math, your-side math and a trait list into one panel. The combat lines
     * are gated on the viewer's `tactician` attribute so a prototype decides whether
     * its player reads fights numerically or has to judge them by eye.
     *
     * @param {Actor} actor - The actor to describe
     * @param {Actor} [viewer] - Whose perspective the combat math is from
     * @param {Object} [options] - See openInfoPanel
     */
    showActorInfo(actor, viewer = null, options = {}) {
        this.openInfoPanel(actor, viewer, options, (target, v, wrap) => {
            const lines = [];

            const description = target.getDescription?.();
            if (description) {
                for (const line of this.wrapText(description, wrap)) lines.push(line);
                lines.push('');
            }

            // Traits, joined as prose: "It flies, sees in the dark and burns easily."
            const traits = target.getTraitPhrases?.() || [];
            if (traits.length) {
                for (const line of this.wrapText(`It ${this.joinProse(traits)}.`, wrap)) {
                    lines.push(line);
                }
                lines.push('');
            }

            // What its attack does to you beyond damage. Deliberately outside the
            // `tactician` gate below: "its bite makes you bleed" is a qualitative
            // warning like the traits above it, not the numeric forecast that gate
            // is about — and a player who can't read the numbers needs it most.
            // predictAppliedState has already ruled out states this viewer is immune
            // to or can't take, so what's printed is what would actually land.
            if (v && v !== target) {
                const inflicts = target.predictCombat?.(v)?.appliedState;
                if (inflicts) {
                    for (const line of this.wrapText(`Its attack can leave you ${inflicts.label}.`, wrap)) {
                        lines.push(line);
                    }
                    lines.push('');
                }
            }

            // Combat math — opt-in per prototype via `tactician` on the viewing actor.
            // Skipped when looking at yourself: the panel would be comparing you to you.
            if (v && v !== target && v.hasAttribute?.('tactician')) {
                for (const line of this.buildCombatLines(target, v, wrap)) lines.push(line);
            }

            return lines;
        });
    },

    /**
     * The item counterpart of showActorInfo — same box, same modes, same intro, so a
     * hover that crosses from a monster to a dropped sword behaves identically.
     *
     * @param {Item} item - The item to describe
     * @param {Actor} [viewer] - Whose stats the equip forecast compares against
     * @param {Object} [options] - As showActorInfo
     */
    showItemInfo(item, viewer = null, options = {}) {
        this.openInfoPanel(item, viewer, options,
            (target, v, wrap) => this.buildItemInfoLines(target, v, wrap));
    },

    /**
     * What a hallucinating viewer sees instead of the truth, or null when they see
     * straight. The name is the SAME scrambled tile the sidebar hover line uses
     * (`_hallucinatedTileNameBase`, set per tick by the texture_scramble effect), so the
     * panel and the line above it always name the same thing — and, since that effect
     * now paints floor items too, the same thing the sprite on the map is showing.
     *
     * Inventory items are exempt: you know what you're carrying. Only what's out in the
     * world is in doubt, which is the split docs/IDEAS.md asks for.
     *
     * The prose is a template, so the vocabulary lives in words.json —
     * `hallucinated_states` was authored for exactly this and had no reader until now.
     * Re-rolled per call rather than memoized: the name has to hold still so the panel
     * and the sidebar agree, but the thing it's *doing* churning each time is the point.
     *
     * @returns {{name: string, lines: string[]}|null}
     */
    hallucinatedIdentity(target, viewer) {
        if (!viewer?.hasStateProperty?.('hallucinating')) return null;
        if (target === viewer) return null;
        // Carried items are known. Tested by inventory membership rather than
        // `item.owner`, which survives a drop and would exempt the item forever.
        if (viewer.inventory?.includes(target)) return null;

        const im = this.engine.inputManager;
        const name = im?.hallucinatedNameFor
            ? im.hallucinatedNameFor(target)
            : (target._hallucinatedTileNameBase || 'something').toLowerCase().replace(/_/g, ' ');

        const text = resolveTemplate(
            InterfaceManager.HALLUCINATION_TEMPLATE,
            target,
            { providers: { hallucinated_name: () => name } }
        );

        return { name, lines: this.wrapText(text, 30) };
    },

    /**
     * What a blind viewer gets for a creature: nothing to go on but that it's there.
     * Items are left alone — only creature names are masked. Null when not blind.
     *
     * @returns {{name: string, lines: string[]}|null}
     */
    blindIdentity(target, viewer) {
        if (!viewer?.findStateWithProperty?.('vision_cap')) return null;
        if (target === viewer || !target?.isAnonymous?.()) return null;
        return { name: 'something', lines: this.wrapText("You can't see what this is.", 30) };
    },

    /**
     * The shell both info panels share: name heading, mode handling, sizing, placement
     * and the optional grow intro. `buildBody` supplies everything between the heading
     * and the footer, so an actor and an item differ only in their text.
     *
     * Two modes. The keyboard route (Tab + Enter) is `sticky`: it takes over as the
     * active box and holds until Esc, because the player asked a deliberate question.
     * Hover is not — a passive read that must not steal the active box or swallow Esc,
     * and closes itself when the pointer leaves.
     *
     * @param {Actor|Item} target - What the panel is about
     * @param {Actor|null} viewer - Whose perspective the body is written from
     * @param {Object} options
     * @param {boolean} [options.sticky=true] - Hold until dismissed (keyboard route)
     * @param {boolean} [options.grow=false] - Play the box-grow intro from the target.
     *   Hover uses it; the keyboard route opens flat, since Tab already moved the
     *   player's attention there and a second flourish would only delay it.
     * @param {function(target, viewer, wrap): string[]} buildBody - Body lines
     */
    openInfoPanel(target, viewer, options, buildBody) {
        if (!target) return;
        const sticky = options.sticky ?? true;
        if (!target.hasInfoPanel?.()) return;
        viewer = viewer || this.engine.entityManager?.player || null;

        if (sticky) this.hidePlayerInfo();
        this.closeActorInfo();
        if (sticky) this.clearTargetingHighlights();

        this.actorInfoMode = sticky;
        this.actorInfoActor = target;

        const boxId = 'actor_info';
        const WRAP = 30;

        // Hallucinating, the player can't identify what they're looking at — the sidebar
        // hover line already scrambles the name, so a panel naming it outright would
        // contradict the line directly above it.
        const deceived = this.hallucinatedIdentity(target, viewer)
            || this.blindIdentity(target, viewer);

        const name = deceived ? deceived.name
            : (target.getDisplayName ? target.getDisplayName() : target.name);
        const lines = [this.capitalize(name), ''];
        const body = deceived ? deceived.lines : buildBody(target, viewer, WRAP);
        for (const line of body) lines.push(line);

        // Sections close with a blank spacer, which the footer sits on. Without a footer
        // that spacer would be a ragged empty row at the bottom of the box.
        while (lines.length && lines[lines.length - 1] === '') lines.pop();

        // Only the sticky panel needs dismissing; a hover panel goes away by itself, so
        // telling the player to press Esc would be a lie.
        if (sticky) {
            lines.push('');
            lines.push('Esc to close');
        }

        const padding = 1;
        const contentWidth = Math.max(...lines.map(l => this.stripMarkup(l).length), 16);
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = lines.length + (padding * 2) + 2;

        // Keep the box off the target as well as the player — you are pointing at it.
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight, { avoid: target });

        const drawPanel = () => {
            const boxContainer = this.createBox(boxId, x, y, boxWidth, boxHeight);
            if (!boxContainer) { this.actorInfoMode = false; this.actorInfoActor = null; return; }

            const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
            const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;
            for (let i = 0; i < lines.length; i++) {
                this.renderTextLine(boxContainer, lines[i],
                    textStartX, textStartY + (i * globalVars.TILE_HEIGHT));
            }

            this.updateBoxOverlays();
        };

        if (options.grow) {
            this.growBoxOpen({
                id: boxId, x, y, width: boxWidth, height: boxHeight,
                from: target,
                draw: drawPanel,
                // Anything that closed the panel mid-intro (a keypress, the pointer
                // moving on) abandons it rather than letting it finish into a panel.
                abort: () => this.actorInfoActor !== target,
            });
        } else {
            drawPanel();
        }
    },

    /**
     * The two-sided combat forecast, as wrapped lines. Both directions come from
     * Actor.predictCombat, which shares its arithmetic with the live damage path, so
     * these numbers are a promise the engine actually keeps.
     * @returns {string[]}
     */
    buildCombatLines(actor, viewer, wrap) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };

        const yours = viewer.predictCombat?.(actor);
        const theirs = actor.predictCombat?.(viewer);

        if (yours) {
            if (yours.immune) {
                push(`You cannot harm it.`);
            } else if (yours.noDamage) {
                push(`You deal it no direct damage.`);
            } else {
                let s = `You have a ${yours.hitChance}% chance to hit it`;
                s += `, and could defeat it in ${yours.hitsToKill} hit${yours.hitsToKill === 1 ? '' : 's'}`;
                // Only worth stating when a crit would actually save a swing.
                if (yours.bestHitsToKill && yours.bestHitsToKill < yours.hitsToKill) {
                    s += ` — ${yours.bestHitsToKill} with a lucky strike`;
                }
                push(s + '.');
                if (yours.appliedState) push(`Your attack can leave it ${yours.appliedState.label}.`);
                if (yours.backstab) push('It has not noticed you.');
            }
            out.push('');
        }

        if (theirs) {
            if (theirs.immune || theirs.noDamage) {
                push(`It deals no direct damage.`);
            } else {
                const n = theirs.hitsToKill;
                push(`It has a ${theirs.hitChance}% chance to hit you, and could defeat you in ${n} hit${n === 1 ? '' : 's'}.`);
            }
            out.push('');
        }

        return out;
    },

    /**
     * The full text of an item info panel, as wrapped lines — in Brogue's order
     * (Items.c:1750): what it is, what it does, then the numbers. The heading is the
     * caller's, since the inventory menu already draws one.
     *
     * Identification gating lives in Item.getPanelDescription, not here.
     *
     * @param {Item} item - The item to describe
     * @param {Actor|null} viewer - Whose stats the equip forecast compares against
     * @param {number} wrap - Wrap width in characters
     * @returns {string[]}
     */
    buildItemInfoLines(item, viewer = null, wrap = 30) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };
        const gap = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };

        // Blind, the description and effect would give away what touch can't
        const blindName = item.getBlindName?.();
        if (blindName) {
            const article = this.engine.inputManager?.getIndefiniteArticle?.(blindName) || 'a';
            push(`You can feel that it's ${article} ${blindName}, but you can't see anything more.`);
            return out;
        }

        const identified = item.identified !== false;

        const description = item.getPanelDescription?.();
        if (description) push(description);

        if (item.getAttribute?.('protected')) {
            gap();
            push('It is protected from acid.');
        }

        // Detect magic: name what was sensed (the eye beside it in the pack says the same)
        const polarity = item.getDetectedMagicPolarity?.();
        if (polarity) {
            gap();
            push(polarity === 'bad'
                ? 'You can feel a malevolent magic lurking within it.'
                : 'You can feel a benevolent magic within it.');
        }

        // Gear identifies itself through use: rings by turns worn (`id_turns`),
        // weapons and armor by blows (`id_blows`). Wands and staffs are
        // enchantable too but identify on use, hence the weapon/wearable gate.
        const isWeapon = item.hasAttribute?.('weapon');
        const wearable = item.getAttribute?.('wearable');
        if (!identified && item.hasAttribute?.('enchantable') && (isWeapon || wearable)) {
            const plural = (n, word) => `${n} more ${word}${n === 1 ? '' : 's'}`;
            gap();
            if (wearable === 'ring') {
                const turns = Math.max(1, item.getIdTurns() - (item.wornTurns || 0));
                push(`You will know it after ${plural(turns, 'turn')} wearing it.`);
            } else {
                const blows = Math.max(1, item.getIdBlows() - (item.combatUseCount || 0));
                push(isWeapon
                    ? `You will know it after ${plural(blows, 'blow')} struck with it.`
                    : `You will know it after ${plural(blows, 'blow')} taken while wearing it.`);
            }
        }

        // Identified only: on a potion the effect IS the secret.
        if (identified) {
            const effect = item.getEffectDescription?.();
            if (effect) {
                gap();
                // Authored as a fragment ("It restores Health"), so may lack a full stop.
                push(/[.!?]$/.test(effect) ? effect : `${effect}.`);
            }
        }

        if (viewer) {
            const preview = item.previewEquipDelta?.(viewer);
            if (preview) {
                gap();
                for (const line of this.buildEquipForecastLines(item, preview, identified, wrap)) {
                    out.push(line);
                }
            }
        }

        // Fuel and condition are visible on the item itself, so they don't wait on
        // identification — a staff's charge count does, being part of what ID tells you.
        const chargeStat = item.getAttribute('charge_stat');
        const statLines = [];
        for (const [key, stat] of Object.entries(item.stats || {})) {
            if (!stat || typeof stat !== 'object' || stat.max === undefined) continue;
            if (key === chargeStat && !identified) continue;
            const label = stat.display_label || this.capitalize(key);
            statLines.push(`${label}: ${Math.round(stat.current ?? stat.max)}/${stat.max}`);
        }
        if (statLines.length) {
            gap();
            for (const line of statLines) out.push(line);
        }

        // Only when the category had no stand-in text of its own — those already end on
        // the mystery ("no telling what it does until it is drunk"), so this would repeat.
        if (!identified && !this.categoryBlurbFor(item)) {
            gap();
            push('Its properties are unknown.');
        }

        while (out.length && out[out.length - 1] === '') out.pop();
        return out;
    },

    /** The unidentified stand-in text for an item's category, if types.json defines one. */
    categoryBlurbFor(item) {
        const types = this.engine.currentPrototype?.types;
        return types?.[item.getCategory?.()]?.unidentified_description || null;
    },

    /**
     * The equip forecast: what wearing or wielding this would do, and what comes off.
     * Brogue reports percentage deltas (Items.c:1981); absolute before/after reads better
     * on small integer stats, and can't divide by zero against an unarmed player.
     *
     * @returns {string[]}
     */
    buildEquipForecastLines(item, preview, identified, wrap) {
        const out = [];
        const push = (text) => {
            for (const line of this.wrapText(text, wrap)) out.push(line);
        };

        const verb = preview.slot === 'weapon' ? 'Wielding' : 'Wearing';

        // Leads, being the most important thing on the panel. canEquipItem reads the base
        // stat, so a strength ring won't get you into heavy armour — the rule as enforced.
        if (!preview.canEquip) {
            push(`You cannot equip this. ${preview.reason}.`);
            return out;
        }

        if (preview.changes.length) {
            const deltas = preview.changes.map(c => `${c.stat} from ${c.from} to ${c.to}`);
            push(`${verb} this would change your ${this.joinProse(deltas)}.`);
        } else if (identified) {
            push(`${verb} this would change none of your stats.`);
        }

        // Named, not implied: with both ring slots full the equip path takes ring1
        // specifically, so the player needs to know which ring actually goes.
        if (preview.displaced) {
            const name = preview.displaced.getDisplayName?.() || preview.displaced.name;
            push(`It would replace your ${name}.`);
        }

        // Shown for anything enchantABLE, not only what is enchanted — otherwise the
        // caveat's presence would itself reveal which items carry one.
        if (!identified && preview.changes.length && item.hasAttribute('enchantable')) {
            push('This assumes it bears no enchantment.');
        }

        return out;
    },

    closeActorInfo() {
        // A pending open is as much "the panel" as a drawn one: closing has to cancel
        // both the hover delay and any running open intro, or a panel would pop up
        // after the thing that closed it.
        this.cancelPendingHoverInfo();
        this.cancelBoxGrow('actor_info');

        // actorInfoActor is part of the test: a hover panel leaves actorInfoMode false,
        // so checking only the box and the mode could strand that reference — and
        // updateHoverInfo compares against it to decide whether to re-open.
        if (!this.boxes.has('actor_info') && !this.actorInfoMode && !this.actorInfoActor) return;
        this.removeBox('actor_info');
        this.actorInfoMode = false;
        this.actorInfoActor = null;
        this.updateBoxOverlays();
    },

    /**
     * Schedule a hover panel for `target`, replacing any pending one.
     *
     * The delay is the point: the pointer must rest on the target, so sweeping across a
     * room of monsters opens nothing. Re-requesting the SAME target keeps the existing
     * timer rather than restarting it, so a pointer drifting within one large actor
     * still opens on schedule instead of never.
     */
    scheduleHoverInfo(target, viewer) {
        if (this.actorInfoHoverPending === target) return;
        this.cancelPendingHoverInfo();
        this.actorInfoHoverPending = target;
        this.actorInfoHoverTimer = setTimeout(() => {
            this.actorInfoHoverTimer = null;
            this.actorInfoHoverPending = null;
            if (target.isDead) return;
            this.showEntityInfo(target, viewer, { sticky: false, grow: true });
        }, InterfaceManager.HOVER_INFO_DELAY);
    },

    /**
     * Open the info panel for an Actor or an Item, whichever this is. Both share one box
     * and one hover timer, so the two routes cannot open competing panels.
     */
    showEntityInfo(target, viewer = null, options = {}) {
        // Duck-typed rather than instanceof: getPanelDescription is the item-only method
        // the panel is actually built on.
        if (target?.getPanelDescription) return this.showItemInfo(target, viewer, options);
        return this.showActorInfo(target, viewer, options);
    },

    /** Drop a scheduled-but-unopened hover panel. */
    cancelPendingHoverInfo() {
        if (this.actorInfoHoverTimer) {
            clearTimeout(this.actorInfoHoverTimer);
            this.actorInfoHoverTimer = null;
        }
        this.actorInfoHoverPending = null;
    },

    // ========================================================================
    // HELP WINDOW
    // ========================================================================

    handleHelpKey(key) {
        if (this.helpWindowMode) {
            if (key === '?' || key === 'Escape') {
                this.closeHelpWindow();
                return true;
            }
            return false;
        }
        if (key === '?') {
            this.showHelpWindow();
            return true;
        }
        return false;
    },

    showHelpWindow() {
        this.hidePlayerInfo();
        this.closeThrowItemMenu();
        this.closeEquipmentMenu();

        this.helpWindowMode = true;

        const menuId = 'help_window';
        if (this.boxes.has(menuId)) {
            this.removeBox(menuId);
        }

        const bindings = this.engine.currentPrototype?.keybindings || this.engine.globalKeybindings || {};
        const actionDescriptions = bindings.descriptions || {};

        // Shared with InputManager.getKeyForAction, so the keybindings screen and
        // in-game prompts shorten key names the same way.
        const formatKey = (key) => InputManager.formatKeyName(key);

        const inputMgr = this.engine.inputManager;
        const actionKeys = {};

        for (const [key, action] of Object.entries(inputMgr.keyMap)) {
            if (action.startsWith('move_')) continue;
            if (!actionKeys[action]) actionKeys[action] = [];
            const formatted = formatKey(key);
            if (!actionKeys[action].includes(formatted) &&
                !actionKeys[action].includes(formatted.toLowerCase())) {
                actionKeys[action].push(formatted);
            }
        }

        for (const [key, action] of Object.entries(inputMgr.globalKeyMap)) {
            if (!actionKeys[action]) actionKeys[action] = [];
            const formatted = formatKey(key);
            if (!actionKeys[action].includes(formatted)) {
                actionKeys[action].push(formatted);
            }
        }

        const pickKeys = (action) => {
            const keys = actionKeys[action];
            if (!keys || keys.length === 0) return '';
            const lower = keys.filter(k => k.length === 1 && k >= 'a' && k <= 'z');
            const upper = keys.filter(k => k.length === 1 && k >= 'A' && k <= 'Z');
            const symbols = keys.filter(k => k.length === 1 && !(k >= 'a' && k <= 'z') && !(k >= 'A' && k <= 'Z'));
            const special = keys.filter(k => k.length > 1);
            const best = [...lower, ...upper, ...symbols, ...special];
            return best.slice(0, 2).join('/');
        };

        const pad = (str, len) => str + ' '.repeat(Math.max(0, len - str.length));
        const kw = 6;

        // Summarize movement from the actual bindings rather than a fixed string, so
        // rebinding or removing movement keys is reflected here.
        const ORTHOGONAL = ['move_up', 'move_down', 'move_left', 'move_right'];
        const DIAGONAL = ['move_up_left', 'move_up_right', 'move_down_left', 'move_down_right'];

        // Group the bound keys for a set of move actions into readable families, so eight
        // separate bindings read as "Arrows/Numpad/hjkl" instead of a wall of keys.
        const describeMovement = (actions) => {
            const families = new Map(); // label -> insertion order preserved
            for (const [key, action] of Object.entries(inputMgr.keyMap)) {
                if (!actions.includes(action)) continue;
                const bare = key.slice(key.lastIndexOf('+') + 1);
                const mod = key.slice(0, key.lastIndexOf('+') + 1);
                // Skip single letters entirely — lowercase ones are collected below, and
                // uppercase ones are just the shift-tolerance aliases bindKey adds, which
                // would otherwise show up as a duplicate "K/J/H/L" family.
                if (bare.length === 1 && bare.toLowerCase() >= 'a' && bare.toLowerCase() <= 'z') continue;
                let label;
                if (bare.startsWith('Arrow')) label = mod + 'Arrows';
                else if (bare.startsWith('Numpad')) label = 'Numpad';
                else label = formatKey(key);
                families.set(label, true);
            }
            // Letter keys are listed literally, in the order the bindings declare them
            // (hjkl / yubn), since that sequence is itself the mnemonic.
            const letters = Object.entries(inputMgr.keyMap)
                .filter(([k, a]) => actions.includes(a) && k.length === 1 && k >= 'a' && k <= 'z')
                .map(([k]) => k);
            const parts = [...families.keys()];
            if (letters.length) parts.push(letters.join(''));
            return parts.join('/');
        };

        const moveSummary = describeMovement(ORTHOGONAL);
        const diagSummary = describeMovement(DIAGONAL);

        const lines = [];
        lines.push('Help');
        lines.push('');
        if (moveSummary) lines.push(`Move: ${moveSummary}`);
        if (diagSummary) lines.push(`Diag: ${diagSummary}`);
        if (moveSummary || diagSummary) lines.push('');

        // Track which lines are keybinding rows so they can be zebra-striped. Headers,
        // the movement summary and blank separators are skipped, and the two groups
        // (actions, globals) stripe as one continuous run so the alternation doesn't
        // restart across the blank line between them.
        const bindingLines = [];
        const pushBinding = (keys, desc) => {
            bindingLines.push({ lineIndex: lines.length });
            lines.push(` ${pad(keys, kw)}${desc}`);
        };

        // In an observer prototype the `wait` key pauses instead (InputManager.handleKeyDown),
        // so it has to be described as what it actually does here, not as what it is bound to.
        const observing = !this.engine.hasControlledActor;

        const actionActions = bindings.actions ? Object.values(bindings.actions) : [];
        const seen = new Set();
        for (const action of actionActions) {
            if (seen.has(action)) continue;
            seen.add(action);
            const effective = (observing && action === 'wait') ? 'toggle_pause' : action;
            const desc = actionDescriptions[effective] || effective;
            pushBinding(pickKeys(action), desc);
        }
        lines.push('');

        const globalActions = bindings.global ? Object.values(bindings.global) : [];
        const globalSeen = new Set();
        for (const action of globalActions) {
            if (globalSeen.has(action)) continue;
            globalSeen.add(action);
            const desc = actionDescriptions[action] || action;
            pushBinding(pickKeys(action), desc);
        }
        pushBinding('?', 'Help');
        lines.push('');
        lines.push('?/Esc to close');

        const padding = 1;
        const maxLineLength = Math.max(...lines.map(l => this.stripMarkup(l).length));
        const contentWidth = maxLineLength;
        const contentHeight = lines.length;
        const boxWidth = contentWidth + (padding * 2) + 2;
        const boxHeight = contentHeight + (padding * 2) + 2;

        // Centered horizontally; vertically placed in the half the player isn't in
        const { x, y } = this.placeBoxAwayFromPlayer(boxWidth, boxHeight);

        const boxContainer = this.createBox(menuId, x, y, boxWidth, boxHeight);
        if (!boxContainer) return;

        // Zebra-stripe the keybinding rows
        this.drawListStripes(boxContainer, bindingLines, contentWidth, padding);

        const textStartX = (padding + 1) * globalVars.TILE_WIDTH;
        const textStartY = (padding + 1) * globalVars.TILE_HEIGHT;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const charY = textStartY + (lineIndex * globalVars.TILE_HEIGHT);
            this.renderTextLine(boxContainer, lines[lineIndex], textStartX, charY);
        }

        this.updateBoxOverlays();
    },

    closeHelpWindow() {
        this.removeBox('help_window');
        this.helpWindowMode = false;
        this.updateBoxOverlays();
    },
};
