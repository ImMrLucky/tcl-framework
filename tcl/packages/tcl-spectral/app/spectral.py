import numpy as np
from typing import List, Dict, Tuple, Set, Optional
from collections import deque
from .spectral_config import SpectralConfig

def build_index(claim_ids: List[str]) -> Dict[str, int]:
    return {cid: i for i, cid in enumerate(claim_ids)}

def _adjacency_directed(n: int,
                        support_edges: List[Tuple[int,int,float]],
                        contradiction_edges: List[Tuple[int,int,float]],
                        w_support: float,
                        w_contra: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Directed support adjacency (A_sup_dir), directed contradiction (A_con_dir).
    We also build signed adjacency A_signed_dir = A_sup_dir - A_con_dir.
    """
    A_sup = np.zeros((n, n), dtype=np.float64)
    A_con = np.zeros((n, n), dtype=np.float64)

    for i, j, w in support_edges:
        if i == j:
            continue
        A_sup[i, j] += float(max(0.0, w)) * float(w_support)

    for i, j, w in contradiction_edges:
        if i == j:
            continue
        A_con[i, j] += float(max(0.0, w)) * float(w_contra)

    A_signed = A_sup - A_con
    return A_signed, A_sup, A_con

def _symmetrize(A: np.ndarray) -> np.ndarray:
    return 0.5 * (A + A.T)

def _signed_laplacian_from_directed(A_signed_dir: np.ndarray) -> np.ndarray:
    """
    For spectral analysis we need a symmetric operator for stable real eigenvalues.
    We use the symmetrized signed adjacency: A = (A_dir + A_dir^T)/2
    Degree uses abs weights.
    """
    A = _symmetrize(A_signed_dir)
    D = np.diag(np.sum(np.abs(A), axis=1))
    return D - A

def _eigvals_sym(H: np.ndarray) -> np.ndarray:
    return np.linalg.eigvalsh(H)

def _heat_trace(evals: np.ndarray, t_values: Tuple[float, ...]) -> List[float]:
    evals = np.clip(evals, 0.0, None)
    return [float(np.sum(np.exp(-t * evals))) for t in t_values]

def _cycle_mass_directed(A_sup_dir: np.ndarray, ungrounded: Set[int], max_len: int) -> float:
    """
    Grounding-aware directed cycle mass.
    We compute weighted directed cycle mass on the subgraph of UNGROUNDED claims.

    For a directed adjacency W (normalized to <= 1):
      trace(W^k) counts total weight of length-k directed cycles.
    We sum k=2..max_len, normalize by number of nodes to be scale-stable.

    Returns >= 0 (higher = more circular self-support).
    """
    nodes = sorted(list(ungrounded))
    m = len(nodes)
    if m <= 1:
        return 0.0

    # submatrix
    W = A_sup_dir[np.ix_(nodes, nodes)].copy()

    # normalize to [0,1] scale to prevent blowups
    maxw = float(np.max(W)) if float(np.max(W)) > 0.0 else 1.0
    W = W / maxw
    W = np.clip(W, 0.0, 1.0)

    cyc = 0.0
    P = W.copy()
    for k in range(2, max_len + 1):
        # For k=2, P is W^2 if we multiply once more
        if k == 2:
            P = W @ W
        else:
            P = P @ W
        cyc += float(np.trace(P)) / float(k)

    # normalize by node count (scale stability)
    return float(max(0.0, cyc / max(1.0, float(m))))

def spectral_metrics(n: int,
                     support_edges: List[Tuple[int,int,float]],
                     contradiction_edges: List[Tuple[int,int,float]],
                     grounded_ids: Set[int],
                     config: Optional[SpectralConfig] = None) -> Dict[str, object]:
    if config is None:
        config = SpectralConfig()
    
    if n <= 1:
        return {
            "spectralGap": 1.0,
            "contradictionEnergy": 0.0,
            "supportEnergy": 0.0,
            "circularityScore": 0,
            "cycleMass": 0.0,
            "heatTrace": [1.0, 1.0, 1.0],
            "coherenceScore": 100
        }

    A_signed, A_sup_dir, A_con_dir = _adjacency_directed(n, support_edges, contradiction_edges, config.w_support, config.w_contradiction)
    H = _signed_laplacian_from_directed(A_signed)

    evals = np.sort(np.clip(_eigvals_sym(H), 0.0, None))
    spectral_gap = float(evals[1] - evals[0]) if n >= 2 else 0.0

    support_energy = float(np.sum(A_sup_dir)) / max(1.0, float(n))
    contradiction_energy = float(np.sum(A_con_dir)) / max(1.0, float(n))

    # grounding-aware circularity: only penalize cycles among ungrounded claims
    ungrounded = set(range(n)) - set(grounded_ids)
    cycle_mass = _cycle_mass_directed(A_sup_dir, ungrounded, config.cycle_max_len)
    # map cycle_mass to 0..1
    cycle01 = 1.0 - np.exp(-config.cycle_decay * cycle_mass)
    circ_pen = float(np.clip(cycle01 * float(config.w_circularity), 0.0, 1.0))
    circularityScore = int(round(100.0 * float(np.clip(cycle01, 0.0, 1.0))))

    heat = _heat_trace(evals, config.heat_t_values)

    # Soft-normalize
    gap_norm = 1.0 - np.exp(-config.gap_scale * spectral_gap)
    contra_norm = 1.0 - np.exp(-config.contra_scale * contradiction_energy)
    sup_norm = 1.0 - np.exp(-config.support_scale * support_energy)

    coherence01 = (
        config.w_gap * gap_norm +
        config.w_support_energy * sup_norm +
        config.w_anti_contra * (1.0 - contra_norm) -
        config.w_circularity_penalty * circ_pen
    )
    coherence01 = float(np.clip(coherence01, 0.0, 1.0))
    coherenceScore = int(round(100.0 * coherence01))

    return {
        "spectralGap": spectral_gap,
        "contradictionEnergy": contradiction_energy,
        "supportEnergy": support_energy,
        "circularityScore": circularityScore,
        "cycleMass": float(cycle_mass),
        "heatTrace": heat,
        "coherenceScore": coherenceScore
    }

# ============================================================================
# LEGACY WRAPPER (for backward compatibility)
# ============================================================================

def spectral_metrics_legacy(
    n: int,
    support_edges: List[Tuple[int,int,float]],
    contradiction_edges: List[Tuple[int,int,float]],
    grounded_ids: Set[int],
    w_support: float = 1.0,
    w_contradiction: float = 1.0,
    w_circularity: float = 1.0,
    cycle_max_len: int = 4
) -> Dict[str, object]:
    """
    Legacy wrapper for spectral_metrics with old parameter signature.
    
    DEPRECATED: Use spectral_metrics with SpectralConfig instead.
    """
    config = SpectralConfig(
        w_support=w_support,
        w_contradiction=w_contradiction,
        w_circularity=w_circularity,
        cycle_max_len=cycle_max_len
    )
    return spectral_metrics(n, support_edges, contradiction_edges, grounded_ids, config=config)


def spectral_truth_vector_legacy(
    n: int,
    support_edges: List[Tuple[int,int,float]],
    contradiction_edges: List[Tuple[int,int,float]],
    grounded_ids: Set[int],
    w_support: float = 1.0,
    w_contradiction: float = 1.0,
    alpha: float = 0.25,
    beta: float = 1.0,
    clip: float = 1.0,
    tau: float = 0.15
) -> Dict[str, object]:
    """
    Legacy wrapper for spectral_truth_vector with old parameter signature.
    
    DEPRECATED: Use spectral_truth_vector with SpectralConfig instead.
    Note: Returns old field names (truthVector, truthStates) for compatibility.
    """
    config = SpectralConfig(
        w_support=w_support,
        w_contradiction=w_contradiction,
        alpha=alpha,
        beta=beta,
        clip=clip,
        tau=tau
    )
    result = spectral_truth_vector(n, support_edges, contradiction_edges, grounded_ids, config=config)
    # Map new field names to old for backward compatibility
    return {
        "truthVector": result["truthSignalVector"],
        "truthStates": result["truthSignalStates"]
    }


# ============================================================================
# NEW PLATFORM-GRADE ANALYSIS FUNCTIONS (Additive - does not modify existing)
# ============================================================================

def spectral_truth_vector(
    n: int,
    support_edges: List[Tuple[int,int,float]],
    contradiction_edges: List[Tuple[int,int,float]],
    grounded_ids: Set[int],
    config: Optional[SpectralConfig] = None
) -> Dict[str, object]:
    """
    Compute per-claim truth signal vector using signed Laplacian with grounding bias.
    
    Solves: (H + alpha * I) x = beta * b
    where H is signed Laplacian, b is grounding bias vector.
    
    Returns:
        truthSignalVector: List[float] - normalized truth signal values per claim
        truthSignalStates: List[str] - state labels ("Supported", "Contradicted", "Ungrounded", "Inconclusive")
    """
    if config is None:
        config = SpectralConfig()
    
    if n <= 0:
        return {
            "truthSignalVector": [],
            "truthSignalStates": []
        }
    
    # Build signed adjacency using existing helper
    A_signed, _, _ = _adjacency_directed(n, support_edges, contradiction_edges, config.w_support, config.w_contradiction)
    
    # Build signed Laplacian using existing helper
    H = _signed_laplacian_from_directed(A_signed)
    
    # Build grounding bias vector
    b = np.zeros(n, dtype=np.float64)
    for i in grounded_ids:
        if 0 <= i < n:
            b[i] = 1.0
    
    # Solve (H + alpha * I) x = beta * b
    H_reg = H + config.alpha * np.eye(n, dtype=np.float64)
    rhs = config.beta * b
    
    try:
        # Try direct solve first
        x = np.linalg.solve(H_reg, rhs)
    except np.linalg.LinAlgError:
        # Fall back to least squares if singular
        x, _, _, _ = np.linalg.lstsq(H_reg, rhs, rcond=None)
    
    # Normalize by max absolute value if nonzero
    max_abs = float(np.max(np.abs(x))) if n > 0 else 1.0
    if max_abs > config.eps:
        x = x / max_abs
    
    # Clamp to [-clip, clip]
    x = np.clip(x, -config.clip, config.clip)
    
    # Convert to list of floats
    truth_signal_vector = [float(x[i]) for i in range(n)]
    
    # Map to truth signal states
    truth_signal_states = []
    for i in range(n):
        x_i = truth_signal_vector[i]
        if abs(x_i) <= config.tau:
            if i in grounded_ids:
                truth_signal_states.append("Inconclusive")
            else:
                truth_signal_states.append("Ungrounded")
        elif x_i > config.tau:
            truth_signal_states.append("Supported")
        else:  # x_i < -tau
            truth_signal_states.append("Contradicted")
    
    return {
        "truthSignalVector": truth_signal_vector,
        "truthSignalStates": truth_signal_states
    }

def spectral_edge_attribution(
    truth_vector: List[float],
    support_edges: List[Tuple[int,int,float]],
    contradiction_edges: List[Tuple[int,int,float]],
    top_k: int = 10
) -> Dict[str, object]:
    """
    Identify problematic edges that drive low coherence.
    
    For support edges: bad if nodes have opposite signs (contradicts support)
    For contradiction edges: bad if nodes have same sign (contradiction not working)
    
    Returns:
        topBadContradictions: List of problematic contradiction edges
        topBadSupports: List of problematic support edges
        nodeBlame: List[float] - blame score per node (sum of incident badness)
    """
    n = len(truth_vector)
    x = np.array(truth_vector, dtype=np.float64)
    
    # Score support edges
    bad_supports = []
    for i, j, w in support_edges:
        if 0 <= i < n and 0 <= j < n:
            # Bad if opposite signs (support edge connecting contradictory nodes)
            if x[i] * x[j] < 0:
                badness = float(w * max(0.0, -x[i] * x[j]))
                bad_supports.append({
                    "claimAIndex": int(i),
                    "claimBIndex": int(j),
                    "weight": float(w),
                    "badness": badness
                })
    
    # Score contradiction edges
    bad_contradictions = []
    for i, j, w in contradiction_edges:
        if 0 <= i < n and 0 <= j < n:
            # Bad if same sign (contradiction edge connecting agreeing nodes)
            if x[i] * x[j] > 0:
                badness = float(w * max(0.0, x[i] * x[j]))
                bad_contradictions.append({
                    "claimAIndex": int(i),
                    "claimBIndex": int(j),
                    "weight": float(w),
                    "badness": badness
                })
    
    # Sort by badness descending and take top_k
    bad_supports.sort(key=lambda e: e["badness"], reverse=True)
    bad_contradictions.sort(key=lambda e: e["badness"], reverse=True)
    
    top_bad_supports = bad_supports[:top_k]
    top_bad_contradictions = bad_contradictions[:top_k]
    
    # Compute node blame (sum of incident badness)
    node_blame = np.zeros(n, dtype=np.float64)
    
    for edge in bad_supports:
        i = edge["claimAIndex"]
        j = edge["claimBIndex"]
        badness = edge["badness"]
        if 0 <= i < n:
            node_blame[i] += badness
        if 0 <= j < n:
            node_blame[j] += badness
    
    for edge in bad_contradictions:
        i = edge["claimAIndex"]
        j = edge["claimBIndex"]
        badness = edge["badness"]
        if 0 <= i < n:
            node_blame[i] += badness
        if 0 <= j < n:
            node_blame[j] += badness
    
    node_blame_list = [float(node_blame[i]) for i in range(n)]
    
    return {
        "topBadContradictions": top_bad_contradictions,
        "topBadSupports": top_bad_supports,
        "nodeBlame": node_blame_list
    }

def spectral_fingerprint(
    coherence_score: int,
    spectral_gap: float,
    contradiction_energy: float,
    circularity_score: int,
    heat_trace: List[float]
) -> Dict[str, object]:
    """
    Generate a monitoring fingerprint for drift detection.
    
    Returns a compact representation that can be stored and compared over time.
    """
    return {
        "coherenceScore": coherence_score,
        "spectralGap": float(spectral_gap),
        "contradictionEnergy": float(contradiction_energy),
        "circularityScore": circularity_score,
        "heatTrace": [float(h) for h in heat_trace]
    }

# ============================================================================
# CLAIM IMPORTANCE RANKING
# ============================================================================

def spectral_claim_importance(
    n: int,
    truth_vector: List[float],
    support_edges: List[Tuple[int,int,float]],
    contradiction_edges: List[Tuple[int,int,float]],
    grounded_ids: Set[int],
    config: Optional[SpectralConfig] = None
) -> Dict[str, object]:
    """
    Rank claims by their structural importance in the network.
    
    Combines: centrality, truth propagation influence, and grounding distance.
    
    Returns claims that, if corrected, would have maximum coherence impact.
    
    Args:
        n: Number of claims
        truth_vector: Per-claim truth signal values from spectral_truth_vector
        support_edges: List of (i, j, weight) tuples for support edges
        contradiction_edges: List of (i, j, weight) tuples for contradiction edges
        grounded_ids: Set of claim indices that are grounded to evidence
        config: SpectralConfig (optional, uses defaults if None)
    
    Returns:
        Dict with:
            - rankedClaims: List of dicts with claimIndex, importanceScore, centrality,
              influence, groundingDistance, truthValue, priority
            - topCritical: List of claims with priority "CRITICAL"
    """
    if config is None:
        config = SpectralConfig()
    
    if n <= 0:
        return {
            "rankedClaims": [],
            "topCritical": []
        }
    
    x = np.array(truth_vector, dtype=np.float64)
    
    # Build full adjacency (support + contradiction) for centrality
    A = np.zeros((n, n), dtype=np.float64)
    for i, j, w in support_edges:
        if 0 <= i < n and 0 <= j < n:
            A[i, j] += float(w)
            A[j, i] += float(w)  # symmetrize for centrality
    
    for i, j, w in contradiction_edges:
        if 0 <= i < n and 0 <= j < n:
            A[i, j] += float(w)
            A[j, i] += float(w)
    
    # 1. Eigenvector centrality (structural importance)
    centrality = _compute_eigenvector_centrality(A, config.centrality_iterations)
    
    # 2. Truth propagation influence (how much fixing this node affects others)
    influence = _compute_truth_influence(n, x, support_edges)
    
    # 3. Grounding distance (how far from grounded sources)
    grounding_dist = _compute_grounding_distance(n, support_edges, grounded_ids)
    
    # Combined importance score
    importance_scores = []
    for i in range(n):
        # High importance if: central, influential, and problematic truth value
        problem_factor = 1.0 - abs(x[i])  # Low truth certainty = problematic
        
        # Normalize grounding distance (inverse: closer to ground = more important)
        # Use 1.0 if already grounded, otherwise 1/(1+distance)
        if i in grounded_ids:
            grounding_score = 1.0
        else:
            dist = grounding_dist[i]
            if dist == np.inf:
                grounding_score = 0.0  # Unreachable from ground
            else:
                grounding_score = 1.0 / (1.0 + float(dist))
        
        score = (
            config.importance_w_centrality * float(centrality[i]) +
            config.importance_w_influence * float(influence[i]) +
            config.importance_w_grounding * grounding_score +
            config.importance_w_problem * problem_factor
        )
        
        # Determine priority
        if score > config.priority_critical_threshold:
            priority = "CRITICAL"
        elif score > config.priority_high_threshold:
            priority = "HIGH"
        else:
            priority = "MEDIUM"
        
        importance_scores.append({
            "claimIndex": int(i),
            "importanceScore": float(score),
            "centrality": float(centrality[i]),
            "influence": float(influence[i]),
            "groundingDistance": int(grounding_dist[i]) if grounding_dist[i] != np.inf else -1,
            "truthValue": float(x[i]),
            "priority": priority
        })
    
    # Sort by importance score descending
    importance_scores.sort(key=lambda x: x["importanceScore"], reverse=True)
    
    # Extract top critical claims
    top_critical = [c for c in importance_scores if c["priority"] == "CRITICAL"]
    
    return {
        "rankedClaims": importance_scores,
        "topCritical": top_critical
    }


def _compute_eigenvector_centrality(A: np.ndarray, iterations: int) -> np.ndarray:
    """
    Power iteration for eigenvector centrality.
    
    Computes the principal eigenvector of the adjacency matrix, which represents
    the structural importance of each node in the network.
    
    Args:
        A: Symmetric adjacency matrix (n x n)
        iterations: Maximum number of power iteration steps
    
    Returns:
        Normalized eigenvector centrality scores (0-1 scale)
    """
    n = A.shape[0]
    if n == 0:
        return np.array([])
    
    # Initialize with uniform vector
    x = np.ones(n, dtype=np.float64) / np.sqrt(float(n))
    
    # Power iteration: x_{k+1} = A * x_k / ||A * x_k||
    for _ in range(iterations):
        x_new = A @ x
        norm = np.linalg.norm(x_new)
        if norm > 1e-10:  # Use fixed tolerance for convergence check
            x = x_new / norm
        else:
            # Convergence to zero vector (disconnected graph)
            break
    
    # Normalize to [0, 1] scale
    max_val = np.max(x)
    if max_val > 1e-10:  # Use fixed tolerance for normalization check
        x = x / max_val
    
    return x


def _compute_truth_influence(
    n: int,
    truth_vector: np.ndarray,
    support_edges: List[Tuple[int,int,float]]
) -> np.ndarray:
    """
    Compute how much each node influences truth propagation through support edges.
    
    Nodes that strongly influence neighbors' truth values (via support edges) are
    more important to correct, as fixing them will propagate corrections.
    
    Args:
        n: Number of claims
        truth_vector: Per-claim truth values
        support_edges: List of (i, j, weight) tuples
    
    Returns:
        Normalized influence scores (0-1 scale) per node
    """
    influence = np.zeros(n, dtype=np.float64)
    
    for i, j, w in support_edges:
        if 0 <= i < n and 0 <= j < n:
            # Node i influences j proportional to weight and truth difference
            # Larger difference = more influence needed to correct
            truth_diff = abs(truth_vector[i] - truth_vector[j])
            influence[i] += float(w) * truth_diff
    
    # Normalize to [0, 1] scale
    max_inf = np.max(influence)
    if max_inf > 1e-10:  # Use fixed tolerance for normalization check
        influence = influence / max_inf
    
    return influence


def _compute_grounding_distance(
    n: int,
    support_edges: List[Tuple[int,int,float]],
    grounded_ids: Set[int]
) -> np.ndarray:
    """
    Compute shortest path distance from each node to the nearest grounded source.
    
    Uses multi-source BFS starting from all grounded nodes.
    Claims closer to grounded sources are more important to correct, as they
    can propagate corrections back to evidence.
    
    Args:
        n: Number of claims
        support_edges: List of (i, j, weight) tuples (weight ignored for BFS)
        grounded_ids: Set of claim indices that are grounded to evidence
    
    Returns:
        Array of distances (0 for grounded nodes, np.inf for unreachable)
    """
    # Build adjacency list (undirected, from support edges)
    adj = [[] for _ in range(n)]
    for i, j, _ in support_edges:
        if 0 <= i < n and 0 <= j < n:
            adj[i].append(j)
            adj[j].append(i)
    
    # Initialize distances to infinity
    distances = np.full(n, np.inf, dtype=np.float64)
    
    # Multi-source BFS from all grounded nodes
    queue = deque()
    for g_id in grounded_ids:
        if 0 <= g_id < n:
            distances[g_id] = 0.0
            queue.append(g_id)
    
    # BFS traversal
    while queue:
        node = queue.popleft()
        for neighbor in adj[node]:
            if distances[neighbor] == np.inf:
                distances[neighbor] = distances[node] + 1.0
                queue.append(neighbor)
    
    return distances
