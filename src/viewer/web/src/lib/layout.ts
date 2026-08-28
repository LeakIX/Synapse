import type { GraphEdge } from './types';

/**
 * A force directed layout. Three forces act on the nodes:
 * repulsion between every pair, a spring along every edge, and a weak pull
 * to the centre that keeps a disconnected node on screen.
 *
 * The layout is a pure function. The same input gives the same output,
 * because the start positions come from a seeded generator and not from
 * Math.random. A refresh therefore does not shuffle the graph.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Pair repulsion strength. */
  repulsion?: number;
  /** Rest length of an edge, in pixels. */
  edgeLength?: number;
  /** Spring stiffness along an edge. */
  stiffness?: number;
  /** Pull towards the origin. */
  gravity?: number;
  /** Velocity kept between steps. */
  damping?: number;
  /** Seed of the start positions. */
  seed?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  repulsion: 12000,
  edgeLength: 130,
  stiffness: 0.004,
  gravity: 0.001,
  damping: 0.85,
  seed: 0x5eed,
};

/** A small deterministic generator, so the layout repeats exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Body extends Point {
  vx: number;
  vy: number;
}

/**
 * Place the given ids. Only an edge whose two ends are both in `ids` pulls.
 * The result maps an id to its point.
 */
export function layoutGraph(
  ids: string[],
  edges: GraphEdge[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const opts = { ...DEFAULTS, ...options };
  const positions = new Map<string, Point>();
  if (ids.length === 0) return positions;

  const random = mulberry32(opts.seed + ids.length);
  const bodies = new Map<string, Body>();
  for (const id of ids) {
    bodies.set(id, {
      x: (random() - 0.5) * 1400,
      y: (random() - 0.5) * 900,
      vx: 0,
      vy: 0,
    });
  }

  const springs = edges.filter(
    (edge) => bodies.has(edge.from) && bodies.has(edge.to),
  );
  const steps = Math.min(400, 100 + ids.length * 2);

  for (let step = 0; step < steps; step++) {
    for (let a = 0; a < ids.length; a++) {
      const first = bodies.get(ids[a]) as Body;
      for (let b = a + 1; b < ids.length; b++) {
        const second = bodies.get(ids[b]) as Body;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.hypot(dx, dy) || 1;
        const force = opts.repulsion / (distance * distance);
        first.vx -= (dx / distance) * force;
        first.vy -= (dy / distance) * force;
        second.vx += (dx / distance) * force;
        second.vy += (dy / distance) * force;
      }
    }

    for (const edge of springs) {
      const from = bodies.get(edge.from) as Body;
      const to = bodies.get(edge.to) as Body;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const force = (distance - opts.edgeLength) * opts.stiffness;
      from.vx += (dx / distance) * force;
      from.vy += (dy / distance) * force;
      to.vx -= (dx / distance) * force;
      to.vy -= (dy / distance) * force;
    }

    for (const body of bodies.values()) {
      body.vx -= body.x * opts.gravity;
      body.vy -= body.y * opts.gravity;
      body.vx *= opts.damping;
      body.vy *= opts.damping;
      body.x += body.vx;
      body.y += body.vy;
    }
  }

  for (const [id, body] of bodies) {
    positions.set(id, { x: body.x, y: body.y });
  }
  return positions;
}
