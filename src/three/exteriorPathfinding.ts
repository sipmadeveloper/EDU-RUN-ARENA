export type NavZoneType = 'parking' | 'canteen' | 'tribune' | 'waypoint';

export interface NavNode {
  id: string;
  x: number;
  z: number;
  zone: NavZoneType;
}

export interface NavEdge {
  to: number;
  cost: number;
}

export interface ExteriorNavGraph {
  nodes: NavNode[];
  adj: NavEdge[][];
  parkingIds: number[];
  canteenIds: number[];
  tribuneIds: number[];
  canteenPositions: {
    west: { x: number; z: number; yaw: number };
    east: { x: number; z: number; yaw: number };
  };
}

export interface PathfindingNpcAgent {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  scale: number;
  lateralOffset: number;
  stridePhase: number;
  isMoving: boolean;
  path: number[];
  pathCursor: number;
  segmentT: number;
  currentNode: number;
  goalNode: number;
  waitTimer: number;
  rngState: number;
}

function nextRand(agent: PathfindingNpcAgent): number {
  agent.rngState = (agent.rngState * 1664525 + 1013904223) >>> 0;
  return agent.rngState / 4294967296;
}

/**
 * Builds the connected exterior stadium navigation waypoint graph linking:
 * - Rear, Left-Side, and Right-Side Parking exits ('parking')
 * - West & East Stadium Canteens / Food Courts ('canteen')
 * - Main Stadium Entrance & Tribune Concourse Access gates ('tribune')
 * All edges stay strictly on unobstructed batako walkways & concourses.
 */
