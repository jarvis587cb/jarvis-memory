import React, { useRef, useEffect, useState } from 'react';

interface Node {
    id: string;
    label: string;
    type: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    glowColor: string;
    content: string;
}

interface Edge {
    source: Node;
    target: Node;
    strength: number;
}

interface NeuralMapProps {
    seeds: any[];
    contexts: any[];
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        mA += a[i] * a[i];
        mB += b[i] * b[i];
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

const NeuralMap: React.FC<NeuralMapProps> = ({ seeds, contexts }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
    const nodesRef = useRef<Node[]>([]);
    const edgesRef = useRef<Edge[]>([]);

    // Initialize nodes and edges
    useEffect(() => {
        const newNodes: Node[] = [
            ...seeds.map((s) => ({
                id: s.id,
                label: s.title || s.id.slice(0, 8),
                type: 'seed',
                x: Math.random() * 800,
                y: Math.random() * 600,
                vx: 0,
                vy: 0,
                color: '#6366f1',
                glowColor: 'rgba(99, 102, 241, 0.5)',
                content: s.content,
                embedding: s.embedding
            })),
            ...contexts.map((c) => ({
                id: c.id,
                label: c.agentId + ' (' + c.type + ')',
                type: 'context',
                x: Math.random() * 800,
                y: Math.random() * 600,
                vx: 0,
                vy: 0,
                color: '#10b981',
                glowColor: 'rgba(16, 185, 129, 0.5)',
                content: c.summary,
                embedding: c.embedding
            }))
        ];

        const newEdges: Edge[] = [];
        const SIMILARITY_THRESHOLD = 0.82;

        for (let i = 0; i < newNodes.length; i++) {
            for (let j = i + 1; j < newNodes.length; j++) {
                const sim = cosineSimilarity((newNodes[i] as any).embedding, (newNodes[j] as any).embedding);
                if (sim > SIMILARITY_THRESHOLD) {
                    newEdges.push({
                        source: newNodes[i],
                        target: newNodes[j],
                        strength: (sim - SIMILARITY_THRESHOLD) / (1 - SIMILARITY_THRESHOLD)
                    });
                }
            }
        }

        nodesRef.current = newNodes;
        edgesRef.current = newEdges;
    }, [seeds, contexts]);

    // Animation loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const update = () => {
            const currentNodes = nodesRef.current;
            const currentEdges = edgesRef.current;

            const width = canvas.width;
            const height = canvas.height;

            // Force physics
            for (let i = 0; i < currentNodes.length; i++) {
                const n1 = currentNodes[i];

                // Center force
                n1.vx += (width / 2 - n1.x) * 0.001;
                n1.vy += (height / 2 - n1.y) * 0.001;

                for (let j = i + 1; j < currentNodes.length; j++) {
                    const n2 = currentNodes[j];
                    const dx = n2.x - n1.x;
                    const dy = n2.y - n1.y;
                    const distSq = dx * dx + dy * dy;

                    // Repulsion
                    const repulsion = 40 / (distSq || 1);
                    n1.vx -= dx * repulsion;
                    n1.vy -= dy * repulsion;
                    n2.vx += dx * repulsion;
                    n2.vy += dy * repulsion;
                }
            }

            // Edge forces (springs)
            for (const edge of currentEdges) {
                const dx = edge.target.x - edge.source.x;
                const dy = edge.target.y - edge.source.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const targetDist = 150;
                const force = (dist - targetDist) * 0.01 * edge.strength;

                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                edge.source.vx += fx;
                edge.source.vy += fy;
                edge.target.vx -= fx;
                edge.target.vy -= fy;
            }

            // Apply velocity
            for (const node of currentNodes) {
                node.x += node.vx;
                node.y += node.vy;
                node.vx *= 0.9; // Friction
                node.vy *= 0.9;

                // Bounds
                if (node.x < 20) node.x = 20;
                if (node.x > width - 20) node.x = width - 20;
                if (node.y < 20) node.y = 20;
                if (node.y > height - 20) node.y = height - 20;
            }
        };

        const draw = () => {
            const currentNodes = nodesRef.current;
            const currentEdges = edgesRef.current;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw edges (Synapses)
            ctx.lineWidth = 1;
            for (const edge of currentEdges) {
                ctx.beginPath();
                const opacity = 0.1 + edge.strength * 0.4;
                ctx.strokeStyle = `rgba(99, 102, 241, ${opacity})`;
                ctx.moveTo(edge.source.x, edge.source.y);
                ctx.lineTo(edge.target.x, edge.target.y);
                ctx.stroke();
            }

            // Draw nodes (Neurons)
            for (const node of currentNodes) {
                // Outer glow
                const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 15);
                gradient.addColorStop(0, node.glowColor);
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 15, 0, Math.PI * 2);
                ctx.fill();

                // Core
                ctx.fillStyle = node.color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, hoveredNode?.id === node.id ? 6 : 4, 0, Math.PI * 2);
                ctx.fill();

                // Label if high enough zoom or hovered
                if (hoveredNode?.id === node.id) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '12px Inter';
                    ctx.textAlign = 'center';
                    ctx.fillText(node.label, node.x, node.y - 20);
                }
            }
        };

        const render = () => {
            update();
            draw();
            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => cancelAnimationFrame(animationFrameId);
    }, [hoveredNode]);

    // Handle resize
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && canvasRef.current) {
                canvasRef.current.width = containerRef.current.clientWidth;
                canvasRef.current.height = containerRef.current.clientHeight;
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let found = null;
        for (const node of nodesRef.current) {
            const dx = node.x - mx;
            const dy = node.y - my;
            if (dx * dx + dy * dy < 400) {
                found = node;
                break;
            }
        }
        setHoveredNode(found);
    };

    return (
        <div className="neural-map-container" ref={containerRef}>
            <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                className="neural-canvas"
            />
            {hoveredNode && (
                <div className="node-tooltip">
                    <div className="tooltip-header">
                        <span className={`badge badge-${hoveredNode.type}`}>
                            {hoveredNode.type === 'seed' ? '🌱 Seed' : '🧠 Context'}
                        </span>
                        <span className="tooltip-id">{hoveredNode.id.slice(0, 8)}</span>
                    </div>
                    <div className="tooltip-title">{hoveredNode.label}</div>
                    <div className="tooltip-content">{hoveredNode.content}</div>
                </div>
            )}
            <div className="neural-map-legend">
                <div className="legend-item"><span className="dot dot-seed"></span> Seed</div>
                <div className="legend-item"><span className="dot dot-context"></span> Agent Context</div>
                <div className="legend-item"><span className="line"></span> Synapse (Ähnlichkeit)</div>
            </div>
        </div>
    );
};

export default NeuralMap;
