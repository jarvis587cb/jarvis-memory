import React, { useRef, useEffect, useState, useLayoutEffect } from 'react';

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
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [isClamped, setIsClamped] = useState(false);

    // Camera state: x, y is translation, k is scale
    const cameraRef = useRef({ x: 0, y: 0, k: 1 });
    const isDraggingRef = useRef(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });

    // Detect if tooltip overflows container height
    useLayoutEffect(() => {
        if (hoveredNode && tooltipRef.current && containerRef.current) {
            const containerHeight = containerRef.current.clientHeight;
            const tooltipHeight = tooltipRef.current.scrollHeight;
            // Clamp if tooltip would exceed container (minus padding)
            setIsClamped(tooltipHeight > containerHeight - 32);
        } else {
            setIsClamped(false);
        }
    }, [hoveredNode]);

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

        // Reset camera once on data load
        if (containerRef.current) {
            cameraRef.current = {
                x: containerRef.current.clientWidth / 2 - 400,
                y: containerRef.current.clientHeight / 2 - 300,
                k: 1
            };
        }
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

            const width = 800; // Reference width for physics
            const height = 600;

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
            }
        };

        const draw = () => {
            const currentNodes = nodesRef.current;
            const currentEdges = edgesRef.current;
            const camera = cameraRef.current;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.translate(camera.x, camera.y);
            ctx.scale(camera.k, camera.k);

            // Draw edges (Synapses)
            const drawEdge = (edge: Edge, opacity: number, width: number, color: string) => {
                ctx.beginPath();
                ctx.lineWidth = width / camera.k;
                ctx.strokeStyle = color.replace('ALPHA', opacity.toString());
                ctx.moveTo(edge.source.x, edge.source.y);
                ctx.lineTo(edge.target.x, edge.target.y);
                ctx.stroke();
            };

            const edgeBaseColor = 'rgba(99, 102, 241, ALPHA)';
            const edgeHighlightColor = 'rgba(165, 180, 252, ALPHA)';

            // Pass 1: Draw non-connected edges
            for (const edge of currentEdges) {
                const isConnected = hoveredNode && (edge.source.id === hoveredNode.id || edge.target.id === hoveredNode.id);
                if (isConnected) continue;

                const baseOpacity = 0.1 + edge.strength * 0.4;
                const opacity = hoveredNode ? baseOpacity * 0.3 : baseOpacity;
                drawEdge(edge, opacity, 1, edgeBaseColor);
            }

            // Pass 2: Draw connected edges
            if (hoveredNode) {
                for (const edge of currentEdges) {
                    const isConnected = edge.source.id === hoveredNode.id || edge.target.id === hoveredNode.id;
                    if (!isConnected) continue;

                    const opacity = 0.6 + edge.strength * 0.3;
                    drawEdge(edge, opacity, 2, edgeHighlightColor);
                }
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

                // Label if hovered
                if (hoveredNode?.id === node.id) {
                    ctx.fillStyle = '#fff';
                    ctx.font = `${12 / camera.k}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.fillText(node.label, node.x, node.y - 20 / camera.k);
                }
            }

            ctx.restore();
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

    const screenToWorld = (sx: number, sy: number) => {
        const camera = cameraRef.current;
        return {
            x: (sx - camera.x) / camera.k,
            y: (sy - camera.y) / camera.k
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (isDraggingRef.current) {
            const dx = e.clientX - lastMousePosRef.current.x;
            const dy = e.clientY - lastMousePosRef.current.y;
            cameraRef.current.x += dx;
            cameraRef.current.y += dy;
            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
            return;
        }

        const worldPos = screenToWorld(mx, my);
        let found = null;
        for (const node of nodesRef.current) {
            const dx = node.x - worldPos.x;
            const dy = node.y - worldPos.y;
            // Radius of hit detection should also scale with zoom so it matches the visual size
            const radius = 15;
            if (dx * dx + dy * dy < radius * radius) {
                found = node;
                break;
            }
        }
        setHoveredNode(found);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        isDraggingRef.current = true;
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
        isDraggingRef.current = false;
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const delta = -e.deltaY;
        const zoomFactor = Math.pow(1.1, delta / 100);

        const camera = cameraRef.current;
        const nextK = Math.max(0.1, Math.min(10, camera.k * zoomFactor));
        const actualFactor = nextK / camera.k;

        camera.x = mx - (mx - camera.x) * actualFactor;
        camera.y = my - (my - camera.y) * actualFactor;
        camera.k = nextK;
    };

    return (
        <div className="neural-map-container" ref={containerRef}>
            <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                className="neural-canvas"
            />
            <div className="neural-controls-hint">
                🖱️ Ziehen zum Bewegen | ⚙️ Scrollen zum Zoomen
            </div>
            {hoveredNode && (
                <div
                    ref={tooltipRef}
                    className={`node-tooltip ${isClamped ? 'is-clamped' : ''}`}
                >
                    <div className="tooltip-header">
                        <span className={`badge badge-${hoveredNode.type}`}>
                            {hoveredNode.type === 'seed' ? '🌱 Seed' : '🧠 Context'}
                        </span>
                        <span className="tooltip-id">{hoveredNode.id.slice(0, 8)}</span>
                    </div>
                    <div className="tooltip-title">{hoveredNode.label}</div>
                    <div className="tooltip-content">{hoveredNode.content}</div>

                    {(() => {
                        const connections = edgesRef.current.filter(e => e.source.id === hoveredNode.id || e.target.id === hoveredNode.id);
                        if (connections.length === 0) return null;

                        // Calculate dynamic columns (1-5) based on connection count
                        let cols = 1;
                        if (connections.length > 40) cols = 5;
                        else if (connections.length > 20) cols = 4;
                        else if (connections.length > 10) cols = 3;
                        else if (connections.length > 5) cols = 2;

                        return (
                            <div className={`tooltip-synapses cols-${cols}`}>
                                <div className="synapses-header">Synapsen ({connections.length}):</div>
                                {connections
                                    .sort((a, b) => b.strength - a.strength)
                                    .map(e => {
                                        const target = e.source.id === hoveredNode.id ? e.target : e.source;
                                        return (
                                            <div key={target.id} className="synapse-item">
                                                <span className="synapse-label">{target.label}</span>
                                                <span className="synapse-strength">{(e.strength * 100).toFixed(0)}%</span>
                                            </div>
                                        );
                                    })}
                            </div>
                        );
                    })()}
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