export function buildExteriorNavGraph(straightLen: number): ExteriorNavGraph {
  const halfL = straightLen / 2;
  const nodes: NavNode[] = [];
  const indexById = new Map<string, number>();

  const addNode = (id: string, x: number, z: number, zone: NavZoneType): number => {
    const idx = nodes.length;
    nodes.push({ id, x, z, zone });
    indexById.set(id, idx);
    return idx;
  };

  const capPt = (side: -1 | 1, basePhi: number, r: number): [number, number] => {
    const phi = side === 1 ? basePhi : Math.PI - basePhi;
    return [side * halfL + Math.cos(phi) * r, Math.sin(phi) * r];
  };

  // --- 1. PARKING ENTRANCE / EXIT NODES ---
  addNode('park_s_w', -132, 266, 'parking');
  addNode('park_s_c', 0, 266, 'parking');
  addNode('park_s_e', 132, 266, 'parking');
  const [pwsX, pwsZ] = capPt(-1, 0.28 * Math.PI, 289);
  const [pwmX, pwmZ] = capPt(-1, 0.0, 289);
  const [pwnX, pwnZ] = capPt(-1, -0.21 * Math.PI, 289);
  const [pesX, pesZ] = capPt(1, 0.28 * Math.PI, 289);
  const [pemX, pemZ] = capPt(1, 0.0, 289);
  const [penX, penZ] = capPt(1, -0.21 * Math.PI, 289);
  addNode('park_w_s', pwsX, pwsZ, 'parking');
  addNode('park_w_m', pwmX, pwmZ, 'parking');
  addNode('park_w_n', pwnX, pwnZ, 'parking');
  addNode('park_e_s', pesX, pesZ, 'parking');
  addNode('park_e_m', pemX, pemZ, 'parking');
  addNode('park_e_n', penX, penZ, 'parking');

  // --- 2. EXTERIOR STADIUM CANTEEN / FOOD COURT NODES (West & East Plazas) ---
  const canteenPhi = -0.278 * Math.PI;
  const [cwPlazaX, cwPlazaZ] = capPt(-1, canteenPhi, 294);
  const [cePlazaX, cePlazaZ] = capPt(1, canteenPhi, 294);
  const [cwPavX, cwPavZ] = capPt(-1, canteenPhi, 312);
  const [cePavX, cePavZ] = capPt(1, canteenPhi, 312);
  addNode('canteen_west', cwPlazaX, cwPlazaZ, 'canteen');
  addNode('canteen_east', cePlazaX, cePlazaZ, 'canteen');

  // --- 3. TRIBUNE & MAIN STADIUM ENTRANCE NODES ---
  addNode('tribune_main', 0, -248, 'tribune');
  addNode('tribune_nw', -20, -259, 'tribune');
  addNode('tribune_ne', 20, -259, 'tribune');
  const [twX, twZ] = capPt(-1, -0.04 * Math.PI, 261);
  const [teX, teZ] = capPt(1, -0.04 * Math.PI, 261);
  addNode('tribune_west', twX, twZ, 'tribune');
  addNode('tribune_east', teX, teZ, 'tribune');
  addNode('tribune_south', 0, 259, 'tribune');

  // --- 4. UNOBSTRUCTED BATAKO CONCOURSE WAYPOINTS (r = 263, clear of stadium wall & flank trees) ---
  addNode('wp_s_w', -132, 261.5, 'waypoint');
  addNode('wp_s_e', 132, 261.5, 'waypoint');
  const [sw1X, sw1Z] = capPt(-1, 0.38 * Math.PI, 263);
  const [sw2X, sw2Z] = capPt(-1, 0.2 * Math.PI, 263);
  const [wn1X, wn1Z] = capPt(-1, -0.18 * Math.PI, 263);
  const [nw1X, nw1Z] = capPt(-1, -0.34 * Math.PI, 263);
  const [nw2X, nw2Z] = capPt(-1, -0.46 * Math.PI, 263);
  addNode('wp_sw_1', sw1X, sw1Z, 'waypoint');
  addNode('wp_sw_2', sw2X, sw2Z, 'waypoint');
  addNode('wp_wn_1', wn1X, wn1Z, 'waypoint');
  addNode('wp_nw_1', nw1X, nw1Z, 'waypoint');
  addNode('wp_nw_2', nw2X, nw2Z, 'waypoint');

  const [se1X, se1Z] = capPt(1, 0.38 * Math.PI, 263);
  const [se2X, se2Z] = capPt(1, 0.2 * Math.PI, 263);
  const [en1X, en1Z] = capPt(1, -0.18 * Math.PI, 263);
  const [ne1X, ne1Z] = capPt(1, -0.34 * Math.PI, 263);
  const [ne2X, ne2Z] = capPt(1, -0.46 * Math.PI, 263);
  addNode('wp_se_1', se1X, se1Z, 'waypoint');
  addNode('wp_se_2', se2X, se2Z, 'waypoint');
  addNode('wp_en_1', en1X, en1Z, 'waypoint');
  addNode('wp_ne_1', ne1X, ne1Z, 'waypoint');
  addNode('wp_ne_2', ne2X, ne2Z, 'waypoint');

  // North concourse straightaway & outer shaded walkway
  addNode('wp_n_w1', -145, -261, 'waypoint');
  addNode('wp_n_w2', -75, -261, 'waypoint');
  addNode('wp_n_e2', 75, -261, 'waypoint');
  addNode('wp_n_e1', 145, -261, 'waypoint');
  addNode('wp_prom_mid', 0, -295, 'waypoint');
  addNode('wp_prom_gate', 0, -348, 'waypoint');

  // Outer shaded walkways (r = 287) between flank trees (276) & side parking curb (293)
  const [ow1X, ow1Z] = capPt(-1, 0.14 * Math.PI, 287);
  const [ow2X, ow2Z] = capPt(-1, -0.11 * Math.PI, 287);
  const [oe1X, oe1Z] = capPt(1, 0.14 * Math.PI, 287);
  const [oe2X, oe2Z] = capPt(1, -0.11 * Math.PI, 287);
  addNode('wp_ow_1', ow1X, ow1Z, 'waypoint');
  addNode('wp_ow_2', ow2X, ow2Z, 'waypoint');
  addNode('wp_oe_1', oe1X, oe1Z, 'waypoint');
  addNode('wp_oe_2', oe2X, oe2Z, 'waypoint');

  const adj: NavEdge[][] = Array.from({ length: nodes.length }, () => []);
  const connect = (idA: string, idB: string, weightScale = 1.0) => {
    const a = indexById.get(idA);
    const b = indexById.get(idB);
    if (a === undefined || b === undefined) return;
    const dist = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z) * weightScale;
    adj[a].push({ to: b, cost: dist });
    adj[b].push({ to: a, cost: dist });
  };

  // Connect South Rear Parking <-> South Concourse
  connect('park_s_w', 'wp_s_w');
  connect('park_s_c', 'tribune_south');
  connect('park_s_e', 'wp_s_e');
  connect('wp_s_w', 'tribune_south');
  connect('tribune_south', 'wp_s_e');

  // Connect West Inner Concourse Loop (South -> West -> North-West -> North)
  connect('wp_s_w', 'wp_sw_1');
  connect('wp_sw_1', 'wp_sw_2');
  connect('wp_sw_2', 'tribune_west');
  connect('tribune_west', 'wp_wn_1');
  connect('wp_wn_1', 'wp_nw_1');
  connect('wp_nw_1', 'wp_nw_2');
  connect('wp_nw_2', 'wp_n_w1');
  connect('wp_n_w1', 'wp_n_w2');
  connect('wp_n_w2', 'tribune_nw');
  connect('tribune_nw', 'tribune_main');

  // Connect East Inner Concourse Loop (South -> East -> North-East -> North)
  connect('wp_s_e', 'wp_se_1');
  connect('wp_se_1', 'wp_se_2');
  connect('wp_se_2', 'tribune_east');
  connect('tribune_east', 'wp_en_1');
  connect('wp_en_1', 'wp_ne_1');
  connect('wp_ne_1', 'wp_ne_2');
  connect('wp_ne_2', 'wp_n_e1');
  connect('wp_n_e1', 'wp_n_e2');
  connect('wp_n_e2', 'tribune_ne');
  connect('tribune_ne', 'tribune_main');

  // Connect Front Promenade
  connect('tribune_nw', 'tribune_ne');
  connect('tribune_main', 'wp_prom_mid');
  connect('wp_prom_mid', 'wp_prom_gate');

  // Connect West Side Parking <-> Outer Shaded Walkway <-> West Canteen & Inner Concourse
  connect('park_w_s', 'wp_sw_2');
  connect('park_w_s', 'wp_ow_1');
  connect('wp_ow_1', 'park_w_m');
  connect('park_w_m', 'tribune_west');
  connect('park_w_m', 'wp_ow_2');
  connect('wp_ow_2', 'park_w_n');
  connect('park_w_n', 'wp_wn_1');
  connect('park_w_n', 'canteen_west');
  connect('canteen_west', 'wp_wn_1');
  connect('canteen_west', 'wp_nw_1');
  connect('canteen_west', 'wp_nw_2');

  // Connect East Side Parking <-> Outer Shaded Walkway <-> East Canteen & Inner Concourse
  connect('park_e_s', 'wp_se_2');
  connect('park_e_s', 'wp_oe_1');
  connect('wp_oe_1', 'park_e_m');
  connect('park_e_m', 'tribune_east');
  connect('park_e_m', 'wp_oe_2');
  connect('wp_oe_2', 'park_e_n');
  connect('park_e_n', 'wp_en_1');
  connect('park_e_n', 'canteen_east');
  connect('canteen_east', 'wp_en_1');
  connect('canteen_east', 'wp_ne_1');
  connect('canteen_east', 'wp_ne_2');

  const parkingIds: number[] = [];
  const canteenIds: number[] = [];
  const tribuneIds: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].zone === 'parking') parkingIds.push(i);
    else if (nodes[i].zone === 'canteen') canteenIds.push(i);
    else if (nodes[i].zone === 'tribune') tribuneIds.push(i);
  }

  // Face each canteen pavilion cleanly inward toward the stadium concourse
  const westYaw = Math.atan2(cwPlazaX - cwPavX, cwPlazaZ - cwPavZ);
  const eastYaw = Math.atan2(cePlazaX - cePavX, cePlazaZ - cePavZ);

  return {
    nodes,
    adj,
    parkingIds,
    canteenIds,
    tribuneIds,
    canteenPositions: {
      west: { x: cwPavX, z: cwPavZ, yaw: westYaw },
      east: { x: cePavX, z: cePavZ, yaw: eastYaw },
    },
  };
}

