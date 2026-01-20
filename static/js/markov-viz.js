/**
 * Markov Graph Visualizer
 * Uses Sigma.js v2 + Graphology for WebGL-based graph rendering
 */

(function() {
    'use strict';

    // State
    let sigmaInstance = null;
    let graph = null;
    let showLabels = true;
    let showEdges = true;
    let lockedNode = null;  // Node that's been clicked to lock the highlight

    // Theme colors
    const themes = {
        'gruvbox-light': {
            node: '#0d6efd',
            nodeHover: '#0b5ed7',
            edge: '#6c757d',
            edgeHover: '#495057',
            label: '#333333',
            background: '#fbf1c7'
        },
        'gruvbox-dark': {
            node: '#83a598',
            nodeHover: '#8ec07c',
            edge: '#665c54',
            edgeHover: '#928374',
            label: '#ebdbb2',
            background: '#282828'
        }
    };

    function getCurrentTheme() {
        const theme = document.documentElement.getAttribute('data-theme');
        return themes[theme] || themes['gruvbox-light'];
    }

    function showLoading(show) {
        document.getElementById('loading-indicator').style.display = show ? 'flex' : 'none';
        document.getElementById('graph-placeholder').style.display = 'none';
    }

    function showPlaceholder() {
        document.getElementById('loading-indicator').style.display = 'none';
        document.getElementById('graph-placeholder').style.display = 'flex';
    }

    function updateStats(nodeCount, edgeCount) {
        document.getElementById('node-count').textContent = nodeCount.toLocaleString();
        document.getElementById('edge-count').textContent = edgeCount.toLocaleString();
        document.getElementById('graph-info').style.display = nodeCount > 0 ? 'block' : 'none';
    }

    function updateHoverInfo(text) {
        document.getElementById('hover-info').textContent = text;
    }

    /**
     * Load a graph JSON file and render it
     */
    async function loadGraph(graphId) {
        if (!graphId) {
            if (sigmaInstance) {
                sigmaInstance.kill();
                sigmaInstance = null;
            }
            showPlaceholder();
            updateStats(0, 0);
            return;
        }

        showLoading(true);

        try {
            // Check for built-in demo graphs first
            let graphData;
            if (graphId.startsWith('demo-')) {
                graphData = generateDemoGraph(graphId);
            } else {
                const response = await fetch(`static/data/graphs/${graphId}.json`);
                if (!response.ok) {
                    throw new Error(`Failed to load graph: ${response.statusText}`);
                }
                graphData = await response.json();
            }

            renderGraph(graphData);
        } catch (error) {
            console.error('Error loading graph:', error);
            showPlaceholder();
            alert('Failed to load graph: ' + error.message);
        }
    }

    /**
     * Generate demo graphs inline (no file needed)
     */
    function generateDemoGraph(demoId) {
        const demos = {
            'demo-small': generateSimpleSentencesGraph,
            'demo-medium': generateShakespeareGraph,
            'demo-large': generateLargeGraph
        };

        const generator = demos[demoId];
        if (generator) {
            return generator();
        }
        throw new Error('Unknown demo: ' + demoId);
    }

    function generateSimpleSentencesGraph() {
        // Simple sentences demo
        const text = `
            The cat sat on the mat. The dog ran to the park.
            A cat and a dog played in the yard. The mat was soft.
            The park had many trees. Trees provide shade.
            Shade is nice on hot days. Days go by quickly.
            The quick brown fox jumps over the lazy dog.
            Dogs are loyal friends. Friends help each other.
            Each day brings new opportunities.
        `;
        return textToGraph(text);
    }

    function generateShakespeareGraph() {
        const text = `
            To be or not to be that is the question whether tis nobler in the mind
            to suffer the slings and arrows of outrageous fortune or to take arms
            against a sea of troubles and by opposing end them to die to sleep
            no more and by a sleep to say we end the heartache and the thousand
            natural shocks that flesh is heir to tis a consummation devoutly to
            be wished to die to sleep to sleep perchance to dream ay theres the rub
            for in that sleep of death what dreams may come when we have shuffled
            off this mortal coil must give us pause theres the respect that makes
            calamity of so long life for who would bear the whips and scorns of time
            the oppressors wrong the proud mans contumely the pangs of despised love
            the laws delay the insolence of office and the spurns that patient merit
            of the unworthy takes when he himself might his quietus make with a bare
            bodkin who would fardels bear to grunt and sweat under a weary life
            but that the dread of something after death the undiscovered country
            from whose bourn no traveller returns puzzles the will and makes us rather
            bear those ills we have than fly to others that we know not of
        `;
        return textToGraph(text);
    }

    function generateLargeGraph() {
        // Generate a larger synthetic graph
        const words = [
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'I',
            'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
            'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
            'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
            'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
            'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
            'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
            'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
            'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
            'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us'
        ];

        // Generate random transitions
        const nodes = [];
        const edges = [];
        const nodeFreq = {};

        // Create nodes
        words.forEach((word, i) => {
            const freq = Math.floor(Math.random() * 100) + 10;
            nodeFreq[word] = freq;
            nodes.push({
                key: word,
                label: word,
                x: Math.cos(i / words.length * Math.PI * 2) * 0.4 + 0.5 + (Math.random() - 0.5) * 0.2,
                y: Math.sin(i / words.length * Math.PI * 2) * 0.4 + 0.5 + (Math.random() - 0.5) * 0.2,
                size: 2 + Math.log(freq) * 2,
                frequency: freq
            });
        });

        // Create edges (random connections)
        words.forEach(word => {
            const numEdges = Math.floor(Math.random() * 8) + 2;
            for (let i = 0; i < numEdges; i++) {
                const target = words[Math.floor(Math.random() * words.length)];
                if (target !== word) {
                    edges.push({
                        source: word,
                        target: target,
                        weight: Math.floor(Math.random() * 20) + 1
                    });
                }
            }
        });

        return {
            nodes: nodes,
            edges: edges,
            metadata: { nodeCount: nodes.length, edgeCount: edges.length }
        };
    }

    function textToGraph(text) {
        const words = text.toLowerCase().replace(/[.,!?;:'"]/g, '').split(/\s+/).filter(w => w);
        const transitions = {};
        const wordFreq = {};

        // Count transitions
        for (let i = 0; i < words.length - 1; i++) {
            const word = words[i];
            const next = words[i + 1];

            wordFreq[word] = (wordFreq[word] || 0) + 1;
            wordFreq[next] = (wordFreq[next] || 0) + 1;

            if (!transitions[word]) transitions[word] = {};
            transitions[word][next] = (transitions[word][next] || 0) + 1;
        }

        // Build nodes with simple circular layout
        const allWords = Object.keys(wordFreq);
        const maxFreq = Math.max(...Object.values(wordFreq));
        const nodes = allWords.map((word, i) => {
            const angle = (i / allWords.length) * Math.PI * 2;
            const radius = 0.35;
            return {
                key: word,
                label: word,
                x: 0.5 + Math.cos(angle) * radius + (Math.random() - 0.5) * 0.1,
                y: 0.5 + Math.sin(angle) * radius + (Math.random() - 0.5) * 0.1,
                size: 2 + 6 * (wordFreq[word] / maxFreq),
                frequency: wordFreq[word]
            };
        });

        // Build edges
        const edges = [];
        for (const source in transitions) {
            for (const target in transitions[source]) {
                edges.push({
                    source: source,
                    target: target,
                    weight: transitions[source][target]
                });
            }
        }

        return {
            nodes: nodes,
            edges: edges,
            metadata: { nodeCount: nodes.length, edgeCount: edges.length }
        };
    }

    /**
     * Render graph using Sigma.js
     */
    function renderGraph(graphData) {
        const container = document.getElementById('sigma-container');
        const colors = getCurrentTheme();

        // Kill existing instance
        if (sigmaInstance) {
            sigmaInstance.kill();
            sigmaInstance = null;
        }

        // Create Graphology graph
        graph = new graphology.Graph();

        // Add nodes
        graphData.nodes.forEach(node => {
            graph.addNode(node.key, {
                x: node.x * 100,
                y: node.y * 100,
                size: node.size || 5,
                label: node.label || node.key,
                color: colors.node,
                frequency: node.frequency || 1
            });
        });

        // Add edges
        const maxWeight = Math.max(...graphData.edges.map(e => e.weight || 1));
        graphData.edges.forEach((edge, i) => {
            const edgeId = `${edge.source}-${edge.target}-${i}`;
            if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
                try {
                    graph.addEdge(edge.source, edge.target, {
                        size: 0.5 + 2 * ((edge.weight || 1) / maxWeight),
                        color: colors.edge,
                        weight: edge.weight || 1
                    });
                } catch (e) {
                    // Ignore duplicate edges
                }
            }
        });

        // Create Sigma instance
        sigmaInstance = new Sigma(graph, container, {
            renderLabels: showLabels,
            renderEdgeLabels: true,
            labelSize: 12,
            labelWeight: 'bold',
            labelColor: { color: colors.label },
            edgeLabelSize: 10,
            edgeLabelColor: { color: colors.label },
            defaultNodeColor: colors.node,
            defaultEdgeColor: colors.edge,
            minCameraRatio: 0.1,
            maxCameraRatio: 10,
            labelRenderedSizeThreshold: 6,
            // Performance optimizations
            hideEdgesOnMove: graphData.nodes.length > 1000,
            hideLabelsOnMove: graphData.nodes.length > 500
        });

        // Reset locked node when loading new graph
        lockedNode = null;

        // Hover and lock effects
        let hoveredNode = null;
        let hoveredNeighbors = new Set();

        // Helper to build edge info string for a node
        function getEdgeInfo(node) {
            const edges = graph.edges(node);
            const edgeDetails = [];
            edges.forEach(edge => {
                const source = graph.source(edge);
                const target = graph.target(edge);
                const weight = graph.getEdgeAttribute(edge, 'weight') || 1;
                const otherNode = source === node ? target : source;
                const direction = source === node ? '→' : '←';
                edgeDetails.push(`${direction}${otherNode}: ${weight}`);
            });
            return edgeDetails.slice(0, 10).join(', ') + (edgeDetails.length > 10 ? '...' : '');
        }

        // Helper to update info display for a node
        function updateNodeInfo(node) {
            const nodeData = graph.getNodeAttributes(node);
            const degree = graph.degree(node);
            const edgeInfo = getEdgeInfo(node);
            updateHoverInfo(`"${nodeData.label}" - ${nodeData.frequency || 0} occurrences, ${degree} connections | Edges: ${edgeInfo}`);
        }

        // Get the active node (locked takes priority over hovered)
        function getActiveNode() {
            return lockedNode || hoveredNode;
        }

        sigmaInstance.on('enterNode', ({ node }) => {
            hoveredNode = node;
            if (!lockedNode) {
                hoveredNeighbors = new Set(graph.neighbors(node));
                updateNodeInfo(node);
            }
            sigmaInstance.refresh();
        });

        sigmaInstance.on('leaveNode', () => {
            hoveredNode = null;
            if (!lockedNode) {
                hoveredNeighbors.clear();
                updateHoverInfo('');
            }
            sigmaInstance.refresh();
        });

        // Click to lock/unlock node highlight
        sigmaInstance.on('clickNode', ({ node }) => {
            if (lockedNode === node) {
                // Clicking same node unlocks it
                lockedNode = null;
                hoveredNeighbors.clear();
                updateHoverInfo('');
            } else {
                // Lock to this node
                lockedNode = node;
                hoveredNeighbors = new Set(graph.neighbors(node));
                updateNodeInfo(node);
            }
            sigmaInstance.refresh();
        });

        // Click on stage (background) to unlock
        sigmaInstance.on('clickStage', () => {
            if (lockedNode) {
                lockedNode = null;
                hoveredNeighbors.clear();
                updateHoverInfo('');
                sigmaInstance.refresh();
            }
        });

        // Node reducer for hover/lock effects
        sigmaInstance.setSetting('nodeReducer', (node, data) => {
            const res = { ...data };
            const activeNode = getActiveNode();

            if (activeNode) {
                if (node === activeNode) {
                    res.highlighted = true;
                    res.color = colors.nodeHover;
                    res.zIndex = 2;
                } else if (hoveredNeighbors.has(node)) {
                    res.color = colors.nodeHover;
                    res.zIndex = 1;
                } else {
                    res.color = colors.node + '40'; // Add transparency
                    res.zIndex = 0;
                }
            }

            return res;
        });

        // Edge reducer for hover/lock effects
        sigmaInstance.setSetting('edgeReducer', (edge, data) => {
            const res = { ...data };

            if (!showEdges) {
                res.hidden = true;
                return res;
            }

            const activeNode = getActiveNode();
            if (activeNode) {
                const source = graph.source(edge);
                const target = graph.target(edge);

                if (source === activeNode || target === activeNode) {
                    res.color = colors.edgeHover;
                    res.size = data.size * 2;
                    res.zIndex = 1;
                    // Show edge weight as label
                    res.label = String(graph.getEdgeAttribute(edge, 'weight') || '');
                } else {
                    res.hidden = true;
                }
            }

            return res;
        });

        showLoading(false);
        updateStats(graphData.nodes.length, graphData.edges.length);
    }

    /**
     * Update colors when theme changes
     */
    function updateThemeColors() {
        if (!sigmaInstance || !graph) return;

        const colors = getCurrentTheme();

        graph.forEachNode((node, attrs) => {
            graph.setNodeAttribute(node, 'color', colors.node);
        });

        graph.forEachEdge((edge, attrs) => {
            graph.setEdgeAttribute(edge, 'color', colors.edge);
        });

        sigmaInstance.setSetting('labelColor', { color: colors.label });
        sigmaInstance.refresh();
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        // Graph selector
        const graphSelect = document.getElementById('graph-select');
        graphSelect.addEventListener('change', function() {
            loadGraph(this.value);
        });

        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', function() {
            if (sigmaInstance) {
                const camera = sigmaInstance.getCamera();
                camera.animatedZoom({ duration: 200 });
            }
        });

        document.getElementById('zoom-out').addEventListener('click', function() {
            if (sigmaInstance) {
                const camera = sigmaInstance.getCamera();
                camera.animatedUnzoom({ duration: 200 });
            }
        });

        document.getElementById('zoom-reset').addEventListener('click', function() {
            if (sigmaInstance) {
                const camera = sigmaInstance.getCamera();
                camera.animatedReset({ duration: 200 });
            }
        });

        // Toggle labels
        document.getElementById('toggle-labels').addEventListener('click', function() {
            showLabels = !showLabels;
            this.classList.toggle('active', showLabels);
            if (sigmaInstance) {
                sigmaInstance.setSetting('renderLabels', showLabels);
            }
        });

        // Toggle edges
        document.getElementById('toggle-edges').addEventListener('click', function() {
            showEdges = !showEdges;
            this.classList.toggle('active', showEdges);
            if (sigmaInstance) {
                sigmaInstance.refresh();
            }
        });

        // Listen for theme changes
        document.addEventListener('themechange', updateThemeColors);

        // Show placeholder initially
        showPlaceholder();
    });
})();
