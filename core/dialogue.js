/**
 * Walks a dialogue tree: { start, nodes: { id: { text, choices: [{label, goto}] } } }.
 * The UI only calls currentLine() / choose() / isFinished(), so another backing
 * format (e.g. ink) can implement the same three methods later.
 */
export class DialogueController {
    constructor(tree) {
        this.tree = tree;
        this.nodeId = tree.start ?? null;
        if (this.nodeId === null) console.warn('Dialogue tree has no start node');
    }

    currentLine() {
        // ...
    }

    choose(index) {
        // ...
    }

    isFinished() {
        // ...
    }
}