/**
 * Lightweight A* shortest-path search over the exterior stadium waypoint graph.
 */
export function findShortestPath(
  graph: ExteriorNavGraph,
  startIdx: number,
  goalIdx: number
): number[] {
  if (startIdx === goalIdx) return [startIdx];

  const n = graph.nodes.length;
  const gScore = new Float32Array(n).fill(Infinity);
  const fScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int16Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const inOpen = new Uint8Array(n);
  const openList: number[] = [startIdx];

  const goal = graph.nodes[goalIdx];
  const heuristic = (idx: number) => {
    const nd = graph.nodes[idx];
    return Math.hypot(goal.x - nd.x, goal.z - nd.z);
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startIdx);
  inOpen[startIdx] = 1;

  while (openList.length > 0) {
    let bestPos = 0;
    let bestF = fScore[openList[0]];
    for (let i = 1; i < openList.length; i++) {
      const f = fScore[openList[i]];
      if (f < bestF) {
        bestF = f;
        bestPos = i;
      }
    }

    const current = openList[bestPos];
    openList[bestPos] = openList[openList.length - 1];
    openList.pop();
    inOpen[current] = 0;

    if (current === goalIdx) {
      const path: number[] = [];
      let cur = goalIdx;
      while (cur !== -1) {
        path.push(cur);
        cur = cameFrom[cur];
      }
      path.reverse();
      return path;
    }

    closed[current] = 1;
    const edges = graph.adj[current];
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (closed[edge.to]) continue;
      const tentativeG = gScore[current] + edge.cost;
      if (tentativeG < gScore[edge.to]) {
        cameFrom[edge.to] = current;
        gScore[edge.to] = tentativeG;
        fScore[edge.to] = tentativeG + heuristic(edge.to);
        if (!inOpen[edge.to]) {
          openList.push(edge.to);
          inOpen[edge.to] = 1;
        }
      }
    }
  }

  return [startIdx];
}

