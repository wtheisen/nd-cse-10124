#!/usr/bin/env python3
"""
Convert a Markov babbler dictionary to Graphology-compatible JSON format
with pre-computed force-directed layout positions.

Usage:
    python markov_to_graph.py input.pkl output.json
    python markov_to_graph.py --demo output.json  # Generate demo graph

Input format: pickle file containing dict[str, Counter]
    Example: {"the": Counter({"cat": 15, "dog": 8}), "cat": Counter({"sat": 12})}

Output format: JSON for Sigma.js/Graphology
    {
        "nodes": [{"key": "word", "x": 0.5, "y": 0.3, "size": 2, "label": "word"}],
        "edges": [{"source": "the", "target": "cat", "weight": 15}]
    }
"""

import argparse
import json
import math
import pickle
import random
import sys
from collections import Counter
from typing import Dict


def load_markov_dict(filepath: str) -> Dict[str, Counter]:
    """Load a Markov babbler dictionary from a pickle file."""
    with open(filepath, 'rb') as f:
        return pickle.load(f)


def compute_force_layout(nodes: list, edges: list, iterations: int = 100) -> dict:
    """
    Simple force-directed layout algorithm.
    For production use with 100K+ nodes, consider using networkx or graphology-layout.
    """
    # Initialize positions randomly
    positions = {node['key']: {'x': random.uniform(-1, 1), 'y': random.uniform(-1, 1)}
                 for node in nodes}

    # Build adjacency for force calculations
    adjacency = {node['key']: [] for node in nodes}
    for edge in edges:
        adjacency[edge['source']].append(edge['target'])
        adjacency[edge['target']].append(edge['source'])

    node_keys = [n['key'] for n in nodes]
    n_nodes = len(node_keys)

    if n_nodes == 0:
        return positions

    # Force-directed parameters
    k = math.sqrt(4.0 / n_nodes) if n_nodes > 0 else 1  # Optimal distance
    temp = 1.0  # Temperature for simulated annealing
    cooling = 0.95

    for _ in range(iterations):
        # Calculate repulsive forces between all nodes
        displacements = {key: {'x': 0, 'y': 0} for key in node_keys}

        for i, u in enumerate(node_keys):
            for v in node_keys[i+1:]:
                dx = positions[u]['x'] - positions[v]['x']
                dy = positions[u]['y'] - positions[v]['y']
                dist = math.sqrt(dx*dx + dy*dy) + 0.01

                # Repulsive force
                force = k * k / dist
                fx = (dx / dist) * force
                fy = (dy / dist) * force

                displacements[u]['x'] += fx
                displacements[u]['y'] += fy
                displacements[v]['x'] -= fx
                displacements[v]['y'] -= fy

        # Calculate attractive forces along edges
        for edge in edges:
            u, v = edge['source'], edge['target']
            if u not in positions or v not in positions:
                continue
            dx = positions[u]['x'] - positions[v]['x']
            dy = positions[u]['y'] - positions[v]['y']
            dist = math.sqrt(dx*dx + dy*dy) + 0.01

            # Attractive force
            force = (dist * dist) / k
            fx = (dx / dist) * force
            fy = (dy / dist) * force

            displacements[u]['x'] -= fx
            displacements[u]['y'] -= fy
            displacements[v]['x'] += fx
            displacements[v]['y'] += fy

        # Apply displacements with temperature limit
        for key in node_keys:
            dx = displacements[key]['x']
            dy = displacements[key]['y']
            dist = math.sqrt(dx*dx + dy*dy) + 0.01

            # Limit displacement by temperature
            limited = min(dist, temp)
            positions[key]['x'] += (dx / dist) * limited
            positions[key]['y'] += (dy / dist) * limited

        temp *= cooling

    # Normalize positions to [0, 1] range
    if positions:
        min_x = min(p['x'] for p in positions.values())
        max_x = max(p['x'] for p in positions.values())
        min_y = min(p['y'] for p in positions.values())
        max_y = max(p['y'] for p in positions.values())

        range_x = max_x - min_x or 1
        range_y = max_y - min_y or 1

        for key in positions:
            positions[key]['x'] = (positions[key]['x'] - min_x) / range_x
            positions[key]['y'] = (positions[key]['y'] - min_y) / range_y

    return positions


