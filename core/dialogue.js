/**
 * Walks a dialogue tree: { start, nodes: { id: { text, choices: [{label, goto}] } } }.
 * The UI only calls currentLine() / choose() / isFinished(), so another backing
 * format (e.g. ink) can implement the same three methods later.
 */
export class DialogueController {
    /**
     * @param {object} tree
     * @param {object} [options]
     * @param {(text: string) => string} [options.formatText] - Applied to node text
     *   and choice labels when shown (template tokens)
     */
    constructor(tree, { formatText = null } = {}) {
        this.tree = tree;
        this.formatText = formatText || (t => t);
        this.nodeId = tree.start ?? null;
        if (this.nodeId === null) console.warn('Dialogue tree has no start node');
    }

    currentLine() {
        const node = this.tree.nodes?.[this.nodeId];
        if (!node) return null;
        const choices = node.choices?.length ? node.choices.map(c => this.formatText(c.label)) : ['Leave'];
        return { text: this.formatText(node.text ?? ''), choices };
    }

    choose(index) {
        const node = this.tree.nodes?.[this.nodeId];
        if (!node) return;

        if (!node.choices?.length) { //Leave
            this.nodeId = null;
            return;
        }

        const choice = node.choices[index];
        if (!choice) return;
        
        const target = choice.goto;
        if (target == null) {
            this.nodeId = null;
            return;
        }

        if (!this.tree.nodes[target]) {
            console.warn(`Dialogue goto "${target}" not found`);
            this.nodeId = null;
            return;
        }

        this.nodeId = target;
    }

    isFinished() {
        return this.nodeId === null;
    }
}