function pickNextDestination(graph: ExteriorNavGraph, agent: PathfindingNpcAgent): number {
  const curZone = graph.nodes[agent.currentNode].zone;
  const r = nextRand(agent);

  let pool: number[];
  if (curZone === 'parking') {
    // From parking entrance -> dynamically head to either Canteen (45%) or Tribune / Main Entrance (55%)
    pool = r < 0.45 ? graph.canteenIds : graph.tribuneIds;
  } else if (curZone === 'canteen') {
    // From canteen -> mostly head onward to Tribune (72%), or back to Parking (28%)
    pool = r < 0.72 ? graph.tribuneIds : graph.parkingIds;
  } else {
    // From tribune -> visit Canteen (48%) or walk back to Parking (52%)
    pool = r < 0.48 ? graph.canteenIds : graph.parkingIds;
  }

  if (pool.length === 0) return agent.currentNode;
  let pick = pool[Math.floor(nextRand(agent) * pool.length)];
  if (pick === agent.currentNode && pool.length > 1) {
    pick = pool[(pool.indexOf(pick) + 1) % pool.length];
  }
  return pick;
}

/**
 * Spawns dynamic pathfinding NPCs distributed along active paths from Parking -> Canteen / Tribune.
 */
export function createPathfindingNpcAgents(
  graph: ExteriorNavGraph,
  count: number
): PathfindingNpcAgent[] {
  const agents: PathfindingNpcAgent[] = [];

  for (let i = 0; i < count; i++) {
    const startNode =
      i % 3 !== 2
        ? graph.parkingIds[i % graph.parkingIds.length]
        : i % 2 === 0
          ? graph.canteenIds[i % graph.canteenIds.length]
          : graph.tribuneIds[i % graph.tribuneIds.length];

    const agent: PathfindingNpcAgent = {
      x: graph.nodes[startNode].x,
      z: graph.nodes[startNode].z,
      yaw: 0,
      speed: 4.0 + (i % 6) * 0.52,
      scale: 1.26 + (i % 4) * 0.08,
      lateralOffset: ((i % 7) - 3) * 1.15,
      stridePhase: i * 1.47,
      isMoving: true,
      path: [startNode],
      pathCursor: 0,
      segmentT: 0,
      currentNode: startNode,
      goalNode: startNode,
      waitTimer: 0,
      rngState: (i + 1) * 2654435761,
    };

    const goal = pickNextDestination(graph, agent);
    agent.goalNode = goal;
    agent.path = findShortestPath(graph, startNode, goal);

    // Pre-advance each agent along its initial route so NPCs start spread organically everywhere
    if (agent.path.length > 1) {
      const segIdx = Math.floor(nextRand(agent) * (agent.path.length - 1));
      agent.pathCursor = segIdx;
      agent.segmentT = nextRand(agent);
      const a = graph.nodes[agent.path[segIdx]];
      const b = graph.nodes[agent.path[segIdx + 1]];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      agent.x = a.x + dx * agent.segmentT + nx * agent.lateralOffset;
      agent.z = a.z + dz * agent.segmentT + nz * agent.lateralOffset;
      agent.yaw = Math.atan2(dx, dz);
    }

    agents.push(agent);
  }

  return agents;
}