def markov_to_graphology(markov_dict: Dict[str, Counter],
                         max_nodes: int = None,
                         layout_iterations: int = 100) -> dict:
    """
    Convert Markov dictionary to Graphology-compatible format.

    Args:
        markov_dict: Markov babbler dictionary {word: Counter({next_word: count})}
        max_nodes: Maximum number of nodes (for sampling large graphs)
        layout_iterations: Number of force-layout iterations

    Returns:
        Dictionary with 'nodes' and 'edges' arrays
    """
    # Collect all unique words and their frequencies
    word_freq = Counter()

    for word, transitions in markov_dict.items():
        word_freq[word] += sum(transitions.values())
        for next_word, count in transitions.items():
            word_freq[next_word] += count

    # Sample if needed
    if max_nodes and len(word_freq) > max_nodes:
        # Keep most frequent words
        words = set(w for w, _ in word_freq.most_common(max_nodes))
    else:
        words = set(word_freq.keys())

    # Build nodes
    max_freq = max(word_freq.values()) if word_freq else 1
    nodes = []
    for word in words:
        freq = word_freq[word]
        # Size scales with frequency (log scale for better visibility)
        size = 2 + 8 * math.log(1 + freq) / math.log(1 + max_freq)
        nodes.append({
            'key': word,
            'label': word,
            'size': round(size, 2),
            'frequency': freq
        })

    # Build edges (only between included nodes)
    edges = []
    for word, transitions in markov_dict.items():
        if word not in words:
            continue
        for next_word, count in transitions.items():
            if next_word not in words:
                continue
            edges.append({
                'source': word,
                'target': next_word,
                'weight': count
            })

    # Compute layout
    print(f"Computing layout for {len(nodes)} nodes and {len(edges)} edges...")
    positions = compute_force_layout(nodes, edges, iterations=layout_iterations)

    # Add positions to nodes
    for node in nodes:
        pos = positions.get(node['key'], {'x': 0.5, 'y': 0.5})
        node['x'] = round(pos['x'], 4)
        node['y'] = round(pos['y'], 4)

    return {
        'nodes': nodes,
        'edges': edges,
        'metadata': {
            'nodeCount': len(nodes),
            'edgeCount': len(edges)
        }
    }


def generate_demo_graph(size: str = 'small') -> Dict[str, Counter]:
    """Generate a demo Markov graph from sample text."""

    # Sample texts for different sizes
    samples = {
        'small': """
        The cat sat on the mat. The dog ran to the park.
        A cat and a dog played in the yard. The mat was soft.
        The park had many trees. Trees provide shade.
        Shade is nice on hot days. Days go by quickly.
        """,
        'medium': """
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
        """
    }

    text = samples.get(size, samples['small'])
    words = text.lower().split()

    markov = {}
    for i in range(len(words) - 1):
        word = words[i].strip('.,!?')
        next_word = words[i + 1].strip('.,!?')
        if word not in markov:
            markov[word] = Counter()
        markov[word][next_word] += 1

    return markov


def main():
    parser = argparse.ArgumentParser(
        description='Convert Markov babbler dictionary to Graphology JSON'
    )
    parser.add_argument('input', help='Input pickle file or --demo for demo graph')
    parser.add_argument('output', help='Output JSON file')
    parser.add_argument('--max-nodes', type=int, default=None,
                        help='Maximum number of nodes (samples most frequent)')
    parser.add_argument('--iterations', type=int, default=100,
                        help='Layout algorithm iterations')
    parser.add_argument('--demo', choices=['small', 'medium'], default=None,
                        help='Generate demo graph instead of loading file')

    args = parser.parse_args()

    if args.input == '--demo' or args.demo:
        size = args.demo or 'small'
        print(f"Generating {size} demo graph...")
        markov_dict = generate_demo_graph(size)
    else:
        print(f"Loading Markov dictionary from {args.input}...")
        markov_dict = load_markov_dict(args.input)

    print(f"Found {len(markov_dict)} source words")

    graph = markov_to_graphology(
        markov_dict,
        max_nodes=args.max_nodes,
        layout_iterations=args.iterations
    )

    print(f"Writing graph to {args.output}...")
    with open(args.output, 'w') as f:
        json.dump(graph, f, indent=2)

    print(f"Done! Created graph with {graph['metadata']['nodeCount']} nodes "
          f"and {graph['metadata']['edgeCount']} edges")


if __name__ == '__main__':
    main()
