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

    // Get theme colors from CSS custom properties
    function getCurrentTheme() {
        const style = getComputedStyle(document.documentElement);
        return {
            node: style.getPropertyValue('--graph-node-color').trim() || '#002b5c',
            nodeHover: style.getPropertyValue('--graph-node-hover').trim() || '#b18d03',
            edge: style.getPropertyValue('--graph-edge-color').trim() || '#999999',
            edgeHover: style.getPropertyValue('--graph-edge-hover').trim() || '#fe8019',
            label: style.getPropertyValue('--graph-label-color').trim() || '#555555',
            background: style.getPropertyValue('--graph-background').trim() || '#f8f9fa'
        };
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
            // Determine path based on graph ID prefix
            let path;
            if (graphId.startsWith('json/')) {
                path = `static/${graphId}.json`;
            } else {
                path = `static/data/graphs/${graphId}.json`;
            }

            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load graph: ${response.statusText}`);
            }
            const graphData = await response.json();

            renderGraph(graphData);
        } catch (error) {
            console.error('Error loading graph:', error);
            showPlaceholder();
            alert('Failed to load graph: ' + error.message);
        }
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
            const currentColors = getCurrentTheme();  // Get fresh colors each render

            if (activeNode) {
                if (node === activeNode) {
                    res.highlighted = true;
                    res.color = currentColors.nodeHover;
                    res.zIndex = 2;
                } else if (hoveredNeighbors.has(node)) {
                    res.color = currentColors.nodeHover;
                    res.zIndex = 1;
                } else {
                    res.color = currentColors.node + '40'; // Add transparency
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
                const currentColors = getCurrentTheme();  // Get fresh colors each render
                const source = graph.source(edge);
                const target = graph.target(edge);

                if (source === activeNode || target === activeNode) {
                    res.color = currentColors.edgeHover;
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
        sigmaInstance.setSetting('edgeLabelColor', { color: colors.label });
        sigmaInstance.setSetting('defaultNodeColor', colors.node);
        sigmaInstance.setSetting('defaultEdgeColor', colors.edge);
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