/**
 * Advances all dynamic pathfinding NPCs by dt seconds (zero heap allocations on normal steps).
 */
export function stepPathfindingNpcAgents(
  graph: ExteriorNavGraph,
  agents: PathfindingNpcAgent[],
  dt: number
): void {
  const clampedDt = Math.min(Math.max(dt, 0), 0.12);

  for (let i = 0; i < agents.length; i++) {
    const ag = agents[i];

    if (ag.waitTimer > 0) {
      ag.waitTimer -= clampedDt;
      ag.isMoving = false;
      if (ag.waitTimer <= 0) {
        const nextGoal = pickNextDestination(graph, ag);
        ag.goalNode = nextGoal;
        ag.path = findShortestPath(graph, ag.currentNode, nextGoal);
        ag.pathCursor = 0;
        ag.segmentT = 0;
        ag.isMoving = ag.path.length > 1;
      }
      continue;
    }

    if (ag.pathCursor >= ag.path.length - 1) {
      ag.currentNode = ag.path[ag.path.length - 1];
      ag.waitTimer = 1.6 + nextRand(ag) * 3.2;
      ag.isMoving = false;
      continue;
    }

    let remainingDist = ag.speed * clampedDt;
    ag.isMoving = true;

    while (remainingDist > 0 && ag.pathCursor < ag.path.length - 1) {
      const fromNode = graph.nodes[ag.path[ag.pathCursor]];
      const toNode = graph.nodes[ag.path[ag.pathCursor + 1]];
      const dx = toNode.x - fromNode.x;
      const dz = toNode.z - fromNode.z;
      const segLen = Math.hypot(dx, dz) || 1;
      const distLeftOnSeg = (1 - ag.segmentT) * segLen;

      if (remainingDist < distLeftOnSeg) {
        ag.segmentT += remainingDist / segLen;
        remainingDist = 0;
      } else {
        remainingDist -= distLeftOnSeg;
        ag.pathCursor += 1;
        ag.segmentT = 0;
        ag.currentNode = ag.path[ag.pathCursor];
        if (ag.pathCursor >= ag.path.length - 1) {
          ag.waitTimer = 1.8 + nextRand(ag) * 3.4;
          ag.isMoving = false;
          break;
        }
      }
    }

    const idxA = Math.min(ag.pathCursor, ag.path.length - 1);
    const idxB = Math.min(ag.pathCursor + 1, ag.path.length - 1);
    const nA = graph.nodes[ag.path[idxA]];
    const nB = graph.nodes[ag.path[idxB]];
    const dx = nB.x - nA.x;
    const dz = nB.z - nA.z;
    const len = Math.hypot(dx, dz);

    if (len > 0.01) {
      const nx = -dz / len;
      const nz = dx / len;
      ag.x = nA.x + dx * ag.segmentT + nx * ag.lateralOffset;
      ag.z = nA.z + dz * ag.segmentT + nz * ag.lateralOffset;
      const targetYaw = Math.atan2(dx, dz);
      let diff = ((targetYaw - ag.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      ag.yaw += diff * Math.min(1, clampedDt * 8.5);
    } else {
      ag.x = nA.x + ag.lateralOffset * 0.4;
      ag.z = nA.z;
    }
  }
}
